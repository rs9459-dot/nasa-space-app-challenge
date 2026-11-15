"""Water supply data for a Newlands Project field -> data/fields/<field_id>/

    python -m pipeline.water_data nv-fallon-01

Writes:
  water.json      the legal water duty and the allocation TCID announced each year
  nwis_flow.csv   daily Carson River flow above Lahontan Reservoir (USGS NWIS, no key)

The allocation table below is hand-collected from the Truckee-Carson Irrigation District's
(TCID) announcements as reported in the press. Every year has its source. Years with no
source found are LEFT OUT, never guessed: at the time of writing that is 2001-2012, 2017 and
2018. To add a year, add a row with its source and rerun.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"

# --- Newlands Project, Carson Division (Fallon) ---------------------------------------------

DUTY = {
    "bottom_land_af_per_acre": 3.5,
    "bench_land_af_per_acre": 4.5,
    "source": "Alpine decree (United States v. Alpine Land & Reservoir Co., 503 F. Supp. 877, D. Nev. 1980), "
              "as applied in 43 CFR 418 (Newlands Project OCAP): maximum annual water duty 3.5 AF/acre for "
              "bottom lands and 4.5 AF/acre for bench lands",
}

# year -> (percent at the start of the season, final percent, what happened, source)
ALLOCATIONS: dict[int, tuple[int | None, int, str, str]] = {
    2013: (None, 75, "Reduced to 75%; deliveries ended in September, two months early.",
           "Nevada Appeal, 2015 drought coverage recapping 2013 (nevadaappeal.com/news/2015/mar/26/dry-conditions-equals-short-water-season)"),
    2014: (40, 45, "Set at 40% in March, raised to 50%, cut back to 45% in May.",
           "Associated Press, 9 May 2014, 'Drought prompts irrigation water cuts in Fallon'; Nevada Appeal, 11 Mar 2014, 'Drought limits water season'"),
    2015: (20, 20, "Set at 20% for both divisions, the lowest on record (previous low 28% in 1994).",
           "Northern Nevada Business Weekly, 9 Mar 2015, 'Drought is a big concern for farmers'; Nevada Appeal, 26 Mar 2015"),
    2016: (70, 75, "Set at 70% in March, later 85%, reduced to 75% on 5 July.",
           "Fernley Reporter, 7 Jul 2016, 'TCID announces allocation, delivery amendments'; Nevada Appeal, 3 Mar and 7 Jul 2016"),
    2019: (100, 100, "Set at 100% on 5 February.",
           "The Fallon Post, 21 Feb 2019, 'TCID sets 100% water year for farmers'"),
    2020: (95, 100, "Set at 95% in March, raised to 100% by August.",
           "The Fallon Post, 10 Mar 2020, 'TCID sets water allocation' and 3 Aug 2020, 'High demand for water in Lahontan Reservoir'"),
    2021: (90, 70, "Set at 90% in March, cut to 70% on 5 May as the snowmelt forecast fell.",
           "The Fallon Post, 5 Mar 2021, 'Forecast optimistic, TCID sets allocation' and 7 May 2021, 'TCID water allocation set at 70%'; TCID board minutes, 8 Mar 2022"),
    2022: (70, 85, "Set at 70% in March, raised to 85% on 21 June after April storms; still 85% in September.",
           "The Fallon Post, 11 Mar 2022, 24 Jun 2022 'TCID raises the water allocation' and 9 Sep 2022"),
    2023: (100, 100, "Set at 100% for the Carson Division.",
           "The Fallon Post, 16 Mar 2023, 'TCID sets water allocation'"),
    2024: (None, 100, "Projected at 100% at the 12 March board meeting (a projection in the source, not a quoted board vote).",
           "The Fallon Post, 23 Mar 2024, 'Good news for TCID water users: 100% allocations ahead'"),
    2025: (100, 100, "Board voted 100% for both divisions.",
           "The Fallon Post, 14 Mar 2025, 'TCID announces 100% water supply, irrigation begins March 15'"),
}

# --- USGS NWIS ------------------------------------------------------------------------------

NWIS_URL = "https://waterservices.usgs.gov/nwis/dv/"
GAUGE = {"site": "10312000", "name": "Carson River near Fort Churchill, NV", "parameter": "00060"}  # discharge, ft3/s


def build_water_json(land: str = "bottom") -> dict:
    duty = DUTY[f"{land}_land_af_per_acre"]
    return {
        "source": "Newlands Project allocations (TCID)",
        "project": "Newlands Project, Carson Division, operated by the Truckee-Carson Irrigation District (TCID)",
        "full_allocation_af_per_acre": duty,
        "land_class": land,
        "land_class_note": "ASSUMED bottom land (the lower duty, so the cautious choice). TCID's bench/bottom "
                           "map for this parcel has not been checked; bench land would be 4.5 AF/acre.",
        "duty_source": DUTY["source"],
        # Of each acre-foot delivered to the farm, how much the crop consumes. The rest is
        # lost on the way to the roots (runoff, deep percolation in flood irrigation).
        "consumptive_use_af_per_acre": 2.99,
        "application_efficiency": round(2.99 / duty, 3),
        "efficiency_source": "Alpine decree: net consumptive use of 2.99 AF/acre for Newlands Project irrigation "
                             "(as cited in Pyramid Lake Paiute Tribe v. Nevada, 9th Cir. 2013). Efficiency = 2.99 "
                             "divided by the duty; a derived figure, not a measured one.",
        "allocation_fraction_by_year": {str(y): final / 100 for y, (_start, final, _note, _src) in sorted(ALLOCATIONS.items())},
        "allocation_detail": [
            {"year": y, "start_pct": start, "final_pct": final, "note": note, "source": src}
            for y, (start, final, note, src) in sorted(ALLOCATIONS.items())
        ],
        "years_without_a_source": [y for y in range(2001, 2026) if y not in ALLOCATIONS],
        "water_cost_usd_per_af": None,
        "water_cost_note": "Not found. TCID charges an annual O&M assessment per acre (tcid.org fee schedule); "
                           "the figure is published as an image/PDF that was not retrieved.",
    }


def fetch_flow(start: str = "2001-01-01", end: str = "2025-12-31") -> pd.DataFrame:
    r = httpx.get(NWIS_URL, params={"format": "json", "sites": GAUGE["site"], "parameterCd": GAUGE["parameter"],
                                    "startDT": start, "endDT": end}, timeout=180)
    r.raise_for_status()
    return flow_frame(r.json())


def flow_frame(payload: dict) -> pd.DataFrame:
    """NWIS daily-values JSON -> day, flow_cfs, qualifiers. Missing or flagged-absent values are dropped, not filled."""
    series = payload["value"]["timeSeries"]
    if not series:
        raise ValueError("USGS NWIS returned no time series")
    no_data = series[0]["variable"].get("noDataValue", -999999.0)
    rows = [
        (v["dateTime"][:10], float(v["value"]), "|".join(v.get("qualifiers", [])))
        for block in series[0]["values"] for v in block["value"]
        if v["value"] not in ("", None) and float(v["value"]) != no_data
    ]
    return pd.DataFrame(rows, columns=["day", "flow_cfs", "qualifiers"]).drop_duplicates("day").sort_values("day")


def main(field_id: str) -> None:
    folder = DATA / "fields" / field_id
    folder.mkdir(parents=True, exist_ok=True)

    water = build_water_json()
    (folder / "water.json").write_text(json.dumps(water, indent=2) + "\n", encoding="utf-8")
    print(f"water.json: duty {water['full_allocation_af_per_acre']} AF/acre, {len(ALLOCATIONS)} sourced years, "
          f"2021 = {water['allocation_fraction_by_year']['2021']}, 2022 = {water['allocation_fraction_by_year']['2022']}; "
          f"no source for {len(water['years_without_a_source'])} years")

    flow = fetch_flow()
    flow.to_csv(folder / "nwis_flow.csv", index=False, lineterminator="\n")
    yearly = flow.assign(year=flow["day"].str[:4].astype(int)).groupby("year")["flow_cfs"].agg(["mean", "count"])
    print(f"nwis_flow.csv: {len(flow)} days from USGS {GAUGE['site']} ({GAUGE['name']}), {flow['day'].iloc[0]} to {flow['day'].iloc[-1]}")
    print("mean flow (ft3/s) by year: " + ", ".join(f"{y}:{m:.0f}" for y, m in yearly["mean"].items()))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m pipeline.water_data <field_id>")
    main(sys.argv[1])
