"""Contract B checks: the schemas accept the samples and reject what they should.

Run from the repo root:  engine/.venv/Scripts/python -m pytest engine/tests
(the engine's real responses get the same checks from E6 on, via validate_response).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine.contract import REQUEST, RESPONSE, contract_problems, schema_errors

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
SAMPLES = CONTRACTS / "samples"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def errors(validator, doc: dict) -> list[str]:
    return schema_errors(validator, doc)


# --- samples are valid -----------------------------------------------------------------

SAMPLE_FILES = sorted(SAMPLES.glob("*.json"))
WORKER_FIXTURE = ROOT / "worker" / "test" / "fixtures" / "fallon-sample.json"


@pytest.mark.parametrize("path", SAMPLE_FILES + [WORKER_FIXTURE], ids=lambda p: p.name)
def test_sample_matches_response_schema(path: Path):
    doc = load(path)
    assert errors(RESPONSE, doc) == []
    assert contract_problems(doc) == []


def test_there_are_three_samples():
    assert {p.name for p in SAMPLE_FILES} == {"plan-normal.json", "plan-drought-heavy.json", "error-field-not-found.json"}


def test_samples_are_marked_as_samples():
    for path in SAMPLE_FILES:
        doc = load(path)
        assert doc["_note"].startswith("SAMPLE"), path.name
        if "error" not in doc:
            assert doc["sample_data"] is True, path.name


@pytest.mark.parametrize("example", load(CONTRACTS / "engine-request.schema.json")["examples"])
def test_request_examples_are_valid(example: dict):
    assert errors(REQUEST, example) == []


# --- the schemas reject what they should ------------------------------------------------

PRIORITIES = {"water": 0.5, "income": 0.25, "drought": 0.25}


@pytest.mark.parametrize(
    "bad",
    [
        {"zip": "89406"},                                                  # no priorities
        {"priorities": PRIORITIES},                                        # no way to find the field
        {"lat": 39.38, "priorities": PRIORITIES},                          # lat without lon
        {"zip": "8940", "priorities": PRIORITIES},                         # not a ZIP/PIN
        {"zip": "89406", "current_crop": "kale", "priorities": PRIORITIES},  # unknown crop code
        {"zip": "89406", "priorities": {"water": 1.5, "income": 0, "drought": 0}},
        {"zip": "89406", "priorities": PRIORITIES, "phone": "+15555550100"},  # no extra fields (no PII)
    ],
)
def test_request_schema_rejects(bad: dict):
    assert errors(REQUEST, bad) != []


def mutate(change) -> dict:
    doc = load(SAMPLES / "plan-normal.json")
    change(doc)
    return doc


@pytest.mark.parametrize(
    "name,change",
    [
        ("two options", lambda d: d["options"].pop()),
        ("unrounded dollars", lambda d: d["options"][0].update(income_usd_per_acre=783)),
        ("percent as fraction", lambda d: d["options"][0].update(water_saved_pct=0.33)),
        ("soil over 10", lambda d: d["options"][0].update(soil_score=11)),
        ("unknown crop", lambda d: d["options"][0].update(rotation=["kale", "barley", "wheat"])),
        ("extra field", lambda d: d.update(confidence=0.9)),
        ("no data sources", lambda d: d.update(data_sources=[])),
    ],
)
def test_response_schema_rejects(name, change):
    assert errors(RESPONSE, mutate(change)) != [], name


@pytest.mark.parametrize(
    "name,change",
    [
        ("duplicate label", lambda d: d["options"][1].update(label="most_water_saved")),
        ("same rotation twice", lambda d: d["options"][1].update(rotation=d["options"][0]["rotation"])),
        ("two decimals of water", lambda d: d["options"][0].update(water_af_per_acre=3.47)),
        ("pct disagrees with baseline", lambda d: d["options"][0].update(water_saved_pct=50)),
        ("invented number in summary", lambda d: d["hindcast"].update(summary="It would have saved 70% of the water.")),
    ],
)
def test_contract_rules_catch(name, change):
    doc = mutate(change)
    assert errors(RESPONSE, doc) == [] or name == "duplicate label"
    assert contract_problems(doc) != [], name
