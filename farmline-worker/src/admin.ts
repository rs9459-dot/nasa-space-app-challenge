import { tigerStats } from "./tiger";
// Admin view (/admin, behind the Auth0 login). Design from farmline-admin.html, wired to live D1 data:
// every farmer, every conversation, and how each answer was made. Nothing on this page is sample data.
import { RUNTIME_JS, WORLD_SVG } from "./admin_assets";
import { listReports } from "./report";
import type { EngineOption, Env, Trace } from "./types";

interface Msg {
  id: number; ts: string; phone: string; channel: string; lang: string; inbound: string | null; outbound: string;
  outcome: string; place: string | null; country: string | null; crop: string | null; trace: string | null;
}
interface Farmer { phone: string; lang: string; lat: number; lon: number; place: string; country: string; crop: string | null; alerts: number; updated_at: string }

const LANGS: Record<string, string> = { en: "English", hi: "Hindi", ur: "Urdu", sw: "Swahili", roman: "Roman Hindi/Urdu", other: "Other (Gemini)" };
const CHANNEL: Record<string, string> = { sms: "SMS", whatsapp: "WhatsApp", call: "Voice call", alert: "Alert" };
const OUTCOMES: Record<string, string> = {
  plans: "Sent 3 crop plans", weather: "Sent NASA weather", details: "Sent plan details", alerts_on: "Turned on drought alerts",
  help: "Sent how to ask", not_found: "Couldn't find the place", no_session: "No earlier answer to expand", need_place: "Asked for their place first",
  busy: "Error, asked to try again", alert: "Alert sent", library: "Answered from the farming library",
  lang_menu: "Sent the language menu", welcome: "Welcomed, asked for the farm's place", ask_location: "Asked for the farm's place",
  confirm_place: "Asked to confirm the place", place_not_found: "Couldn't find the place, asked for the village", ask_village: "Asked for the village name",
  menu: "Sent the menu", welcome_back: "Welcomed back with the menu", ask_crop: "Asked what is growing", ask_water: "Asked if the field is watered",
  ask_outlook: "Asked about next season's water", ask_priority: "Asked what matters most", checking: "Checking NASA data (plans follow)",
  sow_advice: "Sent sow / water advice", alerts_off: "Turned off alerts", ask_question: "Asked for their question", ai_answer: "Answered with AI (library-guided)",
  why: "Explained why", no_why: "Nothing to explain yet", stopped: "Farmer stopped messages", started: "Farmer came back (START)",
  not_understood: "Didn't understand, sent MENU hint", stopped_ignored: "Ignored (farmer has stopped)",
};
const VIA: Record<string, string> = {
  pk_town: "built-in Pakistan town list", postal: "ZIP / PIN code", town_name: "town name search (Open-Meteo)", keypad: "code typed on the call", speech: "town spoken on the call",
};
const KIND: Record<string, string> = { water: "Least water", income: "Most income", drought: "Safest in drought" };
const COUNTRY: Record<string, string> = {
  us: "United States", in: "India", pk: "Pakistan", ke: "Kenya", tz: "Tanzania", ug: "Uganda", mx: "Mexico", br: "Brazil", ar: "Argentina",
  et: "Ethiopia", ng: "Nigeria", gh: "Ghana", bd: "Bangladesh", np: "Nepal", es: "Spain", fr: "France", co: "Colombia", pe: "Peru",
};

/** Natural Earth projection fitted to the design's map (960 x 500). */
function ne(lon: number, lat: number): [number, number] {
  const l = (lat * Math.PI) / 180, L = (lon * Math.PI) / 180, p2 = l * l, p4 = p2 * p2;
  const X = L * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const Y = l * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [479.6 + 174.24 * X, 288.01 - 174.24 * Y];
}
const line = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L");

/** The design's world map, restyled to show coverage everywhere: dotted green land, soft ocean, latitude/longitude grid. */
const MAP_SVG = (() => {
  const merid: string[] = [], para: string[] = [];
  for (let lon = -180; lon <= 180; lon += 30) { const pts: [number, number][] = []; for (let lat = -58; lat <= 84; lat += 2) pts.push(ne(lon, lat)); merid.push(line(pts)); }
  for (const lat of [-40, -20, 20, 40, 60]) { const pts: [number, number][] = []; for (let lon = -180; lon <= 180; lon += 3) pts.push(ne(lon, lat)); para.push(line(pts)); }
  const along = (lat: number) => { const pts: [number, number][] = []; for (let lon = -180; lon <= 180; lon += 3) pts.push(ne(lon, lat)); return line(pts); };
  const label = (lat: number, text: string) => { const [x, y] = ne(-178, lat); return `<text x="${(x + 4).toFixed(1)}" y="${(y - 3).toFixed(1)}">${text}</text>`; };
  const defs = `<defs><linearGradient id="fl-ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F1F7F9"/><stop offset="1" stop-color="#E4EFF3"/></linearGradient>
<pattern id="fl-land" width="4.5" height="4.5" patternUnits="userSpaceOnUse"><rect width="4.5" height="4.5" fill="#DCEBE2"/><circle cx="2.25" cy="2.25" r="0.85" fill="#93C2A6"/></pattern></defs>`;
  const grat = `<g class="fl-grat">${merid.concat(para).map((d) => `<path d="${d}"/>`).join("")}</g>
<g class="fl-lat"><path class="eq" d="${along(0)}"/><path d="${along(23.44)}"/><path d="${along(-23.44)}"/>${label(0, "Equator")}${label(23.44, "Tropic of Cancer")}${label(-23.44, "Tropic of Capricorn")}</g>`;
  return WORLD_SVG
    .replace('<svg ', '<svg class="fl-world" ')
    .replace('<rect x="0" y="0" width="960" height="500" fill="#F3F6F9"></rect>', `${defs}<rect x="-500" y="-300" width="1960" height="1100" fill="url(#fl-ocean)"></rect>${grat}`);
})();

const parse = (t: string | null): Trace => { try { return t ? JSON.parse(t) : {}; } catch { return {}; } };
const DAY = 864e5;

