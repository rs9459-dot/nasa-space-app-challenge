"""H9: load a field bundle into Tiger Data (TimescaleDB).

    python -m pipeline.tiger nv-fallon-01            # create the schema if needed, then load
    python -m pipeline.tiger nv-fallon-01 --counts   # only print the row counts

Reads the bundle files in data/fields/<field_id>/ and data/reference/economics.csv (read-only)
and writes them to the tables in db/schema.sql: weather, satellite observations, river flow
and farmer requests are hypertables; weather_monthly is a continuous aggregate.

Running it twice gives the same rows: the daily series go in by COPY into a temporary table
and are then upserted, and the small tables are replaced for that field inside a transaction.

The connection string comes from DATABASE_URL (environment, or engine/.env, which is
gitignored). TLS is always verified. Tiger Cloud signs its servers with its own certificate
authority (ca.timescale.com), which is not in the system store, so that CA certificate is kept
in db/tiger-ca.pem and the connection is checked against it and the system store.

Uses pg8000, a pure-Python driver: `pip install -r pipeline/requirements-tiger.txt`.
"""
from __future__ import annotations

import io
import json
import os
import ssl
import sys
import urllib.parse
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SCHEMA = ROOT / "db" / "schema.sql"
TIGER_CA = ROOT / "db" / "tiger-ca.pem"

WEATHER_COLUMNS = ["day", "tmax_c", "tmin_c", "tmean_c", "precip_mm", "solar_mj", "rh_pct", "wind_ms"]
COUNTED = ["fields", "crop_history", "weather_daily", "weather_monthly", "satellite_obs",
           "river_flow_daily", "water_allocations", "county_yields", "crop_prices", "requests"]


# ---- reading the bundle (no database needed) -------------------------------------------------

def statements(sql: str) -> list[str]:
    """The schema split into single statements (comments dropped), to run one at a time."""
    lines = [line for line in sql.splitlines() if not line.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";\n") if s.strip().rstrip(";").strip()]


def _json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _text(value) -> str | None:
    return None if value is None or (isinstance(value, float) and pd.isna(value)) else str(value)


def _number(value) -> float | None:
    return None if value is None or pd.isna(value) else float(value)


def field_row(folder: Path) -> tuple:
    f = _json(folder / "field.json", None)
    if f is None:
        raise SystemExit(f"No field.json in {folder}")
    return (f["field_id"], f.get("name", f["field_id"]), f.get("place", ""), f.get("country", ""),
            float(f["lat"]), float(f["lon"]), f.get("provenance", "sample"),
            json.dumps(_json(folder / "soil.json", {})), json.dumps(_json(folder / "water.json", {})))


def crop_history_rows(folder: Path, field_id: str) -> list[tuple]:
    return [(field_id, int(h["year"]), h.get("cdl_code"), h.get("crop"), h.get("category"), h.get("source"))
            for h in _json(folder / "crop_history.json", [])]


def allocation_rows(folder: Path, field_id: str) -> list[tuple]:
    """One row per SOURCED year; years with no source are not in the bundle and are not invented."""
    water = _json(folder / "water.json", {})
    detail = {int(d["year"]): d for d in water.get("allocation_detail", [])}
    return [(field_id, int(year), float(fraction), detail.get(int(year), {}).get("note"),
             detail.get(int(year), {}).get("source") or water.get("source"))
            for year, fraction in sorted((water.get("allocation_fraction_by_year") or {}).items())]


def weather_frame(folder: Path) -> pd.DataFrame:
    weather = pd.read_csv(folder / "weather_daily.csv")
    return weather.reindex(columns=WEATHER_COLUMNS)


def flow_frame(folder: Path) -> pd.DataFrame | None:
    path = folder / "nwis_flow.csv"
    return pd.read_csv(path).reindex(columns=["day", "flow_cfs", "qualifiers"]) if path.exists() else None


def satellite_frame(folder: Path) -> pd.DataFrame | None:
    """Long form: observed_at, source, variable, value. Today: OpenET monthly ET and reference ET."""
    path = folder / "openet_monthly.csv"
    if not path.exists():
        return None
    monthly = pd.read_csv(path)
    source = "OpenET " + monthly["model"].astype(str)
    parts = [pd.DataFrame({"observed_at": monthly["month"].astype(str) + "-01T00:00:00+00:00",
                           "source": source, "variable": column, "value": monthly[column]})
             for column in ("et_mm", "eto_mm") if column in monthly]
    return pd.concat(parts, ignore_index=True).dropna(subset=["value"]) if parts else None


def economics_rows() -> tuple[list[tuple], list[tuple]]:
    path = DATA / "reference" / "economics.csv"
    if not path.exists():
        return [], []
    e = pd.read_csv(path)
    yields = [(r.crop, r.region, _number(r.yield_per_acre), _text(r.unit), _text(r.source_yield))
              for r in e.itertuples()]
    prices = [(r.crop, r.region, _number(r.price_usd_per_unit), _text(r.unit), _number(r.cost_usd_per_acre),
               _text(r.source_price), _text(r.source_cost)) for r in e.itertuples()]
    return yields, prices


