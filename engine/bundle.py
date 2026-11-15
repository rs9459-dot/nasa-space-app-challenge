"""Load and validate field bundles (data/fields/<id>/) and the reference tables.

Errors are BundleError with a code the API returns as-is: `field_not_found` when the field
folder doesn't exist, `no_data` when a file or column the engine needs is missing or broken.
The message always names the file and the problem, so the person who owns that file can fix it.

The data root is `data/` at the repo root, or ENGINE_DATA_DIR when set (tests, Vultr).
"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import pandas as pd

from engine.types import Field, Reference

REPO_ROOT = Path(__file__).resolve().parents[1]
WEATHER_COLUMNS = ["tmax_c", "tmin_c", "tmean_c", "precip_mm", "solar_mj", "rh_pct", "wind_ms"]
SOIL_REQUIRED = ["aws_0_100_cm", "ec_ds_m"]
FIELD_REQUIRED = ["field_id", "name", "lat", "lon", "country", "provenance"]
REAL_WEATHER_YEARS = (2001, 2025)  # a "real" bundle must cover all 25 years

# Files whose dataset is fixed, so their name is enough to cite them, but only in a real
# bundle: a sample bundle's files are made up, so a file name is no evidence of a dataset.
SAMPLE_SOURCE = "SAMPLE DATA: made-up values, not real observations"
FILE_SOURCES = {
    "weather_daily.csv": "NASA POWER",
    "crop_history.json": "USDA CropScape",
    "openet_monthly.csv": "OpenET",
    "nwis_flow.csv": "USGS NWIS",
    "prism_check.csv": "PRISM",
}
FIELD_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


class BundleError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def data_dir() -> Path:
    return Path(os.environ.get("ENGINE_DATA_DIR") or REPO_ROOT / "data")


def load(field_id: str) -> tuple[Field, Reference]:
    return load_field(field_id), load_reference()


# --- field ------------------------------------------------------------------------------

def load_field(field_id: str) -> Field:
    if not FIELD_ID.match(field_id or ""):
        raise BundleError("field_not_found", f"'{field_id}' is not a valid field id")
    folder = data_dir() / "fields" / field_id
    if not folder.is_dir():
        raise BundleError("field_not_found", f"No bundle folder data/fields/{field_id}/")

    meta = _read_json(folder / "field.json", required=True)
    missing = [k for k in FIELD_REQUIRED if meta.get(k) in (None, "")]
    if missing:
        raise BundleError("no_data", f"{field_id}/field.json is missing {', '.join(missing)}")
    if meta["provenance"] not in ("real", "sample"):
        raise BundleError("no_data", f"{field_id}/field.json provenance must be 'real' or 'sample', not {meta['provenance']!r}")
    if meta["field_id"] != field_id:
        raise BundleError("no_data", f"{field_id}/field.json says field_id {meta['field_id']!r}")

    weather = _load_weather(folder / "weather_daily.csv", field_id, meta["provenance"])

    soil = _read_json(folder / "soil.json", required=True)
    missing = [k for k in SOIL_REQUIRED if not isinstance(soil.get(k), (int, float))]
    if missing:
        raise BundleError("no_data", f"{field_id}/soil.json needs numbers for {', '.join(missing)}")

    water = _read_json(folder / "water.json", required=False) or {}
    crop_history = _read_json(folder / "crop_history.json", required=False) or []
    satellite = _read_json(folder / "satellite.json", required=False) or {}
    if not isinstance(crop_history, list):
        raise BundleError("no_data", f"{field_id}/crop_history.json must be a list")

    return Field(
        field_id=field_id,
        name=str(meta["name"]),
        place=str(meta.get("place") or meta["name"]),
        lat=float(meta["lat"]),
        lon=float(meta["lon"]),
        country=str(meta["country"]),
        provenance=meta["provenance"],
        weather=weather,
        soil=soil,
        water=water,
        crop_history=crop_history,
        satellite=satellite,
        sources=_sources(folder, meta["provenance"], soil, water, satellite),
    )


def _load_weather(path: Path, field_id: str, provenance: str) -> pd.DataFrame:
    if not path.exists():
        raise BundleError("no_data", f"{field_id}/weather_daily.csv is missing")
    df = pd.read_csv(path)
    missing = [c for c in ["day", *WEATHER_COLUMNS] if c not in df.columns]
    if missing:
        raise BundleError("no_data", f"{field_id}/weather_daily.csv is missing columns {', '.join(missing)}")
    df["day"] = pd.to_datetime(df["day"], errors="coerce")
    if df["day"].isna().any():
        raise BundleError("no_data", f"{field_id}/weather_daily.csv has unreadable dates")
    df = df.set_index("day").sort_index()[WEATHER_COLUMNS].astype(float)

    if df.index.has_duplicates:
        raise BundleError("no_data", f"{field_id}/weather_daily.csv has duplicate days")
    first, last = df.index[0], df.index[-1]
    if (first.month, first.day) != (1, 1) or (last.month, last.day) != (12, 31):
        raise BundleError("no_data", f"{field_id}/weather_daily.csv must run from 1 Jan to 31 Dec (whole years), got {first.date()} to {last.date()}")
    expected = pd.date_range(first, last, freq="D")
    if len(df) != len(expected):
        gaps = expected.difference(df.index)
        raise BundleError("no_data", f"{field_id}/weather_daily.csv is missing {len(gaps)} days, first {gaps[0].date()}")
    bad = df.columns[df.isna().any()].tolist()
    if bad:
        raise BundleError("no_data", f"{field_id}/weather_daily.csv has empty values in {', '.join(bad)}")
    if provenance == "real" and (first.year, last.year) != REAL_WEATHER_YEARS:
        raise BundleError("no_data", f"{field_id}/weather_daily.csv must cover {REAL_WEATHER_YEARS[0]}-{REAL_WEATHER_YEARS[1]} for a real bundle, got {first.year}-{last.year}")
    return df


def _sources(folder: Path, provenance: str, *json_files: dict) -> list[str]:
    """Datasets to cite. A sample bundle cites only SAMPLE_SOURCE and what its files say."""
    found: list[str] = []
    if provenance == "real":
        for filename, name in FILE_SOURCES.items():
            if (folder / filename).exists():
                found.append(name)
    else:
        found.append(SAMPLE_SOURCE)
    for data in json_files:
        for key in ("source", "sources"):
            value = data.get(key) if isinstance(data, dict) else None
            for item in [value] if isinstance(value, str) else (value or []):
                if isinstance(item, str) and item.strip():
                    found.append(item.strip())
    return list(dict.fromkeys(found))  # de-duplicate, keep order


# --- reference tables -------------------------------------------------------------------

def load_reference() -> Reference:
    ref = data_dir() / "reference"
    crops = _read_csv(ref / "crops.csv", "crop")
    economics = _read_csv(ref / "economics.csv", "crop", index=False)
    return Reference(crops=crops, economics=economics)


def _read_csv(path: Path, key: str, index: bool = True) -> pd.DataFrame:
    name = f"reference/{path.name}"
    if not path.exists():
        raise BundleError("no_data", f"{name} is missing")
    df = pd.read_csv(path)
    if key not in df.columns:
        raise BundleError("no_data", f"{name} has no '{key}' column")
    if index:
        if df[key].duplicated().any():
            raise BundleError("no_data", f"{name} lists a crop twice: {df[key][df[key].duplicated()].tolist()}")
        df = df.set_index(key)
    return df


# --- finding a field --------------------------------------------------------------------

MAX_DISTANCE_KM = 25.0  # a lat/lon further than this from every field is "not found"


def resolve(request: dict) -> str:
    """field_id, then zip/place via reference/places.csv, then the nearest field to lat/lon."""
    if request.get("field_id"):
        return request["field_id"]
    # Try everything the farmer gave; an unknown ZIP shouldn't hide a town we do know.
    first_error: BundleError | None = None
    for kind in ("zip", "place"):
        if request.get(kind):
            try:
                return _lookup_place(kind, str(request[kind]))
            except BundleError as err:
                first_error = first_error or err
    if request.get("lat") is not None and request.get("lon") is not None:
        try:
            return _nearest(float(request["lat"]), float(request["lon"]))
        except BundleError as err:
            first_error = first_error or err
    raise first_error or BundleError("field_not_found", "The request gives no field_id, zip, place or lat/lon")


def _place_key(text: str) -> str:
    """'Fallon, NV ' -> 'fallon nv': case, punctuation and extra spaces don't matter."""
    return " ".join(re.sub(r"[^\w\s]", " ", text.lower()).split())


