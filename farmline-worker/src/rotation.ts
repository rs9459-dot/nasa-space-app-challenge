// Built-in 3-year rotations for places the Vultr engine doesn't cover yet. Standard rotation rules
// (a legume after a cereal, hardier crops for a dry year), sow seasons by latitude, and typical
// seasonal crop water needs from FAO (Irrigation Water Management, Training Manual 3, table 13;
// rice and alfalfa: common irrigated totals). No invented income figures: those come only from the engine.
import type { EngineOption } from "./types";

export type SowKey = "may" | "oct" | "spring" | "nov" | "apr" | "sep" | "rains" | "dry";

const key = (c: string) => {
  const k = c.toLowerCase().trim();
  return k === "maize" ? "corn" : k === "dry beans" || k === "bean" ? "beans" : k === "soya" ? "soybean" : k;
};

export const LEGUMES = new Set(["soybean", "beans", "clover", "chickpea", "lentil", "peas", "groundnut", "mung bean", "alfalfa", "cover crop"]);
export const COVER = new Set(["clover", "cover crop"]);
const HEAVY = new Set(["corn", "wheat", "rice", "cotton", "sugarcane", "sorghum", "millet", "potato", "barley", "oats", "corn silage"]);
const WARM = new Set(["soybean", "corn", "beans", "cotton", "sorghum", "millet", "groundnut", "rice", "mung bean", "sunflower", "corn silage", "sugarcane"]);
const COOL = new Set(["wheat", "barley", "oats", "mustard", "chickpea", "lentil", "peas", "safflower"]);

/** Typical seasonal crop water need, mm (FAO midpoints). */
const WATER_MM: Record<string, number> = {
  corn: 650, "corn silage": 650, soybean: 575, wheat: 550, barley: 550, oats: 500, sorghum: 550, millet: 500, beans: 400,
  chickpea: 350, lentil: 350, peas: 400, mustard: 400, safflower: 500, groundnut: 600, "mung bean": 350, potato: 600,
  cotton: 1000, sugarcane: 2000, rice: 1200, alfalfa: 1200, clover: 450, "cover crop": 400, sunflower: 800, fallow: 0,
};

/** current crop -> [least water, most income, safest in a dry year] */
const TABLE: Record<string, [string[], string[], string[]]> = {
  corn: [["soybean", "wheat", "clover"], ["soybean", "corn", "wheat"], ["wheat", "soybean", "oats"]],
  wheat: [["soybean", "oats", "clover"], ["corn", "soybean", "wheat"], ["sorghum", "chickpea", "wheat"]],
  rice: [["chickpea", "millet", "lentil"], ["wheat", "rice", "mustard"], ["millet", "chickpea", "sorghum"]],
  soybean: [["wheat", "clover", "sorghum"], ["corn", "soybean", "wheat"], ["sorghum", "wheat", "chickpea"]],
  cotton: [["chickpea", "sorghum", "wheat"], ["wheat", "cotton", "soybean"], ["sorghum", "chickpea", "millet"]],
  sugarcane: [["chickpea", "wheat", "soybean"], ["soybean", "wheat", "corn"], ["sorghum", "chickpea", "millet"]],
  alfalfa: [["wheat", "sorghum", "safflower"], ["corn", "wheat", "alfalfa"], ["sorghum", "safflower", "wheat"]],
  beans: [["sorghum", "wheat", "beans"], ["corn", "wheat", "beans"], ["sorghum", "millet", "chickpea"]],
  potato: [["beans", "wheat", "clover"], ["corn", "beans", "potato"], ["sorghum", "beans", "wheat"]],
  sorghum: [["chickpea", "millet", "beans"], ["corn", "beans", "wheat"], ["millet", "chickpea", "sorghum"]],
  millet: [["chickpea", "millet", "beans"], ["groundnut", "wheat", "millet"], ["sorghum", "chickpea", "millet"]],
  barley: [["soybean", "oats", "clover"], ["corn", "soybean", "barley"], ["sorghum", "chickpea", "barley"]],
};
const DEFAULT: [string[], string[], string[]] = [["beans", "wheat", "clover"], ["corn", "soybean", "wheat"], ["sorghum", "chickpea", "millet"]];

/** When to sow, from the crop's season and the farm's latitude. */
export function sowKey(crop: string, lat: number): SowKey {
  const c = key(crop);
  if (Math.abs(lat) <= 23) return COOL.has(c) || COVER.has(c) || c === "alfalfa" ? "dry" : "rains";
  if (lat > 0) return COVER.has(c) ? "spring" : COOL.has(c) ? "oct" : c === "alfalfa" || c === "potato" ? "apr" : "may";
  return COVER.has(c) ? "spring" : COOL.has(c) ? "apr" : c === "alfalfa" || c === "potato" ? "sep" : "nov";
}

const need = (rotation: string[]) => {
  const v = rotation.map((c) => WATER_MM[key(c)]).filter((x) => x !== undefined) as number[];
  return v.length === rotation.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** % water saved against the current crop, from FAO crop water needs (null if a crop isn't known). */
export function waterSaving(rotation: string[], current: string | null): number | null {
  if (!current) return null;
  const now = WATER_MM[key(current)];
  const plan = need(rotation);
  if (!now || plan === null) return null;
  return Math.round(((now - plan) / now) * 100);
}

export const legumesIn = (rotation: string[]) => [...new Set(rotation.filter((c) => LEGUMES.has(key(c))))];
export const isHeavy = (crop: string | null) => Boolean(crop && HEAVY.has(key(crop)));
export const isCover = (crop: string) => COVER.has(key(crop));

/** 3 plans when the engine has no field here. Numbers: FAO water needs only (no income figures). */
export function fallbackPlans(current: string | null): EngineOption[] {
  const t = TABLE[key(current ?? "")] ?? DEFAULT;
  const kinds: EngineOption["kind"][] = ["water", "income", "drought"];
  return t.map((rotation, i) => ({
    rotation,
    water_saving_pct: waterSaving(rotation, current) ?? 0,
    income_change_pct: NaN, // unknown without the engine: never shown
    bad_year_income_change_pct: NaN,
    kind: kinds[i],
    builtIn: true,
  })) as EngineOption[];
}
