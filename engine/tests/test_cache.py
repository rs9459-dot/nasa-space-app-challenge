"""The per-field cache: same answers as computing from scratch, much faster the second time."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from engine import cache, plan, rank, water
from engine.app import app
from engine.bundle import BundleError
from engine.tests.conftest import FIELD_ID
from engine.types import Signals

REQUEST = {"field_id": FIELD_ID, "current_crop": "alfalfa", "priorities": {"water": 0.5, "income": 0.25, "drought": 0.25}}


def from_scratch(request: dict) -> dict:
    """The answer the way make_plan computed it before the cache existed."""
    from engine import bundle
    field, ref = bundle.load(request["field_id"])
    rotations = plan.candidate_rotations(field, ref)
    module = plan.optional("signals")
    signals = module.compute(field) if module else Signals()
    outcomes, base = plan.evaluate(field, ref, signals, rotations, (request["current_crop"],) * 3)
    return rank.choose(outcomes, base, request["priorities"], field, sources=[*field.sources, *signals.sources])


def count_simulations(monkeypatch) -> list[int]:
    calls: list[int] = []
    real = water.simulate

    def counted(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)
    monkeypatch.setattr(water, "simulate", counted)
    return calls


@pytest.mark.parametrize("crop,priorities", [
    ("alfalfa", {"water": 0.5, "income": 0.25, "drought": 0.25}),
    ("barley", {"water": 0.1, "income": 0.8, "drought": 0.1}),
    ("fallow", {"water": 0.34, "income": 0.33, "drought": 0.33}),
])
def test_cached_answer_is_the_same_as_from_scratch(data_root, crop, priorities):
    request = {**REQUEST, "current_crop": crop, "priorities": priorities}
    cached = plan.make_plan(request)
    expected = from_scratch(request)
    for key in ("field", "baseline", "options", "years_tested", "data_sources"):
        assert cached[key] == expected[key], key


def test_second_text_does_no_simulation(data_root, monkeypatch):
    calls = count_simulations(monkeypatch)
    plan.make_plan(REQUEST)
    first = len(calls)
    plan.make_plan({**REQUEST, "current_crop": "barley", "priorities": {"water": 0.1, "income": 0.8, "drought": 0.1}})
    assert first >= 1 and len(calls) == first


def test_restart_reads_the_disk_cache(data_root, monkeypatch):
    answer = plan.make_plan(REQUEST)
    assert (data_root / "cache" / f"{FIELD_ID}.pkl").exists()
    cache.clear()  # like a restart: memory empty, disk kept
    calls = count_simulations(monkeypatch)
    assert plan.make_plan(REQUEST)["options"] == answer["options"] and calls == []


def test_changed_data_is_rebuilt_not_served_stale(data_root, monkeypatch):
    plan.make_plan(REQUEST)
    calls = count_simulations(monkeypatch)
    water_file = data_root / "fields" / FIELD_ID / "water.json"
    table = json.loads(water_file.read_text())
    table["allocation_fraction_by_year"]["2001"] = 0.25
    water_file.write_text(json.dumps(table))
    plan.make_plan(REQUEST)
    assert calls, "new water data must trigger a new simulation"


def test_a_request_cannot_change_the_cache(data_root):
    first = plan.make_plan(REQUEST)
    first["options"][0]["rotation"][0] = "tampered"
    assert plan.make_plan(REQUEST)["options"][0]["rotation"][0] != "tampered"


def test_unprepared_crop_still_gets_the_usual_error(data_root):
    with pytest.raises(BundleError) as err:
        plan.make_plan({**REQUEST, "current_crop": "wheat"})  # no row in the test crops.csv
    assert err.value.code == "no_data"


def test_warm_up_prepares_every_place_and_health_shows_it(data_root, monkeypatch):
    cache.warm_up().join(timeout=60)
    assert cache.status == {FIELD_ID: "ready"}
    monkeypatch.setenv("ENGINE_WARMUP", "0")
    assert TestClient(app).get("/health").json()["fields"] == {FIELD_ID: "ready"}


def test_warm_up_reports_a_field_without_data(data_root):
    (data_root / "fields" / FIELD_ID / "field.json").unlink()
    cache.warm_up().join(timeout=60)
    assert cache.status[FIELD_ID].startswith("no_data")
