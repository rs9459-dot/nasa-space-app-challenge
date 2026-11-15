"""The daily water balance (FAO-56 single crop coefficient with a soil-water bucket).

For every rotation, it replays 3 years of real daily weather and asks: how much water did
each crop need (ETc), how much did it actually get to use (ETa), and how much irrigation
did that take, given that the irrigation district only delivers a share of the water right
in dry years?

Sequences. Weather: each year in the record starts a 3-year sequence (wrapping at the end),
so 25 years give W = 25. Allocation: only years with a SOURCED allocation are used; each
starts a 3-year allocation sequence through the sourced years in order (wrapping), giving A.
Every weather sequence is run against every allocation sequence: S = W x A. Nothing is
estimated for years without a source.

Modelling choices (simplifications, stated so nobody mistakes them for data):
  - Feb 29 is dropped, so every year has 365 days.
  - A crop's season belongs to the calendar year it is harvested in; a season that starts
    in autumn wraps to the start of that same year.
  - Irrigation happens when the readily available water is used up, refills the root zone,
    and stops when the year's allocation is spent. Rain beyond a full root zone is lost.
  - Outside the season, bare soil dries at kc_ini x ET0 until the readily available water
    is gone, then stops (evaporation only reaches the surface layer).
  - Irrigation counted against the allocation is water DELIVERED; only
    water.application_efficiency of it reaches the roots (1.0 if the bundle has none).

Constants in code are physics/method only: Hargreaves 0.0023, 0.408 (MJ/m2 -> mm),
solar constant 0.0820 MJ/m2/min, 304.8 mm per acre-foot per acre. Every crop number comes
from data/reference/crops.csv and every water number from the bundle's water.json.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.bundle import BundleError
from engine.types import Field, Reference, Rotation, Signals, WaterResult

MM_PER_AF_PER_ACRE = 304.8
DAYS = 365
CROP_COLUMNS = ["plant_month", "plant_day", "stage_ini_days", "stage_dev_days", "stage_mid_days",
                "stage_late_days", "kc_ini", "kc_mid", "kc_end", "root_depth_m", "p_depletion"]


# --- weather --------------------------------------------------------------------------------

def extraterrestrial_radiation(lat_deg: float, doy: np.ndarray) -> np.ndarray:
    """Ra in MJ/m2/day (FAO-56 eq. 21)."""
    phi = np.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    delta = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(delta), -1, 1))
    return (24 * 60 / np.pi) * 0.0820 * dr * (ws * np.sin(phi) * np.sin(delta) + np.cos(phi) * np.cos(delta) * np.sin(ws))


def hargreaves_et0(lat_deg: float, doy: np.ndarray, tmax: np.ndarray, tmin: np.ndarray, tmean: np.ndarray) -> np.ndarray:
    """Reference evapotranspiration, mm/day (FAO-56 eq. 52)."""
    ra = extraterrestrial_radiation(lat_deg, doy)
    return np.maximum(0.0023 * 0.408 * ra * (tmean + 17.8) * np.sqrt(np.maximum(tmax - tmin, 0)), 0)


def yearly_arrays(weather: pd.DataFrame, lat: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(years, et0[Y, 365], rain[Y, 365]) with Feb 29 dropped."""
    w = weather[~((weather.index.month == 2) & (weather.index.day == 29))]
    years = np.array(sorted(set(w.index.year)))
    if len(w) != len(years) * DAYS:
        raise BundleError("no_data", "weather must hold whole calendar years")
    doy = np.tile(np.arange(1, DAYS + 1), len(years))
    et0 = hargreaves_et0(lat, doy, w["tmax_c"].to_numpy(), w["tmin_c"].to_numpy(), w["tmean_c"].to_numpy())
    return years, et0.reshape(len(years), DAYS), w["precip_mm"].to_numpy().reshape(len(years), DAYS)


# --- crops ----------------------------------------------------------------------------------

