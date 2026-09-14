"""Tests for the gate on Swagger UI, ReDoc and the OpenAPI document.

FastAPI serves all three by default, so `/docs`, `/redoc` and `/openapi.json`
were live and unauthenticated on production -- `/docs` being an interactive
console with a "Try it out" button, and `/openapi.json` a published schema of
every route. Three sibling surfaces (introspection, the GraphiQL IDE, the
manual's query console) were each deliberately closed on API_ENVIRONMENT; this
one was never decided, because it came from a framework default rather than a
line anyone wrote. See create_app() in api.main.

The checks go both ways on purpose. Asserting only the 404s would pass just as
well if the gate turned the schema off everywhere, which would take the
documentation away from development for no gain.
"""

from fastapi.testclient import TestClient

from api.main import app, create_app

# The module-level app: no explicit environment, so it is the deployed one.
client = TestClient(app)
production = TestClient(create_app(environment="production"))
development = TestClient(create_app(environment="development"))

SCHEMA_PATHS = ("/docs", "/redoc", "/openapi.json")


def test_the_default_app_serves_no_schema_surface() -> None:
    """A plain create_app() is what Railway runs, since API_ENVIRONMENT is unset there."""
    for path in SCHEMA_PATHS:
        assert client.get(path).status_code == 404, path


def test_production_serves_no_schema_surface() -> None:
    for path in SCHEMA_PATHS:
        assert production.get(path).status_code == 404, path


def test_development_serves_every_schema_surface() -> None:
    for path in SCHEMA_PATHS:
        assert development.get(path).status_code == 200, path


def test_development_swagger_ui_is_the_interactive_console() -> None:
    """The thing being gated: Swagger UI, not merely a path that answers 200."""
    body = development.get("/docs").text
    assert "swagger-ui" in body


def test_development_publishes_the_rest_routes() -> None:
    """The document describes the REST view, which is what makes withholding it matter."""
    schema = development.get("/openapi.json").json()
    assert schema["info"]["title"] == "family-tree-api"
    assert "/me" in schema["paths"]
    assert "/person/{person_id}" in schema["paths"]


def test_production_does_not_shadow_the_manual_or_the_api() -> None:
    """Gating the schema off must not cost the routes that share the app."""
    assert production.get("/health").status_code == 200
    assert "Family Tree API" in production.get("/").text
