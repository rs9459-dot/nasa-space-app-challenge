"""The drought replay (A7). Crop values are TEST values; the structure is what is tested."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from engine import bundle, contract, hindcast
from engine.app import app
from engine.tests.conftest import write_bundle, write_reference

FIELD = "drought-field"
ALLOCATIONS = {"2013": 0.75, "2014": 0.45, "2015": 0.2, "2019": 1.0, "2020": 1.0, "2021": 0.7, "2022": 0.85, "2023": 1.0}
HISTORY = [{"year": 2020, "crop": "alfalfa"}, {"year": 2021, "crop": "barley"}, {"year": 2022, "crop": "fallow"}, {"year": 2023, "crop": "alfalfa"}]


@pytest.fixture
def drought_root(tmp_path, monkeypatch):
    folder = write_bundle(tmp_path, FIELD, provenance="real", end="2025-12-31")
    write_reference(tmp_path)
    (folder / "water.json").write_text(json.dumps({
        "source": "TEST allocations", "full_allocation_af_per_acre": 3.5, "allocation_fraction_by_year": ALLOCATIONS}))
    (folder / "crop_history.json").write_text(json.dumps(HISTORY))
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path))
    return tmp_path


def test_hindcast_replays_the_drought(drought_root):
    field, ref = bundle.load(FIELD)
    h = hindcast.run(field, ref)
    assert h["weather_through"] == 2020 and h["years"] == [2021, 2022, 2023]
    assert h["allocation_pct_by_year"] == {"2021": 70, "2022": 85, "2023": 100}
    assert h["current_crop"] == "alfalfa" and h["actual_crops"] == ["barley", "fallow", "alfalfa"]
    assert len(h["safest_rotation"]) == 3
    # Thirsty alfalfa under a cut allocation gets less of its need than the drought-safe pick.
    assert h["safest_need_met_pct"] >= h["current_crop_need_met_pct"]
    assert 0 < h["current_crop_need_met_pct"] <= 100
    assert h["safest_water_af_per_acre"] <= h["current_crop_water_af_per_acre"]


def test_summary_quotes_only_its_own_numbers(drought_root):
    field, ref = bundle.load(FIELD)
    h = hindcast.run(field, ref)
    doc = {**json.loads((contract.CONTRACTS / "samples" / "plan-normal.json").read_text()), "hindcast": h}
    assert contract.problems(doc) == []
    assert f"{h['safest_need_met_pct']}%" in h["summary"] and "2021-2023" in h["summary"] and "70%, 85%, 100%" in h["summary"]


def test_the_choice_cannot_see_the_drought(drought_root):
    """Changing 2021+ weather must not change which rotation is chosen, only how it fares."""
    field, ref = bundle.load(FIELD)
    normal = hindcast.run(field, ref)
    field.weather.loc[field.weather.index.year >= 2021, ["tmax_c", "tmean_c"]] += 8
    hotter = hindcast.run(field, ref)
    assert hotter["safest_rotation"] == normal["safest_rotation"]
    assert hotter["current_crop_need_met_pct"] <= normal["current_crop_need_met_pct"]


@pytest.mark.parametrize("break_it", ["no_2021_allocation", "no_crop_record", "no_earlier_allocation"])
def test_missing_inputs_mean_no_hindcast_not_a_guess(drought_root, break_it):
    field, ref = bundle.load(FIELD)
    table = field.water["allocation_fraction_by_year"]
    if break_it == "no_2021_allocation":
        del table["2021"]
    elif break_it == "no_crop_record":
        field.crop_history = [r for r in field.crop_history if r["year"] != 2020]
    else:
        for year in [y for y in table if int(y) <= 2020]:
            del table[year]
    assert hindcast.run(field, ref) is None


def test_plan_includes_the_hindcast_when_it_can(drought_root, monkeypatch):
    monkeypatch.setenv("ENGINE_API_TOKEN", "t")
    body = {"field_id": FIELD, "current_crop": "alfalfa", "priorities": {"water": 0.5, "income": 0.25, "drought": 0.25}}
    r = TestClient(app).post("/plan", json=body, headers={"Authorization": "Bearer t"})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert contract.problems(doc) == []
    assert doc["hindcast"]["years"] == [2021, 2022, 2023] and doc["years_tested"] == 25


def test_plan_without_hindcast_inputs_still_answers(data_root, monkeypatch):
    monkeypatch.setenv("ENGINE_API_TOKEN", "t")
    body = {"field_id": "test-field-01", "current_crop": "alfalfa", "priorities": {"water": 0.5, "income": 0.25, "drought": 0.25}}
    doc = TestClient(app).post("/plan", json=body, headers={"Authorization": "Bearer t"}).json()
    assert "hindcast" not in doc and len(doc["options"]) == 3
