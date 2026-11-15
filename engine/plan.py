"""One /plan request, start to finish:

    bundle -> signals -> rotations -> water -> yields -> rank -> checked EngineResult

Everything before `rank` is the same for every farmer at a field, so cache.py does it once
per field and make_plan only picks the farmer's baseline and ranks.

The crops-slice steps (signals, rotations, yields) use Hareem's modules when they exist and
the labelled stand-ins in fakes.py when they don't. Any stand-in makes the answer
`sample_data: true` with a `_note` naming it.
"""
from __future__ import annotations

import copy
import importlib
from dataclasses import replace

from engine import bundle, contract, fakes, rank, water
from engine.bundle import BundleError
from engine.types import Field, Outcomes, Reference, Rotation, Signals, WaterResult


def optional(module: str):
    """Hareem's module if it is on this checkout, else None."""
    try:
        return importlib.import_module(f"engine.{module}")
    except ModuleNotFoundError as err:
        if err.name == f"engine.{module}":
            return None
        raise


def stand_ins() -> list[str]:
    return [name for name in ("signals", "rotations", "yields") if optional(name) is None]


def candidate_rotations(field: Field, ref: Reference) -> list[Rotation]:
    """Every rotation worth testing on this field (Hareem's rules, or the stand-in)."""
    module = optional("rotations")
    if module:
        rotations = module.enumerate_rotations(module.candidate_crops(field, ref), ref)
    else:
        rotations = fakes.fake_rotations(field, ref)
    if len(set(rotations)) < 3:
        raise BundleError("no_data", f"Only {len(set(rotations))} rotations fit this field; 3 are needed")
    return rotations


def current_crop(request: dict, field: Field, signals: Signals) -> str:
    """The farmer's crop: what they said, else the field's latest CropScape crop if we trust it."""
    if request.get("current_crop"):
        return request["current_crop"]
    if signals.history_confirmed is False:
        raise BundleError("bad_request", "Satellite images don't match this field's crop records; please say what you grow now")
    known = [h for h in field.crop_history if h.get("crop")]
    if not known:
        raise BundleError("bad_request", "We have no crop record for this field; please say what you grow now")
    return max(known, key=lambda h: h.get("year", 0))["crop"]


def take(result: WaterResult, rows: slice) -> WaterResult:
    return replace(result, rotations=result.rotations[rows], etc_mm=result.etc_mm[rows],
                   eta_mm=result.eta_mm[rows], irrigation_mm=result.irrigation_mm[rows])


def yields_function():
    """Hareem's yields.evaluate, or the stand-in."""
    yields = optional("yields")
    return yields.evaluate if yields else fakes.fake_outcomes


def evaluate(field: Field, ref: Reference, signals: Signals, rotations: list[Rotation], baseline: Rotation,
             **water_overrides) -> tuple[Outcomes, Outcomes]:
    """(outcomes for the rotations, outcomes for the baseline), through the same sequences."""
    evaluate_yields = yields_function()
    simulated = water.simulate(field, [*rotations, baseline], ref, signals, **water_overrides)
    n = len(rotations)
    return (evaluate_yields(field, take(simulated, slice(0, n)), ref, signals),
            evaluate_yields(field, take(simulated, slice(n, n + 1)), ref, signals))


def make_plan(request: dict) -> dict:
    """A contract-valid EngineResult, or BundleError / RuntimeError('engine_failed')."""
    # The heavy, same-for-everyone part (every rotation simulated, each crop's baseline, the
    # hindcast) is prepared once per field by cache.py; only the farmer's part runs here.
    from engine import cache  # imported here because cache uses this module
    prep = cache.prepared(bundle.resolve(request))
    field, signals = prep.field, prep.signals

    crop = current_crop(request, field, signals)
    result = rank.choose(prep.outcomes, cache.baseline(prep, crop), request["priorities"], field,
                         sources=[*field.sources, *signals.sources])
    # The drought replay is an extra: if this field lacked what it needs, the plan still goes out.
    if prep.hindcast:
        result["hindcast"] = copy.deepcopy(prep.hindcast)

    used = stand_ins()
    if used:
        result["sample_data"] = True
        result["_note"] = f"NOT A REAL RESULT: stand-ins used for {', '.join(used)} (crops slice not merged yet)."

    found = contract.problems(result)
    if found:
        raise RuntimeError("; ".join(found[:3]))
    return result
