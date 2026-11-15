"""OpenET monthly water use for one field -> data/fields/<field_id>/openet_monthly.csv

    python -m pipeline.openet nv-fallon-01 39.3800 -118.7700

OpenET (openetdata.org) estimates actual evapotranspiration, the water a field really used,
from Landsat satellite images; the ensemble is the average of six models. It is the
independent check on our water balance: engine/water.py computes ET from weather, soil and
crop coefficients, OpenET measures it from space. We also save OpenET's reference ET
(gridMET ETo) to check our Hargreaves ET0, which uses no crop numbers at all.

Needs a free API key in OPENET_API_KEY (environment, or engine/.env, which is gitignored).
Two requests per run (ET, ETo); the free tier allows 100 a month. The API serves at most
10 years per request, so this fetches 2016-2025.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
import pandas as pd

API = "https://openet-api.org/raster/timeseries/point"
START, END = "2016-01-01", "2025-12-31"  # the API's 10-year limit
MODEL, REFERENCE, VERSION = "Ensemble", "gridMET", 2.1
SOURCE = f"OpenET {MODEL} v{VERSION} (Landsat), reference ET {REFERENCE}; openet-api.org point time series"

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def api_key() -> str:
    key = os.environ.get("OPENET_API_KEY", "").strip()
    env_file = ROOT / "engine" / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENET_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit("Set OPENET_API_KEY (environment or engine/.env); free key at etdata.org")
    return key


def fetch(lat: float, lon: float, variable: str, key: str, start: str = START, end: str = END,
          timeout: float = 180) -> list[dict]:
    r = httpx.post(
        API,
        headers={"Authorization": key},
        json={
            "date_range": [start, end], "interval": "monthly", "geometry": [lon, lat],
            "model": MODEL, "variable": variable, "reference_et": REFERENCE,
            "units": "mm", "file_format": "JSON", "version": VERSION,
        },
        timeout=timeout,
    )
    if r.status_code != 200:
        raise RuntimeError(f"OpenET {variable}: HTTP {r.status_code} {r.text[:200]}")
    return r.json()


def to_frame(et: list[dict], eto: list[dict], start: str = START, end: str = END) -> pd.DataFrame:
    """OpenET's JSON rows -> one row per month. Raises ValueError on a missing month or value."""
    def series(rows: list[dict], name: str) -> pd.Series:
        s = pd.Series({pd.Timestamp(r["time"]).to_period("M"): r.get(name) for r in rows}, dtype=float)
        return s.sort_index()

    df = pd.DataFrame({"et_mm": series(et, "et"), "eto_mm": series(eto, "eto")})
    expected = pd.period_range(start, end, freq="M")
    gaps = expected.difference(df.index)
    if len(gaps):
        raise ValueError(f"OpenET is missing {len(gaps)} months, first {gaps[0]}")
    df = df.loc[expected]
    holes = df.isna().sum()
    if holes.sum():
        raise ValueError(f"OpenET has empty values: {holes[holes > 0].to_dict()}")
    if (df < 0).any().any():
        raise ValueError("OpenET returned negative evapotranspiration")
    df.index = df.index.strftime("%Y-%m")
    df.index.name = "month"
    df["model"] = f"{MODEL} v{VERSION}"
    df["source"] = SOURCE
    return df


def main(field_id: str, lat: float, lon: float) -> Path:
    key = api_key()
    df = to_frame(fetch(lat, lon, "ET", key), fetch(lat, lon, "ETo", key))
    out = DATA / "fields" / field_id / "openet_monthly.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, lineterminator="\n")
    yearly = df["et_mm"].groupby(df.index.str[:4]).sum()
    print(f"{out.relative_to(ROOT)}: {len(df)} months {df.index[0]} to {df.index[-1]}, "
          f"ET {yearly.min():.0f}-{yearly.max():.0f} mm/yr, no gaps")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: python -m pipeline.openet <field_id> <lat> <lon>")
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
