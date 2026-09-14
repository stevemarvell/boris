"""Tests for the per-client rate limit on /graphql.

The point of these, in the issue's own words: "a test or a smoke check proves
it is actually in force -- every failure this project has had was configuration
that looked applied and was not." So they check the deployed wiring (the app
api.main builds, with the real default) as well as the behaviour at the edge of
a limit small enough to cross in a test.

Each test that crosses a limit builds its own app. api.limits creates one
limiter per app, so these counters are private to the test and cannot leak into
the rest of the suite -- or be leaked into by it.
"""

import importlib

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from api import limits
from api.main import app, create_app

STATUS_QUERY = {"query": "{ status }"}

# One caller, and the pool of edge nodes their requests arrive through. The
# deployed environment showed five distinct nodes across 150 concurrent
# requests from a single address; these stand in for them.
CALLER = "31.48.12.206"
OTHER_CALLER = "198.51.100.9"
EDGE_POOL = ["152.233.29.1", "152.233.29.2", "152.233.29.3", "152.233.29.4", "152.233.29.5"]


def limited_client(monkeypatch: pytest.MonkeyPatch, limit: str, **kwargs: object) -> TestClient:
    """A client onto a fresh app whose limit is small enough to reach."""
    monkeypatch.setattr(limits, "RATE_LIMIT", limit)
    return TestClient(create_app(), **kwargs)  # type: ignore[arg-type]


def post_graphql(
    client: TestClient,
    forwarded_for: str | None = None,
    real_ip: str | None = None,
):
    headers = {}
    if forwarded_for:
        headers["x-forwarded-for"] = forwarded_for
    if real_ip:
        headers["x-real-ip"] = real_ip
    return client.post("/graphql", json=STATUS_QUERY, headers=headers)


def railway_headers(caller: str, edge: str) -> str:
    """An X-Forwarded-For shaped exactly as Railway's edge sends it.

    Measured against the deployed PR environment: "<caller>, <edge node>",
    where the edge node comes from a pool and varies between requests.
    """
    return f"{caller}, {edge}"


def test_requests_under_the_limit_are_served(monkeypatch: pytest.MonkeyPatch) -> None:
    client = limited_client(monkeypatch, "3/minute")
    for _ in range(3):
        response = post_graphql(client)
        assert response.status_code == 200
        assert response.json()["data"] == {"status": "ok"}


def test_the_request_over_the_limit_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """The error path: a fourth query inside the window is answered, not executed."""
    client = limited_client(monkeypatch, "3/minute")
    for _ in range(3):
        assert post_graphql(client).status_code == 200

    refused = post_graphql(client)
    assert refused.status_code == 429
    assert "Rate limit exceeded" in refused.json()["error"]
    # A well-behaved client should be able to learn when to come back.
    assert refused.headers["retry-after"]
    assert refused.headers["x-ratelimit-limit"] == "3"


def test_a_second_client_keeps_its_own_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """One abuser must not lock everyone else out -- the limit is per client."""
    client = limited_client(monkeypatch, "2/minute")
    for _ in range(2):
        assert post_graphql(client, "203.0.113.7").status_code == 200
    assert post_graphql(client, "203.0.113.7").status_code == 429

    assert post_graphql(client, "198.51.100.4").status_code == 200


