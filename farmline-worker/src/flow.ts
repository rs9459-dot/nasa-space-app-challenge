// The SMS menu flow. Every farmer has a saved step (in their Durable Object), so a reply of "1" always means
// the right thing for that step. Keywords (MENU, LANG, WHY, STOP, START, STOP ALERTS, ALERT) work from any step.
//
//   Language -> Location -> Confirm -> Menu
//     1 Plan 3 years: Crop -> Water -> (Water outlook) -> Soil -> Plans -> Details / WHY
//     2 Alerts:       drought + heavy-rain (flood) alerts on
//     3 Ask anything: farming library (Vectorize), then a cautious AI answer
//
// A first message that already names a place ("alfalfa 89406 water is short") still gets an answer at once.
import { forecastFor, placeForCode, placeForName, weatherFor } from "./data";
import { askEngine, type EngineAsk } from "./engine";
import { fallbackPlans, isCover, isHeavy, legumesIn, sowKey, waterSaving } from "./rotation";
import { FLOW, LANG_MENU, signed, type FlowLang } from "./flow_text";
import { PACKS } from "./i18n";
import { askLibrary, libraryReply, type LibraryHit } from "./library";
import { findPlace } from "./place";
import { buildSms, cropName, detectLang, findCrop, findPostalCode, footer, replyLang } from "./reply";
import { displayName, logQuery, rainPct, setAlerts, upsertFarmer, weatherTrace } from "./store";
import { translateReply } from "./translate";
import type { EngineOption, Env, Lang, Place, Trace } from "./types";

type Step = "lang" | "location" | "confirm" | "village" | "menu" | "crop" | "water" | "outlook" | "soil" | "priority" | "plans" | "ask";

export interface Flow {
  step: Step;
  lang: FlowLang;
  at?: string; // last message time
  place?: Place;
  pending?: Place; // place waiting for "Is your farm near ...?"
  country?: string; // country code the farmer named, for village search
  crop?: string | null;
  irrigated?: boolean;
  outlook?: "same" | "less" | "much_less";
  priority?: "water" | "income" | "safe";
  soil?: "good" | "tired" | "unknown";
  rainPct?: number | null; // NASA rain vs normal when the plans were made, for WHY
  options?: EngineOption[] | null;
  why?: string; // explanation for the farmer's next WHY
  stopped?: boolean;
}

export interface FlowResult {
  text: string; // reply sent now ("" = no reply)
  outcome: string;
  flow: Flow;
  lang: Lang;
  trace: Trace;
  place?: Place | null;
  crop?: string | null;
  later?: () => Promise<{ text: string; outcome: string; trace: Trace; flow: Flow } | null>; // second SMS (plans)
}

const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(india|bharat)\b|भारत/, "in"], [/\b(usa|u\.s\.a?\.?|united states|america|us)\b/, "us"], [/\bkenya\b/, "ke"], [/\btanzania\b/, "tz"],
  [/\buganda\b/, "ug"], [/\bpakistan\b/, "pk"], [/\bnigeria\b/, "ng"], [/\bghana\b/, "gh"], [/\bethiopia\b/, "et"], [/\bmexico\b/, "mx"],
  [/\bbrazil\b/, "br"], [/\bbangladesh\b/, "bd"], [/\bnepal\b/, "np"], [/\brwanda\b/, "rw"], [/\bmalawi\b/, "mw"], [/\bzambia\b/, "zm"],
];
const COUNTRY_NAME: Record<string, string> = {
  in: "India", us: "USA", ke: "Kenya", tz: "Tanzania", ug: "Uganda", pk: "Pakistan", ng: "Nigeria", gh: "Ghana", et: "Ethiopia",
  mx: "Mexico", br: "Brazil", bd: "Bangladesh", np: "Nepal", rw: "Rwanda", mw: "Malawi", zm: "Zambia", es: "Spain", ar: "Argentina",
};
const placeLabel = (p: Place) => (COUNTRY_NAME[p.country] && !p.name.includes(COUNTRY_NAME[p.country]) ? `${p.name}, ${COUNTRY_NAME[p.country]}` : p.name);
export const shortPlace = (p: Place) => p.name.split(",")[0];

