"""Tests for the reference manual the API serves from its own root.

The manual used to be published by GitHub Pages, which a private repository
does not get without a paid plan. It now ships inside the API image and is
mounted at "/" -- which is a catch-all route, so most of what matters here is
that it did not swallow the endpoints it sits alongside.

The other half is the query console. It is documentation in development and an
unauthenticated GraphQL console on a public host in production, so it is gated
on API_ENVIRONMENT exactly as the GraphiQL IDE and introspection are. The
manual itself is not gated: production serves the whole document, worked
examples included, minus the button.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import main
from api.main import app, create_app, default_manual_path, render_manual

client = TestClient(app)
development = TestClient(create_app(environment="development"))

# The console's fetch target. Nothing else in the manual contains this string,
# so its absence is the whole console being absent rather than merely hidden.
CONSOLE_ENDPOINT = "var ENDPOINT = '/graphql';"
RUN_BUTTON = '<button type="button" class="primary" id="run">'


def test_the_manual_is_served_at_the_root() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Family Tree API" in response.text


def test_the_manual_is_also_served_at_index_html() -> None:
    """The route in front of the mount has to cover both spellings of it."""
    assert client.get("/index.html").text == client.get("/").text


def test_the_manual_ships_its_screenshots() -> None:
    """The page references them relatively, so they have to move with it."""
    response = client.get("/app-generations.jpg")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"


def test_the_console_is_off_by_default() -> None:
    """Default means production, which should not host a console for itself."""
    body = client.get("/").text
    assert CONSOLE_ENDPOINT not in body
    assert RUN_BUTTON not in body
    assert 'id="query"' not in body
    # The note that replaces it names the button, so "Run query" as a phrase
    # is still on the page. The markup for it is not.
    assert "Run query" in body


def test_the_console_is_on_in_development() -> None:
    body = development.get("/").text
    assert CONSOLE_ENDPOINT in body
    assert RUN_BUTTON in body


def test_the_console_queries_its_own_origin() -> None:
    """A relative endpoint is what makes a PR environment's console honest.

    Hardcoded, it would post to production from every deployment -- and would
    need a CORS allowance to do it.
    """
    assert CONSOLE_ENDPOINT in development.get("/").text


def test_production_says_why_the_console_is_missing_and_how_to_do_without() -> None:
    """Losing the button must not look like a broken page."""
    body = client.get("/").text
    assert "without its query console" in body
    assert "API_ENVIRONMENT" in body
    # A curl the reader can run, pointed at this deployment rather than at
    # production: the hostname carries data-origin, which the script rewrites.
    assert 'curl -s <span data-origin="url">' in body


def test_production_keeps_the_manual_whole() -> None:
    """Only the console goes. The documentation is the reason the page exists."""
    body = client.get("/").text
    for section in ("The service", "The data model", "Queries", "Worked examples", "CORS"):
        assert section in body
    # The worked examples carry the same queries the console's buttons loaded,
    # so the examples survive losing the button.
    assert 'person(id: "fred-shaw")' in body
    assert "generations" in body
    assert body.rstrip().endswith("</html>")


def test_the_manual_does_not_claim_the_root_is_empty() -> None:
    """It said so until the manual moved onto the API, and stayed wrong after.

    A page whose whole job is to describe this service cannot be wrong about
    the URL it is served from.
    """
    body = client.get("/").text
    assert "There is nothing at" not in body
    assert "The page you are reading is what <code>/</code> returns" in body


def test_the_manual_names_the_host_it_came_from_in_both_environments() -> None:
    """The origin rewrite is documentation, so it is outside the console gate.

    Without it a pull request environment's manual would read as production's.
    """
    for served in (client, development):
        assert 'data-origin="host"' in served.get("/").text


def test_the_mount_does_not_swallow_the_api() -> None:
    """A mount at "/" matches everything, so it has to be registered last."""
    assert client.get("/health").json() == {"ok": True, "people": 44}

    response = client.post("/graphql", json={"query": "{ status }"})
    assert response.status_code == 200
    assert response.json()["data"] == {"status": "ok"}


def test_an_unknown_path_is_a_404_not_the_manual() -> None:
    assert client.get("/nope").status_code == 404


def test_default_manual_path_finds_the_manual_in_the_repository() -> None:
    found = default_manual_path()
    assert found is not None
    assert (found / "index.html").exists()


def test_an_app_without_a_manual_still_serves_graphql(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Documentation missing is not a reason to refuse to start.

    The smoke workflow fetches the manual after every merge, so an image that
    drops it fails there rather than taking the API down.
    """
    monkeypatch.setattr(main, "default_manual_path", lambda: None)
    bare = TestClient(create_app())

    assert bare.get("/health").json() == {"ok": True, "people": 44}
    assert bare.post("/graphql", json={"query": "{ status }"}).status_code == 200
    assert bare.get("/").status_code == 404


def test_the_manual_directory_can_be_overridden(tmp_path: Path) -> None:
    """API_MANUAL_DIR, and the `manual` argument behind it, select the source."""
    (tmp_path / "index.html").write_text("<p>a different manual</p>", encoding="utf-8")
    other = TestClient(create_app(manual=tmp_path))

    assert other.get("/").text == "<p>a different manual</p>"
    assert other.get("/health").status_code == 200


def test_a_manual_directory_without_an_index_still_serves_its_files(
    tmp_path: Path,
) -> None:
    """Nothing to render is not a reason to drop the mount."""
    (tmp_path / "shot.txt").write_text("a screenshot, pretend", encoding="utf-8")
    other = TestClient(create_app(manual=tmp_path))

    assert other.get("/shot.txt").status_code == 200
    assert other.get("/health").status_code == 200


CONSOLE = "<!-- console:start -->a run button<!-- console:end -->"
NOTE = "<!-- no-console:start -->use curl instead<!-- no-console:end -->"
PAGE = f"before {CONSOLE} {NOTE} after"


def test_render_manual_drops_the_console_in_production() -> None:
    """The half that is kept keeps its markers -- they are only HTML comments."""
    rendered = render_manual(PAGE, is_development=False)
    assert "a run button" not in rendered
    assert NOTE in rendered
    assert rendered.startswith("before ")
    assert rendered.endswith(" after")


def test_render_manual_drops_the_note_in_development() -> None:
    rendered = render_manual(PAGE, is_development=True)
    assert "use curl instead" not in rendered
    assert CONSOLE in rendered


def test_render_manual_drops_every_region_not_just_the_first() -> None:
    """The console is two regions: the section, and the script at the foot."""
    two = (
        "a<!-- console:start -->x<!-- console:end -->b<!-- console:start -->y<!-- console:end -->c"
    )
    assert render_manual(two, is_development=False) == "abc"


def test_render_manual_leaves_a_document_with_no_markers_alone() -> None:
    assert render_manual("<p>plain</p>", is_development=False) == "<p>plain</p>"


def test_an_unterminated_console_region_fails_closed() -> None:
    """A mistyped end marker loses documentation, never leaks the console."""
    assert render_manual("keep <!-- console:start -->run query", is_development=False) == "keep "
