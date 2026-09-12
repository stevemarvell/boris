from typing import Any

from fastapi.testclient import TestClient

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
    assert response.json() == {"ok": True, "people": 44}


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
        "Gemma Hale",
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
