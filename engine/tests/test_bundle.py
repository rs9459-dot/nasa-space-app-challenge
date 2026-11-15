from __future__ import annotations

import json

import pandas as pd
import pytest

from engine import bundle
from engine.bundle import BundleError
from engine.tests.conftest import FIELD_ID, write_bundle
from engine.types import Field, Reference, Signals


def test_loads_a_bundle(data_root):
    field, ref = bundle.load(FIELD_ID)
    assert isinstance(field, Field) and isinstance(ref, Reference)
    assert field.provenance == "sample" and field.place == "Testville, Nevada"
    assert list(field.weather.columns) == bundle.WEATHER_COLUMNS
    assert len(field.weather) == 730 and field.weather.index.name == "day"
    assert field.water["allocation_fraction_by_year"]["2002"] == 0.5
    assert ref.crops.index.tolist() == ["alfalfa", "barley", "fallow"]
    assert "crop" in ref.economics.columns


def test_a_sample_bundle_never_cites_real_datasets(data_root):
    """Made-up files are no evidence of NASA POWER or CropScape, whatever they are called."""
    field, _ = bundle.load(FIELD_ID)
    assert field.sources == [bundle.SAMPLE_SOURCE, "TEST soil", "TEST allocations"]


def test_a_real_bundle_cites_the_datasets_its_files_come_from(tmp_path, monkeypatch):
    write_bundle(tmp_path, "real-field", provenance="real", end="2025-12-31")
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path))
    field = bundle.load_field("real-field")
    assert field.sources == ["NASA POWER", "USDA CropScape", "TEST soil", "TEST allocations"]


def test_optional_files_may_be_missing(data_root):
    folder = data_root / "fields" / FIELD_ID
    (folder / "water.json").unlink()
    (folder / "crop_history.json").unlink()
    field, _ = bundle.load(FIELD_ID)
    assert field.water == {} and field.crop_history == [] and field.satellite == {}


def test_signals_default_to_no_signal():
    s = Signals()
    assert (s.start_depletion_frac, s.rain_scale, s.erosion_weight, s.history_confirmed) == (0.0, 1.0, 1.0, None)
    assert s.drought_years == [] and Signals().drought_years is not s.drought_years


def expect(code: str, text: str, field_id: str = FIELD_ID):
    with pytest.raises(BundleError) as err:
        bundle.load(field_id)
    assert err.value.code == code
    assert text in err.value.message
    return err.value


def test_unknown_field(data_root):
    expect("field_not_found", "data/fields/nope/", "nope")
    expect("field_not_found", "not a valid field id", "../etc")


def test_missing_file_is_named(data_root):
    (data_root / "fields" / FIELD_ID / "soil.json").unlink()
    expect("no_data", "soil.json is missing")


def test_missing_weather_column_is_named(data_root):
    path = data_root / "fields" / FIELD_ID / "weather_daily.csv"
    pd.read_csv(path).drop(columns=["solar_mj"]).to_csv(path, index=False)
    expect("no_data", "missing columns solar_mj")


def test_weather_gap_is_reported(data_root):
    path = data_root / "fields" / FIELD_ID / "weather_daily.csv"
    df = pd.read_csv(path)
    df[df["day"] != "2001-06-15"].to_csv(path, index=False)
    expect("no_data", "missing 1 days, first 2001-06-15")


def test_empty_weather_value_is_reported(data_root):
    path = data_root / "fields" / FIELD_ID / "weather_daily.csv"
    df = pd.read_csv(path)
    df.loc[10, "precip_mm"] = None
    df.to_csv(path, index=False)
    expect("no_data", "empty values in precip_mm")


def test_real_bundle_needs_all_25_years(data_root):
    write_bundle(data_root, "short-real", provenance="real")
    expect("no_data", "must cover 2001-2025", "short-real")


def test_soil_needs_salinity(data_root):
    path = data_root / "fields" / FIELD_ID / "soil.json"
    path.write_text(json.dumps({"aws_0_100_cm": 14.0}))
    expect("no_data", "ec_ds_m")


def test_missing_reference_table(data_root):
    (data_root / "reference" / "crops.csv").unlink()
    expect("no_data", "reference/crops.csv is missing")


def test_resolve(data_root):
    assert bundle.resolve({"field_id": "anything"}) == "anything"
    assert bundle.resolve({"zip": "89406"}) == FIELD_ID
    assert bundle.resolve({"place": " testville "}) == FIELD_ID
    assert bundle.resolve({"lat": 39.40, "lon": -118.75}) == FIELD_ID
    for request, text in [({"zip": "00000"}, "zip 00000"), ({"lat": 10.0, "lon": 10.0}, "within 25 km"), ({}, "gives no")]:
        with pytest.raises(BundleError) as err:
            bundle.resolve(request)
        assert err.value.code == "field_not_found" and text in err.value.message


def test_nearest_prefers_a_real_bundle(data_root):
    write_bundle(data_root, "real-nearby", provenance="real", lat=39.45, lon=-118.77)
    assert bundle.resolve({"lat": 39.38, "lon": -118.77}) == "real-nearby"