async function safeAll<T>(env: Env, sql: string, ...args: unknown[]): Promise<{ rows: T[]; ok: boolean }> {
  try {
    const r = await env.DB!.prepare(sql).bind(...args).all<T>();
    return { rows: r.results ?? [], ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

function mask(p: string) {
  const d = p.replace(/[^\d+]/g, "");
  const cc = d.startsWith("+1") ? "+1" : (["+254", "+255", "+256", "+234", "+233", "+251", "+880", "+977"].find((c) => d.startsWith(c)) ?? d.slice(0, 3));
  const rest = d.slice(cc.length);
  const full = cc === "+1" && rest.length === 10 ? `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`
    : d.startsWith("+") ? `${cc} ${rest.length === 10 ? `${rest.slice(0, 5)} ${rest.slice(5)}` : rest.replace(/(\d{3})(?=\d{3})/g, "$1 ")}` : d;
  return { masked: `${cc} •••• ••${d.slice(-2)}`, full };
}

function segs(text: string) {
  const uni = /[^\x00-\x7F]/.test(text);
  const n = Array.from(text).length;
  const k = uni ? (n <= 70 ? 1 : Math.ceil(n / 67)) : n <= 160 ? 1 : Math.ceil(n / 153);
  return `${k} SMS segment${k === 1 ? "" : "s"}${uni ? ", Unicode" : ""}`;
}

/** Everything the page shows, computed from D1. */
async function adminData(env: Env) {
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY).toISOString();
  const since14 = new Date(now - 14 * DAY).toISOString();
  const [msgsQ, farmersQ, firstsQ, reports] = await Promise.all([
    safeAll<Msg>(env, `SELECT * FROM messages WHERE ts >= ?1 ORDER BY ts DESC LIMIT 2000`, new Date(now - 30 * DAY).toISOString()),
    safeAll<Farmer>(env, `SELECT phone, lang, lat, lon, place, country, crop, alerts, updated_at FROM farmers`),
    safeAll<{ phone: string; first: string }>(env, `SELECT phone, MIN(ts) AS first FROM messages GROUP BY phone`),
    listReports(env),
  ]);
  const msgs = msgsQ.rows.map((m) => ({ ...m, tr: parse(m.trace) }));
  const farmers = farmersQ.rows;
  const first = new Map(firstsQ.rows.map((r) => [r.phone, r.first]));
  const week = msgs.filter((m) => m.ts >= since7);
  const prev = msgs.filter((m) => m.ts >= since14 && m.ts < since7);
  const asked = (arr: typeof msgs) => arr.filter((m) => m.inbound !== null);
  const count = (arr: typeof msgs, outcome: string) => arr.filter((m) => m.outcome === outcome).length;

  // Latest NASA rain reading per farmer, for "in a dry spell" (under half the normal 30-day rain).
  const lastRain = new Map<string, number>();
  for (const m of msgs) if (m.tr.weather?.rainPct != null && !lastRain.has(m.phone)) lastRain.set(m.phone, m.tr.weather.rainPct);
  const dry = (phone: string) => (lastRain.get(phone) ?? 100) < 50;

  const activePhones = new Set(asked(week).map((m) => m.phone));
  const registered = new Set([...farmers.map((f) => f.phone), ...first.keys()]);

  // 14 days of questions by channel.
  const days: { date: string; sms: number; call: number; alert: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY).toISOString().slice(0, 10);
    const on = msgs.filter((m) => m.ts.slice(0, 10) === d);
    days.push({ date: d, sms: on.filter((m) => m.channel === "sms" || m.channel === "whatsapp").length, call: on.filter((m) => m.channel === "call").length, alert: on.filter((m) => m.channel === "alert").length });
  }

  // Countries: farmers, where they are, dry share, this week's questions.
  const byC = new Map<string, { cc: string; farmers: number; dryN: number; lat: number; lon: number; q7: number; active7: Set<string>; alerts: number }>();
  for (const f of farmers) {
    const c = byC.get(f.country) ?? { cc: f.country, farmers: 0, dryN: 0, lat: 0, lon: 0, q7: 0, active7: new Set<string>(), alerts: 0 };
    c.lat = (c.lat * c.farmers + f.lat) / (c.farmers + 1);
    c.lon = (c.lon * c.farmers + f.lon) / (c.farmers + 1);
    c.farmers++;
    if (dry(f.phone)) c.dryN++;
    if (f.alerts) c.alerts++;
    byC.set(f.country, c);
  }
  for (const m of asked(week)) {
    const c = m.country ? byC.get(m.country) : undefined;
    if (c) { c.q7++; c.active7.add(m.phone); }
  }
  // Farm areas for the map: farmers grouped by town, shown at the town's average position rounded to ~10 km, never an exact farm.
  const lastSeen = new Map<string, string>();
  for (const m of msgs) if (!lastSeen.has(m.phone)) lastSeen.set(m.phone, m.ts);
  const q7By = new Map<string, number>();
  for (const m of asked(week)) q7By.set(m.phone, (q7By.get(m.phone) ?? 0) + 1);
  const byP = new Map<string, { lat: number; lon: number; name: string; cc: string; farmers: number; dryN: number; alerts: number; q7: number; last: string; rain: number | null; crops: Set<string> }>();
  for (const f of farmers) {
    const k = `${f.country}|${f.place}`;
    const p = byP.get(k) ?? { lat: 0, lon: 0, name: f.place, cc: f.country, farmers: 0, dryN: 0, alerts: 0, q7: 0, last: "", rain: null, crops: new Set<string>() };
    p.lat = (p.lat * p.farmers + f.lat) / (p.farmers + 1);
    p.lon = (p.lon * p.farmers + f.lon) / (p.farmers + 1);
    p.farmers++;
    if (dry(f.phone)) p.dryN++;
    if (f.alerts) p.alerts++;
    p.q7 += q7By.get(f.phone) ?? 0;
    const seen = lastSeen.get(f.phone) ?? f.updated_at;
    if (seen > p.last) { p.last = seen; p.name = f.place; p.rain = lastRain.get(f.phone) ?? p.rain; }
    if (f.crop) p.crops.add(f.crop);
    byP.set(k, p);
  }
  const places = [...byP.entries()].sort((a, b) => b[1].farmers - a[1].farmers).map(([key, p]) => ({
    ...p, key, lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10, country: COUNTRY[p.cc] ?? p.cc.toUpperCase(), crops: [...p.crops],
  }));

  const countries = [...byC.values()].sort((a, b) => b.farmers - a.farmers).map((c) => ({
    cc: c.cc, name: COUNTRY[c.cc] ?? c.cc.toUpperCase(), farmers: c.farmers, dryN: c.dryN, lat: c.lat, lon: c.lon, q7: c.q7, active7: c.active7.size, alerts: c.alerts,
  }));

  // Plans and the plan each farmer opened ("1", "2", "3"), matched to the plans they were sent just before.
  const chron = msgs.slice().reverse();
  const lastPlans = new Map<string, EngineOption[]>();
  const chosen: { country: string; plan: number; from: string | null; option?: EngineOption }[] = [];
  for (const m of chron) {
    if (m.outcome === "plans" && m.tr.engine?.options?.length) lastPlans.set(m.phone, m.tr.engine.options);
    if (m.outcome === "details" && m.tr.plan) {
      const opts = lastPlans.get(m.phone);
      chosen.push({ country: m.country ?? "", plan: m.tr.plan, from: m.crop, option: opts?.[m.tr.plan - 1] });
    }
  }
  const choiceBy = new Map<string, number[]>();
  for (const c of chosen) {
    const row = choiceBy.get(c.country) ?? [0, 0, 0];
    row[c.plan - 1]++;
    choiceBy.set(c.country, row);
  }
  const shiftsM = new Map<string, { from: string; to: string; country: string; n: number; why: string }>();
  for (const c of chosen) {
    if (!c.option || !c.from) continue;
    const to = c.option.rotation[0];
    if (!to || to === c.from) continue;
    const k = `${c.from}|${to}|${c.country}`;
    const s = shiftsM.get(k) ?? { from: c.from, to, country: COUNTRY[c.country] ?? c.country.toUpperCase(), n: 0, why: KIND[c.option.kind] ?? c.option.kind };
    s.n++;
    shiftsM.set(k, s);
  }
  const savings = chosen.filter((c) => c.option).map((c) => c.option!.water_saving_pct);
  const crops = new Map<string, number>();
  for (const m of asked(week)) if (m.crop) crops.set(m.crop, (crops.get(m.crop) ?? 0) + 1);

  // Usage funnel over this week's askers.
  const askers = [...activePhones];
  const phonesWith = (pred: (m: (typeof msgs)[number]) => boolean) => new Set(week.filter(pred).map((m) => m.phone));
  const gotAnswer = phonesWith((m) => m.outcome === "plans" || m.outcome === "weather");
  const gotPlans = phonesWith((m) => m.outcome === "plans");
  const opened = phonesWith((m) => m.outcome === "details");
  const alertsOn = phonesWith((m) => m.outcome === "alerts_on");
  const cameBack = new Set(askers.filter((p) => (first.get(p) ?? "") < since7));
  const newFarmers = askers.filter((p) => (first.get(p) ?? "") >= since7).length;

  const langMix = new Map<string, number>();
  for (const m of asked(week)) {
    const k = m.tr.detected === "other" ? "other" : m.lang;
    langMix.set(k, (langMix.get(k) ?? 0) + 1);
  }
  const chanMix = new Map<string, number>();
  for (const m of week) chanMix.set(m.channel, (chanMix.get(m.channel) ?? 0) + 1);

  // System health, from each answer's trace.
  const times = week.map((m) => m.tr.ms).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const q = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(p * times.length))] : 0);
  const engineAsked = week.filter((m) => m.tr.engine && m.tr.engine.status !== "not_connected");
  const engineOk = engineAsked.filter((m) => m.tr.engine!.status === "answered");
  const engineMs = engineOk.length ? Math.round(engineOk.reduce((s, m) => s + m.tr.engine!.ms, 0) / engineOk.length) : 0;
  const foreign = week.filter((m) => m.tr.detected === "other");
  const translated = foreign.filter((m) => m.tr.translated).length;
  const nasaLast = msgs.find((m) => m.tr.weather)?.ts ?? null;
  const lastOf = (pred: (m: (typeof msgs)[number]) => boolean) => msgs.find(pred)?.ts ?? null;
  const tiger = await tigerStats(env);
  const feeds = [
    { name: "NASA POWER", what: "Daily rain and high temperature, plus the long-term normal", latest: nasaLast, how: "Live API, cached in Workers KV", on: true },
    { name: "Rotation engine (Vultr)", what: "3 crop-rotation plans per question", latest: lastOf((m) => m.tr.engine?.status === "answered"), how: env.ENGINE_URL ? "Live API" : "Not connected yet (ENGINE_URL)", on: Boolean(env.ENGINE_URL) },
    { name: "Gemini via AI Gateway", what: "Replies in languages without a built-in pack", latest: lastOf((m) => Boolean(m.tr.translated)), how: env.GEMINI_BASE_URL ? "Cloudflare AI Gateway" : env.GEMINI_API_KEY ? "Direct API" : "No key set", on: Boolean(env.GEMINI_API_KEY) },
    { name: "Workers AI (Llama 3.1)", what: "Backup translator if Gemini fails", latest: null, how: env.AI ? "Workers AI binding" : "Not bound", on: Boolean(env.AI) },
    { name: "Whisper speech-to-text", what: "Turns what farmers say on a call into text, in any of the 4 languages", latest: lastOf((m) => Boolean(m.tr.heard)), how: env.AI ? "Workers AI (whisper-large-v3-turbo)" : "Not bound (AI)", on: Boolean(env.AI) },
    { name: "Daily drought report (R2)", what: "NASA rain for every town with farmers, saved each morning as a CSV", latest: reports[0] ? reports[0].date + "T12:07:00Z" : null, how: env.REPORTS ? "Cron Trigger -> Cloudflare R2" : "Not bound (REPORTS)", on: Boolean(env.REPORTS) },
    { name: "Farming library (Vectorize)", what: "Answers to questions that aren't about a place, found by meaning", latest: lastOf((m) => m.outcome === "library"), how: env.KB ? "Workers AI bge-m3 + Vectorize" : "Not bound (KB)", on: Boolean(env.KB && env.AI) },
    { name: "Tiger Data (TimescaleDB)", what: tiger.connected ? `Every NASA reading kept as a time series: ${tiger.rows} readings from ${tiger.places} places` + (tiger.error ? ` (error: ${tiger.error})` : "") : "Every NASA reading kept as a time series", latest: tiger.last, how: tiger.connected ? "Postgres hypertable, daily time_bucket" : "Not connected yet (TIGER_DATABASE_URL)", on: tiger.connected && !tiger.error },
    { name: "Zippopotam.us", what: "US ZIP and India PIN codes to a place", latest: lastOf((m) => m.tr.via === "postal"), how: "Live API, cached in KV", on: true },
    { name: "Open-Meteo geocoding", what: "Town names anywhere to a place", latest: lastOf((m) => m.tr.via === "town_name"), how: "Live API, cached in KV", on: true },
  ];
  const libAsked = week.filter((m) => m.tr.library).length, libAnswered = week.filter((m) => m.outcome === "library").length;
  const events = msgs
    .filter((m) => ["alert", "busy"].includes(m.outcome) || m.tr.engine?.status === "no_answer" || m.tr.translated)
    .slice(0, 6)
    .map((m) => ({
      ts: m.ts,
      text: m.outcome === "alert" ? `Drought alert sent to a farmer in ${m.place ?? "their area"}.`
        : m.outcome === "busy" ? `An answer failed and the farmer was asked to try again (${CHANNEL[m.channel] ?? m.channel}).`
        : m.tr.engine?.status === "no_answer" ? `Rotation engine didn't answer in time for ${m.place ?? "a farmer"}; NASA weather was sent instead.`
        : `Gemini wrote a reply for ${m.place ?? "a farmer"}, every number checked.`,
    }));

  // Conversation log (newest first) with each answer's trace.
  const log = msgs.slice(0, 300).map((m) => {
    const ph = mask(m.phone);
    return {
      id: String(m.id), ts: m.ts, phone: ph.masked, phoneFull: ph.full, area: m.place ?? "Place not known yet", country: m.country ?? "",
      lang: LANGS[m.lang] ?? m.lang, langCode: m.lang, detected: m.tr.detected ?? null, channel: CHANNEL[m.channel] ?? m.channel,
      asked: m.inbound, answer: m.outbound, outcome: OUTCOMES[m.outcome] ?? m.outcome, outcomeId: m.outcome, crop: m.crop, tr: m.tr, segs: segs(m.outbound),
    };
  });

  return {
    ok: msgsQ.ok,
    number: env.TWILIO_NUMBER,
    range: `${new Date(now - 6 * DAY).toISOString().slice(0, 10)} to ${new Date(now).toISOString().slice(0, 10)}`,
    kpis: {
      active: activePhones.size, registered: registered.size,
      questions: asked(week).length, questionsPrev: asked(prev).length,
      plans: count(week, "plans"), plansPrev: count(prev, "plans"),
      alerts: count(week, "alert"), alertsPrev: count(prev, "alert"),
      alertSubs: farmers.filter((f) => f.alerts).length,
    },
    days, countries, places,
    usage: {
      newFarmers, returning: askers.length - newFarmers, askers: askers.length,
      funnel: [["Got a NASA answer", gotAnswer.size], ["Got 3 crop plans", gotPlans.size], ["Opened a plan (replied 1, 2 or 3)", opened.size], ["Turned on drought alerts", alertsOn.size], ["Came back from an earlier week", cameBack.size]],
      lang: [...langMix.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [LANGS[k] ?? k, n]),
      channel: [...chanMix.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [CHANNEL[k] ?? k, n]),
    },
    advice: {
      plans: count(week, "plans"), opened: chosen.length,
      avgSaving: savings.length ? Math.round(savings.reduce((a, b) => a + b, 0) / savings.length) : null,
      choice: [...choiceBy.entries()].map(([cc, r]) => ({ name: COUNTRY[cc] ?? (cc ? cc.toUpperCase() : "Unknown"), r })),
      crops: [...crops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      shifts: [...shiftsM.values()].sort((a, b) => b.n - a.n).slice(0, 8),
    },
    health: {
      median: q(0.5), p95: q(0.95), answers: times.length,
      engine: { connected: Boolean(env.ENGINE_URL), asked: engineAsked.length, ok: engineOk.length, ms: engineMs },
      translated, foreign: foreign.length, errors: count(week, "busy"), notFound: count(week, "not_found"), libAsked, libAnswered,
      feeds, events, reports, r2: Boolean(env.REPORTS), tiger,
    },
    log,
  };
}

// ---------------- page ----------------

