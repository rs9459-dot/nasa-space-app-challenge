/**
 * The number checker: no reply leaves FarmLine with a number the engine didn't produce.
 *
 * Every number in the reply, digits in any script or English number words, must be a
 * number found in the engine's JSON (or a small allowed extra such as "option 1/2/3").
 * Signs are ignored, so "-33% water" matches water_saved_pct 33.
 * Fractions and multipliers ("half", "double") can't be verified, so they fail.
 */

const DIGIT_BLOCKS = [0x0966 /* Devanagari ० */, 0x0660 /* Arabic-Indic ٠ */, 0x06f0 /* Extended (Urdu) ۰ */];

/** Turn Devanagari and Arabic/Urdu digits into ASCII 0-9. */
export function normalizeDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const block = DIGIT_BLOCKS.find((b) => c >= b && c <= b + 9);
    out += block === undefined ? ch : String(c - block);
  }
  // Arabic decimal separator and thousands separator
  return out.replace(/٫/g, ".").replace(/٬/g, ",");
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};
const UNVERIFIABLE = ["half", "halve", "third", "quarter", "double", "triple", "twice", "thrice", "dozen", "million", "billion"];

export interface FoundNumber {
  raw: string;
  value: number | null; // null = present but can't be checked (e.g. "half")
}

/** Every number written in `text`. */
export function extractNumbers(text: string): FoundNumber[] {
  const t = normalizeDigits(text);
  const found: FoundNumber[] = [];

  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    let raw = m[0].replace(/,+$/, "");
    const [intPart, dec] = raw.split(".");
    const groups = intPart.split(",");
    // "1,200" / "1,20,000" are one number; "1,2,3" is three.
    const isGrouped = groups.length > 1 && groups.slice(1).every((g) => g.length === 3 || g.length === 2) && groups.at(-1)!.length === 3;
    if (groups.length === 1 || isGrouped) {
      found.push({ raw, value: Number(groups.join("") + (dec ? `.${dec}` : "")) });
    } else {
      for (const g of groups) if (g) found.push({ raw: g, value: Number(g) });
    }
  }

  // English number words ("thirty-three", "one hundred"): only whole simple ones are checked.
  const words = t.toLowerCase().match(/\b[a-z]+(?:-[a-z]+)*\b/g) ?? [];
  for (const w of words) {
    if (UNVERIFIABLE.some((u) => w === u || w === `${u}s` || w === `${u}d`)) {
      found.push({ raw: w, value: null });
      continue;
    }
    const parts = w.split("-");
    if (parts.every((p) => p in SMALL)) {
      const value = parts.reduce((a, p) => (SMALL[p] >= 100 ? Math.max(a, 1) * SMALL[p] : a + SMALL[p]), 0);
      found.push({ raw: w, value });
    }
  }
  return found;
}

/** Every number anywhere in a JSON value, including digits inside strings. */
export function numbersIn(value: unknown, into = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) into.add(Math.abs(value));
  else if (typeof value === "string") for (const n of extractNumbers(value)) n.value !== null && into.add(n.value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, into);
  else if (value && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, into);
  return into;
}

export interface CheckResult {
  ok: boolean;
  /** Numbers in the reply that are not in the source. */
  unknown: string[];
  /** Required numbers missing from the reply. */
  missing: number[];
}

/**
 * Does every number in `reply` come from `source`?
 * `extras` are numbers allowed without being in the source (default: option numbers 1-3,
 * and 10 for "soil 7/10").
 * `required` must all appear (used to make sure no option was dropped).
 */
export function checkNumbers(
  reply: string,
  source: unknown,
  { extras = [1, 2, 3, 10], required = [] }: { extras?: number[]; required?: number[] } = {},
): CheckResult {
  const allowed = numbersIn(source);
  for (const e of extras) allowed.add(e);
  const found = extractNumbers(reply);
  const unknown = found.filter((f) => f.value === null || !allowed.has(Math.abs(f.value))).map((f) => f.raw);
  const seen = new Set(found.map((f) => f.value));
  const missing = required.filter((r) => !seen.has(Math.abs(r)));
  return { ok: unknown.length === 0 && missing.length === 0, unknown, missing };
}

/** The same numbers, in any order, in both texts (used to check translations). */
export function sameNumbers(original: string, translated: string): boolean {
  const key = (s: string) => extractNumbers(s).filter((n) => /\d/.test(n.raw)).map((n) => n.value).sort().join("|");
  return key(original) === key(translated);
}
