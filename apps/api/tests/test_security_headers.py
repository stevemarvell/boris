"""Tests for the security response headers, on every path that can answer.

The issue these close (#53) is hardening rather than a live hole, but the
failure mode it warns about is the one this repository keeps hitting: a control
that is installed and inert. So none of these tests assert that the middleware
is in the stack. They assert the headers arrive -- on the HTML manual, on a
screenshot off the static mount, on /graphql, on /health, on a 404, on the 429
the rate limiter returns without ever calling the app, and on a CORS preflight
that CORSMiddleware answers without calling it either. Those last two are the
ordering trap: both are produced by a middleware, so only a middleware outside
them can add anything to the response.

`api.security_headers` carries the reasoning for each header and the CSP
decision; this file is the evidence.
"""

import re
from pathlib import Path

import pytest
import strawberry
from fastapi.testclient import TestClient

from api import limits
from api.main import app, create_app
from api.security_headers import IDE_CDN, build_csp

client = TestClient(app)
development = TestClient(create_app(environment="development"))

# The minimum the issue asks for, plus the CSP that carries the frame guard.
EXPECTED = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
}

PREVIEW_ORIGIN = "https://family-tree-a1b2c3d4-steve-projects.vercel.app"


def assert_hardened(response, *, expect_csp: str | None = None) -> None:
    """Every header, on whatever response is passed in."""
    for name, value in EXPECTED.items():
        assert response.headers.get(name) == value, f"{name} missing on {response.url}"
    csp = response.headers.get("content-security-policy")
    assert csp, f"no CSP on {response.url}"
    assert "frame-ancestors 'none'" in csp
    if expect_csp is not None:
        assert csp == expect_csp


def test_the_manual_carries_the_headers() -> None:
    """The document that made these necessary: HTML, with inline script."""
    response = client.get("/")
    assert response.status_code == 200
    assert_hardened(response, expect_csp=build_csp(is_development=False))


def test_a_static_file_off_the_mount_carries_them() -> None:
    """StaticFiles streams its own FileResponse -- a header hook can miss it."""
    response = client.get("/app-generations.jpg")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert_hardened(response)


def test_graphql_carries_them() -> None:
    response = client.post("/graphql", json={"query": "{ status }"})
    assert response.status_code == 200
    assert response.json()["data"] == {"status": "ok"}
    assert_hardened(response)


def test_health_carries_them() -> None:
    """The path Playwright polls to decide the API is up."""
    response = client.get("/health")
    assert response.status_code == 200
    assert_hardened(response)


def test_a_404_carries_them() -> None:
    """The mount at "/" answers for everything unmatched, including misses."""
    response = client.get("/no-such-page")
    assert response.status_code == 404
    assert_hardened(response)


def test_a_graphql_error_response_carries_them() -> None:
    """GET /graphql?query= is refused with a 400 by the router itself."""
    response = client.get("/graphql", params={"query": "{ status }"})
    assert response.status_code == 400
    assert_hardened(response)