const norm = (s: string) => s.toLowerCase().replace(/[.!?।,]+/g, " ").replace(/\s+/g, " ").trim();
const KW = {
  stopAlerts: /^(stop alerts?|alerts? off|अलर्ट बंद( करें)?|zima tahadhari)$/,
  stop: /^(stop|stopall|unsubscribe|रोकें|बंद करें|acha|sitisha)$/,
  start: /^(start|unstop|शुरू|anza)$/,
  menu: /^(menu|मेनू|menyu)$/,
  lang: /^(lang|language|भाषा|lugha)$/,
  why: /^(why|क्यों|kwa nini|kwanini)$/,
  alerts: /^(alerts?|alert on|अलर्ट|tahadhari)$/,
  hello: /^(hi+|hello|hey|hola|namaste|namaskar|नमस्ते|नमस्कार|habari|jambo|hujambo|salaam|start over)$/,
  restart: /^(restart|reset)$/,
};
const digit = (s: string) => (/^\s*[1-9]\s*[.)]?\s*$/.test(s) ? Number(s.trim()[0]) : 0);
const yes = /^(yes|y|haan|हाँ|हां|ndiyo|ndio)$/, no = /^(no|n|nahi|नहीं|hapana)$/;
export const toFlowLang = (l: Lang): FlowLang => (l === "hi" || l === "sw" ? l : "en");
const RETURN_AFTER_MS = 12 * 3600e3;

/** Pick a language from "1/2/3" or a language word. */
function langChoice(text: string): FlowLang | null {
  const d = digit(text);
  if (d === 1) return "en";
  if (d === 2) return "hi";
  if (d === 3) return "sw";
  const k = norm(text);
  if (/^(english|angrezi|अंग्रेज़ी)$/.test(k)) return "en";
  if (/^(hindi|हिंदी|हिन्दी)$/.test(k)) return "hi";
  if (/^(kiswahili|swahili)$/.test(k)) return "sw";
  return null;
}

/** "India 413512", "Kenya Nakuru", "89406" or "Latur" -> a place to confirm. */
async function parseLocation(env: Env, text: string, lang: FlowLang): Promise<{ place: Place | null; country?: string; via?: Trace["via"]; lookup?: string }> {
  const k = norm(text);
  const hit = COUNTRY_WORDS.find(([re]) => re.test(k));
  const country = hit?.[1];
  // Keep the farmer's own spelling of the town; only remove the country word.
  const rest = (hit ? text.replace(new RegExp(hit[0].source, "i"), " ") : text).replace(/[.!?।,]+/g, " ").replace(/\s+/g, " ").trim();
  const code = findPostalCode(rest);
  if (code) {
    const place = await placeForCode(env, code).catch(() => null);
    if (place) return { place, country: place.country, via: "postal", lookup: code };
  }
  const name = rest.replace(/\d+/g, " ").trim();
  if (name.length >= 3) {
    const place = await placeForName(env, name, country).catch(() => null);
    if (place) return { place, country: country ?? place.country, via: "town_name", lookup: name };
  }
  if (!hit) {
    const r = await findPlace(env, text, lang === "en" ? detectLang(text) : lang);
    if (r.place) return { place: r.place, country: r.place.country, via: r.via, lookup: r.lookup };
  }
  return { place: null, country };
}

