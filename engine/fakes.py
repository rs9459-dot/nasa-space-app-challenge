"""STAND-INS for the crops slice (Hareem) until the real modules are on main.

Nothing here is agronomy or economics. They exist so the water slice and the API can run
end to end. Whenever one is used, the API marks the answer `sample_data: true` and says
which stand-ins were used, so a fake number can never be mistaken for a result.

Delete each function when its real module lands:
  fake_rotations -> engine/rotations.py (H4)
  fake_outcomes  -> engine/yields.py   (H5)
"""
from __future__ import annotations

from itertools import product

import numpy as np

from engine.types import Field, Outcomes, Reference, Rotation, Signals, WaterResult
from engine.water import MM_PER_AF_PER_ACRE


def fake_rotations(field: Field, ref: Reference) -> list[Rotation]:
    """Every 3-year sequence of the crops in crops.csv, except the same crop 3 times."""
    crops = list(ref.crops.index)
    return [r for r in product(crops, repeat=3) if len(set(r)) > 1]


def fake_outcomes(field: Field, water_result: WaterResult, ref: Reference, signals: Signals) -> Outcomes:
    """Toy numbers: income is 1000 x the share of water need met, minus 50 per acre-foot."""
    with np.errstate(divide="ignore", invalid="ignore"):
        met = np.where(water_result.etc_mm > 0, water_result.eta_mm / water_result.etc_mm, 0.0)
    water_af = water_result.irrigation_mm.mean(axis=2) / MM_PER_AF_PER_ACRE
    grown = (water_result.etc_mm > 0).mean(axis=2)  # share of years with a crop in the ground
    return Outcomes(
        rotations=water_result.rotations,
        yield_frac=met,
        income_usd=1000.0 * met.mean(axis=2) * grown - 50.0 * water_af,
        water_af=water_af,
        soil_score=np.full(len(water_result.rotations), 5.0),
    )
