from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_graphql_status() -> None:
    response = client.post("/graphql", json={"query": "{ status }"})
    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ok"}}


def test_graphql_rejects_unknown_field() -> None:
    response = client.post("/graphql", json={"query": "{ nope }"})
    assert "errors" in response.json()
