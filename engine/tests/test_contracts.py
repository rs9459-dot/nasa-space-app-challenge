"""Contract B checks: the schemas accept the samples and reject what they should.

Run from the repo root:  engine/.venv/Scripts/python -m pytest engine/tests
(the engine's real responses get the same checks from E6 on, via validate_response).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
SAMPLES = CONTRACTS / "samples"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


REQUEST = Draft202012Validator(load(CONTRACTS / "engine-request.schema.json"))
RESPONSE = Draft202012Validator(load(CONTRACTS / "engine-response.schema.json"))


def errors(validator: Draft202012Validator, doc: dict) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in validator.iter_errors(doc)]


def numbers_in(value) -> list[float]:
    """Every number in a JSON value, digits inside strings included (like the worker's checker)."""
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [abs(value)]
    if isinstance(value, str):
        return [float(m) for m in re.findall(r"\d+(?:\.\d+)?", value)]
    if isinstance(value, list):
        return [n for v in value for n in numbers_in(v)]
    if isinstance(value, dict):
        return [n for k, v in value.items() if not k.startswith("_") for n in numbers_in(v)]
    return []


def contract_problems(doc: dict) -> list[str]:
    """Rules JSON Schema can't express. The engine will call this on every response (E6)."""
    if "error" in doc:
        return []
    problems = []
    labels = [o["label"] for o in doc["options"]]
    if sorted(labels) != ["most_income", "most_water_saved", "safest_in_drought"]:
        problems.append(f"labels must be one of each, got {labels}")
    if sorted(o["rank"] for o in doc["options"]) != [1, 2, 3]:
        problems.append("ranks must be 1, 2, 3")
    if len({tuple(o["rotation"]) for o in doc["options"]}) != 3:
        problems.append("the 3 options must be different rotations")

    def one_decimal(x: float) -> bool:
        return abs(round(x, 1) - x) < 1e-9

    acre_feet = [doc["baseline"]["water_af_per_acre"]] + [o["water_af_per_acre"] for o in doc["options"]]
    if "climate_2035" in doc:
        acre_feet += [o["water_af_per_acre"] for o in doc["climate_2035"]["options"]]
        if not one_decimal(doc["climate_2035"]["temp_trend_c_per_decade"]):
            problems.append("temp trend must be 1 decimal")
    if "hindcast" in doc:
        acre_feet.append(doc["hindcast"]["safest_water_af_per_acre"])
    if not all(one_decimal(x) for x in acre_feet):
        problems.append(f"acre-feet must be 1 decimal: {acre_feet}")

    for o in doc["options"]:
        b = doc["baseline"]["water_af_per_acre"]
        if b > 0:
            expected = round(100 * (b - o["water_af_per_acre"]) / b)
            if abs(expected - o["water_saved_pct"]) > 1:  # rounding of rounded inputs
                problems.append(f"{o['label']}: water_saved_pct {o['water_saved_pct']} but baseline says {expected}")

    if "hindcast" in doc:
        h = doc["hindcast"]
        allowed = set(numbers_in({k: v for k, v in h.items() if k != "summary"}))
        allowed |= {float(y) for y in h["allocation_pct_by_year"]}
        stray = [n for n in numbers_in(h["summary"]) if n not in allowed]
        if stray:
            problems.append(f"hindcast summary has numbers not in the hindcast: {stray}")
    return problems


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
