import { recordReading } from "./tiger";
import type { Trace, Env, Lang, Place, Session, Weather } from "./types";

// ---------- KV: cache slow outside lookups (NASA POWER, geocoding) ----------

/** Return a cached JSON value, or compute it and cache it for ttl seconds. Works without KV too. */
export async function cached<T>(env: Env, key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  if (env.CACHE) {
    try {
      const hit = await env.CACHE.get(key, "json");
      if (hit !== null) return hit as T;
    } catch (e) {
      console.error("KV read failed", e);
    }
  }
  const value = await compute();
  if (env.CACHE && value !== null && value !== undefined) {
    env.CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttl) }).catch((e) => console.error("KV write failed", e));
  }
  return value;
}

export const rainPct = (w: Weather) => (w.normal30mm > 0 ? Math.round((w.rain30mm / w.normal30mm) * 100) : null);

// ---------- D1: farmers and the anonymous question log ----------

/** Remember where a farmer is, so ALERT and the daily drought check know their place. */
export async function upsertFarmer(env: Env, phone: string, lang: Lang, p: Place, crop: string | null): Promise<void> {
  if (!env.DB || !phone) return;
  await env.DB.prepare(
    `INSERT INTO farmers (phone, lang, lat, lon, place, country, crop, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(phone) DO UPDATE SET lang = ?2, lat = ?3, lon = ?4, place = ?5, country = ?6,
       crop = COALESCE(?7, crop), updated_at = ?8`,
  )
    .bind(phone, lang, p.lat, p.lon, displayName(p, lang), p.country, crop, new Date().toISOString())
    .run();
}

export async function getFarmer(env: Env, phone: string) {
  if (!env.DB || !phone) return null;
  return env.DB.prepare(`SELECT phone, lang, lat, lon, place, country, crop, alerts FROM farmers WHERE phone = ?1`)
    .bind(phone)
    .first<{ phone: string; lang: Lang; lat: number; lon: number; place: string; country: string; crop: string | null; alerts: number }>();
}

export async function setAlerts(env: Env, phone: string, on: boolean): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(`UPDATE farmers SET alerts = ?2 WHERE phone = ?1`).bind(phone, on ? 1 : 0).run();
}

export async function logQuery(env: Env, channel: "sms" | "call" | "alert", lang: Lang, p: Place, crop: string | null, w: Weather | null): Promise<void> {
  const tiger = w && env.TIGER_DATABASE_URL ? recordReading(env, channel, p, w) : null; // runs alongside D1
  try {
    await logQueryD1(env, channel, lang, p, crop, w);
  } finally {
    if (tiger) await tiger;
  }
}

async function logQueryD1(env: Env, channel: "sms" | "call" | "alert", lang: Lang, p: Place, crop: string | null, w: Weather | null): Promise<void> {
  if (!env.DB) return;
  const base = [new Date().toISOString(), channel, lang, p.name, p.country, crop, w ? rainPct(w) : null];
  const round = (x: number) => Math.round(x * 10) / 10; // ~10 km: enough for the map, never a farm address
  try {
    await env.DB.prepare(`INSERT INTO queries (ts, channel, lang, place, country, crop, rain_pct, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(...base, round(p.lat), round(p.lon))
      .run();
  } catch {
    // Database created before the map columns existed (see db/migrate_002_map.sql): log without them.
    await env.DB.prepare(`INSERT INTO queries (ts, channel, lang, place, country, crop, rain_pct) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(...base)
      .run();
  }
}

export interface MessageRow {
  phone: string;
  channel: "sms" | "whatsapp" | "call" | "alert";
  lang: Lang;
  inbound: string | null;
  outbound: string;
  outcome: string;
  place?: string | null;
  country?: string | null;
  crop?: string | null;
  trace?: Trace;
}

/** Admin conversation log (phone numbers included: only shown behind the /admin login). */
export async function logMessage(env: Env, m: MessageRow): Promise<void> {
  if (!env.DB || !m.phone) return;
  try {
    await env.DB.prepare(
      `INSERT INTO messages (ts, phone, channel, lang, inbound, outbound, outcome, place, country, crop, trace)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(new Date().toISOString(), m.phone, m.channel, m.lang, m.inbound, m.outbound, m.outcome,
        m.place ?? null, m.country ?? null, m.crop ?? null, m.trace ? JSON.stringify(m.trace) : null)
      .run();
  } catch (e) {
    console.error("message log failed (run db/migrate_003_admin.sql?)", e);
  }
}

export const weatherTrace = (w: Weather) => ({
  rain30mm: Math.round(w.rain30mm * 10) / 10, normal30mm: Math.round(w.normal30mm * 10) / 10,
  rainPct: rainPct(w), avgHighC: Math.round(w.avgHighC * 10) / 10, days: w.days,
  ...(w.soilRoot !== undefined ? { soilPct: Math.round(w.soilRoot * 100) } : {}),
});

export const displayName = (p: Place, lang: Lang) => (lang === "ur" && p.localName ? p.localName : p.name);

// ---------- Durable Object: each farmer's last answer, for "1", "2", "3" follow-ups ----------

function sessionStub(env: Env, phone: string) {
  return env.FARMER!.get(env.FARMER!.idFromName(phone));
}

export async function saveSession(env: Env, phone: string, s: Session): Promise<void> {
  if (!env.FARMER || !phone) return;
  await sessionStub(env, phone).fetch("https://session/last", { method: "PUT", body: JSON.stringify(s) });
}

export async function loadSession(env: Env, phone: string): Promise<Session | null> {
  if (!env.FARMER || !phone) return null;
  const res = await sessionStub(env, phone).fetch("https://session/last");
  return (await res.json()) as Session | null;
}

/** A phone call's answer, kept in the farmer's Durable Object while the call waits for it (strongly consistent, unlike KV). */
export async function putCallResult(env: Env, phone: string, callSid: string, value: unknown): Promise<void> {
  if (!env.FARMER || !phone || !callSid) return;
  await sessionStub(env, phone).fetch(`https://session/call-${encodeURIComponent(callSid)}`, { method: "PUT", body: JSON.stringify(value) });
}
export async function takeCallResult<T>(env: Env, phone: string, callSid: string): Promise<T | null> {
  if (!env.FARMER || !phone || !callSid) return null;
  const stub = sessionStub(env, phone);
  const value = (await (await stub.fetch(`https://session/call-${encodeURIComponent(callSid)}`)).json()) as T | null;
  if (value) await stub.fetch(`https://session/call-${encodeURIComponent(callSid)}`, { method: "DELETE" });
  return value;
}

/** The farmer's place in the menu flow (step, language, farm, crop, answers), in their Durable Object. */
export async function loadFlow<T>(env: Env, phone: string): Promise<T | null> {
  if (!env.FARMER || !phone) return null;
  return (await (await sessionStub(env, phone).fetch("https://session/flow")).json()) as T | null;
}
export async function saveFlow(env: Env, phone: string, flow: unknown): Promise<void> {
  if (!env.FARMER || !phone) return;
  await sessionStub(env, phone).fetch("https://session/flow", { method: "PUT", body: JSON.stringify(flow) });
}
