import importlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api import main
from api.main import app

client = TestClient(app)


def query(document: str) -> dict[str, Any]:
    response = client.post("/graphql", json={"query": document})
    assert response.status_code == 200
    return response.json()


def data(document: str) -> dict[str, Any]:
    body = query(document)
    assert "errors" not in body, body["errors"]
    return body["data"]


def test_health_reports_the_loaded_tree() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "people": 44, "commit": None}


def test_graphql_status() -> None:
    assert data("{ status }") == {"status": "ok"}


def test_graphql_rejects_unknown_field() -> None:
    assert "errors" in query("{ nope }")


def test_people_returns_everyone() -> None:
    assert len(data("{ people { id } }")["people"]) == 44


def test_person_by_id_with_relationships() -> None:
    fred = data(
        """
        { person(id: "fred-shaw") {
            name
            generation
            spouse { name }
            children { name }
            siblings { name }
            parents { name }
            grandparents { name }
            cousins { name }
            descendants { name }
        } }
        """
    )["person"]
    assert fred["name"] == "Fred Shaw"
    assert fred["spouse"]["name"] == "Ellie Shaw"
    assert [c["name"] for c in fred["children"]] == ["Daisy Shaw", "Sam Shaw"]
    assert [s["name"] for s in fred["siblings"]] == ["Sally Baker"]
    assert [p["name"] for p in fred["parents"]] == ["Frank Shaw", "Margaret Shaw"]
    assert len(fred["grandparents"]) == 4
    assert [c["name"] for c in fred["cousins"]] == [
        "Gemma Hale-Nunn",
        "George Hale",
        "Hugo Shaw",
        "Isaac Clay",
        "Ivy Clay",
    ]
    assert [d["name"] for d in fred["descendants"]] == ["Daisy Shaw", "Sam Shaw"]


def test_descendants_walk_the_whole_line() -> None:
    albert = data('{ person(id: "albert-shaw") { descendants { id } } }')["person"]
    assert len(albert["descendants"]) == 11
    assert "toby-baker" in [d["id"] for d in albert["descendants"]]


def test_unknown_person_is_null_not_an_error() -> None:
    body = query('{ person(id: "nobody") { name } }')
    assert "errors" not in body
    assert body["data"]["person"] is None


def test_generations_returns_the_whole_tree_oldest_first() -> None:
    generations = data("{ generations { depth people { name } } }")["generations"]
    assert [g["depth"] for g in generations] == [0, 1, 2, 3]
    assert sum(len(g["people"]) for g in generations) == 44
    assert "Albert Shaw" in [p["name"] for p in generations[0]["people"]]
    assert [p["name"] for p in generations[3]["people"]] == [
        "Daisy Shaw",
        "Rory Nunn",
        "Rosie Nunn",
        "Sam Shaw",
        "Toby Baker",
    ]


def test_zero_cases_serialise_as_empty_lists_and_null() -> None:
    nora = data('{ person(id: "nora-pike") { spouse { name } children { name } } }')["person"]
    assert nora == {"spouse": None, "children": []}

    olivia = data('{ person(id: "olivia-vance") { spouse { name } children { name } } }')["person"]
    assert olivia["spouse"]["name"] == "Peter Vance"
    assert olivia["children"] == []

    albert = data('{ person(id: "albert-shaw") { siblings { name } parents { name } } }')["person"]
    assert albert == {"siblings": [], "parents": []}


def test_cousins_and_descendants_are_empty_lists_when_there_are_none() -> None:
    nora = data('{ person(id: "nora-pike") { cousins { name } descendants { name } } }')["person"]
    assert nora == {"cousins": [], "descendants": []}

    albert = data('{ person(id: "albert-shaw") { cousins { name } } }')["person"]
    assert albert == {"cousins": []}

    for youngest in ("daisy-shaw", "sam-shaw"):
        person = data(f'{{ person(id: "{youngest}") {{ descendants {{ name }} }} }}')["person"]
        assert person == {"descendants": []}


def test_cors_allows_local_and_vercel_origins() -> None:
    """The loopback address is not spelled 'localhost'; e2e runs on 127.0.0.1."""
    for origin in (
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "https://family-tree-flame-ten.vercel.app",
    ):
        response = client.options(
            "/graphql",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.headers.get("access-control-allow-origin") == origin, origin


def test_cors_refuses_every_github_pages_origin() -> None:
    """The manual moved here from Pages, so no github.io origin is admitted.

    Including the account that used to be: an allowance nothing needs is one
    more way in, and *.github.io is a domain shared with every GitHub user.
    """
    for origin in ("https://stevemarvell.github.io", "https://someone-else.github.io"):
        response = client.options(
            "/graphql",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.headers.get("access-control-allow-origin") is None, origin


def test_health_reports_the_commit_it_was_built_from(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Vercel injects VERCEL_GIT_COMMIT_SHA; smoke compares it to its own ref.

    Without it a deployment that silently did not happen is indistinguishable
    from one that did -- which is the detection half of issue #50.
    """
    monkeypatch.setattr(main, "DEPLOYED_COMMIT", "0123456789abcdef")
    stamped = TestClient(main.create_app())

    assert stamped.get("/health").json() == {
        "ok": True,
        "people": 44,
        "commit": "0123456789abcdef",
    }


def test_deployed_commit_reads_the_vercel_variable_by_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The two tests above patch the module attribute directly, so neither
    would catch a typo in the env var name itself -- #126 renamed it from
    Railway's RAILWAY_GIT_COMMIT_SHA and this is what would have caught it
    getting the new name wrong. Follows the pattern api.limits.RATE_LIMIT
    tests: set the env var, reload the module, check what it picked up.
    """
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "fedcba9876543210")
    try:
        assert importlib.reload(main).DEPLOYED_COMMIT == "fedcba9876543210"
    finally:
        monkeypatch.delenv("VERCEL_GIT_COMMIT_SHA")
        importlib.reload(main)


def test_health_reports_no_commit_when_the_platform_does_not_say(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local runs and the container tests have no Vercel variable to read."""
    monkeypatch.setattr(main, "DEPLOYED_COMMIT", None)
    bare = TestClient(main.create_app())

    assert bare.get("/health").json()["commit"] is None