def test_one_caller_behind_a_pool_of_edge_nodes_is_one_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The regression test for what shipped broken.

    Railway's edge is a pool, and the hop it appends is the node that handled
    the request, so consecutive requests from one caller arrive with different
    *rightmost* hops. Keying on that hop gave one caller a counter per node:
    120/minute let 571 requests through in twelve seconds against the deployed
    PR environment. Every request here is the same caller.
    """
    client = limited_client(monkeypatch, "3/minute")
    for edge in EDGE_POOL[:3]:
        assert post_graphql(client, railway_headers(CALLER, edge)).status_code == 200

    # A fourth request, through a fourth node. Same caller, so no new budget.
    assert post_graphql(client, railway_headers(CALLER, EDGE_POOL[3])).status_code == 429


def test_the_edge_set_real_ip_is_preferred(monkeypatch: pytest.MonkeyPatch) -> None:
    """X-Real-IP is what Railway sends alongside X-Forwarded-For, with nothing to parse."""
    client = limited_client(monkeypatch, "2/minute")
    for edge in EDGE_POOL[:2]:
        response = post_graphql(client, railway_headers(CALLER, edge), real_ip=CALLER)
        assert response.status_code == 200

    refused = post_graphql(client, railway_headers(CALLER, EDGE_POOL[2]), real_ip=CALLER)
    assert refused.status_code == 429

    # A different caller through the same edge node still has its budget.
    assert (
        post_graphql(client, railway_headers(OTHER_CALLER, EDGE_POOL[2]), OTHER_CALLER).status_code
        == 200
    )


def test_the_socket_address_is_used_when_there_is_no_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Locally there is no X-Forwarded-For, so two hosts must still be told apart."""
    first = limited_client(monkeypatch, "1/minute", client=("127.0.0.1", 5000))
    assert post_graphql(first).status_code == 200
    assert post_graphql(first).status_code == 429

    # Same app object, a different peer: it has not spent anything yet.
    second = TestClient(first.app, client=("127.0.0.2", 5000))
    assert post_graphql(second).status_code == 200


def test_health_is_never_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    """The trap in this change.

    /health is Railway's healthcheck (railway.json) and Playwright's readiness
    probe. Rate limiting it turns a burst into a restart loop, which is worse
    than the burst.
    """
    client = limited_client(monkeypatch, "1/minute")
    for _ in range(10):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["ok"] is True


def test_the_manual_is_not_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    """Static bytes off disk are not what needs protecting; the console's queries are."""
    client = limited_client(monkeypatch, "1/minute")
    for _ in range(10):
        assert client.get("/").status_code == 200


def test_a_refusal_is_still_a_cors_valid_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """CORS wraps the limiter, so a browser can read the 429 rather than see a CORS error."""
    client = limited_client(monkeypatch, "1/minute")
    origin = "https://family-tree-a1b2c3d4-steve-projects.vercel.app"

    assert post_graphql(client).status_code == 200
    refused = client.post("/graphql", json=STATUS_QUERY, headers={"Origin": origin})
    assert refused.status_code == 429
    assert refused.headers.get("access-control-allow-origin") == origin


