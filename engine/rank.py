"""Choose the 3 options a farmer hears, from every rotation's outcomes.

Each rotation is judged on four things across all weather x allocation sequences:
  water       mean irrigation delivered (lower is better)
  income      mean income
  bad year    10th-percentile income ("a bad year": drought safety)
  soil        soil-health score

TOPSIS ranks the rotations by how close they are to the best on everything and how far from
the worst, weighted by the farmer's priorities (soil has a fixed 10% so it is never ignored).
From the 20 best overall, three are picked so the farmer can decide: the one that uses the
least water, the one that earns the most, and the one that earns the most in a bad year.

All rounding for the farmer happens here (contract B): acre-feet to 1 decimal, percentages
whole, dollars to the nearest 10, soil score whole.
"""
from __future__ import annotations

import numpy as np

from engine.bundle import BundleError
from engine.types import Field, Outcomes

SOIL_WEIGHT = 0.1
SHORTLIST = 20
BAD_YEAR_PERCENTILE = 10
LABELS = ["most_water_saved", "most_income", "safest_in_drought"]


def criteria(outcomes: Outcomes) -> dict[str, np.ndarray]:
    """Per rotation: mean water, mean income, bad-year income, soil score."""
    return {
        "water": outcomes.water_af.mean(axis=1),
        "income": outcomes.income_usd.mean(axis=1),
        "bad_year": np.percentile(outcomes.income_usd, BAD_YEAR_PERCENTILE, axis=1),
        "soil": np.asarray(outcomes.soil_score, dtype=float),
    }


def weights(priorities: dict) -> np.ndarray:
    """[water, income, bad year, soil], summing to 1."""
    w = np.array([max(float(priorities.get(k, 0)), 0) for k in ("water", "income", "drought")])
    w = w / w.sum() if w.sum() > 0 else np.full(3, 1 / 3)
    return np.append(w * (1 - SOIL_WEIGHT), SOIL_WEIGHT)


def topsis(matrix: np.ndarray, w: np.ndarray, higher_is_better: list[bool]) -> np.ndarray:
    """Closeness to the ideal for each row, 0..1 (1 = best on every criterion)."""
    norms = np.sqrt((matrix ** 2).sum(axis=0))
    scaled = matrix / np.where(norms > 0, norms, 1) * w
    best = np.where(higher_is_better, scaled.max(axis=0), scaled.min(axis=0))
    worst = np.where(higher_is_better, scaled.min(axis=0), scaled.max(axis=0))
    to_best = np.sqrt(((scaled - best) ** 2).sum(axis=1))
    to_worst = np.sqrt(((scaled - worst) ** 2).sum(axis=1))
    total = to_best + to_worst
    return np.where(total > 0, to_worst / np.where(total > 0, total, 1), 1.0)


def pick_three(c: dict[str, np.ndarray], closeness: np.ndarray) -> list[int]:
    """Row indices for [most water saved, most income, safest in drought], all different."""
    shortlist = np.argsort(-closeness, kind="stable")[:SHORTLIST]
    orderings = [
        shortlist[np.argsort(c["water"][shortlist], kind="stable")],       # least water first
        shortlist[np.argsort(-c["income"][shortlist], kind="stable")],     # most income first
        shortlist[np.argsort(-c["bad_year"][shortlist], kind="stable")],   # best bad year first
    ]
    chosen: list[int] = []
    for order in orderings:
        chosen.append(next(int(i) for i in order if int(i) not in chosen))
    return chosen


def usd(x: float) -> int:
    return int(round(float(x) / 10.0)) * 10


def acre_feet(x: float) -> float:
    return round(float(x) + 1e-9, 1)


def choose(outcomes: Outcomes, baseline_outcomes: Outcomes, priorities: dict, field: Field, *,
           years_tested: int | None = None, sources: list[str] | None = None) -> dict:
    """An EngineResult (contract B). Needs at least 3 different rotations with an income estimate.

    A rotation whose income is unknown (NaN: a crop with no yield, price or cost) is never
    offered; the farmer's own rotation without one is reported with income null
    ("estimate unavailable").
    """
    known = ~np.isnan(np.asarray(outcomes.income_usd, dtype=float)).any(axis=1)
    if not known.all():
        rows = np.flatnonzero(known)
        outcomes = Outcomes([outcomes.rotations[i] for i in rows], outcomes.yield_frac[rows],
                            outcomes.income_usd[rows], outcomes.water_af[rows], np.asarray(outcomes.soil_score)[rows])
    if len(set(outcomes.rotations)) < 3:
        raise BundleError("no_data", f"Only {len(set(outcomes.rotations))} rotations have an income estimate; "
                                     "3 are needed (crops without a yield, price or cost can't be compared)")
    c = criteria(outcomes)
    matrix = np.column_stack([c["water"], c["income"], c["bad_year"], c["soil"]])
    closeness = topsis(matrix, weights(priorities), [False, True, True, True])
    picks = pick_three(c, closeness)

    base = criteria(baseline_outcomes)
    base_water = acre_feet(base["water"][0])

    options = []
    for rank, (label, i) in enumerate(zip(LABELS, picks), start=1):
        water = acre_feet(c["water"][i])
        options.append({
            "rank": rank,
            "label": label,
            "rotation": list(outcomes.rotations[i]),
            "water_af_per_acre": water,
            # from the rounded figures, so it agrees with what the farmer is shown
            "water_saved_pct": int(round(100 * (base_water - water) / base_water)) if base_water > 0 else 0,
            "income_usd_per_acre": usd(c["income"][i]),
            "bad_year_income_usd_per_acre": usd(c["bad_year"][i]),
            "soil_score": int(np.clip(round(float(c["soil"][i])), 0, 10)),
        })

    return {
        "field": {"id": field.field_id, "place": field.place, "current_rotation": list(baseline_outcomes.rotations[0])},
        "baseline": {
            "water_af_per_acre": base_water,
            # null = "estimate unavailable" (the farmer's crop has no yield, price or cost)
            "income_usd_per_acre": None if np.isnan(base["income"][0]) else usd(base["income"][0]),
            "bad_year_income_usd_per_acre": None if np.isnan(base["bad_year"][0]) else usd(base["bad_year"][0]),
        },
        "options": options,
        "years_tested": int(years_tested if years_tested is not None else field.weather.index.year.nunique()),
        "data_sources": list(dict.fromkeys(sources if sources is not None else field.sources)) or ["unknown"],
        "sample_data": field.provenance == "sample",
    }
