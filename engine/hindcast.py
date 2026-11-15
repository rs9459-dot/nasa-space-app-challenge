"""The hindcast: would FarmLine's advice have held up in a drought it could not see coming?

1. Stand at the end of `weather_through` (2020). Choose the drought-safe rotation using only
   the weather and the water allocations known by then.
2. Replay the following years (2021-2023) with the weather and the allocations that really
   happened (70%, 85%, 100% at Fallon), for that rotation and for carrying on with the crop
   the field was growing.
3. Report how much water each needed and what share of its water need was met, next to what
   the field actually grew (USDA CropScape).

Returns None when the field lacks what this needs (weather for those years, a SOURCED
allocation for each replay year, a crop record for `weather_through`). It never fills a gap.
"""
from __future__ import annotations

import numpy as np

from engine import plan, rank, water
from engine.types import Field, Reference, Rotation, Signals
from engine.water import MM_PER_AF_PER_ACRE

WEATHER_THROUGH = 2020
REPLAY_YEARS = (2021, 2022, 2023)
EVEN = {"water": 1 / 3, "income": 1 / 3, "drought": 1 / 3}


def crop_in(field: Field, year: int) -> str | None:
    for record in field.crop_history:
        if record.get("year") == year:
            return record.get("crop")
    return None


def run(field: Field, ref: Reference, signals: Signals | None = None, *,
        rotations: list[Rotation] | None = None, weather_through: int = WEATHER_THROUGH,
        replay_years: tuple[int, int, int] = REPLAY_YEARS) -> dict | None:
    table = {int(y): float(f) for y, f in (field.water.get("allocation_fraction_by_year") or {}).items()}
    known = {y: f for y, f in table.items() if y <= weather_through}
    weather_years = set(field.weather.index.year)
    current = crop_in(field, weather_through)
    if (not known or current is None or any(y not in table for y in replay_years)
            or not set(replay_years) <= weather_years or weather_through not in weather_years):
        return None

    # Today's satellite soil moisture says nothing about 2021; keep only the rainfall correction.
    past_signals = Signals(rain_scale=(signals or Signals()).rain_scale)
    rotations = rotations if rotations is not None else plan.candidate_rotations(field, ref)
    baseline: Rotation = (current,) * 3

    # 1. Choose with what was known at the end of weather_through.
    before = field.weather[field.weather.index.year <= weather_through]
    outcomes, baseline_outcomes = plan.evaluate(field, ref, past_signals, rotations, baseline,
                                                weather=before, allocation=known)
    chosen = rank.choose(outcomes, baseline_outcomes, EVEN, field)
    safest: Rotation = tuple(next(o for o in chosen["options"] if o["label"] == "safest_in_drought")["rotation"])

    # 2. Replay what really happened.
    after = field.weather[field.weather.index.year.isin(replay_years)]
    replay = water.simulate(field, [safest, baseline], ref, past_signals,
                            weather=after, allocation={y: table[y] for y in replay_years})
    wanted = np.array(replay_years)
    row = int(np.flatnonzero((replay.sequences == wanted).all(axis=1) & (replay.allocation_years == wanted).all(axis=1))[0])

    def summarise(i: int) -> tuple[float, int]:
        need, used = replay.etc_mm[i, row].sum(), replay.eta_mm[i, row].sum()
        return rank.acre_feet(replay.irrigation_mm[i, row].mean() / MM_PER_AF_PER_ACRE), int(round(100 * used / need)) if need > 0 else 0

    safest_water, safest_met = summarise(0)
    current_water, current_met = summarise(1)
    allocation_pct = {str(y): int(round(100 * table[y])) for y in replay_years}

    span = f"{replay_years[0]}-{replay_years[-1]}"
    cuts = ", ".join(f"{allocation_pct[str(y)]}%" for y in replay_years)
    summary = (f"Planned with weather only up to {weather_through}, the drought-safe rotation would have had "
               f"{safest_met}% of its water need met in {span} (allocations {cuts}) on {safest_water} acre-feet "
               f"per acre; carrying on as before, {current_met}% on {current_water}.")

    return {
        "weather_through": weather_through,
        "years": list(replay_years),
        "allocation_pct_by_year": allocation_pct,
        "safest_rotation": list(safest),
        "safest_water_af_per_acre": safest_water,
        "safest_need_met_pct": safest_met,
        "current_crop": current,
        "current_crop_water_af_per_acre": current_water,
        "current_crop_need_met_pct": current_met,
        "actual_crops": [crop_in(field, y) for y in replay_years],
        "summary": summary,
    }