def test_preflight_does_not_spend_the_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """CORSMiddleware answers OPTIONS itself, so a preflight never reaches the limiter."""
    client = limited_client(monkeypatch, "1/minute")
    for _ in range(5):
        preflight = client.options(
            "/graphql",
            headers={
                "Origin": "https://family-tree-a1b2c3d4-steve-projects.vercel.app",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert preflight.status_code == 200

    assert post_graphql(client).status_code == 200


def test_the_deployed_app_is_limited_at_the_default() -> None:
    """The wiring, not the behaviour: the app api.main builds carries the limit.

    Proved by the headers the limiter injects on a real /graphql call rather
    than by sending 121 requests, which would be a slow test that also poisoned
    the rest of the suite's budget.
    """
    client = TestClient(app)
    response = client.post("/graphql", json=STATUS_QUERY)

    assert response.status_code == 200
    assert response.headers["x-ratelimit-limit"] == limits.DEFAULT_RATE_LIMIT.split("/")[0]


def test_health_carries_no_limit_on_the_deployed_app() -> None:
    """The other half of the wiring: the limiter never even looks at /health."""
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert "x-ratelimit-limit" not in response.headers


def test_the_limit_is_configurable_by_environment_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """API_RATE_LIMIT follows the pattern API_ENVIRONMENT set: read once, at import."""
    monkeypatch.setenv("API_RATE_LIMIT", "7/minute")
    try:
        assert importlib.reload(limits).RATE_LIMIT == "7/minute"
    finally:
        monkeypatch.delenv("API_RATE_LIMIT")
        importlib.reload(limits)

    assert limits.RATE_LIMIT == limits.DEFAULT_RATE_LIMIT


def make_request(headers: dict[str, str], client: tuple[str, int] | None = None) -> Request:
    raw = [(name.lower().encode(), value.encode()) for name, value in headers.items()]
    return Request({"type": "http", "headers": raw, "client": client})


def test_the_key_is_the_caller_not_the_edge_node() -> None:
    """The exact headers the deployed environment sends, keyed the way it must be."""
    request = make_request(
        {
            "x-forwarded-for": f"{CALLER}, {EDGE_POOL[3]}",
            "x-real-ip": CALLER,
        },
        client=("100.64.0.8", 40000),
    )

    assert limits.client_key(request) == CALLER


def test_the_leftmost_hop_is_the_fallback_when_there_is_no_real_ip() -> None:
    request = make_request({"x-forwarded-for": f"{CALLER}, {EDGE_POOL[0]}"})

    assert limits.client_key(request) == CALLER


def test_the_socket_peer_is_the_last_resort() -> None:
    """Railway's mesh address, 100.64.0.0/10, is never the caller -- but locally the peer is."""
    assert limits.client_key(make_request({}, client=("127.0.0.1", 40000))) == "127.0.0.1"


def test_a_client_with_no_address_at_all_still_gets_a_key() -> None:
    """ASGI allows a missing `client`; the limiter must not raise on it."""
    request = Request({"type": "http", "headers": [], "client": None})

    assert limits.client_key(request) == "unknown"


@pytest.mark.parametrize(
    ("path", "limited"),
    [
        ("/graphql", True),
        ("/graphql/", True),
        ("/health", False),
        ("/", False),
        ("/index.html", False),
        # A path that merely starts with the same letters is not the endpoint.
        ("/graphqlite", False),
    ],
)
def test_only_the_graphql_endpoint_is_in_scope(path: str, limited: bool) -> None:
    assert limits.is_limited_path(path) is limited


def test_the_rest_routes_share_the_graphql_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """New paths are unlimited until they opt in, so assert they did.

    /person and /me are cheap next to a deep query, but they walk the tree to
    derive children and siblings, and an unlimited path is a way around the
    limit rather than an exception to it. One budget across both surfaces:
    spending it on /person must leave none for /graphql.
    """
    client = limited_client(monkeypatch, "3/minute")

    assert client.get("/person/fred-shaw").status_code == 200
    assert client.get("/me", headers={"X-Person-Id": "fred-shaw"}).status_code == 200
    assert client.get("/person/nora-pike").status_code == 200

    assert client.get("/person/fred-shaw").status_code == 429
    # And the budget is shared, not per-path.
    assert post_graphql(client).status_code == 429


def test_health_is_still_exempt_beside_the_rest_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Railway healthchecks it; a 429 there reads as an unhealthy deployment."""
    client = limited_client(monkeypatch, "1/minute")

    assert client.get("/person/fred-shaw").status_code == 200
    assert client.get("/person/fred-shaw").status_code == 429
    for _ in range(5):
        assert client.get("/health").status_code == 200


def test_the_limit_is_per_caller_not_per_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: slowapi's default key_style put the path in the bucket.

    With one endpoint that was invisible. /person/{id} makes every id its own
    URL, so the default would have given a caller one budget per person --
    forty-four times the stated limit. Fails before the key_style change.
    """
    client = limited_client(monkeypatch, "3/minute")
    ids = ["fred-shaw", "nora-pike", "albert-shaw", "agnes-shaw", "ellie-shaw"]

    codes = [client.get(f"/person/{person_id}").status_code for person_id in ids]

    assert codes == [200, 200, 200, 429, 429]
