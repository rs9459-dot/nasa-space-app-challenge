import type { EngineOption, Env, Place } from "./types";

/**
 * Ask the Vultr rotation engine for 3 options. Returns null when ENGINE_URL is not set
 * yet or the engine is down, so the farmer still gets the NASA weather answer.
 */
/** What the farmer told FarmLine in the menu flow (all optional; see ENGINE.md). */
export interface EngineAsk { irrigated?: boolean; water_outlook?: "same" | "less" | "much_less"; priority?: "water" | "income" | "safe"; timeoutMs?: number }

const CROP_CODES = new Set(["alfalfa", "wheat", "barley", "sorghum", "dry_beans", "safflower", "corn", "corn_silage", "cover_crop", "fallow", "rice", "cotton", "mustard", "chickpea", "millet", "sugarcane"]);
const CROP_ALIASES: Record<string, string> = {
  maize: "corn", "dry beans": "dry_beans", beans: "dry_beans", bean: "dry_beans", gram: "chickpea", chana: "chickpea", chickpeas: "chickpea",
  paddy: "rice", cane: "sugarcane", "sugar cane": "sugarcane", silage: "corn_silage", "corn silage": "corn_silage", lucerne: "alfalfa",
  "cover crop": "cover_crop", bajra: "millet", jowar: "sorghum", sarson: "mustard", rapeseed: "mustard", kapas: "cotton",
};
/** FarmLine's free-text crop -> the engine's crop code (or null = "use what the field grew"). */
export function cropCode(crop: string | null): string | null {
  if (!crop) return null;
  const k = crop.toLowerCase().trim();
  const c = CROP_ALIASES[k] ?? k.replace(/ /g, "_");
  return CROP_CODES.has(c) ? c : null;
}

/** Priority weights for the engine, from the menu answers. */
function priorities(ask: EngineAsk) {
  let p = { water: 0.34, income: 0.33, drought: 0.33 };
  if (ask.priority === "water") p = { water: 0.6, income: 0.2, drought: 0.2 };
  if (ask.priority === "income") p = { water: 0.2, income: 0.6, drought: 0.2 };
  if (ask.priority === "safe") p = { water: 0.2, income: 0.2, drought: 0.6 };
  if (ask.water_outlook === "less" || ask.water_outlook === "much_less") {
    p.drought += ask.water_outlook === "much_less" ? 0.2 : 0.1;
    const t = p.water + p.income + p.drought;
    p = { water: +(p.water / t).toFixed(2), income: +(p.income / t).toFixed(2), drought: +(p.drought / t).toFixed(2) };
  }
  return p;
}

/** ENGINE_URL may be the engine's base (https://x.trycloudflare.com) or a full path. */
function planUrl(base: string): string {
  const found = base.match(/https?:\/\/[^\s"'<>]+/i); // the address, whatever was pasted around it
  let b = found ? found[0] : base.trim().replace(/^[A-Z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();
  if (!/^https?:\/\//i.test(b)) b = "https://" + b; // "abc.trycloudflare.com" works too
  const u = new URL(b);
  if (u.pathname === "/" || u.pathname === "" || u.pathname === "/health") u.pathname = "/plan";
  return u.toString();
}

const KIND: Record<string, EngineOption["kind"]> = { most_water_saved: "water", most_income: "income", safest_in_drought: "drought" };
const pct = (v: number, base: number) => (Math.abs(base) < 1 ? 0 : Math.round(((v - base) / Math.abs(base)) * 100));

interface PlanOption { rank: number; label: string; rotation: string[]; water_af_per_acre: number; water_saved_pct: number; income_usd_per_acre: number; bad_year_income_usd_per_acre: number; soil_score: number }
interface PlanResult { field: { place: string }; baseline: { water_af_per_acre: number; income_usd_per_acre: number; bad_year_income_usd_per_acre: number }; options: PlanOption[]; years_tested: number }

/** Turn the engine's contract-B answer into FarmLine's options. Numbers come only from the engine. */
export function fromPlan(r: PlanResult): EngineOption[] {
  const b = r.baseline;
  return [...r.options].sort((a, z) => a.rank - z.rank).map((o) => ({
    rotation: o.rotation.map((c) => c.replace(/_/g, " ")),
    water_saving_pct: o.water_saved_pct,
    income_change_pct: pct(o.income_usd_per_acre, b.income_usd_per_acre),
    bad_year_income_change_pct: pct(o.bad_year_income_usd_per_acre, b.bad_year_income_usd_per_acre),
    kind: KIND[o.label] ?? "water",
    why: `Tested on ${r.years_tested} years of NASA weather for ${r.field.place}: about ${o.water_af_per_acre} acre-feet of water per acre a year, $${o.income_usd_per_acre} per acre on average and $${o.bad_year_income_usd_per_acre} in a bad year (now $${b.income_usd_per_acre} and $${b.bad_year_income_usd_per_acre}). Soil health ${o.soil_score}/10.`,
  }));
}

export async function getOptions(env: Env, place: Place, crop: string | null, question: string, ask: EngineAsk = {}): Promise<EngineOption[] | null> {
  if (!env.ENGINE_URL) return null;
  try {
    const { timeoutMs = 6000 } = ask;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = (env.ENGINE_API_TOKEN ?? "").trim().replace(/^[A-Z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = {
      place: place.name.slice(0, 100),
      lat: Math.round(place.lat * 10000) / 10000,
      lon: Math.round(place.lon * 10000) / 10000,
      current_crop: cropCode(crop),
      priorities: priorities(ask),
    };
    const res = await fetch(planUrl(env.ENGINE_URL), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.log("engine said", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const j = (await res.json()) as { options?: unknown[]; baseline?: unknown };
    if (!Array.isArray(j.options) || !j.options.length) return null;
    if (j.baseline) return fromPlan(j as unknown as PlanResult); // the real engine (contract B)
    return j.options as EngineOption[]; // older FarmLine-shaped answer
  } catch (e) {
    console.error("engine call failed", e);
    return null;
  }
}

/** Same as getOptions, plus what the admin view shows: did the engine answer, and how fast. */
export async function askEngine(env: Env, place: Place, crop: string | null, question: string, ask: EngineAsk = {}) {
  const t = Date.now();
  if (!env.ENGINE_URL) return { options: null, engine: { status: "not_connected" as const, ms: 0 } };
  const options = await getOptions(env, place, crop, question, ask);
  return { options, engine: { status: options ? ("answered" as const) : ("no_answer" as const), ms: Date.now() - t, options: options ?? undefined } };
}
