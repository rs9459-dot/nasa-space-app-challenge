from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from engine import bundle, contract, plan as planner
from engine.app import app
from engine.tests.conftest import FIELD_ID

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
PRIORITIES = {"water": 0.5, "income": 0.25, "drought": 0.25}


@pytest.fixture
def client(data_root, monkeypatch) -> TestClient:
    monkeypatch.setenv("ENGINE_API_TOKEN", TOKEN)
    return TestClient(app)


def test_health_needs_no_token_and_names_stand_ins(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "farmline-engine" and body["token_configured"] is True
    missing = planner.stand_ins()
    assert body["model"] == ("live" if not missing else "stand-ins: " + ", ".join(missing))


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
    {"field_id": FIELD_ID, "current_crop": "alfalfa", "priorities": PRIORITIES},
    {"place": "Testville", "current_crop": "alfalfa", "priorities": PRIORITIES},
    {"lat": 39.38, "lon": -118.77, "current_crop": None, "priorities": PRIORITIES},  # crop from the field's history
])
def test_plan_computes_a_contract_valid_answer(client, request_body):
    r = client.post("/plan", json=request_body, headers=AUTH)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert contract.problems(doc) == []
    assert doc["field"] == {"id": FIELD_ID, "place": "Testville, Nevada", "current_rotation": ["alfalfa"] * 3}
    assert doc["years_tested"] == 2
    # the bundle's datasets first; the signals step (H7) adds what it used or could not use
    assert doc["data_sources"][:3] == [bundle.SAMPLE_SOURCE, "TEST soil", "TEST allocations"]
    assert doc["sample_data"] is True  # the test bundle is a sample
    if planner.stand_ins():
        assert doc["_note"].startswith("NOT A REAL RESULT")
    # computed, not the contract sample: alfalfa on this fake field uses far less than 5.2 AF
    assert doc["baseline"]["water_af_per_acre"] != 5.2
    assert {tuple(o["rotation"]) for o in doc["options"]}.isdisjoint({("sorghum", "safflower", "barley")})


def test_priorities_change_the_answer(client):
    def ask(priorities):
        r = client.post("/plan", json={"field_id": FIELD_ID, "current_crop": "alfalfa", "priorities": priorities}, headers=AUTH)
        return r.json()["options"]
    water_first = ask({"water": 1.0, "income": 0.0, "drought": 0.0})
    income_first = ask({"water": 0.0, "income": 1.0, "drought": 0.0})
    assert water_first[0]["water_af_per_acre"] <= income_first[0]["water_af_per_acre"]
    assert income_first[1]["income_usd_per_acre"] >= water_first[1]["income_usd_per_acre"]


@pytest.mark.parametrize("body,status,code,text", [
    ({"zip": "89406"}, 400, "bad_request", "priorities"),
    ({"zip": "89406", "current_crop": "kale", "priorities": PRIORITIES}, 400, "bad_request", "current_crop"),
    ({"zip": "89406", "priorities": PRIORITIES, "phone": "+15555550100"}, 400, "bad_request", "phone"),
    ({"zip": "00000", "priorities": PRIORITIES}, 404, "field_not_found", "zip 00000"),
    ({"field_id": "nope", "priorities": PRIORITIES}, 404, "field_not_found", "nope"),
    # a real crop code the reference table has no row for
    ({"field_id": FIELD_ID, "current_crop": "rice", "priorities": PRIORITIES}, 422, "no_data", "no row for 'rice'"),
])
def test_plan_errors(client, body, status, code, text):
    r = client.post("/plan", json=body, headers=AUTH)
    assert (r.status_code, r.json()["error"]) == (status, code), r.text
    assert text in r.json()["message"]
    assert contract.problems(r.json()) == []


def test_no_crop_given_and_no_history_asks_for_the_crop(client, data_root):
    (data_root / "fields" / FIELD_ID / "crop_history.json").unlink()
    r = client.post("/plan", json={"field_id": FIELD_ID, "priorities": PRIORITIES}, headers=AUTH)
    assert r.status_code == 400 and "say what you grow now" in r.json()["message"]


def test_plan_rejects_non_json(client):
    r = client.post("/plan", content=b"not json", headers=AUTH)
    assert r.status_code == 400 and r.json()["error"] == "bad_request"


def test_broken_bundle_is_no_data(client, data_root):
    (data_root / "fields" / FIELD_ID / "soil.json").unlink()
    r = client.post("/plan", json={"field_id": FIELD_ID, "priorities": PRIORITIES}, headers=AUTH)
    assert r.status_code == 422 and r.json() == {"error": "no_data", "message": f"{FIELD_ID}/soil.json is missing"}


def test_an_answer_that_breaks_the_contract_is_never_sent(client, monkeypatch):
    real = planner.rank.choose

    def broken(*args, **kwargs):
        result = real(*args, **kwargs)
        result["options"][0]["income_usd_per_acre"] = 783  # not rounded to 10
        return result

    monkeypatch.setattr(planner.rank, "choose", broken)
    r = client.post("/plan", json={"field_id": FIELD_ID, "current_crop": "alfalfa", "priorities": PRIORITIES}, headers=AUTH)
    assert r.status_code == 500
    assert r.json() == {"error": "engine_failed", "message": "The engine could not compute a plan for this field"}