# ---- the database ------------------------------------------------------------------------------

def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    env_file = ROOT / "engine" / ".env"
    if not url and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    if not url:
        raise SystemExit("Set DATABASE_URL (environment or engine/.env) to the Tiger Cloud service URL.")
    return url


def tls_context() -> ssl.SSLContext:
    """Verified TLS: the system's trusted authorities plus Tiger Cloud's own CA."""
    context = ssl.create_default_context()
    if TIGER_CA.exists():
        context.load_verify_locations(cafile=str(TIGER_CA))
    return context


def connect(url: str | None = None):
    import pg8000.dbapi

    u = urllib.parse.urlparse(url or database_url())
    conn = pg8000.dbapi.connect(
        user=urllib.parse.unquote(u.username or ""), password=urllib.parse.unquote(u.password or ""),
        host=u.hostname, port=u.port or 5432, database=u.path.lstrip("/") or "tsdb",
        ssl_context=tls_context(), timeout=60)
    conn.autocommit = True
    return conn


def apply_schema(conn) -> None:
    cur = conn.cursor()
    for statement in statements(SCHEMA.read_text(encoding="utf-8")):
        cur.execute(statement)


def _copy_upsert(cur, table: str, frame: pd.DataFrame, field_id: str, key: list[str]) -> None:
    """COPY the rows into a temporary table, then upsert them (inside the caller's transaction)."""
    columns = list(frame.columns)
    temp = f"incoming_{table}"
    cur.execute(f"CREATE TEMPORARY TABLE {temp} (LIKE {table} INCLUDING DEFAULTS) ON COMMIT DROP")
    cur.execute(f"ALTER TABLE {temp} DROP COLUMN field_id")
    buffer = io.BytesIO(frame.to_csv(index=False, header=False).encode("utf-8"))
    cur.execute(f"COPY {temp} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv)", stream=buffer)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c not in key)
    action = f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
    cur.execute(
        f"INSERT INTO {table} (field_id, {', '.join(columns)}) "
        f"SELECT %s, {', '.join(columns)} FROM {temp} "
        f"ON CONFLICT (field_id, {', '.join(key)}) {action}", (field_id,))


def load(conn, field_id: str) -> None:
    folder = DATA / "fields" / field_id
    if not folder.is_dir():
        raise SystemExit(f"No field bundle at {folder}")
    row = field_row(folder)
    yields, prices = economics_rows()
    cur = conn.cursor()

    cur.execute("BEGIN")
    try:
        cur.execute(
            "INSERT INTO fields (field_id, name, place, country, lat, lon, provenance, soil, water) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, CAST(%s AS jsonb), CAST(%s AS jsonb)) "
            "ON CONFLICT (field_id) DO UPDATE SET name = EXCLUDED.name, place = EXCLUDED.place, "
            "country = EXCLUDED.country, lat = EXCLUDED.lat, lon = EXCLUDED.lon, provenance = EXCLUDED.provenance, "
            "soil = EXCLUDED.soil, water = EXCLUDED.water, loaded_at = now()", row)

        # Small tables: replace this field's rows, so a year dropped from the bundle goes too.
        cur.execute("DELETE FROM crop_history WHERE field_id = %s", (field_id,))
        cur.executemany("INSERT INTO crop_history VALUES (%s, %s, %s, %s, %s, %s)", crop_history_rows(folder, field_id))
        cur.execute("DELETE FROM water_allocations WHERE field_id = %s", (field_id,))
        cur.executemany("INSERT INTO water_allocations VALUES (%s, %s, %s, %s, %s)", allocation_rows(folder, field_id))
        if yields:
            cur.execute("DELETE FROM county_yields")
            cur.executemany("INSERT INTO county_yields VALUES (%s, %s, %s, %s, %s)", yields)
            cur.execute("DELETE FROM crop_prices")
            cur.executemany("INSERT INTO crop_prices VALUES (%s, %s, %s, %s, %s, %s, %s)", prices)

        # Time series: COPY, then upsert.
        _copy_upsert(cur, "weather_daily", weather_frame(folder), field_id, ["day"])
        flow = flow_frame(folder)
        if flow is not None:
            _copy_upsert(cur, "river_flow_daily", flow, field_id, ["day"])
        satellite = satellite_frame(folder)
        if satellite is not None:
            _copy_upsert(cur, "satellite_obs", satellite, field_id, ["observed_at", "source", "variable"])
        cur.execute("COMMIT")
    except Exception:
        cur.execute("ROLLBACK")
        raise

    # Outside the transaction: a continuous aggregate can't be refreshed inside one.
    cur.execute("CALL refresh_continuous_aggregate('weather_monthly', NULL, NULL)")


def counts(conn) -> dict[str, int]:
    cur = conn.cursor()
    result = {}
    for table in COUNTED:
        cur.execute(f"SELECT count(*) FROM {table}")
        result[table] = int(cur.fetchone()[0])
    return result


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        return 2
    conn = connect()
    try:
        if "--counts" not in argv:
            apply_schema(conn)
            load(conn, args[0])
        for table, n in counts(conn).items():
            print(f"{table:20s} {n}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
