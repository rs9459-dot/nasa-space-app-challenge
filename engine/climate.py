"""H8: where the field's climate is heading, and the chosen options replayed in 2035.

    trend(field)          Mann-Kendall test + Sen's slope on annual mean temperature and annual
                          rain, over every complete weather year (2001-2025 at Fallon).
    shift_weather(field)  the daily weather moved to 2035 by those trends: temperatures add
                          the trend, rain is scaled by it.
    summary(...)          the `climate_2035` block of an EngineResult (contract B).

The trend is the field's own 25-year NASA POWER record carried forward in a straight line. It
is not a climate-model projection, and it is used whether or not it is statistically
significant; the two `*_significant` flags say which it is (Mann-Kendall p < 0.05).

Mann-Kendall and Sen's slope are written out here (about 20 lines) so the engine needs no
extra package. The test has the usual correction for tied values.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from engine.types import Field, Outcomes

TARGET_YEAR = 2035
MIN_YEARS = 10  # fewer complete years than this and no trend is reported
MIN_DAYS = 360  # a year counts only if nearly every day is present
ALPHA = 0.05
TEMP_COLUMNS = ("tmax_c", "tmin_c", "tmean_c")


def mann_kendall(values) -> tuple[float, float]:
    """(Sen's slope per step, two-sided p-value) for an evenly spaced series."""
    x = np.asarray(values, dtype=float)
    n = len(x)
    if n < 3:
        return 0.0, 1.0
    i, j = np.triu_indices(n, k=1)
    diffs = x[j] - x[i]
    s = float(np.sign(diffs).sum())
    _, counts = np.unique(x, return_counts=True)
    ties = float((counts * (counts - 1) * (2 * counts + 5)).sum())
    var = (n * (n - 1) * (2 * n + 5) - ties) / 18.0
    if var <= 0:
        return 0.0, 1.0
    z = (s - 1) / math.sqrt(var) if s > 0 else (s + 1) / math.sqrt(var) if s < 0 else 0.0
    p = math.erfc(abs(z) / math.sqrt(2))
    return float(np.median(diffs / (j - i))), p


def annual(weather: pd.DataFrame) -> pd.DataFrame:
    """Mean temperature and total rain for each complete year, index = year."""
    by_year = weather.groupby(weather.index.year)
    table = pd.DataFrame({
        "tmean_c": by_year["tmean_c"].mean(),
        "precip_mm": by_year["precip_mm"].sum(),
        "days": by_year["tmean_c"].count(),
    })
    return table[table["days"] >= MIN_DAYS].drop(columns="days")


def trend(field: Field) -> dict | None:
    """The field's temperature and rain trends, or None if the record is too short.

    Keys: temp_trend_c_per_decade, temp_trend_significant, rain_trend_mm_per_decade,
    rain_trend_significant (unrounded), plus first_year, last_year, mean_rain_mm.
    """
    years = annual(field.weather)
    if len(years) < MIN_YEARS:
        return None
    # Sen's slope is per step, so the years must be evenly spaced: a gap would stretch it.
    if not np.array_equal(years.index.to_numpy(), np.arange(years.index[0], years.index[0] + len(years))):
        return None
    temp_slope, temp_p = mann_kendall(years["tmean_c"])
    rain_slope, rain_p = mann_kendall(years["precip_mm"])
    return {
        "temp_trend_c_per_decade": temp_slope * 10,
        "temp_trend_significant": bool(temp_p < ALPHA),
        "rain_trend_mm_per_decade": rain_slope * 10,
        "rain_trend_significant": bool(rain_p < ALPHA),
        "first_year": int(years.index[0]),
        "last_year": int(years.index[-1]),
        "mean_rain_mm": float(years["precip_mm"].mean()),
    }


def shift_weather(field: Field, year: int = TARGET_YEAR, trends: dict | None = None) -> pd.DataFrame:
    """The daily weather as it would look in `year` if the trends carry on.

    Every day gets the temperature trend added (trend x decades past the last weather year)
    and its rain scaled by the rain trend's share of the mean annual rain (never below zero).
    With no trend available the weather comes back unchanged.
    """
    trends = trends if trends is not None else trend(field)
    shifted = field.weather.copy()
    if not trends:
        return shifted
    decades = (year - trends["last_year"]) / 10.0
    for column in TEMP_COLUMNS:
        if column in shifted:
            shifted[column] = shifted[column] + trends["temp_trend_c_per_decade"] * decades
    mean_rain = trends["mean_rain_mm"]
    if mean_rain > 0:
        factor = max(0.0, 1.0 + trends["rain_trend_mm_per_decade"] * decades / mean_rain)
        shifted["precip_mm"] = shifted["precip_mm"] * factor
    return shifted


def summary(trends: dict | None, future: Outcomes | None, options: list[dict]) -> dict | None:
    """The contract's `climate_2035` block for the 3 chosen options, or None if it can't be filled.

    `future` holds every rotation's outcomes on the shifted weather (cache.py prepares it once
    per field). An option without a 2035 income estimate means no block, never a guess.
    """
    from engine import rank  # the farmer-facing rounding lives there

    if not trends or future is None:
        return None
    row = {tuple(r): i for i, r in enumerate(future.rotations)}
    rows = []
    for option in options:
        i = row.get(tuple(option["rotation"]))
        if i is None:
            return None
        income = float(np.mean(future.income_usd[i]))
        water = float(np.mean(future.water_af[i]))
        if math.isnan(income) or math.isnan(water):
            return None
        rows.append({"label": option["label"], "water_af_per_acre": rank.acre_feet(water),
                     "income_usd_per_acre": rank.usd(income)})
    return {
        "temp_trend_c_per_decade": round(trends["temp_trend_c_per_decade"], 1) + 0.0,
        "temp_trend_significant": trends["temp_trend_significant"],
        "rain_trend_mm_per_decade": int(round(trends["rain_trend_mm_per_decade"])),
        "rain_trend_significant": trends["rain_trend_significant"],
        "options": rows,
    }
