"""Water-slice data checks (A3). No network: parsing is tested on small fake payloads, and
the saved Fallon files are checked as they sit in data/fields/nv-fallon-01/.

Run from the repo root:  engine/.venv/Scripts/python -m pytest pipeline/tests
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from engine import bundle
from pipeline import soil, weather

FALLON = Path(__file__).resolve().parents[2] / "data" / "fields" / "nv-fallon-01"


# --- NASA POWER parsing -----------------------------------------------------------------

def power_payload(days: list[str], **overrides) -> dict:
    parameter = {p: {d: 1.0 for d in days} for p in weather.PARAMS}
    for p, values in overrides.items():
        parameter[p].update(values)
    return {"properties": {"parameter": parameter}}


def test_power_payload_becomes_a_daily_table():
    df = weather.to_frame(power_payload(["20010101", "20010102", "20010103"], T2M_MAX={"20010102": 7.5}), "20010101", "20010103")
    assert list(df.columns) == bundle.WEATHER_COLUMNS
    assert df.index.name == "day" and len(df) == 3
    assert df.loc["2001-01-02", "tmax_c"] == 7.5


def test_minus_999_is_refused():
    payload = power_payload(["20010101", "20010102"], PRECTOTCORR={"20010102": -999.0})
    with pytest.raises(ValueError, match="missing values.*precip_mm"):
        weather.to_frame(payload, "20010101", "20010102")


def test_a_missing_day_is_refused():
    with pytest.raises(ValueError, match="missing 1 days, first 2001-01-02"):
        weather.to_frame(power_payload(["20010101", "20010103"]), "20010101", "20010103")


def test_a_missing_parameter_is_refused():
    payload = power_payload(["20010101"])
    del payload["properties"]["parameter"]["WS2M"]
    with pytest.raises(ValueError, match="WS2M"):
        weather.to_frame(payload, "20010101", "20010101")


# --- SSURGO parsing ---------------------------------------------------------------------

RAW = {
    "unit": {"mukey": "1", "muname": "Test clay", "aws025wta": "4", "aws050wta": "8", "aws0100wta": "13.65",
             "aws0150wta": "17.28", "drclassdcd": "Well drained", "hydgrpdcd": "C", "slopegraddcp": None},
    "component": {"cokey": "9", "compname": "Test", "comppct_r": "85", "slope_r": "2"},
    "horizons": [{"hzname": "H1", "hzdept_r": "0", "hzdepb_r": "18", "awc_r": "0.16", "om_r": "4", "sandtotal_r": "22",
                  "silttotal_r": "28", "claytotal_r": "50", "ph1to1h2o_r": "7.9", "ec_r": "6", "wthirdbar_r": "37.2",
                  "wfifteenbar_r": "32.2"}],
}


def test_ssurgo_rows_become_soil_json():
    s = soil.summarise(RAW)
    assert s["source"] == "USDA SSURGO"
    assert (s["aws_0_100_cm"], s["ec_ds_m"], s["clay_pct"]) == (13.65, 6.0, 50.0)
    assert (s["fc_top_vol_pct"], s["wp_top_vol_pct"]) == (37.2, 32.2)  # as SSURGO gives them
    assert s["slope_pct"] == 2.0  # falls back to the component's slope


def test_missing_ssurgo_values_stay_null():
    raw = {"unit": {**RAW["unit"]}, "component": {}, "horizons": []}
    s = soil.summarise(raw)
    assert s["ec_ds_m"] is None and s["fc_top_vol_pct"] is None and s["slope_pct"] is None


# --- the saved Fallon files -------------------------------------------------------------

needs_fallon = pytest.mark.skipif(not (FALLON / "weather_daily.csv").exists(), reason="Fallon bundle not fetched")


@needs_fallon
def test_fallon_weather_is_complete():
    df = bundle._load_weather(FALLON / "weather_daily.csv", "nv-fallon-01", "real")  # the engine's own checks
    assert len(df) == 9131
    assert (df["tmax_c"] >= df["tmin_c"]).all()
    assert df["precip_mm"].min() >= 0 and df["solar_mj"].between(0, 40).all()
    yearly = df["precip_mm"].groupby(df.index.year).sum()
    assert 70 < yearly.min() < 90 and 290 < yearly.max() < 320  # a desert: 78-307 mm/yr
    assert yearly[2021] > yearly.mean()  # 2021's drought was not local rain


@needs_fallon
def test_fallon_soil_matches_ssurgo():
    s = json.loads((FALLON / "soil.json").read_text(encoding="utf-8"))
    assert s["source"] == "USDA SSURGO" and s["mukey"] == "643787"
    assert s["map_unit"].startswith("Carcity clay, slightly saline")
    assert (s["aws_0_100_cm"], s["aws_0_150_cm"]) == (13.65, 17.28)
    assert s["ec_ds_m"] == 6.0 and s["slope_pct"] == 0.5 and s["ph"] == 7.9
    assert s["wp_top_vol_pct"] < s["fc_top_vol_pct"] < 60
    assert all(isinstance(s[k], (int, float)) for k in bundle.SOIL_REQUIRED)
