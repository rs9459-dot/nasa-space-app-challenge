"""USDA SSURGO soil for one field -> data/fields/<field_id>/soil.json

    python -m pipeline.soil nv-fallon-01 39.3800 -118.7700

Uses the Soil Data Access REST service (no key). US only. What the engine takes from it:
  - available water storage (the size of the water-balance bucket)
  - salinity (ec_ds_m), which cuts the yield of salt-sensitive crops
  - field capacity and wilting point of the topsoil (for the SMAP soil-moisture signal)
  - slope, drainage, texture, organic matter (soil score and erosion risk)
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import httpx

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
DATA = Path(__file__).resolve().parents[1] / "data"


def query(sql: str) -> list[dict]:
    r = httpx.post(SDA_URL, json={"query": sql, "format": "JSON+COLUMNNAME"}, timeout=90)
    r.raise_for_status()
    table = r.json().get("Table") or []
    if not table:
        return []
    columns, *rows = table
    return [dict(zip(columns, row)) for row in rows]


def num(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch(lat: float, lon: float) -> dict:
    """Raw SSURGO rows for the map unit at this point: map unit, dominant component, its horizons."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("lat/lon out of range")
    units = query(f"""
        SELECT mu.mukey, mu.muname, ma.aws025wta, ma.aws050wta, ma.aws0100wta, ma.aws0150wta,
               ma.drclassdcd, ma.hydgrpdcd, ma.slopegraddcp
        FROM mapunit mu JOIN muaggatt ma ON ma.mukey = mu.mukey
        WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point({lon:.6f} {lat:.6f})'))
    """)
    if not units:
        raise LookupError(f"SSURGO has no map unit at {lat}, {lon} (SSURGO covers the US only)")
    unit = units[0]
    mukey = int(unit["mukey"])
    components = query(f"""
        SELECT TOP 1 cokey, compname, comppct_r, slope_r FROM component
        WHERE mukey = '{mukey}' AND majcompflag = 'Yes' ORDER BY comppct_r DESC
    """)
    component = components[0] if components else {}
    horizons = query(f"""
        SELECT hzname, hzdept_r, hzdepb_r, awc_r, om_r, sandtotal_r, silttotal_r, claytotal_r,
               ph1to1h2o_r, ec_r, wthirdbar_r, wfifteenbar_r
        FROM chorizon WHERE cokey = '{int(component["cokey"])}' ORDER BY hzdept_r
    """) if component else []
    return {"unit": unit, "component": component, "horizons": horizons}


def summarise(raw: dict) -> dict:
    """SSURGO rows -> soil.json (contract A). Values SSURGO doesn't have stay null; nothing is estimated."""
    unit, component, horizons = raw["unit"], raw["component"], raw["horizons"]
    top = horizons[0] if horizons else {}

    # SSURGO's wthirdbar_r (1/3 bar = field capacity) and wfifteenbar_r (15 bar = wilting
    # point) are already percent by volume of the whole soil, the same unit SMAP measures.
    # Stored as SSURGO gives them. Note: their difference can disagree with awc_r (here
    # 5 points vs 0.16 cm/cm); the water balance uses the AWS values, not these.
    fc_vol, wp_vol = num(top.get("wthirdbar_r")), num(top.get("wfifteenbar_r"))

    slope = num(unit.get("slopegraddcp"))
    if slope is None:
        slope = num(component.get("slope_r"))

    return {
        "source": "USDA SSURGO",
        "source_detail": f"USDA NRCS Soil Data Access, map unit {unit['mukey']}, retrieved {date.today().isoformat()}",
        "mukey": str(unit["mukey"]),
        "map_unit": unit["muname"],
        "component": component.get("compname"),
        "component_pct": num(component.get("comppct_r")),
        # available water storage: cm of plant-available water held in the top N cm
        "aws_0_25_cm": num(unit.get("aws025wta")),
        "aws_0_50_cm": num(unit.get("aws050wta")),
        "aws_0_100_cm": num(unit.get("aws0100wta")),
        "aws_0_150_cm": num(unit.get("aws0150wta")),
        "drainage": unit.get("drclassdcd"),
        "hydrologic_group": unit.get("hydgrpdcd"),
        "slope_pct": slope,
        # topsoil (first horizon of the dominant component)
        "organic_matter_pct": num(top.get("om_r")),
        "sand_pct": num(top.get("sandtotal_r")),
        "silt_pct": num(top.get("silttotal_r")),
        "clay_pct": num(top.get("claytotal_r")),
        "ph": num(top.get("ph1to1h2o_r")),
        "ec_ds_m": num(top.get("ec_r")),
        "fc_top_vol_pct": fc_vol,
        "wp_top_vol_pct": wp_vol,
        "horizons": [
            {
                "name": h.get("hzname"), "top_cm": num(h.get("hzdept_r")), "bottom_cm": num(h.get("hzdepb_r")),
                "awc_cm_per_cm": num(h.get("awc_r")), "ec_ds_m": num(h.get("ec_r")), "clay_pct": num(h.get("claytotal_r")),
            }
            for h in horizons
        ],
    }


def main(field_id: str, lat: float, lon: float) -> Path:
    soil = summarise(fetch(lat, lon))
    for key in ("aws_0_100_cm", "ec_ds_m"):
        if soil[key] is None:
            raise SystemExit(f"SSURGO has no {key} here; the engine needs it. Not saving.")
    out = DATA / "fields" / field_id / "soil.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(soil, indent=2) + "\n", encoding="utf-8")
    print(f"{out.relative_to(DATA.parent)}: {soil['map_unit']} | AWS 0-100 cm {soil['aws_0_100_cm']} cm | "
          f"EC {soil['ec_ds_m']} dS/m | slope {soil['slope_pct']}% | FC {soil['fc_top_vol_pct']}% WP {soil['wp_top_vol_pct']}% by volume")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: python -m pipeline.soil <field_id> <lat> <lon>")
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
