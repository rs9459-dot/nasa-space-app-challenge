// Daily drought report, kept in Cloudflare R2: every morning the Cron Trigger checks NASA POWER rain for each
// town where FarmLine has farmers and saves a CSV (reports/YYYY-MM-DD.csv) that the admin view can download,
// for example to share with an agriculture office. No phone numbers: towns and counts only.
import { weatherFor } from "./data";
import { rainPct } from "./store";
import type { Env } from "./types";

interface Town { place: string; country: string; lat: number; lon: number; farmers: number; alerts: number }

const status = (p: number | null) => (p === null ? "No normal to compare" : p < 50 ? "Dry spell" : p < 80 ? "Drier than normal" : p > 120 ? "Wetter than normal" : "Normal");
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface ReportInfo { key: string; date: string; size: number; towns: number; dry: number }

/** Build today's report from D1 (towns) + NASA POWER (rain, cached in KV) and save it to R2. */
export async function saveDailyReport(env: Env, date = new Date().toISOString().slice(0, 10)): Promise<ReportInfo | null> {
  if (!env.DB || !env.REPORTS) return null;
  const { results } = await env.DB.prepare(
    `SELECT place, country, AVG(lat) AS lat, AVG(lon) AS lon, COUNT(*) AS farmers, SUM(alerts) AS alerts
     FROM farmers GROUP BY country, place ORDER BY farmers DESC LIMIT 500`,
  ).all<Town>();
  const towns = results ?? [];
  const rows: string[] = ["date,town,country,farmers,on_drought_alerts,rain_last_30_days_mm,normal_mm,rain_pct_of_normal,status,avg_high_c,latitude,longitude"];
  let dry = 0;
  for (let i = 0; i < towns.length; i += 10) {
    // 10 towns at a time: NASA POWER is cached in KV, so most of these are instant.
    const batch = towns.slice(i, i + 10);
    const weather = await Promise.all(batch.map((t) => weatherFor(env, Math.round(t.lat * 100) / 100, Math.round(t.lon * 100) / 100).catch(() => null)));
    batch.forEach((t, j) => {
      const w = weather[j];
      const p = w ? rainPct(w) : null;
      if (p !== null && p < 50) dry++;
      rows.push([date, t.place, t.country.toUpperCase(), t.farmers, t.alerts ?? 0, w ? w.rain30mm.toFixed(1) : "", w ? w.normal30mm.toFixed(1) : "", p ?? "", w ? status(p) : "NASA not reachable", w ? w.avgHighC.toFixed(1) : "", t.lat.toFixed(1), t.lon.toFixed(1)].map(csvCell).join(","));
    });
  }
  const body = rows.join("\n") + "\n";
  const key = `reports/${date}.csv`;
  await env.REPORTS.put(key, body, {
    httpMetadata: { contentType: "text/csv; charset=utf-8", contentDisposition: `attachment; filename="farmline-drought-report-${date}.csv"` },
    customMetadata: { towns: String(towns.length), dry: String(dry) },
  });
  return { key, date, size: body.length, towns: towns.length, dry };
}

/** The most recent reports in R2, newest first. */
export async function listReports(env: Env, limit = 14): Promise<ReportInfo[]> {
  if (!env.REPORTS) return [];
  try {
    const out = await env.REPORTS.list({ prefix: "reports/", include: ["customMetadata"] } as R2ListOptions);
    return out.objects
      .map((o) => ({ key: o.key, date: o.key.slice(8, 18), size: o.size, towns: Number(o.customMetadata?.towns ?? 0), dry: Number(o.customMetadata?.dry ?? 0) }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  } catch (e) {
    console.error("report list failed", e);
    return [];
  }
}

/** Stream one report out of R2 as a download. */
export async function reportResponse(env: Env, date: string): Promise<Response> {
  if (!env.REPORTS || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Not found", { status: 404 });
  const obj = await env.REPORTS.get(`reports/${date}.csv`);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store");
  return new Response(obj.body, { headers });
}
