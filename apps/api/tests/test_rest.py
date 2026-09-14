"""Tests for the REST view: /person/{id} and /me.

The pair's whole claim is that they are one resource reached two ways, so the
test that matters most is the one asserting the bodies are identical.
"""

import json

import pytest
from fastapi.testclient import TestClient

from api import rest
from api.main import app
from api.tree import default_data_path

client = TestClient(app)

FRED = "fred-shaw"


def test_person_returns_the_record() -> None:
    body = client.get(f"/person/{FRED}").json()

    assert body["id"] == FRED
    assert body["name"] == "Fred Shaw"
    assert body["spouse"] == {"id": "ellie-shaw", "name": "Ellie Shaw"}
    assert {p["name"] for p in body["parents"]} == {"Frank Shaw", "Margaret Shaw"}
    assert {p["name"] for p in body["children"]} == {"Daisy Shaw", "Sam Shaw"}


def test_person_derives_rather_than_stores() -> None:
    """The project's central rule, asserted across the wire.

    children, siblings and generation appear in the response and in no file.
    If one ever gets stored, this fails and should.
    """
    stored = json.loads(default_data_path().read_text(encoding="utf-8"))
    fred = next(p for p in stored["people"] if p["id"] == FRED)
    assert set(fred) == {"id", "name", "parents", "spouse"}

    body = client.get(f"/person/{FRED}").json()
    assert set(body) >= {"children", "siblings", "generation"}
    assert body["generation"] == 2


def test_unknown_person_is_404_not_an_empty_record() -> None:
    response = client.get("/person/nobody-at-all")

    assert response.status_code == 404
    assert "nobody-at-all" in response.json()["detail"]


def test_the_zero_cases_are_empty_lists_not_missing_keys() -> None:
    # Albert is the oldest generation: no parents, no siblings recorded.
    albert = client.get("/person/albert-shaw").json()
    assert albert["parents"] == []
    assert albert["siblings"] == []
    assert albert["spouse"] == {"id": "agnes-shaw", "name": "Agnes Shaw"}

    # Nora never married and has no children, but she does have parents.
    nora = client.get("/person/nora-pike").json()
    assert nora["spouse"] is None
    assert nora["children"] == []
    assert nora["parents"] != []


def test_me_is_the_same_resource_as_that_person_url() -> None:
    """The point of the pair. If these ever diverge, /me is lying."""
    me = client.get("/me", headers={"X-Person-Id": FRED})
    by_id = client.get(f"/person/{FRED}")

    assert me.status_code == by_id.status_code == 200
    assert me.json() == by_id.json()
    assert me.content == by_id.content


def test_me_points_at_the_canonical_url() -> None:
    me = client.get("/me", headers={"X-Person-Id": FRED})

    assert me.headers["content-location"].endswith(f"/person/{FRED}")


def test_me_refuses_to_be_cached_by_anything_shared() -> None:
    """It varies by caller, so a shared cache would hand one person another's."""
    me = client.get("/me", headers={"X-Person-Id": FRED})

    assert me.headers["cache-control"] == "private, no-store"


def test_me_without_an_identity_is_401() -> None:
    response = client.get("/me")

    assert response.status_code == 401
    assert "X-Person-Id" in response.json()["detail"]


def test_me_as_someone_outside_the_tree_is_404() -> None:
    """Signed in is not the same as present. 401 would be the wrong answer."""
    response = client.get("/me", headers={"X-Person-Id": "a-stranger"})

    assert response.status_code == 404
    assert "a-stranger" in response.json()["detail"]


def test_a_default_identity_stands_in_for_a_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.main import create_app

    monkeypatch.setattr(rest, "DEFAULT_IDENTITY", FRED)
    pinned = TestClient(create_app())

    assert pinned.get("/me").json()["id"] == FRED
    # An explicit header still wins over the default.
    assert pinned.get("/me", headers={"X-Person-Id": "nora-pike"}).json()["id"] == "nora-pike"


def test_the_rest_routes_did_not_shadow_anything() -> None:
    assert client.get("/health").json()["ok"] is True
    assert client.post("/graphql", json={"query": "{ status }"}).status_code == 200
    assert "Family Tree API" in client.get("/").text