/** Plans SMS: "3 plans for the next 3 years: 1) A > B > C: least water ..." */
export function plansText(lang: FlowLang, options: EngineOption[]): string {
  const L = FLOW[lang];
  const lines = [L.plansHead];
  options.slice(0, 3).forEach((o, i) => lines.push(`${i + 1}) ${o.rotation.map((c) => cap(cropName(c, lang))).join(" > ")}: ${L.kind[o.kind] ?? o.kind}${legumesIn(o.rotation).length >= 2 ? L.buildsSoil : ""}`));
  lines.push(L.plansFoot);
  return lines.join("\n");
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Details of one plan: when to sow each year, water against the current crop, and (engine plans) income. */
export function detailsText(f: Flow, n: number): string | null {
  const o = f.options?.[n - 1];
  if (!o) return null;
  const L = FLOW[f.lang];
  const lat = f.place?.lat ?? 40;
  const rot = o.rotation.map((c) => cap(cropName(c, f.lang))).join(" > ");
  const lines = [`${PACKS[f.lang].plan} ${n}: ${rot}`];
  o.rotation.slice(0, 3).forEach((crop, i) => lines.push(L.year(i + 1, cap(cropName(crop, f.lang)) + (isCover(crop) ? L.coverSuffix : ""), L.sow[sowKey(crop, lat)])));
  const current = f.crop ? cropName(f.crop, f.lang) : null;
  const pct = o.builtIn ? waterSaving(o.rotation, f.crop ?? null) : Math.round(o.water_saving_pct);
  const nitro = legumesIn(o.rotation).length ? (f.soil === "tired" ? 2 : 1) : 0;
  const w = L.planWater(pct, current, nitro);
  if (w) lines.push(w);
  if (!o.builtIn && Number.isFinite(o.income_change_pct)) lines.push(L.money(signed(o.income_change_pct), signed(o.bad_year_income_change_pct)));
  lines.push(L.detailFoot);
  return lines.join("\n");
}

/** WHY for one plan: soil nitrogen after a heavy crop, NASA rain here, and water against the current crop. */
export function planWhy(f: Flow, o: EngineOption): string {
  const L = FLOW[f.lang];
  const parts: string[] = [];
  const legs = legumesIn(o.rotation).map((c) => cropName(c, f.lang));
  const current = f.crop ? cropName(f.crop, f.lang) : null;
  if (legs.length && current && isHeavy(f.crop ?? null)) parts.push(L.afterCrop(current), L.legumesAdd(cap(legs.join(L.and))));
  if (f.place && f.rainPct !== null && f.rainPct !== undefined) parts.push(L.whyRain(shortPlace(f.place), f.rainPct));
  const pct = o.builtIn ? waterSaving(o.rotation, f.crop ?? null) : o.water_saving_pct;
  if (current && pct !== null && pct >= 5) parts.push(L.lessWater(current));
  else parts.push(L.whyKind[o.kind]);
  if (o.why && f.lang === "en") parts.push(o.why);
  return parts.join(" ");
}

const KIND_FOR: Record<NonNullable<Flow["priority"]>, EngineOption["kind"]> = { water: "water", income: "income", safe: "drought" };

/** Option 2: NASA soil moisture and recent rain, plus the 7-day rain forecast. */
async function sowAdvice(env: Env, f: Flow, trace: Trace): Promise<{ text: string; why: string }> {
  const L = FLOW[f.lang];
  const p = f.place!;
  const [w, fc] = await Promise.all([weatherFor(env, p.lat, p.lon), forecastFor(env, p.lat, p.lon).catch(() => null)]);
  trace.weather = weatherTrace(w);
  const pct = rainPct(w);
  const soil = w.soilRoot;
  const dry = (pct !== null && pct < 80) || (soil !== undefined && soil < 0.35);
  const wet = (pct !== null && pct > 120) || (soil !== undefined && soil > 0.7);
  const name = shortPlace(p);
  const lines = [dry ? L.soilDrier(name) : wet ? L.soilWetter(name) : L.soilNormal(name)];
  if (soil !== undefined) lines.push(L.soilPct(Math.round(soil * 100)));
  if (fc) {
    (trace as any).forecast = { next7mm: Math.round(fc.next7mm), next3mm: Math.round(fc.next3mm) };
    lines.push(fc.next7mm < 2 ? L.noRain : L.rainMm(Math.round(fc.next7mm)));
    lines.push(fc.next7mm >= 15 ? L.rainComing : dry ? L.wait : L.ok);
  } else {
    lines.push(L.forecastDown, dry ? L.wait : L.ok);
  }
  lines.push(L.moreFoot);
  logQuery(env, "sms", f.lang, p, f.crop ?? null, w).catch(() => {});
  return { text: lines.join("\n"), why: pct !== null ? L.whyRain(name, pct) : L.noWhy };
}

/** Option 4: farming library first; if nothing is close, a short, careful AI answer grounded in the library and NASA data. */
async function answerQuestion(env: Env, question: string, f: Flow, trace: Trace): Promise<{ text: string; outcome: string }> {
  const L = FLOW[f.lang];
  const lib = await askLibrary(env, question);
  if (lib.hits.length || lib.ms) trace.library = { answered: Boolean(lib.entry), ms: lib.ms, hits: lib.hits };
  const inLang = async (english: string) => {
    if (f.lang === "en") return english;
    const out = await translateReply(env, question, english);
    trace.translated = out !== english;
    return out;
  };
  if (lib.entry) return { text: `${await inLang(libraryReply(lib.entry))}\n${L.moreFoot}`, outcome: "library" };
  if (!env.AI) return { text: L.notUnderstood, outcome: "not_understood" };
  try {
    let nasa = "";
    if (f.place) {
      const w = await weatherFor(env, f.place.lat, f.place.lon).catch(() => null);
      const pct = w ? rainPct(w) : null;
      if (pct !== null) nasa = `NASA data: rain in the last 30 days near ${shortPlace(f.place)} was ${pct}% of normal.`;
    }
    const notes = lib.hits.slice(0, 3).map((h: LibraryHit) => `- ${h.title} (${h.source})`).join("\n");
    const out = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
      messages: [
        { role: "system", content: "You are FarmLine, an SMS farming helper for small farmers. Reply in plain English in at most 2 short sentences, under 280 characters. Give only general, widely accepted farming advice. Never invent numbers, product names, doses or prices. If you are not sure, say so and suggest asking the local agriculture office." },
        { role: "user", content: `Farmer's question: ${question}\nFarm area: ${f.place ? placeLabel(f.place) : "unknown"}${f.crop ? `\nCrop: ${f.crop}` : ""}\n${nasa}\nRelated topics in our library:\n${notes || "- none"}` },
      ],
      max_tokens: 160,
    })) as { response?: string };
    const answer = (out.response ?? "").trim().replace(/\s+/g, " ").slice(0, 320);
    if (!answer) return { text: L.notUnderstood, outcome: "not_understood" };
    (trace as any).ai = { model: "llama-3.1-8b-instruct" };
    return { text: `${await inLang(`FarmLine: ${answer}\nGeneral advice; check with your local agriculture office.`)}\n${L.moreFoot}`, outcome: "ai_answer" };
  } catch (e) {
    console.error("AI answer failed", e);
    return { text: L.notUnderstood, outcome: "not_understood" };
  }
}

