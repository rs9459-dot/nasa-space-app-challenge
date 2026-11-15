import postgres from "postgres";
import type { Env, Place, Weather } from "./types";

/**
 * Tiger Data (TimescaleDB): every NASA POWER reading FarmLine fetches is kept as a time series,
 * so the team can see rain against normal over time, place by place. Best effort: if Tiger Data
 * is down or not set up, farmers still get their answer.
 */
type Sql = ReturnType<typeof postgres>;

function connect(env: Env): Sql | null {
  const raw = (env.TIGER_DATABASE_URL ?? "").trim().replace(/^[A-Z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "");
  if (!raw) return null;
  return postgres(raw, { max: 1, prepare: false, fetch_types: false, ssl: "require", connect_timeout: 5, idle_timeout: 2 });
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`CREATE TABLE IF NOT EXISTS nasa_readings (
    time timestamptz NOT NULL,
    channel text, place text, country text,
    lat double precision, lon double precision,
    rain30_mm real, normal30_mm real, rain_pct integer, high_c real, soil_root real
  )`;
  try {
    await sql`SELECT create_hypertable('nasa_readings', 'time', if_not_exists => TRUE)`;
  } catch {
    // plain PostgreSQL without the TimescaleDB extension: still a normal table
  }
  ready = true;
}

const round1 = (x: number) => Math.round(x * 10) / 10; // ~10 km, never a farm address

export async function recordReading(env: Env, channel: string, p: Place, w: Weather): Promise<void> {
  const sql = connect(env);
  if (!sql) return;
  try {
    await ensureTable(sql);
    const pct = w.normal30mm > 0 ? Math.round((w.rain30mm / w.normal30mm) * 100) : null;
    await sql`INSERT INTO nasa_readings (time, channel, place, country, lat, lon, rain30_mm, normal30_mm, rain_pct, high_c, soil_root)
      VALUES (now(), ${channel}, ${p.name}, ${p.country}, ${round1(p.lat)}, ${round1(p.lon)}, ${w.rain30mm}, ${w.normal30mm}, ${pct}, ${w.avgHighC}, ${w.soilRoot ?? null})`;
  } catch (e) {
    console.error("tiger data write failed", e);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export interface TigerStats { connected: boolean; rows: number; places: number; last: string | null; days: { day: string; readings: number; rainPct: number | null }[]; error?: string }

/** For the dashboard: readings per day and average rain vs normal, using TimescaleDB's time_bucket. */
export async function tigerStats(env: Env): Promise<TigerStats> {
  const sql = connect(env);
  if (!sql) return { connected: false, rows: 0, places: 0, last: null, days: [] };
  try {
    await ensureTable(sql);
    const [tot] = await sql`SELECT count(*)::int AS rows, count(DISTINCT place)::int AS places, max(time) AS last FROM nasa_readings`;
    let days: TigerStats["days"] = [];
    try {
      days = (await sql`SELECT time_bucket('1 day', time) AS day, count(*)::int AS readings, round(avg(rain_pct))::int AS rain_pct
        FROM nasa_readings WHERE time > now() - interval '14 days' GROUP BY day ORDER BY day`).map((r: any) => ({ day: new Date(r.day).toISOString().slice(0, 10), readings: r.readings, rainPct: r.rain_pct }));
    } catch {
      days = [];
    }
    return { connected: true, rows: tot?.rows ?? 0, places: tot?.places ?? 0, last: tot?.last ? new Date(tot.last).toISOString() : null, days };
  } catch (e) {
    return { connected: true, rows: 0, places: 0, last: null, days: [], error: String((e as Error)?.message ?? e).slice(0, 120) };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
