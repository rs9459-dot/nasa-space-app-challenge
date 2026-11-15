"""H9: what pipeline/tiger.py reads from a bundle and how it splits the schema (no database)."""
from __future__ import annotations

import json
import ssl

import pandas as pd
import pytest

from pipeline import tiger


@pytest.fixture
def folder(tmp_path):
    f = tmp_path / "fields" / "t-1"
    f.mkdir(parents=True)
    (f / "field.json").write_text(json.dumps({
        "field_id": "t-1", "name": "Test", "place": "Testville, Nevada", "country": "US",
        "lat": 39.0, "lon": -118.0, "provenance": "sample"}))
    (f / "soil.json").write_text(json.dumps({"ec_ds_m": 2.0}))
    (f / "water.json").write_text(json.dumps({
        "source": "TEST allocations",
        "allocation_fraction_by_year": {"2015": 0.2, "2021": 0.7},
        "allocation_detail": [{"year": 2015, "note": "cut", "source": "TEST 2015"}]}))
    (f / "crop_history.json").write_text(json.dumps([
        {"year": 2024, "cdl_code": 36, "crop": "alfalfa", "category": "Alfalfa", "source": "TEST"},
        {"year": 2008, "cdl_code": 28, "crop": None, "category": "Oats", "source": "TEST"}]))
    pd.DataFrame({"day": ["2001-01-01", "2001-01-02"], "tmax_c": [4.0, 6.0], "tmin_c": [-5.0, -2.0],
                  "tmean_c": [-0.3, 0.7], "precip_mm": [0.0, 1.5], "solar_mj": [9.0, 10.0],
                  "rh_pct": [66.0, 54.0], "wind_ms": [0.8, 0.8]}).to_csv(f / "weather_daily.csv", index=False)
    pd.DataFrame({"month": ["2016-01", "2016-02"], "et_mm": [8.0, 20.0], "eto_mm": [25.3, None],
                  "model": ["Ensemble v2.1"] * 2, "source": ["TEST"] * 2}).to_csv(f / "openet_monthly.csv", index=False)
    return f


def test_schema_splits_into_single_statements():
    found = tiger.statements(tiger.SCHEMA.read_text(encoding="utf-8"))
    assert all("--" not in s.splitlines()[0] for s in found)
    assert sum(s.startswith("SELECT create_hypertable") for s in found) == 4
    assert found[0].startswith("CREATE EXTENSION")
    # the continuous aggregate is one whole statement, and the last one
    assert found[-1].startswith("CREATE MATERIALIZED VIEW") and "WITH NO DATA" in found[-1]
    # nothing was glued together: one CREATE or SELECT per statement
    assert all(s.count("CREATE TABLE") + s.count("create_hypertable(") + s.count("CREATE MATERIALIZED") <= 1 for s in found)


def test_schema_is_safe_to_run_again():
    for s in tiger.statements(tiger.SCHEMA.read_text(encoding="utf-8")):
        assert "IF NOT EXISTS" in s or "if_not_exists => TRUE" in s, s[:60]


def test_field_row_keeps_soil_and_water_whole(folder):
    row = tiger.field_row(folder)
    assert row[:7] == ("t-1", "Test", "Testville, Nevada", "US", 39.0, -118.0, "sample")
    assert json.loads(row[7]) == {"ec_ds_m": 2.0}
    assert json.loads(row[8])["allocation_fraction_by_year"]["2015"] == 0.2


def test_crop_history_keeps_unmapped_years(folder):
    rows = tiger.crop_history_rows(folder, "t-1")
    assert ("t-1", 2008, 28, None, "Oats", "TEST") in rows and len(rows) == 2


def test_allocations_are_the_sourced_years_only(folder):
    rows = tiger.allocation_rows(folder, "t-1")
    assert rows == [("t-1", 2015, 0.2, "cut", "TEST 2015"), ("t-1", 2021, 0.7, None, "TEST allocations")]


def test_weather_has_the_table_columns_in_order(folder):
    assert list(tiger.weather_frame(folder).columns) == tiger.WEATHER_COLUMNS


def test_satellite_is_long_form_and_drops_missing_values(folder):
    long = tiger.satellite_frame(folder)
    assert list(long.columns) == ["observed_at", "source", "variable", "value"]
    assert len(long) == 3  # et x 2, eto x 1 (the missing one is not loaded)
    assert set(long["variable"]) == {"et_mm", "eto_mm"}
    assert long["observed_at"].iloc[0] == "2016-01-01T00:00:00+00:00"
    assert set(long["source"]) == {"OpenET Ensemble v2.1"}


def test_missing_optional_files_are_skipped(folder):
    (folder / "openet_monthly.csv").unlink()
    assert tiger.satellite_frame(folder) is None and tiger.flow_frame(folder) is None


def test_economics_rows_cover_every_crop_and_leave_gaps_empty():
    yields, prices = tiger.economics_rows()
    assert len(yields) == len(prices) > 0
    assert all(len(r) == 5 for r in yields) and all(len(r) == 7 for r in prices)
    assert all(v is None or v == v for r in yields for v in r)  # no NaN reaches the database


def test_tls_is_always_verified():
    context = tiger.tls_context()
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname is True


def test_database_url_must_be_set(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(tiger, "ROOT", tmp_path)
    with pytest.raises(SystemExit):
        tiger.database_url()
