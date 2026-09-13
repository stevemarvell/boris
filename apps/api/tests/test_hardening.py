"""Tests for the fixes to the unauthenticated GraphQL DoS and the open CORS regex.

See MAX_QUERY_DEPTH in api.schema and the environment gating in api.main for
the reasoning; these tests are the "fails before, passes after" for each.
"""

from typing import Any

from fastapi.testclient import TestClient

from api.main import app, create_app

client = TestClient(app)

# The deepest query the app itself ever sends: apps/web/src/api.ts's
# GENERATIONS query, generations -> people -> spouse/parents/children/siblings
# { name }. Depth 3 by QueryDepthLimiter's count.
GENERATIONS_QUERY = """
{
  generations {
    depth
    people {
      id
      name
      spouse { name }
      parents { name }
      children { name }
      siblings { name }
    }
  }
}
"""

# cousins nested 7 deep is depth 8 -- the exact shape the security review
# measured at 3.1 CPU-seconds against this same 44-person tree.
DEEPLY_NESTED_COUSINS_QUERY = "{ people { " + "cousins { " * 7 + "name" + " }" * 7 + " } }"

INTROSPECTION_QUERY = "{ __schema { types { name } } }"


def test_deeply_nested_query_is_rejected() -> None:
    response = client.post("/graphql", json={"query": DEEPLY_NESTED_COUSINS_QUERY})
    assert response.status_code == 200  # GraphQL reports errors in the body, not the status.
    body = response.json()
    assert "errors" in body
    assert "exceeds maximum operation depth" in body["errors"][0]["message"]


def test_normal_app_query_still_succeeds() -> None:
    response = client.post("/graphql", json={"query": GENERATIONS_QUERY})
    assert response.status_code == 200
    body = response.json()
    assert "errors" not in body, body.get("errors")
    assert sum(len(g["people"]) for g in body["data"]["generations"]) == 44


def test_introspection_is_off_by_default() -> None:
    """The default app has no explicit API_ENVIRONMENT, so it behaves as production."""
    response = client.post("/graphql", json={"query": INTROSPECTION_QUERY})
    assert response.status_code == 200
    body = response.json()
    assert "errors" in body


def test_introspection_is_on_in_development() -> None:
    dev_client = TestClient(create_app(environment="development"))
    response = dev_client.post("/graphql", json={"query": INTROSPECTION_QUERY})
    assert response.status_code == 200
    body = response.json()
    assert "errors" not in body, body.get("errors")
    assert any(t["name"] == "Person" for t in body["data"]["__schema"]["types"])


def test_graphql_ide_is_off_by_default() -> None:
    """A bare GET is how a browser or curl requests the IDE page."""
    response = client.get("/graphql", headers={"accept": "text/html"})
    assert response.status_code == 404


def test_graphql_ide_is_on_in_development() -> None:
    dev_client = TestClient(create_app(environment="development"))
    response = dev_client.get("/graphql", headers={"accept": "text/html"})
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_get_query_is_refused() -> None:
    """GET /graphql?query=... executed queries before the fix -- no auth, no JS needed."""
    response = client.get("/graphql", params={"query": "{ status }"})
    assert response.status_code == 400


def test_post_query_still_works() -> None:
    response: dict[str, Any] = client.post("/graphql", json={"query": "{ status }"}).json()
    assert response["data"] == {"status": "ok"}


def test_cors_allows_a_preview_vercel_origin() -> None:
    """Preview deployments of this project look like family-tree-<hash>-<scope>."""
    origin = "https://family-tree-a1b2c3d4-steve-projects.vercel.app"
    response = client.options(
        "/graphql",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.headers.get("access-control-allow-origin") == origin


def test_cors_refuses_an_unrelated_vercel_origin() -> None:
    """Before the fix, any *.vercel.app origin was allowed -- vercel.app is public."""
    response = client.options(
        "/graphql",
        headers={
            "Origin": "https://some-other-app.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.headers.get("access-control-allow-origin") is None
