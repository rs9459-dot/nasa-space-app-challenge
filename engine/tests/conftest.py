"""Test fixtures: a small hand-made bundle in a temp folder (ENGINE_DATA_DIR points at it).

It stands in for Hareem's sample bundle (H1) and uses the same file layout. Values are
obviously fake; nothing here is data.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

FIELD_ID = "test-field-01"


def write_bundle(root: Path, field_id: str = FIELD_ID, *, provenance: str = "sample",
                 start: str = "2001-01-01", end: str = "2002-12-31", lat: float = 39.38, lon: float = -118.77) -> Path:
    folder = root / "fields" / field_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "field.json").write_text(json.dumps({
        "field_id": field_id, "name": "Test field", "place": "Testville, NV", "lat": lat, "lon": lon,
        "county": "Test", "state": "NV", "country": "US", "zip": "89406", "provenance": provenance,
    }))
    days = pd.date_range(start, end, freq="D")
    doy = days.day_of_year.to_numpy()
    season = np.sin((doy - 100) / 365 * 2 * np.pi)
    pd.DataFrame({
        "day": days.strftime("%Y-%m-%d"),
        "tmax_c": 20 + 12 * season, "tmin_c": 5 + 10 * season, "tmean_c": 12.5 + 11 * season,
        "precip_mm": np.where(doy % 30 == 0, 5.0, 0.0), "solar_mj": 18 + 8 * season,
        "rh_pct": 40.0, "wind_ms": 3.0,
    }).to_csv(folder / "weather_daily.csv", index=False)
    (folder / "soil.json").write_text(json.dumps({
        "aws_0_100_cm": 14.0, "aws_0_150_cm": 17.0, "ec_ds_m": 6.0, "slope_pct": 0.5, "source": "TEST soil",
    }))
    (folder / "water.json").write_text(json.dumps({
        "source": "TEST allocations", "full_allocation_af_per_acre": 3.5,
        "allocation_fraction_by_year": {"2001": 1.0, "2002": 0.5},
    }))
    (folder / "crop_history.json").write_text(json.dumps([{"year": 2024, "cdl_code": 36, "crop": "alfalfa"}]))
    return folder


# TEST VALUES, not crop science: round numbers chosen to make the tests easy to reason about.
# The real table is data/reference/crops.csv (Hareem, task H2).
TEST_CROPS_CSV = """crop,perennial,plant_month,plant_day,stage_ini_days,stage_dev_days,stage_mid_days,stage_late_days,kc_ini,kc_mid,kc_end,root_depth_m,p_depletion,source
alfalfa,true,4,1,10,30,150,10,0.4,1.0,0.9,1.5,0.5,TEST
barley,false,3,15,20,30,50,30,0.3,1.1,0.3,1.0,0.5,TEST
fallow,false,1,1,0,0,0,0,0.2,0.2,0.2,0.5,0.5,TEST
"""


def write_reference(root: Path) -> None:
    ref = root / "reference"
    ref.mkdir(parents=True, exist_ok=True)
    (ref / "crops.csv").write_text(TEST_CROPS_CSV)
    (ref / "economics.csv").write_text("crop,region,yield_per_acre,unit,price_usd_per_unit,cost_usd_per_acre\nalfalfa,Test,5,tons,200,500\n")
    (ref / "places.csv").write_text(f"key,kind,country,lat,lon,field_id\n89406,zip,US,39.38,-118.77,{FIELD_ID}\nTestville,town,US,39.38,-118.77,{FIELD_ID}\n")


@pytest.fixture
def data_root(tmp_path, monkeypatch) -> Path:
    write_bundle(tmp_path)
    write_reference(tmp_path)
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path))
    return tmp_path
