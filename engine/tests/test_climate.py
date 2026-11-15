"""H8: the climate trend, the weather shifted to 2035, and the plan's climate_2035 block."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from engine import bundle, climate, contract, plan
from engine.tests.conftest import FIELD_ID, write_bundle

REQUEST = {"field_id": FIELD_ID, "current_crop": "alfalfa", "priorities": {"water": 0.5, "income": 0.25, "drought": 0.25}}


def warming_field(data_root, *, warming_c_per_year: float = 0.05, drying_mm_per_year: float = 0.0):
    """The test bundle with 2001-2015 weather and a known trend written into it."""
    folder = write_bundle(data_root, start="2001-01-01", end="2015-12-31")
    path = folder / "weather_daily.csv"
    weather = pd.read_csv(path, parse_dates=["day"])
    step = weather["day"].dt.year - 2001
    for column in climate.TEMP_COLUMNS:
        weather[column] = weather[column] + warming_c_per_year * step
    wet = weather["precip_mm"] > 0
    rain_days = wet.groupby(weather["day"].dt.year).transform("sum")
    weather.loc[wet, "precip_mm"] += (drying_mm_per_year * step / rain_days)[wet]
    weather.to_csv(path, index=False)
    return bundle.load(FIELD_ID)


def test_mann_kendall_finds_a_known_trend():
    rng = np.random.default_rng(7)
    series = 10 + 0.05 * np.arange(25) + rng.normal(0, 0.02, 25)
    slope, p = climate.mann_kendall(series)
    assert slope == pytest.approx(0.05, abs=0.005)
    assert p < 0.001


def test_mann_kendall_sees_no_trend_in_noise_or_a_flat_line():
    rng = np.random.default_rng(7)
    slope, p = climate.mann_kendall(rng.normal(10, 1, 25))
    assert p > 0.05
    assert climate.mann_kendall([4.0] * 25) == (0.0, 1.0)
    assert climate.mann_kendall([1.0, 2.0]) == (0.0, 1.0)  # too short to say anything


def test_mann_kendall_matches_a_hand_worked_example():
    # 1, 2, 3, 5, 4: nine rising pairs, one falling -> S = 8, var = 5*4*15/18, z = 7/sqrt(var)
    slope, p = climate.mann_kendall([1, 2, 3, 5, 4])
    assert slope == pytest.approx(1.0)
    assert p == pytest.approx(0.0864, abs=0.0005)


def test_trend_reads_the_warming_written_into_the_weather(data_root):
    field, _ = warming_field(data_root, warming_c_per_year=0.05, drying_mm_per_year=-1.0)
    t = climate.trend(field)
    assert t["temp_trend_c_per_decade"] == pytest.approx(0.5, abs=0.02)
    assert t["temp_trend_significant"] is True
    assert t["rain_trend_mm_per_decade"] == pytest.approx(-10, abs=1)
    assert t["rain_trend_significant"] is True
    assert (t["first_year"], t["last_year"]) == (2001, 2015)


def test_too_short_a_record_gives_no_trend(data_root):
    field, _ = bundle.load(FIELD_ID)  # the standard test bundle has 2 years
    assert climate.trend(field) is None
    assert climate.shift_weather(field).equals(field.weather)


def test_shift_adds_the_temperature_trend_and_scales_the_rain(data_root):
    field, _ = warming_field(data_root, warming_c_per_year=0.05, drying_mm_per_year=-1.0)
    t = climate.trend(field)
    shifted = climate.shift_weather(field, year=2035, trends=t)
    decades = (2035 - 2015) / 10
    warmer = t["temp_trend_c_per_decade"] * decades
    for column in climate.TEMP_COLUMNS:
        assert (shifted[column] - field.weather[column]).to_numpy() == pytest.approx(warmer)
    factor = 1 + t["rain_trend_mm_per_decade"] * decades / t["mean_rain_mm"]
    assert 0 < factor < 1
    assert shifted["precip_mm"].sum() == pytest.approx(field.weather["precip_mm"].sum() * factor)
    assert shifted["solar_mj"].equals(field.weather["solar_mj"])
    assert field.weather["tmean_c"].iloc[0] != shifted["tmean_c"].iloc[0]  # the original is untouched


def test_rain_never_goes_below_zero(data_root):
    field, _ = bundle.load(FIELD_ID)
    drying = {"temp_trend_c_per_decade": 0.0, "rain_trend_mm_per_decade": -1e6, "last_year": 2002, "mean_rain_mm": 60.0}
    assert climate.shift_weather(field, trends=drying)["precip_mm"].sum() == 0


def test_plan_carries_a_valid_2035_block(data_root):
    warming_field(data_root, warming_c_per_year=0.1)
    result = plan.make_plan(REQUEST)
    block = result["climate_2035"]
    assert contract.problems(result) == []
    assert block["temp_trend_c_per_decade"] == 1.0 and block["temp_trend_significant"] is True
    assert [o["label"] for o in block["options"]] == [o["label"] for o in result["options"]]
    # 2 C warmer by 2035: no option needs less water than it does today
    today = {o["label"]: o["water_af_per_acre"] for o in result["options"]}
    assert all(o["water_af_per_acre"] >= today[o["label"]] for o in block["options"])


def test_plan_without_a_trend_has_no_2035_block(data_root):
    result = plan.make_plan(REQUEST)  # 2 years of weather
    assert "climate_2035" not in result