def test_a_429_carries_them(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ordering trap, first half.

    The rate limiter returns its 429 from inside its own middleware without
    calling the app, so a header layer registered *before* it -- and therefore
    inside it -- would never see this response. It is also the response most
    worth hardening: it is what an abusive client gets, repeatedly.
    """
    monkeypatch.setattr(limits, "RATE_LIMIT", "2/minute")
    limited = TestClient(create_app())
    for _ in range(2):
        assert limited.post("/graphql", json={"query": "{ status }"}).status_code == 200

    refused = limited.post("/graphql", json={"query": "{ status }"})
    assert refused.status_code == 429
    assert_hardened(refused)


def test_a_cors_preflight_carries_them() -> None:
    """The ordering trap, second half.

    CORSMiddleware answers a preflight itself and never calls downstream, so
    this response only carries the headers if the header middleware is outside
    CORS too -- which means it has to be the last one added.
    """
    response = client.options(
        "/graphql",
        headers={
            "Origin": PREVIEW_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PREVIEW_ORIGIN
    assert_hardened(response)


def test_a_refused_cors_preflight_carries_them() -> None:
    """The "Disallowed CORS origin" response comes from the same middleware."""
    response = client.options(
        "/graphql",
        headers={
            "Origin": "https://some-other-app.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.headers.get("access-control-allow-origin") is None
    assert_hardened(response)


def test_a_cors_allowance_does_not_expose_the_policy_to_the_page() -> None:
    """A sanity check on the pair: the headers are set, CORS is unchanged.

    The rate limiter's own headers still arrive too, so nothing in the new
    layer is dropping what an inner one set.
    """
    response = client.post(
        "/graphql",
        json={"query": "{ status }"},
        headers={"Origin": PREVIEW_ORIGIN},
    )
    assert response.headers["access-control-allow-origin"] == PREVIEW_ORIGIN
    assert response.headers["x-ratelimit-limit"]
    assert_hardened(response)


def test_production_csp_permits_no_external_origin() -> None:
    """The policy that ships. 'unsafe-inline' is granted; hosts are not."""
    csp = build_csp(is_development=False)
    assert "default-src 'none'" in csp
    assert "connect-src 'self'" in csp
    assert "base-uri 'none'" in csp
    assert "form-action 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    # The decision, asserted rather than described: inline is permitted, and
    # extracting the manual's script is what would let this come out.
    assert "script-src 'self' 'unsafe-inline'" in csp
    # No host anywhere in it -- an injected <script src> loads nothing.
    assert "http" not in csp


def test_development_csp_permits_the_ide_cdn_and_production_does_not() -> None:
    assert IDE_CDN in build_csp(is_development=True)
    assert IDE_CDN not in build_csp(is_development=False)


def test_the_development_ide_page_carries_the_development_policy() -> None:
    response = development.get("/graphql", headers={"accept": "text/html"})
    assert response.status_code == 200
    assert_hardened(response, expect_csp=build_csp(is_development=True))


def graphiql_template() -> str:
    return (Path(strawberry.__file__).parent / "static" / "graphiql.html").read_text(
        encoding="utf-8"
    )


def test_every_host_the_ide_loads_from_is_permitted_in_development() -> None:
    """The IDE is served from this origin but its assets are not on it.

    Strawberry's GraphiQL template pulls React, GraphiQL and the explorer
    plugin from a CDN. A CSP strict enough for production leaves that page
    blank, which is why development has its own policy -- and why this test
    reads the shipped template rather than trusting a hardcoded host: a
    Strawberry upgrade that moves the IDE to a different CDN fails here instead
    of failing silently in someone's browser.
    """
    template = graphiql_template()
    hosts = {
        match.group(0)
        for match in re.finditer(r"https://[a-z0-9.-]+", template)
        # w3.org is the SVG xmlns, a namespace identifier rather than a fetch.
        if "w3.org" not in match.group(0)
    }
    assert hosts, "found no external assets in the GraphiQL template -- check the regex"

    csp = build_csp(is_development=True)
    for host in hosts:
        assert host in csp, f"the IDE loads from {host}, which the development CSP forbids"


def test_the_production_app_never_serves_the_ide_that_needs_the_cdn() -> None:
    """Why production can afford the strict policy: there is no IDE to break."""
    assert client.get("/graphql", headers={"accept": "text/html"}).status_code == 404


# --- Access-Control-Expose-Headers -------------------------------------------
#
# A different kind of header from the ones above: these tests are not about
# what the server *sends* but about what a browser is allowed to *read*. A
# cross-origin response hands JavaScript only the seven safelisted names unless
# Access-Control-Expose-Headers names more, so every other header this API sets
# was arriving and being discarded (issue #89).
#
# TestClient has no CORS layer, so it can only assert the permission is
# granted, never that a browser honours it. That half is
# apps/web/e2e/cors-expose-headers.spec.ts, which reads Retry-After off a real
# cross-origin 429 in a real browser -- the only check that would have caught
# this, because curl and TestClient both lack the constraint production has.

# Everything api.rest and api.limits set that is not CORS-safelisted.
EXPOSED = {
    "retry-after",
    "content-location",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
}


def exposed_names(response) -> set[str]:
    """The header names the response permits a cross-origin page to read."""
    header = response.headers.get("access-control-expose-headers")
    assert header, f"no access-control-expose-headers on {response.url}"
    return {name.strip().lower() for name in header.split(",") if name.strip()}


def test_a_cors_response_permits_reading_every_header_it_sets() -> None:
    """The allowance itself, on an ordinary 200."""
    response = client.post(
        "/graphql",
        json={"query": "{ status }"},
        headers={"Origin": PREVIEW_ORIGIN},
    )
    assert response.status_code == 200
    assert exposed_names(response) >= EXPOSED


def test_the_rate_limit_headers_are_both_sent_and_readable() -> None:
    """headers_enabled=True is pointless if the browser strips the result.

    The limiter's comment says it tells a well-behaved client what its budget
    is. That claim needs both halves: the header present, and named in the
    exposure list.
    """
    response = client.post(
        "/graphql",
        json={"query": "{ status }"},
        headers={"Origin": PREVIEW_ORIGIN},
    )
    names = exposed_names(response)
    for header in ("x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"):
        assert response.headers.get(header), f"{header} not sent"
        assert header in names, f"{header} sent but not readable cross-origin"


def test_me_exposes_the_content_location_it_sets() -> None:
    """/me names the identical /person/{id} resource. Unreadable is unusable."""
    response = client.get(
        "/me",
        headers={"Origin": PREVIEW_ORIGIN, "X-Person-Id": "fred-shaw"},
    )
    assert response.status_code == 200
    assert response.headers["content-location"].endswith("/person/fred-shaw")
    assert "content-location" in exposed_names(response)


def test_a_429_exposes_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    """The response the exposure exists for.

    A 429 is produced inside the limiter, which sits inside CORSMiddleware, so
    this also pins the ordering: were CORS the inner layer, the refusal would
    go out with no exposure list and apps/web/src/api.ts would read null from
    `retry-after` exactly as it did in production.
    """
    monkeypatch.setattr(limits, "RATE_LIMIT", "2/minute")
    limited = TestClient(create_app())
    for _ in range(2):
        assert (
            limited.post(
                "/graphql",
                json={"query": "{ status }"},
                headers={"Origin": PREVIEW_ORIGIN},
            ).status_code
            == 200
        )

    refused = limited.post(
        "/graphql",
        json={"query": "{ status }"},
        headers={"Origin": PREVIEW_ORIGIN},
    )
    assert refused.status_code == 429
    assert refused.headers["access-control-allow-origin"] == PREVIEW_ORIGIN
    assert refused.headers["retry-after"]
    assert exposed_names(refused) >= EXPOSED
