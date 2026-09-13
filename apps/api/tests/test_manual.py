"""Tests for the reference manual the API serves from its own root.

The manual used to be published by GitHub Pages, which a private repository
does not get without a paid plan. It now ships inside the API image and is
mounted at "/" -- which is a catch-all route, so most of what matters here is
that it did not swallow the endpoints it sits alongside.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import main
from api.main import app, create_app, default_manual_path

client = TestClient(app)


def test_the_manual_is_served_at_the_root() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Family Tree API" in response.text


def test_the_manual_ships_its_screenshots() -> None:
    """The page references them relatively, so they have to move with it."""
    response = client.get("/app-generations.jpg")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"


def test_the_manual_queries_its_own_origin() -> None:
    """A relative endpoint is what makes a PR environment's console honest.

    Hardcoded, it would post to production from every deployment -- and would
    need a CORS allowance to do it.
    """
    body = client.get("/").text
    assert "var ENDPOINT = '/graphql';" in body


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
