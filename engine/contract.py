"""Contract B checks, used by the tests and by the engine on every answer it sends.

`problems(doc)` returns a list of what is wrong (empty = fine): the JSON Schema in
contracts/engine-response.schema.json plus the rules a schema can't express.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"


def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((CONTRACTS / name).read_text(encoding="utf-8")))


REQUEST = _validator("engine-request.schema.json")
RESPONSE = _validator("engine-response.schema.json")


def schema_errors(validator: Draft202012Validator, doc) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path)) or 'document'}: {e.message}" for e in validator.iter_errors(doc)]


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
    """Rules JSON Schema can't express. Assumes the document already passes the schema."""
    if "error" in doc:
        return []
    found = []
    labels = [o["label"] for o in doc["options"]]
    if sorted(labels) != ["most_income", "most_water_saved", "safest_in_drought"]:
        found.append(f"labels must be one of each, got {labels}")
    if sorted(o["rank"] for o in doc["options"]) != [1, 2, 3]:
        found.append("ranks must be 1, 2, 3")
    if len({tuple(o["rotation"]) for o in doc["options"]}) != 3:
        found.append("the 3 options must be different rotations")

    def one_decimal(x: float) -> bool:
        return abs(round(x, 1) - x) < 1e-9

    acre_feet = [doc["baseline"]["water_af_per_acre"]] + [o["water_af_per_acre"] for o in doc["options"]]
    if "climate_2035" in doc:
        acre_feet += [o["water_af_per_acre"] for o in doc["climate_2035"]["options"]]
        if not one_decimal(doc["climate_2035"]["temp_trend_c_per_decade"]):
            found.append("temp trend must be 1 decimal")
    if "hindcast" in doc:
        acre_feet.append(doc["hindcast"]["safest_water_af_per_acre"])
        if "current_crop_water_af_per_acre" in doc["hindcast"]:
            acre_feet.append(doc["hindcast"]["current_crop_water_af_per_acre"])
    if not all(one_decimal(x) for x in acre_feet):
        found.append(f"acre-feet must be 1 decimal: {acre_feet}")

    base = doc["baseline"]["water_af_per_acre"]
    for o in doc["options"]:
        if base > 0:
            expected = round(100 * (base - o["water_af_per_acre"]) / base)
            if abs(expected - o["water_saved_pct"]) > 1:  # rounding of rounded inputs
                found.append(f"{o['label']}: water_saved_pct {o['water_saved_pct']} but baseline says {expected}")

    if "hindcast" in doc:
        h = doc["hindcast"]
        allowed = set(numbers_in({k: v for k, v in h.items() if k != "summary"}))
        allowed |= {float(y) for y in h["allocation_pct_by_year"]}
        stray = [n for n in numbers_in(h["summary"]) if n not in allowed]
        if stray:
            found.append(f"hindcast summary has numbers not in the hindcast: {stray}")
    return found


def problems(doc: dict) -> list[str]:
    errors = schema_errors(RESPONSE, doc)
    return errors or contract_problems(doc)
