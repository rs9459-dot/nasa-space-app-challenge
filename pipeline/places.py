"""Where farmers say they are -> which field bundle answers them.

    python -m pipeline.places        writes data/reference/places.csv

A farmer texts a ZIP code or a town ("alfalfa 89406", "alfalfa near Fallon"). The engine
looks that up here to find the field bundle to use. Add a field's ZIP codes and place
names to FIELDS below and rerun. Matching ignores case, commas and extra spaces, so
"Fallon, NV" and "fallon nv" are the same key.

lat/lon are the FIELD's location (the bundle that will answer), not the town centre.
"""
from __future__ import annotations

import csv
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"

FIELDS = [
    {
        "field_id": "nv-fallon-01", "country": "US", "lat": 39.3800, "lon": -118.7700,
        "zips": ["89406"],  # Fallon, Churchill County, NV
        "towns": ["Fallon", "Fallon NV", "Fallon Nevada", "Churchill County"],
    },
]


def rows() -> list[dict]:
    out = []
    for f in FIELDS:
        for kind, keys in (("zip", f["zips"]), ("town", f["towns"])):
            for key in keys:
                out.append({"key": key, "kind": kind, "country": f["country"], "lat": f["lat"], "lon": f["lon"], "field_id": f["field_id"]})
    keys = [(r["kind"], r["key"].lower()) for r in out]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        raise ValueError(f"the same place points at two fields: {sorted(duplicates)}")
    return out


def main() -> Path:
    out = DATA / "reference" / "places.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="\n", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["key", "kind", "country", "lat", "lon", "field_id"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows())
    print(f"{out.relative_to(DATA.parent)}: {len(rows())} places for {len(FIELDS)} field(s)")
    return out


if __name__ == "__main__":
    main()
