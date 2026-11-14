"""The shared interfaces between the water slice (Abdullah) and the crops slice (Hareem).

Copied from docs/engine-plan/README.md. This is the only code both people depend on, so
change it only after telling the other person, and update the README table in the same commit.

Shapes: R rotations, S weather sequences (25: each start year 2001-2025 plus the next two,
wrapping), 3 years per rotation.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

Rotation = tuple[str, str, str]
"""Crop codes for years 1, 2, 3 (codes from worker/src/gemini/crops.ts)."""


@dataclass
class Field:
    """One field bundle, loaded and validated (bundle.load, Abdullah)."""

    field_id: str
    name: str
    place: str
    lat: float
    lon: float
    country: str
    provenance: str  # "real" | "sample"
    weather: pd.DataFrame  # daily, index 'day': tmax_c tmin_c tmean_c precip_mm solar_mj rh_pct wind_ms
    soil: dict  # soil.json
    water: dict  # water.json ({} if missing)
    crop_history: list[dict]  # crop_history.json ([] if missing)
    satellite: dict  # satellite.json ({} if missing)
    sources: list[str]  # every dataset that went into this bundle


@dataclass
class Reference:
    """The data/reference tables (bundle.load, Abdullah; tables are Hareem's)."""

    crops: pd.DataFrame  # crops.csv, index = crop code
    economics: pd.DataFrame  # economics.csv


@dataclass
class Signals:
    """NASA signals the engine uses (signals.compute, Hareem). The defaults mean "no signal"."""

    start_depletion_frac: float = 0.0  # soil dryness at the start: 0 = full, 1 = wilting point (SMAP/NLDAS)
    rain_scale: float = 1.0  # IMERG / POWER rainfall ratio; the water model scales rain by it
    erosion_weight: float = 1.0  # >= 1, raises cover-crop value on slopes (SRTM/SSURGO)
    history_confirmed: bool | None = None  # NDVI agrees with CropScape history
    drought_years: list[int] = field(default_factory=list)  # NWIS low flow + allocation cuts
    sources: list[str] = field(default_factory=list)


@dataclass
class WaterResult:
    """Water use per rotation, sequence and year (water.simulate, Abdullah)."""

    rotations: list[Rotation]
    sequences: np.ndarray  # (S, 3) calendar years used for years 1..3
    etc_mm: np.ndarray  # (R, S, 3) seasonal crop water need without stress
    eta_mm: np.ndarray  # (R, S, 3) actual crop water use
    irrigation_mm: np.ndarray  # (R, S, 3) irrigation applied (capped by allocation)


@dataclass
class Outcomes:
    """What each rotation yields and earns (yields.evaluate, Hareem)."""

    rotations: list[Rotation]
    yield_frac: np.ndarray  # (R, S, 3) Ya/Ym after water stress and salinity
    income_usd: np.ndarray  # (R, S) average USD per acre per year over the 3 years
    water_af: np.ndarray  # (R, S) average irrigation, acre-feet per acre per year
    soil_score: np.ndarray  # (R,) 0..10