def _lookup_place(kind: str, value: str) -> str:
    path = data_dir() / "reference" / "places.csv"
    label = f"{kind} {value}"
    if not path.exists():
        raise BundleError("field_not_found", f"No reference/places.csv yet, so {label} can't be looked up")
    places = pd.read_csv(path, dtype=str).fillna("")
    want = "zip" if kind == "zip" else "town"
    rows = places[(places["kind"].str.lower() == want) & (places["key"].map(_place_key) == _place_key(value))]
    if rows.empty:
        raise BundleError("field_not_found", f"No field near {label} in reference/places.csv")
    return rows.iloc[0]["field_id"]


def _nearest(lat: float, lon: float) -> str:
    """Nearest bundle by its field.json location; real bundles win over samples."""
    best: tuple[bool, float, str] | None = None
    for meta_path in (data_dir() / "fields").glob("*/field.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            d = _km(lat, lon, float(meta["lat"]), float(meta["lon"]))
        except (ValueError, KeyError, TypeError):
            continue
        key = (meta.get("provenance") != "real", d, meta_path.parent.name)
        if d <= MAX_DISTANCE_KM and (best is None or key < best):
            best = key
    if best is None:
        raise BundleError("field_not_found", f"No field within {MAX_DISTANCE_KM:.0f} km of {lat:.4f}, {lon:.4f}")
    return best[2]


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _read_json(path: Path, required: bool):
    if not path.exists():
        if required:
            raise BundleError("no_data", f"{path.parent.name}/{path.name} is missing")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise BundleError("no_data", f"{path.parent.name}/{path.name} is not valid JSON: {err}") from err
