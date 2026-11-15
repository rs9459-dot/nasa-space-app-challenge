"""Water-slice data checks (A4). No network."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from pipeline import water_data

FALLON = Path(__file__).resolve().parents[2] / "data" / "fields" / "nv-fallon-01"


def test_every_allocation_year_has_a_source():
    for year, (start, final, note, source) in water_data.ALLOCATIONS.items():
        assert 2001 <= year <= 2025
        assert 0 <= final <= 100 and (start is None or 0 <= start <= 100)
        assert len(note) > 10 and len(source) > 20, year


def test_water_json_shape():
    w = water_data.build_water_json()
    assert w["source"] and w["duty_source"]
    assert w["full_allocation_af_per_acre"] == 3.5
    fractions = w["allocation_fraction_by_year"]
    assert all(0 <= v <= 1 for v in fractions.values())
    # the two years the hindcast needs
    assert fractions["2021"] == 0.7 and fractions["2022"] == 0.85
    assert fractions["2015"] == 0.2
    # years with no source are listed, not filled in
    assert set(map(str, w["years_without_a_source"])).isdisjoint(fractions)
    assert len(fractions) + len(w["years_without_a_source"]) == 25
    assert w["water_cost_usd_per_af"] is None and w["water_cost_note"]


def test_nwis_json_becomes_a_table():
    payload = {"value": {"timeSeries": [{
        "variable": {"noDataValue": -999999.0},
        "values": [{"value": [
            {"value": "44.9", "qualifiers": ["A"], "dateTime": "2021-06-01T00:00:00.000"},
            {"value": "-999999", "qualifiers": ["P", "Ice"], "dateTime": "2021-06-02T00:00:00.000"},
            {"value": "37.5", "qualifiers": ["A", "e"], "dateTime": "2021-06-03T00:00:00.000"},
        ]}],
    }]}}
    df = water_data.flow_frame(payload)
    assert df.to_dict("records") == [
        {"day": "2021-06-01", "flow_cfs": 44.9, "qualifiers": "A"},
        {"day": "2021-06-03", "flow_cfs": 37.5, "qualifiers": "A|e"},
    ]
    with pytest.raises(ValueError):
        water_data.flow_frame({"value": {"timeSeries": []}})


needs_fallon = pytest.mark.skipif(not (FALLON / "nwis_flow.csv").exists(), reason="Fallon water data not fetched")


@needs_fallon
def test_saved_water_json_matches_the_script():
    assert json.loads((FALLON / "water.json").read_text(encoding="utf-8")) == water_data.build_water_json()


@needs_fallon
def test_river_flow_agrees_with_the_allocation_cuts():
    flow = pd.read_csv(FALLON / "nwis_flow.csv")
    assert len(flow) == 9131 and (flow["flow_cfs"] >= 0).all()
    yearly = flow.groupby(flow["day"].str[:4].astype(int))["flow_cfs"].mean()
    # The two driest river years are the two lowest allocations (2015: 20%, 2014: 45%).
    assert set(yearly.nsmallest(2).index) == {2014, 2015}
    # 2021 (allocation cut to 70%) is a low-flow year; 2017 and 2023 are the big-snow years.
    assert yearly[2021] < yearly.quantile(0.25)
    assert set(yearly.nlargest(2).index) == {2017, 2023}
