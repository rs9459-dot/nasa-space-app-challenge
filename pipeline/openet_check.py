"""Check our water balance against OpenET -> data/fields/<field_id>/openet_check.json

    python -m pipeline.openet_check nv-fallon-01

Two checks, both against data/fields/<field_id>/openet_monthly.csv (pipeline/openet.py):

1. Reference ET (no crop numbers involved): our Hargreaves ET0 from NASA POWER temperatures
   vs OpenET's gridMET reference ET, monthly, 2016-2025.
2. Crop water use: our simulated actual ET for the crops the field really grew (USDA
   CropScape, crop_history.json) vs the ET OpenET measured from Landsat, per year. Needs a
   complete crops.csv (crops slice) and a sourced allocation for every year of each
   3-year window, so it covers fewer years and is skipped until those exist.

Our model only counts water use in a crop's season and none for fallow, while OpenET
measures the whole year (bare-soil evaporation and weeds included); the crop check therefore
compares calendar-year totals and reports each year so the differences can be read.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from engine import bundle, water
from engine.bundle import BundleError

ROOT = Path(__file__).resolve().parents[1]


def openet(field_id: str) -> pd.DataFrame:
    return pd.read_csv(bundle.data_dir() / "fields" / field_id / "openet_monthly.csv", index_col="month")


def reference_check(weather: pd.DataFrame, lat: float, o: pd.DataFrame) -> dict:
    """Needs only the weather file and the OpenET file (no crop numbers, no field.json)."""
    w = weather
    et0 = pd.Series(water.hargreaves_et0(lat, w.index.day_of_year.to_numpy(), w["tmax_c"].to_numpy(),
                                         w["tmin_c"].to_numpy(), w["tmean_c"].to_numpy()), index=w.index)
    ours = et0.resample("MS").sum()
    ours.index = ours.index.strftime("%Y-%m")
    j = pd.DataFrame({"ours": ours, "openet": o["eto_mm"]}).dropna()
    yearly = j.groupby(j.index.str[:4]).sum()
    return {
        "what": "Hargreaves ET0 (NASA POWER) vs OpenET gridMET reference ET",
        "months": len(j),
        "annual_bias_pct": round(100 * (yearly["ours"].sum() - yearly["openet"].sum()) / yearly["openet"].sum(), 1),
        "monthly_correlation": round(float(j["ours"].corr(j["openet"])), 3),
        "monthly_mean_abs_diff_mm": round(float((j["ours"] - j["openet"]).abs().mean()), 1),
        "by_year_mm": {y: {"ours": round(r.ours), "openet": round(r.openet)} for y, r in yearly.iterrows()},
    }


def crop_check(field, ref, o: pd.DataFrame) -> dict | None:
    grown = {h["year"]: h.get("crop") for h in field.crop_history}
    alloc = {int(k): float(v) for k, v in (field.water.get("allocation_fraction_by_year") or {}).items()}
    first, last = int(o.index[0][:4]), int(o.index[-1][:4])

    per_year: dict[int, list[tuple[float, str]]] = {}
    for y0 in range(first, last - 1):
        years = [y0, y0 + 1, y0 + 2]
        rotation = tuple(grown.get(y) for y in years)
        if not all(y in alloc for y in years) or not all(c in ref.crops.index for c in rotation):
            continue
        try:
            sim = water.simulate(field, [rotation], ref, weather=field.weather[field.weather.index.year.isin(years)],
                                 allocation={y: alloc[y] for y in years})
        except BundleError:
            return None  # crops.csv not complete yet
        row = int(np.flatnonzero((sim.sequences == years).all(axis=1) & (sim.allocation_years == years).all(axis=1))[0])
        for j, y in enumerate(years):
            per_year.setdefault(y, []).append((float(sim.eta_mm[0, row, j]), rotation[j]))
    if not per_year:
        return None

    yearly = o["et_mm"].groupby(o.index.str[:4]).sum()
    rows = {}
    for y in sorted(per_year):
        ours = float(np.mean([v for v, _ in per_year[y]]))
        rows[str(y)] = {"crop": per_year[y][0][1], "allocation_pct": round(100 * alloc[y]),
                        "ours_mm": round(ours), "openet_mm": round(float(yearly[str(y)]))}
    full = [r for r in rows.values() if r["allocation_pct"] == 100 and r["crop"] != "fallow"]
    summary = None
    if full:
        ours, theirs = sum(r["ours_mm"] for r in full), sum(r["openet_mm"] for r in full)
        summary = {"years": len(full), "bias_pct": round(100 * (ours - theirs) / theirs, 1),
                   "worst_year_pct": max((round(100 * (r["ours_mm"] - r["openet_mm"]) / r["openet_mm"], 1)
                                          for r in full), key=abs)}
    return {"what": "simulated actual ET for the crops grown (CropScape) vs OpenET Ensemble ET, calendar years",
            "full_allocation_years": summary, "by_year": rows}


def main(field_id: str) -> Path:
    field, ref = bundle.load(field_id)
    o = openet(field_id)
    result = {"field_id": field_id, "reference_et": reference_check(field.weather, field.lat, o),
              "crop_et": crop_check(field, ref, o),
              "note": "Crop ET depends on the crops slice's crop coefficients (prototype until validated)."}
    out = bundle.data_dir() / "fields" / field_id / "openet_check.json"
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    r = result["reference_et"]
    print(f"Reference ET: ours vs OpenET {r['annual_bias_pct']:+}% a year, monthly r = {r['monthly_correlation']}")
    c = result["crop_et"]
    if c is None:
        print("Crop ET: skipped (needs a complete crops.csv and crop history)")
    else:
        for y, row in c["by_year"].items():
            print(f"  {y} {row['crop'] or '?':10s} allocation {row['allocation_pct']:3d}%  ours {row['ours_mm']:5d} mm  OpenET {row['openet_mm']:5d} mm")
        if c["full_allocation_years"]:
            s = c["full_allocation_years"]
            print(f"Crop ET, full-allocation years: ours vs OpenET {s['bias_pct']:+}% over {s['years']} years (worst {s['worst_year_pct']:+}%)")
    print(f"-> {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m pipeline.openet_check <field_id>")
    main(sys.argv[1])
