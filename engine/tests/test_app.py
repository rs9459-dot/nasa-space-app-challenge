from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from engine.app import RESPONSE_SCHEMA, app
from engine.tests.conftest import FIELD_ID
from engine.tests.test_contracts import contract_problems

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
PRIORITIES = {"water": 0.5, "income": 0.25, "drought": 0.25}


@pytest.fixture
def client(data_root, monkeypatch) -> TestClient:
    monkeypatch.setenv("ENGINE_API_TOKEN", TOKEN)
    return TestClient(app)


def test_health_needs_no_token(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"service": "farmline-engine", "status": "ok", "token_configured": True, "model": "skeleton"}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}])
def test_plan_needs_the_token(client, headers):
    r = client.post("/plan", json={"zip": "89406", "priorities": PRIORITIES}, headers=headers)
    assert r.status_code == 401 and r.json()["error"] == "unauthorized"


def test_no_configured_token_means_closed(client, monkeypatch):
    monkeypatch.delenv("ENGINE_API_TOKEN")
    r = client.post("/plan", json={"zip": "89406", "priorities": PRIORITIES}, headers={"Authorization": "Bearer "})
    assert r.status_code == 401


@pytest.mark.parametrize("request_body", [
    {"zip": "89406", "current_crop": "alfalfa", "priorities": PRIORITIES},
    {"field_id": FIELD_ID, "priorities": PRIORITIES},
    {"place": "Testville", "priorities": PRIORITIES},
    {"lat": 39.38, "lon": -118.77, "current_crop": None, "priorities": PRIORITIES},
])
def test_plan_returns_a_contract_valid_answer(client, request_body):
    r = client.post("/plan", json=request_body, headers=AUTH)
    assert r.status_code == 200
    doc = r.json()
    assert list(RESPONSE_SCHEMA.iter_errors(doc)) == []
    assert contract_problems(doc) == []
    assert doc["field"] == {"id": FIELD_ID, "place": "Testville, NV", "current_rotation": ["alfalfa"] * 3}
    assert doc["sample_data"] is True and doc["_note"].startswith("SKELETON")


@pytest.mark.parametrize("body,status,code,text", [
    ({"zip": "89406"}, 400, "bad_request", "priorities"),
    ({"zip": "89406", "current_crop": "kale", "priorities": PRIORITIES}, 400, "bad_request", "current_crop"),
    ({"zip": "89406", "priorities": PRIORITIES, "phone": "+15555550100"}, 400, "bad_request", "phone"),
    ({"zip": "00000", "priorities": PRIORITIES}, 404, "field_not_found", "zip 00000"),
    ({"field_id": "nope", "priorities": PRIORITIES}, 404, "field_not_found", "nope"),
])
def test_plan_errors(client, body, status, code, text):
    r = client.post("/plan", json=body, headers=AUTH)
    assert (r.status_code, r.json()["error"]) == (status, code)
    assert text in r.json()["message"]
    assert list(RESPONSE_SCHEMA.iter_errors(r.json())) == []


def test_plan_rejects_non_json(client):
    r = client.post("/plan", content=b"not json", headers=AUTH)
    assert r.status_code == 400 and r.json()["error"] == "bad_request"


def test_broken_bundle_is_no_data(client, data_root):
    (data_root / "fields" / FIELD_ID / "soil.json").unlink()
    r = client.post("/plan", json={"field_id": FIELD_ID, "priorities": PRIORITIES}, headers=AUTH)
    assert r.status_code == 422 and r.json() == {"error": "no_data", "message": f"{FIELD_ID}/soil.json is missing"}