/** First message that already names a place: answer at once (the original one-message FarmLine). */
async function shortcut(env: Env, from: string, body: string, prev: Flow | null, trace: Trace, started: number): Promise<FlowResult | null> {
  const detected = detectLang(body);
  const found = await findPlace(env, body, detected);
  if (!found.place) return null;
  const place = found.place;
  const lang = replyLang(detected, place);
  const crop = findCrop(body);
  Object.assign(trace, { detected, via: found.via, lookup: found.lookup, lat: place.lat, lon: place.lon });
  const [weather, { options, engine }] = await Promise.all([weatherFor(env, place.lat, place.lon), askEngine(env, place, crop, body)]);
  trace.weather = weatherTrace(weather);
  trace.engine = engine;
  let text = `${buildSms(place, weather, lang, crop, options)}\n${footer(lang, Boolean(options?.length))}`;
  if (detected === "other") {
    const out = await translateReply(env, body, text);
    trace.translated = out !== text;
    text = out;
  }
  await upsertFarmer(env, from, lang, place, crop).catch((e) => console.error("farmer save failed", e));
  logQuery(env, "sms", lang, place, crop, weather).catch(() => {});
  const fl = toFlowLang(lang);
  const pct = rainPct(weather);
  const flow: Flow = {
    ...(prev ?? {}), step: options?.length ? "plans" : "menu", lang: prev?.lang ?? fl, place, crop, options,
    why: pct !== null ? FLOW[fl].whyRain(shortPlace(place), pct) : prev?.why,
  };
  trace.ms = Date.now() - started;
  return { text, outcome: options?.length ? "plans" : "weather", flow, lang, trace, place, crop };
}

