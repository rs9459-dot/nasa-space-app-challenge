import { forecastFor, weatherFor } from "./data";
import { FLOW } from "./flow_text";
import { PACKS } from "./i18n";
import { loadFlow, logMessage, logQuery, rainPct, saveFlow, weatherTrace } from "./store";
import { sendSms } from "./twilio";
import type { AlertJob, Env } from "./types";

const DRY_PCT = 50; // alert when the last 30 days had under half the normal rain
const MIN_NORMAL_MM = 5; // ...but not in places/seasons that are normally dry anyway
const MIN_DAYS_BETWEEN = 6; // at most one alert a week per farmer
const HEAVY_3DAY_MM = 50; // heavy-rain alert: 50 mm or more forecast over the next 3 days
const HEAVY_DAY_MM = 35; // ...or 35 mm or more on a single day

/** Cron Trigger: find farmers who asked for alerts and queue one check per farmer. */
export async function runDailyCheck(env: Env): Promise<number> {
  if (!env.DB) return 0;
  const since = new Date(Date.now() - MIN_DAYS_BETWEEN * 864e5).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT phone, lang, lat, lon, place FROM farmers WHERE alerts = 1 AND (last_alert IS NULL OR last_alert < ?1)`,
  )
    .bind(since)
    .all<AlertJob>();
  const jobs = results ?? [];
  if (!jobs.length) return 0;
  if (env.ALERTS) {
    // Queues: one message per farmer, so a slow NASA call never holds up the others.
    for (let i = 0; i < jobs.length; i += 100) await env.ALERTS.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body })));
  } else {
    for (const job of jobs) await checkFarmer(env, job); // no queue bound: run inline
  }
  return jobs.length;
}

/** Queue consumer: check one farmer's NASA rain and text them if it is a dry spell. */
export async function handleAlertBatch(batch: MessageBatch<AlertJob>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await checkFarmer(env, msg.body);
      msg.ack();
    } catch (e) {
      console.error("alert check failed", e);
      msg.retry();
    }
  }
}

/** Returns true when an alert was sent: a NASA dry spell, or heavy rain in the forecast. */
export async function checkFarmer(env: Env, job: AlertJob): Promise<boolean> {
  const w = await weatherFor(env, job.lat, job.lon);
  const pct = rainPct(w);
  const fl = job.lang === "hi" || job.lang === "sw" ? job.lang : job.lang === "en" ? "en" : null; // menu-flow languages
  const short = job.place.split(",")[0];
  let text: string | null = null;
  let why = "";
  let kind = "";
  if (pct !== null && w.normal30mm >= MIN_NORMAL_MM && pct < DRY_PCT) {
    kind = "drought";
    text = fl ? FLOW[fl].droughtAlert(short) : PACKS[job.lang].alert(job.place, pct);
    why = fl ? FLOW[fl].whyDrought(short, pct) : "";
  } else {
    const fc = await forecastFor(env, job.lat, job.lon).catch(() => null);
    if (fc && (fc.next3mm >= HEAVY_3DAY_MM || fc.maxDayMm >= HEAVY_DAY_MM)) {
      const days = Math.max(1, Math.min(7, fc.maxDayIn + 1));
      const mm = Math.round(fc.next3mm >= HEAVY_3DAY_MM ? fc.next3mm : fc.maxDayMm);
      kind = "heavy_rain";
      const lang = fl ?? "en";
      text = FLOW[lang].rainAlert(short, days);
      why = FLOW[lang].whyRainAlert(mm, fc.next3mm >= HEAVY_3DAY_MM ? 3 : days);
    }
  }
  if (!text) return false;
  await sendSms(env, job.phone, text);
  await logMessage(env, { phone: job.phone, channel: "alert", lang: job.lang, inbound: null, outbound: text, outcome: "alert", place: job.place, trace: { lat: job.lat, lon: job.lon, weather: weatherTrace(w), alert: kind } as any });
  if (why) {
    // So the farmer's reply of WHY explains this alert.
    const flow = await loadFlow<Record<string, unknown>>(env, job.phone).catch(() => null);
    if (flow) await saveFlow(env, job.phone, { ...flow, why }).catch(() => {});
  }
  if (env.DB) {
    await env.DB.prepare(`UPDATE farmers SET last_alert = ?2 WHERE phone = ?1`).bind(job.phone, new Date().toISOString()).run();
  }
  await logQuery(env, "alert", job.lang, { lat: job.lat, lon: job.lon, name: job.place, country: "" }, null, w);
  return true;
}