def kc_curve(row: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    """(kc[365], in_season[365]) for one crop: flat, rising, flat, falling (FAO-56 fig. 34)."""
    lengths = [int(row[f"stage_{s}_days"]) for s in ("ini", "dev", "mid", "late")]
    total = min(sum(lengths), DAYS)
    kc = np.full(DAYS, float(row["kc_ini"]))
    season = np.zeros(DAYS, dtype=bool)
    if total == 0:
        return kc, season
    ini, dev, mid, late = lengths
    t = np.arange(total)
    values = np.select(
        [t < ini, t < ini + dev, t < ini + dev + mid],
        [row["kc_ini"],
         row["kc_ini"] + (row["kc_mid"] - row["kc_ini"]) * (t - ini + 1) / max(dev, 1),
         row["kc_mid"]],
        default=row["kc_mid"] + (row["kc_end"] - row["kc_mid"]) * (t - ini - dev - mid + 1) / max(late, 1),
    )
    start = pd.Timestamp(2001, int(row["plant_month"]), int(row["plant_day"])).day_of_year - 1  # 2001: not a leap year
    days = (start + t) % DAYS
    kc[days] = values
    season[days] = True
    return kc, season


def crop_tables(crops: pd.DataFrame, codes: list[str], soil: dict) -> dict[str, np.ndarray]:
    missing_cols = [c for c in CROP_COLUMNS if c not in crops.columns]
    if missing_cols:
        raise BundleError("no_data", f"reference/crops.csv is missing columns {', '.join(missing_cols)}")
    kc, season, taw, p = [], [], [], []
    for code in codes:
        if code not in crops.index:
            raise BundleError("no_data", f"reference/crops.csv has no row for '{code}'")
        row = crops.loc[code]
        blank = [c for c in CROP_COLUMNS if pd.isna(row[c])]
        if blank:
            raise BundleError("no_data", f"reference/crops.csv: '{code}' has no value for {', '.join(blank)}")
        k, s = kc_curve(row)
        kc.append(k)
        season.append(s)
        deep = float(row["root_depth_m"]) > 1 and isinstance(soil.get("aws_0_150_cm"), (int, float))
        taw.append(10 * float(soil["aws_0_150_cm"] if deep else soil["aws_0_100_cm"]))  # cm of water -> mm
        p.append(float(row["p_depletion"]))
    return {"kc": np.array(kc), "season": np.array(season), "taw": np.array(taw), "p": np.array(p)}


# --- sequences ------------------------------------------------------------------------------

def three_year_sequences(n: int) -> np.ndarray:
    """(n, 3) indices: each position starts a run of 3, wrapping."""
    return (np.arange(n)[:, None] + np.arange(3)[None, :]) % n


def allocation_table(field: Field, allocation: dict | None) -> tuple[np.ndarray, np.ndarray, float, float]:
    """(years[A], fraction[A], duty in AF/acre, application efficiency) from water.json or the override."""
    water = field.water or {}
    duty = water.get("full_allocation_af_per_acre")
    if not isinstance(duty, (int, float)) or duty <= 0:
        raise BundleError("no_data", f"{field.field_id}/water.json has no full_allocation_af_per_acre")
    table = allocation if allocation is not None else water.get("allocation_fraction_by_year") or {}
    if not table:
        raise BundleError("no_data", f"{field.field_id}/water.json has no allocation_fraction_by_year")
    years = np.array(sorted(int(y) for y in table))
    fractions = np.array([float({int(k): v for k, v in table.items()}[y]) for y in years])
    if ((fractions < 0) | (fractions > 1)).any():
        raise BundleError("no_data", f"{field.field_id}: allocation fractions must be between 0 and 1")
    efficiency = water.get("application_efficiency", 1.0)
    if not isinstance(efficiency, (int, float)) or not 0 < efficiency <= 1:
        raise BundleError("no_data", f"{field.field_id}/water.json application_efficiency must be between 0 and 1")
    return years, fractions, float(duty), float(efficiency)


# --- the simulation -------------------------------------------------------------------------

def simulate(field: Field, rotations: list[Rotation], ref: Reference, signals: Signals | None = None, *,
             weather: pd.DataFrame | None = None, allocation: dict | None = None) -> WaterResult:
    """Run every rotation through every weather x allocation sequence.

    `weather` replaces field.weather (climate and hindcast runs); `allocation` replaces the
    water.json table ({year: fraction}).
    """
    signals = signals or Signals()
    if not rotations:
        raise ValueError("no rotations to simulate")

    years, et0, rain = yearly_arrays(weather if weather is not None else field.weather, field.lat)
    rain = rain * signals.rain_scale
    alloc_years, alloc_frac, duty, efficiency = allocation_table(field, allocation)

    codes = sorted({c for r in rotations for c in r})
    tables = crop_tables(ref.crops, codes, field.soil)
    crop_idx = np.array([[codes.index(c) for c in r] for r in rotations])  # (R, 3)

    w_seq = three_year_sequences(len(years))        # (W, 3) indices into years
    a_seq = three_year_sequences(len(alloc_years))  # (A, 3) indices into alloc_years
    R, W, A = len(rotations), len(w_seq), len(a_seq)

    # State is (R, W, A); crop terms broadcast as (R, 1, 1), weather (1, W, 1), allocation (1, 1, A).
    first_taw = tables["taw"][crop_idx[:, 0]][:, None, None]
    depletion = np.broadcast_to(np.clip(signals.start_depletion_frac, 0, 1) * first_taw, (R, W, A)).copy()
    etc_sum = np.zeros((R, W, 1, 3))
    eta_sum = np.zeros((R, W, A, 3))
    irrigation_sum = np.zeros((R, W, A, 3))

    for j in range(3):
        crop = crop_idx[:, j]
        kc_year = tables["kc"][crop]          # (R, 365)
        season_year = tables["season"][crop]  # (R, 365)
        taw = tables["taw"][crop][:, None, None]
        p = tables["p"][crop][:, None, None]
        raw = p * taw
        np.minimum(depletion, taw, out=depletion)
        # Water that can reach the roots this year (mm), after application losses.
        cap = (duty * alloc_frac[a_seq[:, j]] * MM_PER_AF_PER_ACRE * efficiency)[None, None, :] * np.ones((R, W, 1))
        et0_year = et0[w_seq[:, j]]    # (W, 365)
        rain_year = rain[w_seq[:, j]]  # (W, 365)

        for d in range(DAYS):
            in_season = season_year[:, d][:, None, None]
            demand = kc_year[:, d][:, None, None] * et0_year[:, d][None, :, None]  # (R, W, 1)

            depletion -= rain_year[:, d][None, :, None]
            np.maximum(depletion, 0, out=depletion)

            # Irrigate when the easy water is gone, as far as the allocation allows.
            net = np.where(in_season & (depletion > raw), np.minimum(depletion, cap), 0.0)
            depletion -= net
            cap -= net
            irrigation_sum[..., j] += net

            stress = np.clip((taw - depletion) / ((1 - p) * taw), 0, 1)
            used = np.where(in_season, np.where(depletion > raw, stress, 1.0) * demand,
                            np.where(depletion < raw, demand, 0.0))
            depletion += used
            np.minimum(depletion, taw, out=depletion)

            eta_sum[..., j] += np.where(in_season, used, 0.0)
            etc_sum[..., j] += np.where(in_season, demand, 0.0)

    S = W * A
    w_of_s = np.repeat(np.arange(W), A)
    a_of_s = np.tile(np.arange(A), W)
    return WaterResult(
        rotations=list(rotations),
        sequences=years[w_seq][w_of_s],
        etc_mm=np.broadcast_to(etc_sum, (R, W, A, 3)).reshape(R, S, 3).copy(),
        eta_mm=eta_sum.reshape(R, S, 3),
        irrigation_mm=irrigation_sum.reshape(R, S, 3) / efficiency,  # delivered water
        allocation=alloc_frac[a_seq][a_of_s],
        allocation_years=alloc_years[a_seq][a_of_s],
    )
