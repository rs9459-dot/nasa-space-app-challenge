"""NASA POWER daily weather for one field -> data/fields/<field_id>/weather_daily.csv

    python -m pipeline.weather nv-fallon-01 39.3800 -118.7700

Free, no key. One call returns every parameter for 2001-2025. POWER marks a missing value
with -999; this script refuses to save a file with any missing value or missing day, so the
engine's water balance never runs on a gap.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pandas as pd

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
START, END = "20010101", "20251231"  # 25 whole years

# POWER parameter -> our column (contract A)
PARAMS = {
    "T2M_MAX": "tmax_c",              # daily max air temperature at 2 m, deg C
    "T2M_MIN": "tmin_c",              # daily min
    "T2M": "tmean_c",                 # daily mean
    "PRECTOTCORR": "precip_mm",       # bias-corrected precipitation, mm/day
    "ALLSKY_SFC_SW_DWN": "solar_mj",  # surface solar radiation, MJ/m2/day
    "RH2M": "rh_pct",                 # relative humidity at 2 m, %
    "WS2M": "wind_ms",                # wind speed at 2 m, m/s
}
MISSING = -999.0

DATA = Path(__file__).resolve().parents[1] / "data"


def fetch(lat: float, lon: float, start: str = START, end: str = END, timeout: float = 180) -> dict:
    r = httpx.get(
        POWER_URL,
        params={
            "parameters": ",".join(PARAMS), "community": "AG", "latitude": lat, "longitude": lon,
            "start": start, "end": end, "format": "JSON", "time-standard": "LST",
        },
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()


def to_frame(payload: dict, start: str = START, end: str = END) -> pd.DataFrame:
    """POWER's JSON -> a daily table. Raises ValueError on any missing parameter, day or value."""
    parameter = payload["properties"]["parameter"]
    absent = [p for p in PARAMS if p not in parameter]
    if absent:
        raise ValueError(f"NASA POWER did not return {', '.join(absent)}")
    df = pd.DataFrame({col: pd.Series(parameter[p], dtype=float) for p, col in PARAMS.items()})
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "day"
    df = df.sort_index()
    df = df.mask(df <= MISSING + 1)  # -999 = missing

    expected = pd.date_range(pd.to_datetime(start, format="%Y%m%d"), pd.to_datetime(end, format="%Y%m%d"), freq="D")
    gaps = expected.difference(df.index)
    if len(gaps):
        raise ValueError(f"NASA POWER is missing {len(gaps)} days, first {gaps[0].date()}")
    holes = df.isna().sum()
    if holes.sum():
        raise ValueError(f"NASA POWER has missing values (-999): {holes[holes > 0].to_dict()}")
    return df.loc[expected]


def main(field_id: str, lat: float, lon: float) -> Path:
    df = to_frame(fetch(lat, lon))
    out = DATA / "fields" / field_id / "weather_daily.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.round(2).to_csv(out, date_format="%Y-%m-%d", lineterminator="\n")
    yearly = df["precip_mm"].groupby(df.index.year).sum()
    print(f"{out.relative_to(DATA.parent)}: {len(df)} days, {df.index[0].date()} to {df.index[-1].date()}, "
          f"rain {yearly.min():.0f}-{yearly.max():.0f} mm/yr, no gaps")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: python -m pipeline.weather <field_id> <lat> <lon>")
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