/** Ask the engine (or use built-in rotations) for the farmer's 3 plans. Shared by SMS and the phone call. */
export async function computePlans(env: Env, snapshot: Flow, timeoutMs: number): Promise<{ text: string; outcome: string; trace: Trace; flow: Flow }> {
  const t: Trace = { lat: snapshot.place!.lat, lon: snapshot.place!.lon };
  const ask: EngineAsk = { irrigated: snapshot.irrigated, water_outlook: snapshot.outlook, priority: snapshot.priority, timeoutMs };
  const [w, { options, engine }] = await Promise.all([
    weatherFor(env, snapshot.place!.lat, snapshot.place!.lon).catch(() => null),
    askEngine(env, snapshot.place!, snapshot.crop ?? null, `${snapshot.crop ?? ""} irrigated=${snapshot.irrigated} outlook=${snapshot.outlook ?? ""} priority=${snapshot.priority}`, ask),
  ]);
  t.engine = engine;
  if (w) { t.weather = weatherTrace(w); logQuery(env, "sms", snapshot.lang, snapshot.place!, snapshot.crop ?? null, w).catch(() => {}); }
  const pct = w ? rainPct(w) : null;
  // The engine only knows some fields so far: elsewhere, FarmLine's built-in rotations.
  const plans = options?.length ? options : fallbackPlans(snapshot.crop ?? null);
  if (!options?.length) (t as any).plansFrom = "built-in rotations";
  const next: Flow = { ...snapshot, options: plans, rainPct: pct, step: "plans" };
  next.why = planWhy(next, plans.find((o) => o.kind === KIND_FOR[snapshot.priority!]) ?? plans[0]);
  return { text: plansText(snapshot.lang, plans), outcome: "plans", trace: t, flow: next };
}

