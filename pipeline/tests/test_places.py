"""The places lookup (A9): the saved places.csv, read the way the engine reads it."""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from engine import bundle
from engine.bundle import BundleError
from pipeline import places

REPO_DATA = Path(__file__).resolve().parents[2] / "data"


def test_saved_file_matches_the_script():
    saved = pd.read_csv(REPO_DATA / "reference" / "places.csv", dtype=str)
    assert saved.to_dict("records") == [{k: str(v) for k, v in r.items()} for r in places.rows()]


def test_every_place_points_at_a_field_folder():
    for row in places.rows():
        assert (REPO_DATA / "fields" / row["field_id"]).is_dir(), row


@pytest.mark.parametrize("request_body", [
    {"zip": "89406"},
    {"place": "Fallon"},
    {"place": "fallon, nv"},
    {"place": "  FALLON  Nevada "},
    {"zip": "99999", "place": "Fallon"},         # unknown ZIP, known town
    {"zip": "99999", "lat": 39.40, "lon": -118.75} if (REPO_DATA / "fields" / "nv-fallon-01" / "field.json").exists() else {"zip": "89406"},
])
def test_farmer_locations_find_fallon(monkeypatch, request_body):
    monkeypatch.setenv("ENGINE_DATA_DIR", str(REPO_DATA))
    assert bundle.resolve(request_body) == "nv-fallon-01"


def test_unknown_places_say_which(monkeypatch):
    monkeypatch.setenv("ENGINE_DATA_DIR", str(REPO_DATA))
    with pytest.raises(BundleError, match="zip 10001") as err:
        bundle.resolve({"zip": "10001", "place": "New York"})
    assert err.value.code == "field_not_found"


def test_one_place_cannot_point_at_two_fields(monkeypatch):
    clash = [*places.FIELDS, {"field_id": "other", "country": "US", "lat": 0, "lon": 0, "zips": ["89406"], "towns": []}]
    monkeypatch.setattr(places, "FIELDS", clash)
    with pytest.raises(ValueError, match="two fields"):
        places.rows()