export async function renderAdmin(env: Env, admin: string, demo = false): Promise<Response> {
  const data = env.DB ? await adminData(env) : null;
  if (demo && data) {
    // Demo link (no sign-in): every phone number becomes "Farmer 1", "Farmer 2", ... and nothing can be changed.
    const ids = new Map<string, string>();
    for (const r of data.log) {
      if (!ids.has(r.phoneFull)) ids.set(r.phoneFull, `Farmer ${ids.size + 1}`);
      r.phone = r.phoneFull = ids.get(r.phoneFull)!;
    }
  }
  const boot = JSON.stringify({ data, admin }).replace(/</g, "\\u003c");
  let html = page(boot);
  if (demo) {
    html = html
      .replace('<a href="/admin/logout">Sign out</a>', "<span>Demo view, read-only</span>")
      .replace(/<sc-if value="\{\{r2\}\}"><a href="\/admin\/reports\/new"[\s\S]*?<\/a><\/sc-if>/, "");
  }
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/** Old per-farmer links open the Conversations tab filtered to that farmer. */
export function farmerRedirect(phone: string): Response {
  return new Response(null, { status: 302, headers: { Location: `/admin?farmer=${encodeURIComponent(phone)}#convs` } });
}

const CARD = "background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 12px";
const KPI = "flex: 1 1 200px; min-width: 0; background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 10px; padding: 14px 16px";
const H2 = "margin: 0; font-size: 15px; font-weight: 700";
const MUTED = "color: #475467";

function page(boot: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>FarmLine · Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap">
<style>
body{margin:0}
a{color:#1B5E3F}a:hover{color:#123F2A}
button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #2E5AAC;outline-offset:2px}
.fl-world{position:absolute;inset:0}
.fl-world>path{fill:url(#fl-land);stroke:#FFFFFF;stroke-width:0.5}
.fl-grat path{fill:none;stroke:#CBDCE5;stroke-width:0.45}
.fl-lat path{fill:none;stroke:#A9C3D2;stroke-width:0.6;stroke-dasharray:3 3}
.fl-lat path.eq{stroke:#7FA3B8;stroke-width:0.8;stroke-dasharray:6 3}
.fl-lat text{font:600 7px Inter,sans-serif;fill:#7FA3B8;letter-spacing:.02em}
.fl-pin{position:absolute;transform:translate(-50%,-50%);border-radius:50%;border:2px solid #FFFFFF;cursor:pointer;padding:0;min-width:14px;min-height:14px;transition:transform .15s}
.fl-pin:hover,.fl-pin[aria-pressed=true]{transform:translate(-50%,-50%) scale(1.15)}
.fl-label{position:absolute;transform:translate(-50%,0);pointer-events:none;background:rgba(255,255,255,.95);border:1px solid #D0D5DD;border-radius:6px;padding:1px 7px;font-size:11.5px;font-weight:600;white-space:nowrap;color:#101828}
.fl-pulse{position:absolute;transform:translate(-50%,-50%);border-radius:50%;border:2px solid;pointer-events:none;animation:flpulse 2.4s ease-out infinite}
@keyframes flpulse{0%{opacity:.8;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.1)}}
@media (max-width:700px){.fl-wide{display:none}.fl-badge{left:8px!important;top:8px!important;padding:3px 9px 3px 6px!important;font-size:11px!important}.fl-label{font-size:10.5px;padding:0 5px}}
.fl-dot-pulse{width:10px;height:10px;border-radius:50%;border:2px solid #1B5E3F;box-sizing:border-box}
@media (prefers-reduced-motion:reduce){.fl-pulse{animation:none;opacity:.5}}
@media (max-width:700px){.steprow{flex-wrap:wrap}.steprow .st-title{flex-basis:auto!important}.st-sum{flex-basis:100%!important;padding-left:34px}}
</style>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="boot">${boot}</script>
<template id="app-template">
<div style="min-height: 100vh; display: flex; flex-wrap: wrap; background: #F5F6F8; font-family: Inter, system-ui, sans-serif; color: #101828; font-size: 14px; line-height: 1.5; font-feature-settings: 'tnum' 1">

<aside aria-label="Main" style="flex: 1 1 220px; min-width: 0; background: #FFFFFF; border-right: 1px solid #E4E7EC; display: flex; flex-direction: column; gap: 28px; padding: 20px 12px">
<div style="display: flex; align-items: center; gap: 10px; padding: 0 8px">
<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="{{accent}}"></rect><path d="M8 22c0-7 5-11.5 14-11.5-0.8 8-5.5 12.5-12.5 12.5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 23l6.5-6.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"></path></svg>
<div><div style="font-weight: 700; font-size: 15px">FarmLine</div><div style="font-size: 12px; ${MUTED}">Admin · {{number}}</div></div>
</div>
<nav aria-label="Sections" style="display: flex; flex-direction: column; gap: 2px">
<sc-for list="{{navItems}}" as="n">
<button type="button" onClick="{{n.pick}}" aria-current="{{n.current}}" style="min-height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border: none; border-radius: 8px; background: {{n.bg}}; color: {{n.fg}}; font-family: Inter, sans-serif; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer">
<span style="width: 8px; height: 8px; border-radius: 2px; background: {{n.mark}}"></span>{{n.label}}</button>
</sc-for>
</nav>
<div style="margin-top: auto; padding: 0 10px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; ${MUTED}">
<span style="display: flex; align-items: center; gap: 6px; color: #344054; font-weight: 600"><span style="width: 8px; height: 8px; border-radius: 50%; background: {{statusDot}}"></span>{{statusText}}</span>
<span>Live data from Cloudflare D1</span>
<button type="button" onClick="{{toggleNums}}" aria-pressed="{{numsPressed}}" style="align-self: flex-start; min-height: 32px; padding: 0 10px; border: 1px solid #D0D5DD; border-radius: 8px; background: {{numsBg}}; color: #101828; font-family: Inter, sans-serif; font-size: 12px; font-weight: 600; cursor: pointer">{{numsLabel}}</button>
<span style="word-break: break-all">{{admin}}</span>
<span><a href="/">Public page</a> · <a href="/admin/logout">Sign out</a></span>
</div>
</aside>

<div style="flex: 999 1 640px; min-width: 0">
<main style="max-width: 1200px; margin: 0 auto; padding: 28px 28px 40px; display: flex; flex-direction: column; gap: 20px">

<div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 8px 16px">
<div>
<h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.01em">{{pageTitle}}</h1>
<p style="margin: 2px 0 0; ${MUTED}">{{pageSub}}</p>
</div>
<span style="font-size: 13px; ${MUTED}">Last 7 days · {{range}}</span>
</div>

<sc-if value="{{noTable}}"><p style="margin: 0; padding: 12px 14px; border-radius: 10px; background: #FEF0C7; color: #7A2E0E">The conversation log table is missing. Run <code>npx wrangler d1 execute farmline --remote --file=db/migrate_003_admin.sql</code> once.</p></sc-if>
<sc-if value="{{empty}}"><p style="margin: 0; padding: 12px 14px; border-radius: 10px; background: #EEF4F0; color: #1B5E3F">No questions yet. Text or call {{number}} and this page fills in.</p></sc-if>

<sc-if value="{{isOverview}}">
<div style="display: flex; flex-direction: column; gap: 20px">
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<sc-for list="{{kpis}}" as="k">
<div style="${KPI}">
<div style="font-size: 13px; ${MUTED}">{{k.label}}</div>
<div style="font-size: 26px; font-weight: 700; letter-spacing: -0.02em">{{k.value}}</div>
<div style="font-size: 12px"><span style="font-weight: 600; color: {{k.deltaColor}}">{{k.delta}}</span> <span style="${MUTED}">{{k.sub}}</span></div>
</div>
</sc-for>
</div>

<section style="${CARD}; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 6px 16px">
<h2 style="${H2}">Messages per day</h2>
<span style="display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: #344054">
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: {{accent}}"></span>SMS &amp; WhatsApp</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: #6CA88A"></span>Voice call</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: #B9D7C5"></span>Drought alert</span>
</span>
</div>
<div style="display: flex; gap: 10px">
<div style="flex: 0 0 34px; display: flex; flex-direction: column; justify-content: space-between; height: 160px; font-size: 11.5px; ${MUTED}; text-align: right"><span>{{dayMax}}</span><span>{{dayMid}}</span><span>0</span></div>
<div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px">
<div style="height: 160px; display: flex; align-items: flex-end; gap: 6px; border-bottom: 1px solid #D0D5DD; background-image: linear-gradient(#F2F4F7 1px, transparent 1px); background-size: 100% 80px">
<sc-for list="{{days}}" as="d">
<div title="{{d.title}}" style="flex: 1 1 0; height: {{d.h}}; display: flex; flex-direction: column-reverse; border-radius: 3px 3px 0 0; overflow: hidden">
<span style="height: {{d.sms}}; background: {{accent}}"></span><span style="height: {{d.call}}; background: #6CA88A"></span><span style="height: {{d.alert}}; background: #B9D7C5"></span>
</div>
</sc-for>
</div>
<div style="display: flex; gap: 6px; font-size: 11px; ${MUTED}"><sc-for list="{{days}}" as="d"><span style="flex: 1 1 0; text-align: center">{{d.label}}</span></sc-for></div>
</div>
</div>
</section>

<div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start">
<section aria-label="Map" style="flex: 999 1 560px; min-width: 0; ${CARD}; overflow: hidden">
<div style="padding: 12px 14px; border-bottom: 1px solid #EAECF0; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px">
<h2 style="${H2}">Where farmers are</h2>
<div role="group" aria-label="Map view" style="display: flex; flex-wrap: wrap; border: 1px solid #D0D5DD; border-radius: 8px; overflow: hidden">
<sc-for list="{{viewTabs}}" as="r"><button type="button" onClick="{{r.pick}}" aria-pressed="{{r.pressed}}" style="min-height: 34px; padding: 0 11px; border: none; border-right: 1px solid #E4E7EC; background: {{r.bg}}; color: {{r.fg}}; font-family: Inter, sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer">{{r.label}}</button></sc-for>
</div>
</div>
<div class="fl-map" style="position: relative; aspect-ratio: 960 / 500; overflow: hidden; background: #E9F2F5">
<div class="fl-zoom" style="position: absolute; inset: 0; transform-origin: 0 0; transform: {{zoom}}">
${MAP_SVG}
</div>
<sc-for list="{{rings}}" as="g"><span class="fl-pulse" aria-hidden="true" style="left: {{g.left}}; top: {{g.top}}; width: {{g.d}}; height: {{g.d}}; border-color: {{g.color}}"></span></sc-for>
<sc-for list="{{pins}}" as="b">
<button type="button" class="fl-pin" onClick="{{b.pick}}" aria-label="{{b.aria}}" aria-pressed="{{b.pressed}}" title="{{b.aria}}" style="left: {{b.left}}; top: {{b.top}}; width: {{b.d}}; height: {{b.d}}; background: {{b.fill}}; box-shadow: {{b.shadow}}"></button>
</sc-for>
<sc-for list="{{pinLabels}}" as="b">
<span class="fl-label" style="left: {{b.left}}; top: {{b.top}}">{{b.text}}</span>
</sc-for>
<div class="fl-badge" style="position: absolute; left: 12px; top: 12px; display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.92); border: 1px solid #D5E3DA; border-radius: 999px; padding: 5px 12px 5px 8px; font-size: 12px; font-weight: 600; color: #1B5E3F; box-shadow: 0 1px 2px rgba(16,24,40,0.06)">
<span style="width: 14px; height: 14px; border-radius: 4px; background: #DCEBE2; border: 1px solid #93C2A6"></span>Works in every country<span class="fl-wide"> · any phone, no internet</span></div>
<sc-if value="{{noPins}}"><div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: rgba(255,255,255,0.94); border: 1px solid #E4E7EC; border-radius: 10px; padding: 10px 14px; font-size: 13px; color: #344054; text-align: center">{{noPinsText}}</div></sc-if>
</div>
<div style="padding: 10px 14px; border-top: 1px solid #EAECF0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; font-size: 12px; color: #344054">
<span style="display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center"><span style="font-weight: 600">Last 30 days of NASA rain</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 50%; background: #D92D20"></span>Dry spell (under 50%)</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 50%; background: #F79009"></span>Drier (50–80%)</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 50%; background: #12B76A"></span>Normal</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 50%; background: #2E90FA"></span>Wetter (over 120%)</span>
<span style="display: flex; align-items: center; gap: 5px"><span class="fl-dot-pulse"></span>Active in the last 24 h</span></span>
<span style="${MUTED}">Each pin is a town, placed to within about 10 km, never an exact farm. Size = farmers.</span>
</div>
</section>

<section aria-label="Area" style="flex: 1 1 300px; min-width: 0; ${CARD}; overflow: hidden">
<div style="padding: 14px 16px; border-bottom: 1px solid #EAECF0; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px">
<div><h2 style="${H2}">{{area.name}}</h2><div style="font-size: 12px; ${MUTED}">{{area.sub}}</div></div>
<sc-if value="{{hasUnit}}"><button type="button" onClick="{{closeUnit}}" aria-label="Back to the summary" style="width: 32px; height: 32px; border: none; border-radius: 6px; background: #F2F4F7; color: #344054; cursor: pointer; font-size: 16px">×</button></sc-if>
</div>
<sc-if value="{{hasUnit}}"><div style="padding: 12px 16px 4px"><div style="position: relative; height: 300px; border-radius: 12px; overflow: hidden; background: #0B1430">
<div id="fl3d-slot" data-lat="{{area.lat}}" data-lon="{{area.lon}}" style="position: absolute; inset: 0"></div>
<span style="position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 60px); z-index: 2; pointer-events: none; background: rgba(11,20,48,0.78); color: #EEF1EA; border-radius: 6px; padding: 3px 9px; font-size: 11.5px; font-weight: 600">{{area.label3d}}</span>
</div></div></sc-if>
<sc-for list="{{area.rows}}" as="r">
<div style="padding: 10px 16px; border-bottom: 1px solid #F2F4F7; display: flex; justify-content: space-between; gap: 12px"><span style="${MUTED}">{{r.k}}</span><span style="font-weight: 600; color: {{r.color}}; text-align: right">{{r.v}}</span></div>
</sc-for>
<p style="margin: 0; padding: 12px 16px; font-size: 13px; color: #344054">{{area.note}}</p>
</section>
</div>
</div>
</sc-if>

<sc-if value="{{isUsage}}">
<div style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<sc-for list="{{uKpis}}" as="k">
<div style="${KPI}"><div style="font-size: 13px; ${MUTED}">{{k.label}}</div><div style="font-size: 24px; font-weight: 700">{{k.value}}</div><div style="font-size: 12px; ${MUTED}">{{k.sub}}</div></div>
</sc-for>
</div>
<div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch">
<section style="flex: 1 1 460px; min-width: 0; ${CARD}; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
<div><h2 style="${H2}">What farmers do after asking</h2><p style="margin: 2px 0 0; font-size: 12px; ${MUTED}">Share of the {{askers}} farmers who asked something this week</p></div>
<sc-for list="{{funnel}}" as="f">
<div style="display: grid; grid-template-columns: minmax(120px, 190px) 1fr 82px; gap: 12px; align-items: center; font-size: 13px">
<span>{{f.label}}</span>
<span style="height: 22px; border-radius: 4px; background: #F2F4F7; position: relative"><span style="position: absolute; left: 0; top: 0; bottom: 0; width: {{f.w}}; border-radius: 4px; background: {{accent}}; opacity: {{f.op}}"></span></span>
<span style="text-align: right"><strong>{{f.n}}</strong> <span style="${MUTED}">{{f.pct}}</span></span>
</div>
</sc-for>
</section>
<section style="flex: 1 1 320px; min-width: 0; ${CARD}; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px">
<sc-for list="{{mixes}}" as="m">
<div style="display: flex; flex-direction: column; gap: 8px">
<h2 style="${H2}">{{m.title}}</h2>
<sc-if value="{{m.has}}">
<div style="display: flex; height: 14px; border-radius: 4px; overflow: hidden">
<sc-for list="{{m.parts}}" as="p"><span title="{{p.label}}" style="width: {{p.w}}; background: {{p.color}}"></span></sc-for>
</div>
<div style="display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: #344054">
<sc-for list="{{m.parts}}" as="p"><span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: {{p.color}}"></span>{{p.label}} <strong>{{p.pct}}</strong></span></sc-for>
</div>
</sc-if>
<sc-if value="{{m.none}}"><p style="margin: 0; font-size: 13px; ${MUTED}">Nothing this week yet.</p></sc-if>
</div>
</sc-for>
</section>
</div>
<section style="${CARD}; overflow: hidden">
<div style="padding: 14px 18px; border-bottom: 1px solid #EAECF0"><h2 style="${H2}">Usage by country</h2></div>
<div style="overflow-x: auto"><div role="table" aria-label="Usage by country" style="min-width: 640px; font-size: 13px">
<div role="row" style="display: grid; grid-template-columns: 1.3fr repeat(5, minmax(0, 1fr)); gap: 12px; padding: 8px 18px; background: #F9FAFB; border-bottom: 1px solid #EAECF0; font-size: 12px; font-weight: 600; ${MUTED}"><span role="columnheader">Country</span><span role="columnheader">Farmers</span><span role="columnheader">Active this week</span><span role="columnheader">Questions</span><span role="columnheader">In a dry spell</span><span role="columnheader">Alert subscribers</span></div>
<sc-for list="{{regionRows}}" as="r"><div role="row" style="display: grid; grid-template-columns: 1.3fr repeat(5, minmax(0, 1fr)); gap: 12px; padding: 10px 18px; border-bottom: 1px solid #F2F4F7; font-weight: {{r.weight}}"><span role="cell">{{r.name}}</span><span role="cell">{{r.reg}}</span><span role="cell">{{r.act}}</span><span role="cell">{{r.q}}</span><span role="cell">{{r.dry}}</span><span role="cell">{{r.subs}}</span></div></sc-for>
</div></div>
</section>
</div>
</sc-if>

<sc-if value="{{isAdvice}}">
<div style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<sc-for list="{{aKpis}}" as="k">
<div style="flex: 1 1 240px; min-width: 0; background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 10px; padding: 14px 16px"><div style="font-size: 13px; ${MUTED}">{{k.label}}</div><div style="font-size: 24px; font-weight: 700">{{k.value}}</div><div style="font-size: 12px; ${MUTED}">{{k.sub}}</div></div>
</sc-for>
</div>
<sc-if value="{{noEngine}}"><p style="margin: 0; padding: 12px 14px; border-radius: 10px; background: #FEF0C7; color: #7A2E0E">The rotation engine isn't connected yet, so farmers get NASA weather but no crop plans. Set ENGINE_URL in wrangler.toml and deploy.</p></sc-if>
<div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch">
<section style="flex: 1 1 440px; min-width: 0; ${CARD}; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
<div><h2 style="${H2}">Which plan farmers open</h2><p style="margin: 2px 0 0; font-size: 12px; ${MUTED}">Share of farmers who replied 1, 2 or 3, by country</p></div>
<sc-for list="{{choice}}" as="c">
<div style="display: grid; grid-template-columns: 110px 1fr; gap: 12px; align-items: center; font-size: 13px">
<span style="font-weight: 600">{{c.name}}</span>
<div style="display: flex; height: 22px; border-radius: 4px; overflow: hidden; background: #F2F4F7">
<span title="Least water {{c.a}}" style="width: {{c.a}}; background: {{accent}}; color: #FFFFFF; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; padding-left: 6px; overflow: hidden">{{c.a}}</span>
<span title="Most income {{c.b}}" style="width: {{c.b}}; background: #6CA88A; color: #FFFFFF; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; padding-left: 6px; overflow: hidden">{{c.b}}</span>
<span title="Safest in drought {{c.c}}" style="width: {{c.c}}; background: #B9D7C5; color: #101828; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; padding-left: 6px; overflow: hidden">{{c.c}}</span>
</div>
</div>
</sc-for>
<sc-if value="{{noChoice}}"><p style="margin: 0; font-size: 13px; ${MUTED}">No farmer has opened a plan yet.</p></sc-if>
<div style="display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: #344054">
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: {{accent}}"></span>1 · Least water</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: #6CA88A"></span>2 · Most income</span>
<span style="display: flex; align-items: center; gap: 5px"><span style="width: 10px; height: 10px; border-radius: 2px; background: #B9D7C5"></span>3 · Safest in drought</span>
</div>
</section>
<section style="flex: 1 1 320px; min-width: 0; ${CARD}; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px">
<h2 style="${H2}">Crops farmers ask about</h2>
<sc-for list="{{topics}}" as="t">
<div style="display: grid; grid-template-columns: 1fr 120px 40px; gap: 10px; align-items: center; font-size: 13px">
<span style="text-transform: capitalize">{{t.label}}</span>
<span style="height: 8px; border-radius: 4px; background: #F2F4F7; position: relative"><span style="position: absolute; left: 0; top: 0; bottom: 0; width: {{t.w}}; border-radius: 4px; background: {{accent}}"></span></span>
<span style="text-align: right; font-weight: 600">{{t.n}}</span>
</div>
</sc-for>
<sc-if value="{{noTopics}}"><p style="margin: 0; font-size: 13px; ${MUTED}">No crops named this week yet.</p></sc-if>
</section>
</div>
<section style="${CARD}; overflow: hidden">
<div style="padding: 14px 18px; border-bottom: 1px solid #EAECF0"><h2 style="${H2}">Crop shifts farmers chose</h2><p style="margin: 2px 0 0; font-size: 12px; ${MUTED}">Current crop → first crop of the plan the farmer opened</p></div>
<div style="overflow-x: auto"><div role="table" aria-label="Crop shifts" style="min-width: 560px; font-size: 13px">
<div role="row" style="display: grid; grid-template-columns: 1fr 1fr 1fr 0.6fr 1.2fr; gap: 12px; padding: 8px 18px; background: #F9FAFB; border-bottom: 1px solid #EAECF0; font-size: 12px; font-weight: 600; ${MUTED}"><span role="columnheader">From</span><span role="columnheader">To</span><span role="columnheader">Country</span><span role="columnheader">Farmers</span><span role="columnheader">Plan type</span></div>
<sc-for list="{{shifts}}" as="s"><div role="row" style="display: grid; grid-template-columns: 1fr 1fr 1fr 0.6fr 1.2fr; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #F2F4F7; text-transform: capitalize"><span role="cell">{{s.from}}</span><span role="cell" style="font-weight: 600">→ {{s.to}}</span><span role="cell">{{s.country}}</span><span role="cell">{{s.n}}</span><span role="cell" style="color: #344054; text-transform: none">{{s.why}}</span></div></sc-for>
<sc-if value="{{noShifts}}"><p style="margin: 0; padding: 12px 18px; font-size: 13px; ${MUTED}">Shows up once farmers open plans.</p></sc-if>
</div></div>
</section>
</div>
</sc-if>

<sc-if value="{{isHealth}}">
<div style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<sc-for list="{{hKpis}}" as="k">
<div style="flex: 1 1 170px; min-width: 0; background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 10px; padding: 14px 16px"><div style="font-size: 13px; ${MUTED}">{{k.label}}</div><div style="font-size: 24px; font-weight: 700; color: {{k.color}}">{{k.value}}</div><div style="font-size: 12px; ${MUTED}">{{k.sub}}</div></div>
</sc-for>
</div>
<div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch">
<section style="flex: 999 1 520px; min-width: 0; ${CARD}; overflow: hidden">
<div style="padding: 14px 18px; border-bottom: 1px solid #EAECF0"><h2 style="${H2}">NASA and partner data</h2></div>
<div style="overflow-x: auto"><div role="table" aria-label="Data sources" style="min-width: 620px; font-size: 13px">
<div role="row" style="display: grid; grid-template-columns: 1.1fr 1.5fr 1fr 1.2fr 0.8fr; gap: 12px; padding: 8px 18px; background: #F9FAFB; border-bottom: 1px solid #EAECF0; font-size: 12px; font-weight: 600; ${MUTED}"><span role="columnheader">Source</span><span role="columnheader">Used for</span><span role="columnheader">Last used</span><span role="columnheader">How FarmLine gets it</span><span role="columnheader">Status</span></div>
<sc-for list="{{feeds}}" as="f"><div role="row" style="display: grid; grid-template-columns: 1.1fr 1.5fr 1fr 1.2fr 0.8fr; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #F2F4F7"><span role="cell" style="font-weight: 600">{{f.name}}</span><span role="cell" style="color: #344054">{{f.what}}</span><span role="cell">{{f.latest}}</span><span role="cell" style="color: #344054">{{f.how}}</span><span role="cell"><span style="font-size: 12px; font-weight: 600; color: {{f.fg}}; background: {{f.bg}}; border-radius: 6px; padding: 1px 8px">{{f.status}}</span></span></div></sc-for>
</div></div>
</section>
<section style="flex: 1 1 300px; min-width: 0; ${CARD}; overflow: hidden">
<div style="padding: 14px 18px; border-bottom: 1px solid #EAECF0"><h2 style="${H2}">Recent events</h2></div>
<sc-for list="{{events}}" as="e"><div style="padding: 10px 18px; border-bottom: 1px solid #F2F4F7; display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; ${MUTED}">{{e.time}}</span><span style="font-size: 13px">{{e.text}}</span></div></sc-for>
<sc-if value="{{noEvents}}"><p style="margin: 0; padding: 12px 18px; font-size: 13px; ${MUTED}">Nothing unusual yet.</p></sc-if>
</section>
</div>
<section style="${CARD}; overflow: hidden">
<div style="padding: 14px 18px; border-bottom: 1px solid #EAECF0; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px">
<div><h2 style="${H2}">Daily drought reports</h2><p style="margin: 2px 0 0; font-size: 12px; ${MUTED}">Saved to Cloudflare R2 every morning: NASA rain for every town with farmers. No phone numbers. Share with an agriculture office.</p></div>
<sc-if value="{{r2}}"><a href="/admin/reports/new" style="min-height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 8px; background: {{accent}}; color: #FFFFFF; font-weight: 600; font-size: 13px; text-decoration: none">Make today's report now</a></sc-if>
</div>
<sc-for list="{{reports}}" as="r">
<div style="padding: 10px 18px; border-bottom: 1px solid #F2F4F7; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; font-size: 13px">
<span style="font-weight: 600">{{r.date}}</span><span style="color: #344054">{{r.towns}} towns · <span style="color: {{r.dryColor}}; font-weight: 600">{{r.dry}} in a dry spell</span> · {{r.kb}}</span><a href="{{r.href}}" download>Download CSV</a>
</div>
</sc-for>
<sc-if value="{{noReports}}"><p style="margin: 0; padding: 12px 18px; font-size: 13px; ${MUTED}">{{noReportsText}}</p></sc-if>
</section>
<p style="margin: 0; font-size: 12px; ${MUTED}">Reply time runs from the moment Twilio hands FarmLine the message to the moment the answer is ready. Gemini only rewords a reply; if any number changes, the reply is rejected and the Workers AI backup or the English template is sent instead.</p>
</div>
</sc-if>

<sc-if value="{{isConvs}}">
<div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start">
<section aria-label="Conversation log" style="flex: 1 1 400px; min-width: 0; ${CARD}; overflow: hidden">
<div style="padding: 12px 14px; border-bottom: 1px solid #EAECF0; display: flex; flex-wrap: wrap; gap: 8px">
<label for="log-search" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Search conversations</label>
<input id="log-search" type="search" placeholder="Search place, crop, number or words" value="{{q}}" onInput="{{onSearch}}" style="flex: 1 1 200px; min-height: 36px; padding: 0 12px; border: 1px solid #D0D5DD; border-radius: 8px; font-family: Inter, sans-serif; font-size: 14px">
<div role="group" aria-label="Language" style="display: flex; flex-wrap: wrap; gap: 6px">
<sc-for list="{{langTabs}}" as="o"><button type="button" onClick="{{o.pick}}" aria-pressed="{{o.pressed}}" style="min-height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid {{o.bd}}; background: {{o.bg}}; color: {{o.fg}}; font-family: Inter, sans-serif; font-size: 12px; font-weight: 600; cursor: pointer">{{o.label}}</button></sc-for>
</div>
</div>
<sc-for list="{{log}}" as="r">
<button type="button" onClick="{{r.pick}}" aria-pressed="{{r.pressed}}" style="width: 100%; text-align: left; padding: 11px 14px; border: none; border-bottom: 1px solid #F2F4F7; background: {{r.bg}}; box-shadow: inset 3px 0 0 {{r.bar}}; cursor: pointer; font-family: Inter, sans-serif; color: #101828; display: grid; grid-template-columns: 1fr auto; gap: 2px 12px">
<span style="font-weight: 600">{{r.area}}</span><span style="font-size: 12px; ${MUTED}">{{r.time}}</span>
<span style="font-size: 13px; ${MUTED}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" dir="auto">{{r.gloss}}</span><span style="font-size: 12px; ${MUTED}">{{r.lang}} · {{r.channel}}</span>
<span style="font-size: 12px; color: {{r.outColor}}">{{r.outcome}}</span><span style="font-size: 12px; ${MUTED}">{{r.phone}}</span>
</button>
</sc-for>
<sc-if value="{{noLog}}"><p style="margin: 0; padding: 16px; ${MUTED}">No conversations match.</p></sc-if>
<div style="padding: 10px 14px; font-size: 12px; ${MUTED}">{{logInfo}}</div>
</section>

<section aria-label="Conversation detail" style="flex: 999 1 520px; min-width: 0; ${CARD}; overflow: hidden">
<sc-if value="{{hasRec}}">
<div style="padding: 14px 18px; border-bottom: 1px solid #EAECF0; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 6px 12px">
<h2 style="margin: 0; font-size: 17px; font-weight: 700">{{rec.area}}</h2>
<span style="font-size: 12px; ${MUTED}">{{rec.time}} · {{rec.channel}} · {{rec.lang}} · {{rec.phone}}</span>
</div>
<sc-if value="{{rec.has3d}}"><div style="padding: 14px 18px 0"><div style="position: relative; height: 300px; border-radius: 12px; overflow: hidden; background: #0B1430">
<div id="fl3d-slot" data-lat="{{rec.lat}}" data-lon="{{rec.lon}}" style="position: absolute; inset: 0"></div>
<span style="position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 60px); z-index: 2; pointer-events: none; background: rgba(11,20,48,0.78); color: #EEF1EA; border-radius: 6px; padding: 3px 9px; font-size: 11.5px; font-weight: 600">{{rec.label3d}}</span>
</div></div></sc-if>
<div style="display: flex; flex-wrap: wrap">
<div style="flex: 1 1 240px; min-width: 0; padding: 14px 18px; border-right: 1px solid #EAECF0; display: flex; flex-direction: column; gap: 6px">
<span style="font-size: 12px; font-weight: 600; ${MUTED}">{{rec.askedLabel}}</span>
<p lang="{{rec.langCode}}" dir="auto" style="margin: 0; font-size: 15px">{{rec.asked}}</p>
</div>
<div style="flex: 1 1 240px; min-width: 0; padding: 14px 18px; display: flex; flex-direction: column; gap: 6px">
<span style="font-size: 12px; font-weight: 600; ${MUTED}">FarmLine answered</span>
<p style="margin: 0; font-size: 15px">{{rec.outcome}}</p>
<p style="margin: 0; font-size: 13px; ${MUTED}">{{rec.farmerNote}}</p>
</div>
</div>
<div style="border-top: 1px solid #EAECF0">
<div style="padding: 12px 18px; font-weight: 700; font-size: 14px">How this answer was made</div>
<sc-for list="{{steps}}" as="s">
<div style="border-top: 1px solid #F2F4F7">
<button type="button" class="steprow" onClick="{{s.toggle}}" aria-expanded="{{s.expanded}}" style="width: 100%; min-height: 46px; display: flex; align-items: center; gap: 12px; padding: 8px 18px; border: none; background: {{s.bg}}; cursor: pointer; font-family: Inter, sans-serif; text-align: left; color: #101828">
<span style="flex: 0 0 22px; height: 22px; border-radius: 50%; border: 1.5px solid {{accent}}; color: {{accent}}; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center">{{s.num}}</span>
<span class="st-title" style="flex: 0 0 170px; font-weight: 600; font-size: 13px">{{s.title}}</span>
<span class="st-sum" style="flex: 1 1 auto; min-width: 0; font-size: 12px; ${MUTED}">{{s.summary}}</span>
<span aria-hidden="true" style="${MUTED}; font-size: 14px">{{s.icon}}</span>
</button>
<sc-if value="{{s.isFacts}}">
<div style="padding: 2px 18px 14px 52px; display: flex; flex-wrap: wrap; gap: 8px">
<sc-for list="{{t.facts}}" as="x"><span style="border: 1px solid #E4E7EC; border-radius: 8px; padding: 5px 10px; font-size: 13px"><span style="display: block; font-size: 11.5px; ${MUTED}">{{x.k}}</span><strong>{{x.v}}</strong></span></sc-for>
</div>
</sc-if>
<sc-if value="{{s.isData}}">
<div style="padding: 2px 18px 14px 52px"><div style="overflow-x: auto; border: 1px solid #EAECF0; border-radius: 8px"><div role="table" aria-label="NASA data" style="min-width: 480px; font-size: 13px">
<sc-for list="{{t.data}}" as="d"><div role="row" style="display: grid; grid-template-columns: 0.9fr 1.3fr 2fr; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #F2F4F7"><span role="cell" style="font-weight: 600">{{d.name}}</span><span role="cell" style="color: {{d.valueColor}}">{{d.value}}</span><span role="cell" style="color: #344054">{{d.context}}</span></div></sc-for>
</div></div></div>
</sc-if>
<sc-if value="{{s.isEngine}}">
<div style="padding: 2px 18px 16px 52px; display: flex; flex-direction: column; gap: 12px">
<sc-if value="{{t.hasOptions}}">
<div style="overflow-x: auto; border: 1px solid #EAECF0; border-radius: 8px"><div role="table" aria-label="The three plans" style="min-width: 560px; font-size: 13px">
<div role="row" style="display: grid; grid-template-columns: 1.2fr 2fr 0.8fr 0.8fr 0.9fr; gap: 12px; padding: 8px 12px; background: #F9FAFB; border-bottom: 1px solid #EAECF0; font-size: 12px; font-weight: 600; ${MUTED}"><span role="columnheader">Plan</span><span role="columnheader">Rotation</span><span role="columnheader">Water use</span><span role="columnheader">Income</span><span role="columnheader">Bad year</span></div>
<sc-for list="{{t.options}}" as="o"><div role="row" style="display: grid; grid-template-columns: 1.2fr 2fr 0.8fr 0.8fr 0.9fr; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #F2F4F7"><span role="cell" style="font-weight: 600">{{o.num}}. {{o.tag}}</span><span role="cell" style="text-transform: capitalize">{{o.seq}}</span><span role="cell">{{o.water}}</span><span role="cell">{{o.income}}</span><span role="cell" style="color: {{o.badColor}}">{{o.bad}}</span></div></sc-for>
</div></div>
</sc-if>
<p style="margin: 0; font-size: 13px; color: #344054">{{t.why}}</p>
</div>
</sc-if>
<sc-if value="{{s.isHeard}}">
<div style="padding: 2px 18px 14px 52px; display: flex; flex-direction: column; gap: 6px">
<p lang="{{rec.langCode}}" dir="auto" style="margin: 0; font-size: 14px; background: #F9FAFB; border: 1px solid #EAECF0; border-radius: 10px; padding: 10px 12px">“{{t.heardText}}”</p>
<p style="margin: 0; font-size: 13px; color: #344054">{{t.heardNote}}</p>
</div>
</sc-if>
<sc-if value="{{s.isLibrary}}">
<div style="padding: 2px 18px 14px 52px; display: flex; flex-direction: column; gap: 8px">
<div style="overflow-x: auto; border: 1px solid #EAECF0; border-radius: 8px"><div role="table" aria-label="Closest library answers" style="min-width: 420px; font-size: 13px">
<div role="row" style="display: grid; grid-template-columns: 2fr 1fr 0.7fr; gap: 12px; padding: 8px 12px; background: #F9FAFB; border-bottom: 1px solid #EAECF0; font-size: 12px; font-weight: 600; ${MUTED}"><span role="columnheader">Closest answers</span><span role="columnheader">Source</span><span role="columnheader">Match</span></div>
<sc-for list="{{t.hits}}" as="h"><div role="row" style="display: grid; grid-template-columns: 2fr 1fr 0.7fr; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #F2F4F7; font-weight: {{h.weight}}"><span role="cell">{{h.title}}</span><span role="cell" style="color: #344054">{{h.source}}</span><span role="cell" style="color: {{h.color}}">{{h.score}}</span></div></sc-for>
</div></div>
<p style="margin: 0; font-size: 13px; color: #344054">{{t.libNote}}</p>
</div>
</sc-if>
<sc-if value="{{s.isCheck}}"><p style="margin: 0; padding: 2px 18px 14px 52px; font-size: 13px; color: #344054">{{t.checker}}</p></sc-if>
<sc-if value="{{s.isSent}}">
<div style="padding: 2px 18px 14px 52px"><p lang="{{t.langCode}}" dir="auto" style="margin: 0; font-size: 13px; background: #E8F3EC; border: 1px solid #C7E3D1; border-radius: 10px; padding: 10px 12px; white-space: pre-line">{{t.reply}}</p></div>
</sc-if>
</div>
</sc-for>
</div>
</sc-if>
<sc-if value="{{noRec}}"><p style="margin: 0; padding: 18px; ${MUTED}">Select a conversation to see the full exchange and how the answer was made.</p></sc-if>
</section>
</div>
</sc-if>

<p style="margin: 0; font-size: 12px; ${MUTED}">Live data from Cloudflare D1 for {{totalL}} farmers. Weather from NASA POWER. Map: Natural Earth. Phone numbers stay hidden until you choose to show them.</p>
</main>
</div>
</div>
</template>
<script>
${RUNTIME_JS}
</script>
<script>
${COMPONENT_JS}
</script>
</body>
</html>`;
}

/** The page logic: the design's Component class, reading live data instead of samples. */
const COMPONENT_JS = String.raw`
const BOOT = JSON.parse(document.getElementById('boot').textContent);
class Component extends DCLogic {
  constructor(props) {
    super(props);
    const u = new URL(location.href);
    const farmer = u.searchParams.get('farmer');
    const page = (location.hash || '').slice(1);
    let nums = false; try { nums = sessionStorage.getItem('fl_nums') === '1'; } catch (e) {}
    this.state = { page: ['overview','usage','advice','health','convs'].includes(page) ? page : (farmer ? 'convs' : 'overview'), view: 'world', place: null, q: farmer || '', lang: 'all', rec: null, step: 'data', nums };
  }
  fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  cls(d) { return d >= 30 ? { color: '#B42318', fill: 'rgba(180,35,24,0.72)' } : d >= 15 ? { color: '#DC6803', fill: 'rgba(220,104,3,0.72)' } : { color: '#039855', fill: 'rgba(3,152,85,0.68)' }; }
  when(ts) { if (!ts) return 'Not yet'; const d = new Date(ts); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  delta(now, before) { if (!before) return now ? { delta: 'New', deltaColor: '#05603A' } : { delta: '', deltaColor: '#475467' }; const p = Math.round((now - before) / before * 100); return { delta: (p >= 0 ? '+' : '') + p + '%', deltaColor: p >= 0 ? '#05603A' : '#B54708' }; }
  signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + '%'; }

  renderVals() {
    const accent = this.props.accent || '#1B5E3F';
    const st = this.state, D = BOOT.data || { kpis: {}, days: [], countries: [], usage: { funnel: [], lang: [], channel: [] }, advice: { choice: [], crops: [], shifts: [] }, health: { engine: {}, feeds: [], events: [] }, log: [] };
    const fmt = (n) => this.fmt(n);
    const K = D.kpis;
    const pill = (sel) => sel ? { bg: '#F2F4F7', fg: '#101828', bd: '#98A2B3' } : { bg: '#FFFFFF', fg: '#475467', bd: '#E4E7EC' };
    const go = (page) => { this.setState({ page }); try { history.replaceState(null, '', '#' + page); } catch (e) {} };
    const navDefs = [['overview', 'Overview'], ['usage', 'Usage'], ['advice', 'Advice given'], ['health', 'System health'], ['convs', 'Conversations']];
    const navItems = navDefs.map(([id, label]) => ({ label, current: st.page === id ? 'page' : 'false', bg: st.page === id ? '#EEF4F0' : 'transparent', fg: st.page === id ? accent : '#344054', mark: st.page === id ? accent : '#D0D5DD', pick: () => go(id) }));
    const titles = {
      overview: ['Overview', 'How much FarmLine is being used, and where.'],
      usage: ['Usage', 'Who uses FarmLine, in which language and channel, and what they do after asking.'],
      advice: ['Advice given', 'What FarmLine recommends, and which plans farmers open.'],
      health: ['System health', 'Is every answer fast and built on fresh NASA data?'],
      convs: ['Conversations', 'Every question and answer, with how each answer was made.']
    }[st.page];

    // ---- overview ----
    const kpis = [
      Object.assign({ label: 'Active farmers', value: fmt(K.active || 0), sub: 'of ' + fmt(K.registered || 0) + ' who have texted or called' }, { delta: '', deltaColor: '#475467' }),
      Object.assign({ label: 'Questions answered', value: fmt(K.questions || 0), sub: 'vs previous 7 days' }, this.delta(K.questions, K.questionsPrev)),
      Object.assign({ label: '3-crop plans delivered', value: fmt(K.plans || 0), sub: 'vs previous 7 days' }, this.delta(K.plans, K.plansPrev)),
      Object.assign({ label: 'Drought alerts sent', value: fmt(K.alerts || 0), sub: fmt(K.alertSubs || 0) + ' farmers subscribed' }, this.delta(K.alerts, K.alertsPrev))
    ];
    const tot = D.days.map((d) => d.sms + d.call + d.alert);
    const dmax = Math.max(4, Math.ceil(Math.max(0, ...tot) / 4) * 4);
    const pc = (a, b) => (b ? (a / b * 100).toFixed(1) : 0) + '%';
    const days = D.days.map((d, i) => { const t = d.sms + d.call + d.alert; const dt = new Date(d.date + 'T12:00:00Z');
      return { h: (t / dmax * 100).toFixed(1) + '%', sms: pc(d.sms, t), call: pc(d.call, t), alert: pc(d.alert, t), label: i % 2 === 0 ? dt.getUTCDate() + ' ' + dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) : '', title: d.date + ': ' + t + ' messages (' + d.sms + ' SMS, ' + d.call + ' calls, ' + d.alert + ' alerts)' }; });
    // World map: the design's map is drawn in the Natural Earth projection; this fit matches its coastlines to within a few pixels.
    const proj = (lat, lon) => { const l = lat * Math.PI / 180, L = lon * Math.PI / 180, p2 = l * l, p4 = p2 * p2;
      const X = L * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
      const Y = l * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
      return { x: (479.6 + 174.24 * X) / 9.6, y: (288.01 - 174.24 * Y) / 5 }; };
    const C = D.countries;
    const P = D.places || [];
    const REG = { world: ['World', [-180, 180, -56, 84]], americas: ['Americas', [-168, -34, -56, 72]], europe: ['Europe', [-25, 45, 34, 71]], africa: ['Africa', [-20, 55, -36, 38]], asia: ['Asia', [25, 150, -11, 58]] };
    const view = REG[st.view] ? st.view : 'world';
    const box = REG[view][1];
    let zx0 = 100, zx1 = 0, zy0 = 100, zy1 = 0;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const p = proj(box[2] + (box[3] - box[2]) * i / 8, box[0] + (box[1] - box[0]) * j / 8); zx0 = Math.min(zx0, p.x); zx1 = Math.max(zx1, p.x); zy0 = Math.min(zy0, p.y); zy1 = Math.max(zy1, p.y); }
    const zs = view === 'world' ? 1 : Math.min(100 / (zx1 - zx0 + 4), 100 / (zy1 - zy0 + 4));
    const zcx = view === 'world' ? 50 : (zx0 + zx1) / 2, zcy = view === 'world' ? 50 : (zy0 + zy1) / 2;
    const zoom = 'translate(' + (50 - zcx * zs).toFixed(3) + '%, ' + (50 - zcy * zs).toFixed(3) + '%) scale(' + zs.toFixed(4) + ')';
    const scr = (lat, lon) => { const p = proj(lat, lon); return { x: 50 + (p.x - zcx) * zs, y: 50 + (p.y - zcy) * zs }; };
    const inBox = (p) => p.lon >= box[0] && p.lon <= box[1] && p.lat >= box[2] && p.lat <= box[3];
    const tone = (r) => r == null ? '#98A2B3' : r < 50 ? '#D92D20' : r < 80 ? '#F79009' : r > 120 ? '#2E90FA' : '#12B76A';
    const mxP = Math.max(1, ...P.map((p) => p.farmers));
    const k = Math.max(0.6, Math.min(1, (window.innerWidth || 1200) / 1100));
    const sz = (f) => Math.round((14 + 22 * Math.sqrt(f / mxP)) * k * (view === 'world' ? 1 : 1.15));
    const visible = P.filter(inBox);
    const recent = Date.now() - 864e5;
    const pins = visible.map((p) => { const s2 = scr(p.lat, p.lon); const col = tone(p.rain); const sel = st.place === p.key;
      return { left: s2.x + '%', top: s2.y + '%', d: sz(p.farmers) + 'px', fill: col, shadow: sel ? '0 0 0 3px #101828' : '0 1px 3px rgba(16,24,40,.35)', pressed: sel ? 'true' : 'false',
        aria: p.name + ': ' + fmt(p.farmers) + (p.farmers === 1 ? ' farmer' : ' farmers') + (p.rain != null ? ', rain ' + p.rain + '% of normal' : ''), pick: () => this.setState({ place: p.key }) }; });
    const rings = visible.filter((p) => p.last && Date.parse(p.last) > recent).map((p) => { const s2 = scr(p.lat, p.lon); return { left: s2.x + '%', top: s2.y + '%', d: sz(p.farmers) + 'px', color: tone(p.rain) }; });
    const placed = [];
    const pinLabels = visible.filter((p) => { const s2 = scr(p.lat, p.lon); if (s2.x < 4 || s2.x > 96 || s2.y > 92) return false; const narrow = (window.innerWidth || 1200) < 700; if (placed.some((q) => Math.abs(q.x - s2.x) < (narrow ? 26 : 13) && Math.abs(q.y - s2.y) < (narrow ? 14 : 7))) return false; placed.push(s2); return placed.length <= ((window.innerWidth || 1200) < 700 ? 4 : 10); })
      .map((p) => { const s2 = scr(p.lat, p.lon); return { left: s2.x + '%', top: 'calc(' + s2.y + '% + ' + (sz(p.farmers) / 2 + 3) + 'px)', text: p.name }; });
    const viewTabs = Object.keys(REG).map((id) => ({ label: REG[id][0], pressed: view === id ? 'true' : 'false', bg: view === id ? '#EEF4F0' : '#FFFFFF', fg: view === id ? '#1B5E3F' : '#475467', pick: () => this.setState({ view: id, place: null }) }));
    const sum = (arr, key) => arr.reduce((a, c) => a + c[key], 0);
    const pSel = P.find((p) => p.key === st.place);
    const ago = (ts) => { if (!ts) return '–'; const m = (Date.now() - Date.parse(ts)) / 6e4; return m < 60 ? Math.max(1, Math.round(m)) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
    let area;
    if (pSel) {
      const pct = Math.round(pSel.dryN / pSel.farmers * 100);
      area = { name: pSel.name, sub: pSel.country, lat: pSel.lat, lon: pSel.lon, label3d: pSel.name + ' · NASA imagery on 3D terrain', rows: [
        { k: 'Farmers', v: fmt(pSel.farmers), color: '#101828' },
        { k: 'NASA rain, last 30 days', v: pSel.rain == null ? 'Not checked yet' : pSel.rain + '% of normal', color: tone(pSel.rain) },
        { k: 'In a dry spell', v: fmt(pSel.dryN) + ' (' + pct + '%)', color: this.cls(pct).color },
        { k: 'Crops', v: pSel.crops.length ? pSel.crops.join(', ') : 'Not named yet', color: '#101828' },
        { k: 'Questions this week', v: fmt(pSel.q7), color: '#101828' },
        { k: 'Drought alert subscribers', v: fmt(pSel.alerts), color: '#101828' },
        { k: 'Last message', v: ago(pSel.last), color: '#101828' }],
        note: pSel.rain != null && pSel.rain < 50 ? 'This area is in a dry spell. Farmers who texted ALERT get a NASA rain check every day.' : 'Rain here is not in a dry spell right now.' };
    } else {
      const f = sum(visible, 'farmers'), d = sum(visible, 'dryN'), pct = f ? Math.round(d / f * 100) : 0;
      const cs = new Set(visible.map((p) => p.cc));
      area = { name: view === 'world' ? 'Everywhere' : REG[view][0], sub: visible.length + (visible.length === 1 ? ' area' : ' areas') + ' in ' + cs.size + (cs.size === 1 ? ' country' : ' countries'), rows: [
        { k: 'Farmers', v: fmt(f), color: '#101828' },
        { k: 'Questions this week', v: fmt(sum(visible, 'q7')), color: '#101828' },
        { k: 'In a dry spell', v: fmt(d) + ' (' + pct + '%)', color: this.cls(pct).color },
        { k: 'Active in the last 24 h', v: fmt(rings.length) + (rings.length === 1 ? ' area' : ' areas'), color: '#101828' },
        { k: 'Drought alert subscribers', v: fmt(sum(visible, 'alerts')), color: '#101828' }],
        note: visible.length ? 'Select a pin for that area. FarmLine works anywhere: NASA POWER covers every point on land.' : 'No farmers here yet. FarmLine works anywhere: NASA POWER covers every point on land.' };
    }
    const noPins = visible.length === 0, noPinsText = P.length ? 'No farmers in ' + REG[view][0] + ' yet' : 'Pins appear here when farmers text or call ' + (D.number || '');

    // ---- usage ----
    const U = D.usage;
    const uKpis = [
      { label: 'New farmers this week', value: fmt(U.newFarmers || 0), sub: 'First text or call this week' },
      { label: 'Returning farmers', value: fmt(U.returning || 0), sub: 'Asked before this week too' },
      { label: 'Questions per active farmer', value: U.askers ? (K.questions / U.askers).toFixed(1) : '0', sub: 'Including follow-ups' },
      { label: 'Alert subscribers', value: fmt(K.alertSubs || 0), sub: K.registered ? Math.round(K.alertSubs / K.registered * 100) + '% of farmers' : 'Farmers who texted ALERT' }
    ];
    const funnel = U.funnel.map(([label, n], i) => { const p = U.askers ? n / U.askers : 0; return { label, w: Math.round(p * 100) + '%', op: Math.max(0.4, 1 - i * 0.12), n: fmt(n), pct: Math.round(p * 100) + '%' }; });
    const colors = [accent, '#6CA88A', '#B9D7C5', '#98A2B3', '#D0D5DD', '#E4E7EC'];
    const mix = (title, arr) => { const t = arr.reduce((a, x) => a + x[1], 0); return { title, has: t > 0, none: t === 0, parts: arr.map(([label, n], i) => ({ label, pct: Math.round(n / t * 100) + '%', w: (n / t * 100).toFixed(1) + '%', color: colors[i % colors.length] })) }; };
    const mixes = [mix('Language farmers wrote in', U.lang), mix('Channel', U.channel)];
    const regionRows = C.map((c) => ({ name: c.name, reg: fmt(c.farmers), act: fmt(c.active7), q: fmt(c.q7), dry: fmt(c.dryN), subs: fmt(c.alerts), weight: 400 }));
    if (C.length > 1) regionRows.push({ name: 'All countries', reg: fmt(C.reduce((a, c) => a + c.farmers, 0)), act: fmt(C.reduce((a, c) => a + c.active7, 0)), q: fmt(C.reduce((a, c) => a + c.q7, 0)), dry: fmt(C.reduce((a, c) => a + c.dryN, 0)), subs: fmt(C.reduce((a, c) => a + c.alerts, 0)), weight: 700 });

    // ---- advice ----
    const A = D.advice;
    const aKpis = [
      { label: 'Plans delivered this week', value: fmt(A.plans || 0), sub: 'Each one 3 crop rotations from the engine' },
      { label: 'Water use of opened plans', value: A.avgSaving == null ? '–' : this.signed(-A.avgSaving), sub: A.avgSaving == null ? 'Shows once farmers open plans' : 'Average water use vs the current crop (engine estimate)' },
      { label: 'Plans opened', value: fmt(A.opened || 0), sub: 'Farmers who replied 1, 2 or 3' }
    ];
    const choice = A.choice.map((c) => { const t = c.r[0] + c.r[1] + c.r[2] || 1; const p = (n) => Math.round(n / t * 100) + '%'; return { name: c.name, a: p(c.r[0]), b: p(c.r[1]), c: p(c.r[2]) }; });
    const cmax = Math.max(1, ...A.crops.map((c) => c[1]));
    const topics = A.crops.map(([label, n]) => ({ label, n, w: Math.round(n / cmax * 100) + '%' }));

    // ---- health ----
    const H = D.health;
    const E = H.engine;
    const hKpis = [
      { label: 'Median reply time', value: H.answers ? (H.median / 1000).toFixed(1) + ' s' : '–', sub: H.answers ? '95% within ' + (H.p95 / 1000).toFixed(1) + ' s' : 'No answers this week yet', color: '#101828' },
      { label: 'Rotation engine', value: E.connected ? (E.asked ? Math.round(E.ok / E.asked * 100) + '%' : 'Ready') : 'Off', sub: E.connected ? (E.asked ? 'answered in time, ' + E.ms + ' ms average (Vultr)' : 'Connected, no questions yet') : 'Not connected yet', color: E.connected ? '#05603A' : '#B54708' },
      { label: 'Translated by Gemini', value: fmt(H.translated || 0), sub: H.foreign ? 'of ' + H.foreign + ' messages in other languages, numbers checked' : 'No messages in other languages yet', color: '#101828' },
      { label: 'Answered by the library', value: fmt(H.libAnswered || 0), sub: H.libAsked ? 'of ' + H.libAsked + ' questions searched in Vectorize' : 'Questions that aren\'t about a place', color: '#101828' },
      { label: 'Places not found', value: fmt(H.notFound || 0), sub: 'Farmer was asked for a ZIP, PIN or town', color: '#101828' },
      { label: 'NASA readings in Tiger Data', value: H.tiger && H.tiger.connected ? fmt(H.tiger.rows) : 'Off', sub: H.tiger && H.tiger.connected ? (H.tiger.error ? 'Connection problem: ' + H.tiger.error : H.tiger.places + ' places; ' + H.tiger.days.length + ' days in the last 2 weeks (time_bucket)') : 'Not connected yet', color: H.tiger && H.tiger.connected && !H.tiger.error ? '#05603A' : '#B54708' },
      { label: 'Errors', value: fmt(H.errors || 0), sub: 'Farmer was asked to try again', color: H.errors ? '#B42318' : '#05603A' }
    ];
    const feeds = H.feeds.map((f) => Object.assign({}, f, { latest: f.latest ? this.when(f.latest) : (f.on ? 'Not used yet' : '–'), status: f.on ? 'Ready' : 'Off', fg: f.on ? '#05603A' : '#93370D', bg: f.on ? '#D1FADF' : '#FEF0C7' }));
    const events = H.events.map((e) => ({ time: this.when(e.ts), text: e.text }));
    const reports = (H.reports || []).map((r) => ({ date: new Date(r.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), towns: fmt(r.towns), dry: fmt(r.dry), dryColor: r.dry ? '#B42318' : '#05603A', kb: (r.size / 1024).toFixed(1) + ' KB', href: '/admin/reports/' + r.date + '.csv' }));
    const noReports = reports.length === 0, noReportsText = H.r2 ? 'No reports yet. The first one is saved at the next daily check, or make one now.' : 'R2 isn\'t connected yet: create the farmline-reports bucket and deploy.';

    // ---- conversations ----
    const langSet = Array.from(new Set(D.log.map((r) => r.lang)));
    const langTabs = [['all', 'All']].concat(langSet.map((l) => [l, l])).map(([id, label]) => Object.assign({ label, pressed: st.lang === id ? 'true' : 'false', pick: () => this.setState({ lang: id }) }, pill(st.lang === id)));
    const q = st.q.trim().toLowerCase().replace(/[^\p{L}\p{N}+ ]/gu, '');
    const logF = D.log.filter((r) => (st.lang === 'all' || r.lang === st.lang) && (!q || [r.area, r.asked || '', r.outcome, r.crop || '', r.phoneFull.replace(/\D/g, ''), r.phoneFull].join(' ').toLowerCase().includes(q.replace(/^\+/, ''))));
    const shown = logF.slice(0, 80);
    const best = shown.find((r) => r.tr && r.tr.weather) || shown[0];
    const recId = st.rec && logF.some((r) => r.id === st.rec) ? st.rec : (best && best.id);
    const ph = (r) => st.nums ? r.phoneFull : r.phone;
    const log = shown.map((r) => { const sel = recId === r.id; return { area: r.area, time: this.when(r.ts), gloss: r.asked == null ? '(FarmLine wrote first)' : (r.asked || '(silence on the call)'), lang: r.lang, channel: r.channel, outcome: r.outcome, outColor: ['busy', 'not_found'].includes(r.outcomeId) ? '#B42318' : '#344054', phone: ph(r), pressed: sel ? 'true' : 'false', bg: sel ? '#F6FAF7' : '#FFFFFF', bar: sel ? accent : 'transparent', pick: () => this.setState({ rec: r.id }) }; });
    const logInfo = 'Showing ' + shown.length + ' of ' + logF.length + ' conversations from the last 30 days';
    const R = D.log.find((r) => r.id === recId);
    let rec = {}, t = { facts: [], data: [], options: [] }, steps = [];
    if (R) {
      const tr = R.tr || {};
      const lib = tr.library;
      const sameFarmer = D.log.filter((r) => r.phoneFull === R.phoneFull).length;
      const r1 = (x) => Math.round(x * 10) / 10;
      const has3d = tr.lat != null && tr.lon != null;
      rec = { has3d, lat: has3d ? r1(tr.lat) : '', lon: has3d ? r1(tr.lon) : '', label3d: 'Where this ' + (R.channel === 'Voice call' ? 'call' : R.channel === 'Drought alert' ? 'alert' : 'message') + ' came from · within about 10 km · NASA imagery on 3D terrain', area: R.area, time: this.when(R.ts), channel: R.channel, lang: R.lang, langCode: R.langCode, phone: ph(R), askedLabel: R.asked == null ? 'FarmLine sent on its own' : 'Farmer asked', asked: R.asked == null ? 'Daily NASA rain check found a dry spell.' : (R.asked || '(no words on the call)'), outcome: R.outcome, farmerNote: sameFarmer > 1 ? sameFarmer + ' messages with this farmer in the last 30 days.' : 'First message from this farmer.' };
      const facts = [];
      if (tr.detected) facts.push({ k: 'Language read', v: ({ en: 'English', hi: 'Hindi', ur: 'Urdu', sw: 'Swahili', roman: 'Roman Hindi/Urdu', other: 'Other (Gemini)' })[tr.detected] || tr.detected });
      facts.push({ k: 'Replied in', v: R.lang + (tr.translated ? ' (Gemini)' : '') });
      if (tr.via) facts.push({ k: 'Farm found by', v: ({ pk_town: 'Pakistan town list', postal: 'ZIP / PIN code', town_name: 'Town name', keypad: 'Code on the call', speech: 'Town spoken' })[tr.via] + (tr.lookup ? ' "' + tr.lookup + '"' : '') });
      if (tr.lat != null) facts.push({ k: 'Coordinates', v: tr.lat.toFixed(3) + ', ' + tr.lon.toFixed(3) });
      if (R.crop) facts.push({ k: 'Crop now', v: R.crop });
      if (tr.plan) facts.push({ k: 'Plan asked about', v: String(tr.plan) });
      if (tr.flow) facts.push({ k: 'Menu step', v: tr.flow.from + ' → ' + tr.flow.to });
      if (tr.ai) facts.push({ k: 'Answered by', v: 'Workers AI (' + tr.ai.model + ')' });
      const data = [];
      if (tr.weather) { const w = tr.weather; const p = w.rainPct;
        data.push({ name: 'NASA POWER', value: 'Rain ' + w.rain30mm + ' mm, last ' + w.days + ' days', context: p == null ? 'No normal to compare with' : p + '% of the long-term normal (' + w.normal30mm + ' mm)' + (p < 50 ? ': a dry spell' : p > 120 ? ': wetter than normal' : ''), valueColor: p != null && p < 50 ? '#B42318' : '#101828' });
        data.push({ name: 'NASA POWER', value: 'Average high ' + w.avgHighC + ' °C', context: 'Daily maximum temperature over the same days', valueColor: '#101828' });
        if (w.soilPct != null) data.push({ name: 'NASA POWER', value: 'Soil moisture ' + w.soilPct + '%', context: 'Root-zone soil wetness on the latest day (0% dry, 100% saturated)', valueColor: w.soilPct < 35 ? '#B42318' : '#101828' }); }
      if (tr.forecast) data.push({ name: 'Rain forecast', value: tr.forecast.next7mm + ' mm in 7 days', context: 'Open-Meteo forecast (NASA POWER has no forecast); ' + tr.forecast.next3mm + ' mm in the next 3 days', valueColor: '#101828' });
      const eng = tr.engine;
      const tag = { water: 'Least water', income: 'Most income', drought: 'Safest in drought' };
      const opts = eng && eng.options ? eng.options.map((o, i) => ({ num: i + 1, tag: tag[o.kind] || o.kind, seq: o.rotation.join(' → '), water: this.signed(-o.water_saving_pct), income: this.signed(o.income_change_pct), bad: this.signed(o.bad_year_income_change_pct), badColor: o.bad_year_income_change_pct < 0 ? '#B42318' : '#05603A' })) : [];
      const why = !eng ? '' : eng.status === 'answered' ? 'The Vultr engine answered in ' + eng.ms + ' ms. Water use and income are compared with the farmer\'s current crop; "Bad year" is income in a dry year.' : eng.status === 'no_answer' ? 'The engine didn\'t answer within 6 seconds (' + eng.ms + ' ms), so the farmer got the NASA weather only.' : 'The rotation engine isn\'t connected yet, so the farmer got the NASA weather only.';
      const libMin = 0.55;
      const hits = lib ? lib.hits.map((h, i) => ({ title: h.title, source: h.source, score: Math.round(h.score * 100) + '%', color: h.score >= libMin ? '#05603A' : '#475467', weight: i === 0 && lib.answered ? 700 : 400 })) : [];
      const libNote = 'Workers AI (bge-m3) turned the question into a vector and Cloudflare Vectorize found the closest answers by meaning, in any language. Only a match of ' + Math.round(libMin * 100) + '% or more is sent' + (lib && lib.answered ? '; the reply names its source.' : '.');
      const heardText = tr.heard ? (tr.heard.text || '(silence)') : '';
      const heardNote = 'The farmer spoke freely after the beep. Workers AI (' + (tr.heard ? tr.heard.model : 'Whisper') + ') turned the recording into text in ' + (tr.heard ? tr.heard.ms : 0) + ' ms; the recording was then deleted from Twilio. FarmLine keeps only the words.';
      t = { heardText, heardNote, hits, libNote, facts, data, options: opts, hasOptions: opts.length > 0, why, langCode: R.langCode, reply: R.answer,
        checker: tr.translated ? 'Gemini rewrote the English reply in the farmer\'s language. Every number was compared with the original before sending; a reply with a changed number is thrown away.' : (R.tr && R.tr.detected === 'other' ? 'Gemini wasn\'t available, so the English template was sent.' : 'Written from the built-in ' + R.lang + ' reply pack. Numbers are put in directly from NASA and the engine, so they can\'t change.') };
      const defs = [];
      if (tr.heard) defs.push(['heard', 'Heard the call (Whisper)', (tr.heard.text ? '"' + (tr.heard.text.length > 40 ? tr.heard.text.slice(0, 40) + '…' : tr.heard.text) + '"' : 'Nothing heard') + ' · ' + tr.heard.ms + ' ms']);
      defs.push(['facts', 'Understood the request', facts.slice(0, 3).map((x) => x.v).join(' · ')]);
      if (data.length) defs.push(['data', 'Checked NASA data', data[0].context.split(':')[0]]);
      if (lib) defs.push(['library', 'Searched the farming library', lib.hits.length ? (lib.answered ? 'Best match: ' + lib.hits[0].title : 'No close match, sent how to ask') + ' · ' + lib.ms + ' ms' : 'Library not indexed yet']);
      if (eng) defs.push(['engine', 'Rotation engine', eng.status === 'answered' ? opts.length + ' plans in ' + eng.ms + ' ms' : eng.status === 'no_answer' ? 'Timed out, sent weather only' : 'Not connected yet']);
      if (R.asked !== null || R.outcomeId === 'alert') defs.push(['check', 'Kept the numbers right', tr.translated ? 'Gemini reply, numbers checked' : 'Built-in reply pack']);
      defs.push(['sent', 'Sent by ' + R.channel, R.segs + (tr.ms ? ' · ready in ' + (tr.ms / 1000).toFixed(1) + ' s' : '')]);
      steps = defs.map(([id, title, summary], i) => { const open = st.step === id; return { num: i + 1, title, summary, expanded: open ? 'true' : 'false', icon: open ? '−' : '+', bg: open ? '#F9FAFB' : '#FFFFFF', isFacts: open && id === 'facts', isData: open && id === 'data', isEngine: open && id === 'engine', isCheck: open && id === 'check', isLibrary: open && id === 'library', isHeard: open && id === 'heard', isSent: open && id === 'sent', toggle: () => this.setState({ step: open ? null : id }) }; });
    }

    const setNums = (v) => { this.setState({ nums: v }); try { sessionStorage.setItem('fl_nums', v ? '1' : '0'); } catch (e) {} };
    return {
      accent, navItems, pageTitle: titles[0], pageSub: titles[1], range: D.range || '', number: D.number || '', admin: BOOT.admin,
      statusDot: E.connected ? '#12B76A' : '#F79009', statusText: E.connected ? 'Engine connected' : 'Engine not connected yet',
      numsLabel: st.nums ? 'Hide phone numbers' : 'Show phone numbers', numsPressed: st.nums ? 'true' : 'false', numsBg: st.nums ? '#EEF4F0' : '#FFFFFF', toggleNums: () => setNums(!st.nums),
      noTable: BOOT.data && BOOT.data.ok === false, empty: BOOT.data && BOOT.data.ok !== false && D.log.length === 0,
      totalL: fmt(K.registered || 0),
      isOverview: st.page === 'overview', isUsage: st.page === 'usage', isAdvice: st.page === 'advice', isHealth: st.page === 'health', isConvs: st.page === 'convs',
      kpis, days, dayMax: String(dmax), dayMid: String(dmax / 2), zoom, viewTabs, pins, rings, pinLabels, noPins, noPinsText, area, hasUnit: !!pSel, closeUnit: () => this.setState({ place: null }),
      uKpis, funnel, askers: fmt(U.askers || 0), mixes, regionRows,
      aKpis, noEngine: !E.connected, choice, noChoice: choice.length === 0, topics, noTopics: topics.length === 0, shifts: A.shifts, noShifts: A.shifts.length === 0,
      hKpis, feeds, events, noEvents: events.length === 0, reports, noReports, noReportsText, r2: !!H.r2,
      q: st.q, onSearch: (e) => this.setState({ q: e.target.value }), langTabs, log, noLog: log.length === 0, logInfo,
      hasRec: !!R, noRec: !R, rec, t, steps
    };
  }
}
const app = mountDC(Component, document.getElementById('root'), { accent: '#1B5E3F' });
addEventListener('resize', () => app.setState({}));

// ---- 3D view of a farm area: NASA GIBS satellite imagery draped on terrain, in MapLibre GL ----
(function () {
  const root = document.getElementById('root');
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let map = null, marker = null, cur = '', loading = null, spinning = !reduce, last = 0;
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const gibs = (layer, date, level, ext) => 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + layer + '/default/' + date + '/GoogleMapsCompatible_' + level + '/{z}/{y}/{x}.' + ext;
  const load = () => loading || (loading = new Promise((res, rej) => {
    if (window.maplibregl) return res();
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'; document.head.appendChild(l);
    const sc = document.createElement('script'); sc.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc);
  }));
  const style = () => ({
    version: 8,
    sources: {
      modis: { type: 'raster', tiles: [gibs('VIIRS_NOAA20_CorrectedReflectance_TrueColor', day(2), 'Level9', 'jpg')], tileSize: 256, maxzoom: 9, attribution: 'NASA GIBS · VIIRS NOAA-20' },
      marble: { type: 'raster', tiles: [gibs('BlueMarble_NextGeneration', '2004-08-01', 'Level8', 'jpeg')], tileSize: 256, maxzoom: 8, attribution: 'NASA Blue Marble' },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: 'Terrain: AWS Terrain Tiles' },
      shade: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 12 }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0B1430' } },
      { id: 'modis', type: 'raster', source: 'modis', paint: { 'raster-saturation': 0.15, 'raster-contrast': 0.1 } },
      { id: 'marble', type: 'raster', source: 'marble', layout: { visibility: 'none' } },
      { id: 'relief', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': '#1B1511', 'hillshade-highlight-color': '#FFF6DA' } }
    ],
    terrain: { source: 'dem', exaggeration: 1.8 },
    sky: { 'sky-color': '#18244F', 'horizon-color': '#9DB8D9', 'fog-color': '#DCE7F2', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 }
  });
  // Image switch: latest NASA satellite day (may have clouds) or the cloud-free NASA Blue Marble.
  const ctl = document.createElement('div');
  ctl.style.cssText = 'position:absolute;left:10px;top:10px;z-index:3;display:flex;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.35);font:600 11.5px Inter,sans-serif';
  const mk = (id, label) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.id = id; b.style.cssText = 'border:0;padding:5px 9px;cursor:pointer;font:inherit'; b.onclick = () => pick(id); ctl.appendChild(b); return b; };
  const bM = mk('modis', 'NASA, ' + day(2)), bB = mk('marble', 'Cloud-free');
  function pick(id) {
    [bM, bB].forEach((b) => { const on = b.dataset.id === id; b.style.background = on ? '#EBC774' : 'rgba(11,20,48,.75)'; b.style.color = on ? '#1B1511' : '#EEF1EA'; b.setAttribute('aria-pressed', String(on)); });
    if (map && map.getLayer('modis')) { map.setLayoutProperty('modis', 'visibility', id === 'modis' ? 'visible' : 'none'); map.setLayoutProperty('marble', 'visibility', id === 'marble' ? 'visible' : 'none'); }
  }
  box.appendChild(ctl); pick('modis');
  function spin(t) {
    if (map && spinning && document.getElementById('fl3d-slot')) { if (last) map.setBearing((map.getBearing() + (t - last) * 0.004) % 360); }
    last = t; requestAnimationFrame(spin);
  }
  function sync() {
    const slot = document.getElementById('fl3d-slot');
    if (!slot) return;
    if (box.parentNode !== slot) slot.appendChild(box);
    const lat = Number(slot.dataset.lat), lon = Number(slot.dataset.lon);
    if (!isFinite(lat) || !isFinite(lon) || slot.dataset.lat === '') return;
    const key = lat + ',' + lon;
    load().then(() => {
      if (!map) {
        map = new maplibregl.Map({ container: box, style: style(), center: [lon, lat], zoom: 9.2, pitch: 70, bearing: -20, maxPitch: 80, attributionControl: { compact: true } });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        const el = document.createElement('div');
        el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#EBC774;border:3px solid #FFFFFF;box-shadow:0 0 0 6px rgba(235,199,116,.35),0 2px 8px rgba(0,0,0,.5)';
        marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
        map.on('load', () => { const a = box.querySelector('.maplibregl-ctrl-attrib'); if (a) a.classList.remove('maplibregl-compact-show'); });
        ['mousedown', 'touchstart', 'wheel'].forEach((ev) => box.addEventListener(ev, () => { spinning = false; }, { passive: true }));
        requestAnimationFrame(spin);
      } else {
        map.resize();
        if (key !== cur) { map.flyTo({ center: [lon, lat], zoom: 9.2, pitch: 70, duration: reduce ? 0 : 2600, essential: true }); marker.setLngLat([lon, lat]); spinning = !reduce; }
      }
      cur = key;
    }).catch(() => { slot.textContent = ''; const p = document.createElement('p'); p.textContent = 'The 3D view needs internet access to load NASA imagery.'; p.style.cssText = 'margin:0;padding:16px;color:#EEF1EA;font-size:13px'; slot.appendChild(p); });
  }
  new MutationObserver(sync).observe(root, { childList: true });
  sync();
})();

`;
