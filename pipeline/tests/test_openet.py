"""OpenET: parsing (no network), the saved Fallon file, and the reference-ET check."""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from pipeline import openet, openet_check

FALLON = Path(__file__).resolve().parents[2] / "data" / "fields" / "nv-fallon-01"


def rows(months: list[str], name: str, value: float = 10.0) -> list[dict]:
    return [{"time": f"{m}-01", name: value} for m in months]


def test_openet_rows_become_a_monthly_table():
    months = ["2016-01", "2016-02", "2016-03"]
    df = openet.to_frame(rows(months, "et", 5.0), rows(months, "eto", 20.0), "2016-01-01", "2016-03-31")
    assert list(df.index) == months and df.index.name == "month"
    assert df["et_mm"].tolist() == [5.0] * 3 and df["eto_mm"].tolist() == [20.0] * 3
    assert set(df["model"]) == {"Ensemble v2.1"}


@pytest.mark.parametrize("et,eto,message", [
    (rows(["2016-01", "2016-03"], "et"), rows(["2016-01", "2016-02", "2016-03"], "eto"), "missing|empty"),
    ([{"time": "2016-01-01", "et": None}] + rows(["2016-02", "2016-03"], "et"), rows(["2016-01", "2016-02", "2016-03"], "eto"), "empty"),
    (rows(["2016-01", "2016-02", "2016-03"], "et", -1.0), rows(["2016-01", "2016-02", "2016-03"], "eto"), "negative"),
])
def test_gaps_and_bad_values_are_refused(et, eto, message):
    with pytest.raises(ValueError, match=message):
        openet.to_frame(et, eto, "2016-01-01", "2016-03-31")


def test_saved_fallon_file_is_complete():
    df = pd.read_csv(FALLON / "openet_monthly.csv")
    assert list(df.columns) == ["month", "et_mm", "eto_mm", "model", "source"]
    assert len(df) == 120 and df["month"].iloc[0] == "2016-01" and df["month"].iloc[-1] == "2025-12"
    assert df[["et_mm", "eto_mm"]].notna().all().all() and (df[["et_mm", "eto_mm"]] >= 0).all().all()
    yearly = df.groupby(df["month"].str[:4])["et_mm"].sum()
    # The 2021-22 drought shows from space: far less water used than in full-allocation years.
    assert yearly["2021"] < 0.5 * yearly["2019"] and yearly["2022"] < 0.5 * yearly["2024"]


def test_our_reference_et_agrees_with_openet():
    """Hargreaves ET0 from NASA POWER vs gridMET reference ET: same months, within 10% a year."""
    weather = pd.read_csv(FALLON / "weather_daily.csv", parse_dates=["day"], index_col="day")
    o = pd.read_csv(FALLON / "openet_monthly.csv", index_col="month")
    result = openet_check.reference_check(weather, 39.38, o)
    assert result["months"] == 120
    assert abs(result["annual_bias_pct"]) < 10
    assert result["monthly_correlation"] > 0.95