/** Handle one SMS. Returns the reply now and, for crop plans, a second SMS to send when the engine answers. */
export async function handleSms(env: Env, from: string, body: string, prev: Flow | null): Promise<FlowResult> {
  const started = Date.now();
  const trace: Trace = {};
  const text = body.trim();
  const k = norm(text);
  const now = new Date().toISOString();
  let f: Flow = prev ? { ...prev, at: now } : { step: "lang", lang: "en", at: now };
  const L = () => FLOW[f.lang];
  const done = (reply: string, outcome: string, extra: Partial<FlowResult> = {}): FlowResult => {
    (trace as any).flow = { from: prev?.step ?? "new", to: f.step };
    trace.ms = Date.now() - started;
    return { text: reply, outcome, flow: f, lang: f.lang, trace, place: f.place, crop: f.crop, ...extra };
  };
  const needPlace = () => { f.step = "location"; return done(L().welcome, "ask_location"); };

  // Stopped farmers only come back with START.
  if (prev?.stopped) {
    if (!KW.start.test(k)) return done("", "stopped_ignored");
    f.stopped = false;
    if (!f.place) return needPlace();
    f.step = "menu";
    return done(L().welcomeBack + L().menu, "started");
  }
  if (KW.stop.test(k)) { f.stopped = true; if (f.place) await setAlerts(env, from, false).catch(() => {}); return done(L().stopped, "stopped"); }
  if (KW.start.test(k)) { if (!f.place) return needPlace(); f.step = "menu"; return done(L().menu, "menu"); }
  if (KW.lang.test(k)) { f.step = "lang"; return done(LANG_MENU, "lang_menu"); }
  if (KW.menu.test(k)) { if (!f.place) return needPlace(); f.step = "menu"; return done(L().menu, "menu"); }
  if (KW.why.test(k)) return done(f.why ? `${f.why}\n${L().moreFoot}` : L().noWhy, f.why ? "why" : "no_why");
  if (KW.stopAlerts.test(k)) { await setAlerts(env, from, false).catch(() => {}); return done(L().alertsOff, "alerts_off"); }
  if (KW.alerts.test(k)) {
    if (!f.place) return needPlace();
    await upsertFarmer(env, from, f.lang, f.place, f.crop ?? null).catch(() => {});
    await setAlerts(env, from, true);
    f.step = "menu";
    return done(L().alertsOn, "alerts_on");
  }

  // A greeting always starts again at the language menu (the farm is kept: after the language, the menu).
  if (prev && KW.hello.test(k)) { f.step = "lang"; return done(LANG_MENU, "lang_menu"); }
  // RESTART: forget the farm and start from the beginning (handy between demo runs).
  if (prev && KW.restart.test(k)) {
    f = { step: "lang", lang: "en", at: now };
    return done(LANG_MENU, "lang_menu");
  }

  // New farmer: a message that already names a place is answered at once; anything else gets the language menu.
  if (!prev) {
    const quick = /\d{5,6}|[a-zA-Zऀ-ॿ؀-ۿ]{3,}/.test(text) ? await shortcut(env, from, text, null, trace, started) : null;
    if (quick) return quick;
    f.step = "lang";
    return done(LANG_MENU, "lang_menu");
  }

  // Returning after a long gap: welcome back to the menu (a menu number still works directly).
  const away = prev.at && Date.now() - Date.parse(prev.at) > RETURN_AFTER_MS;
  if (away && f.place && !["lang", "location", "confirm", "village"].includes(f.step) && !(digit(text) >= 1 && digit(text) <= 3)) {
    f.step = "menu";
    return done(L().welcomeBack + L().menu, "welcome_back");
  }
  if (away && f.place) f.step = "menu";

  // A ZIP / PIN code outside the place-setup steps: answer for that place at once.
  if (/\b\d{5,6}\b/.test(text) && !["location", "village", "confirm"].includes(f.step)) {
    const quick = await shortcut(env, from, text, f, trace, started);
    if (quick) return quick;
  }

  switch (f.step) {
    case "lang": {
      const lang = langChoice(text);
      // After the language, always ask where the farm is (a farmer may be somewhere new).
      if (lang) { f.lang = lang; f.step = "location"; return done(L().welcome, "welcome"); }
      const quick = await shortcut(env, from, text, f, trace, started);
      return quick ?? done(LANG_MENU, "lang_menu");
    }
    case "location":
    case "village": {
      const r = f.step === "village" ? { place: await placeForName(env, text, f.country).catch(() => null), country: f.country, via: "town_name" as const, lookup: text } : await parseLocation(env, text, f.lang);
      if (r.country) f.country = r.country;
      if (!r.place) { f.step = "village"; return done(L().notFoundPlace, "place_not_found"); }
      Object.assign(trace, { via: r.via, lookup: r.lookup, lat: r.place.lat, lon: r.place.lon });
      f.pending = r.place;
      f.step = "confirm";
      return done(L().confirm(placeLabel(r.place)), "confirm_place");
    }
    case "confirm": {
      const d = digit(text);
      if (d === 1 || yes.test(k)) {
        f.place = f.pending;
        f.pending = undefined;
        await upsertFarmer(env, from, f.lang, f.place!, f.crop ?? null).catch((e) => console.error("farmer save failed", e));
        f.step = "menu";
        return done(L().menu, "menu");
      }
      if (d === 2 || no.test(k)) { f.step = "village"; return done(L().askVillage, "ask_village"); }
      return done(L().confirm(placeLabel(f.pending!)), "confirm_place");
    }
    case "menu": {
      const d = digit(text);
      if (!f.place) return needPlace();
      if (d === 1) { f.step = "crop"; return done(L().askCrop, "ask_crop"); }
      if (d === 2) { await upsertFarmer(env, from, f.lang, f.place, f.crop ?? null).catch(() => {}); await setAlerts(env, from, true); return done(L().alertsOn, "alerts_on"); }
      if (d === 3) { f.step = "ask"; return done(L().askAnything, "ask_question"); }
      if (/[0-9]{5,6}/.test(text)) { const quick = await shortcut(env, from, text, f, trace, started); if (quick) return quick; }
      if (text.split(/\s+/).length >= 3) { const a = await answerQuestion(env, text, f, trace); return done(a.text, a.outcome); }
      return done(L().notUnderstood, "not_understood");
    }
    case "crop": {
      const found = findCrop(text);
      const crop = found === "maize" && /\bcorn\b/i.test(text) ? "corn" : found ?? (k.replace(/[^\p{L} ]/gu, "").trim().slice(0, 30) || null);
      if (!crop) return done(L().askCrop, "ask_crop");
      f.crop = crop;
      f.step = "water";
      return done(L().askWater, "ask_water");
    }
    case "water": {
      const d = digit(text);
      if (d === 1) { f.irrigated = true; f.step = "outlook"; return done(L().askOutlook, "ask_outlook"); }
      if (d === 2) { f.irrigated = false; f.outlook = undefined; f.step = "soil"; return done(L().askSoil, "ask_soil"); }
      return done(L().askWater, "ask_water");
    }
    case "outlook": {
      const d = digit(text);
      if (d >= 1 && d <= 3) { f.outlook = (["same", "less", "much_less"] as const)[d - 1]; f.step = "soil"; return done(L().askSoil, "ask_soil"); }
      return done(L().askOutlook, "ask_outlook");
    }
    case "soil":
    case "priority": {
      const d = digit(text);
      if (!(d >= 1 && d <= 3)) return done(L().askSoil, "ask_soil");
      f.soil = (["good", "tired", "unknown"] as const)[d - 1];
      // What to favour, from the answers: less water coming -> save water; tired soil -> build soil (safest); else income.
      f.priority = f.outlook === "less" || f.outlook === "much_less" ? "water" : f.soil === "tired" ? "safe" : "income";
      f.step = "plans";
      f.options = null;
      const snapshot: Flow = { ...f };
      // The engine can take a while: reply "checking" now, send the plans as a second SMS.
      const later = () => computePlans(env, snapshot, 20000);
      return done(L().checking(shortPlace(f.place!)), "checking", { later });
    }
    case "plans": {
      const d = digit(text);
      if (d >= 1 && d <= 3) {
        const det = detailsText(f, d);
        (trace as any).plan = d;
        trace.plan = d;
        if (det) { f.why = planWhy(f, f.options![d - 1]); return done(det, "details"); }
      }
      if (d === 4) { f.step = "ask"; return done(L().askAnything, "ask_question"); }
      if (text.split(/\s+/).length >= 3) { f.step = "menu"; const a = await answerQuestion(env, text, f, trace); return done(a.text, a.outcome); }
      return done(L().notUnderstood, "not_understood");
    }
    case "ask": {
      f.step = "menu";
      const a = await answerQuestion(env, text, f, trace);
      return done(a.text, a.outcome);
    }
  }
  return done(L().notUnderstood, "not_understood");
}

/** Called by the call flow, so a reply of "1", "2" or "3" after a call opens that plan. */
export function flowAfterCall(prev: Flow | null, lang: Lang, place: Place, crop: string | null, options: EngineOption[] | null, why?: string): Flow {
  return { ...(prev ?? {}), step: options?.length ? "plans" : "menu", lang: prev?.lang ?? toFlowLang(lang), place, crop, options, why: why ?? prev?.why, at: new Date().toISOString() };
}
