/**
 * Languages FarmLine answers in.
 *
 * Built-in languages get hand-written templates, so no model ever touches a number.
 * Roman Hindi and Roman Urdu are written the same way in Latin letters, so they are
 * told apart by the farm's country, not the text: Pakistan -> Urdu, India -> Hindi.
 */

export const BUILT_IN = ["en", "hi", "hi-Latn", "ur", "ur-Latn", "sw"] as const;
export type BuiltInLang = (typeof BUILT_IN)[number];
/** A built-in language, or "other" (Gemini translates; `language_name` says which). */
export type Lang = BuiltInLang | "other";

export type Script = "latin" | "devanagari" | "arabic" | "other";

export function isBuiltIn(l: string): l is BuiltInLang {
  return (BUILT_IN as readonly string[]).includes(l);
}

/** Which script most of the letters in `text` are written in. */
export function detectScript(text: string): Script {
  let latin = 0, deva = 0, arabic = 0, other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++;
    else if (c >= 0x0900 && c <= 0x097f) deva++;
    else if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0xfb50 && c <= 0xfeff)) arabic++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  const max = Math.max(latin, deva, arabic, other);
  if (max === 0) return "latin";
  if (max === deva) return "devanagari";
  if (max === arabic) return "arabic";
  if (max === latin) return "latin";
  return "other";
}

/**
 * Settle the language from what the model guessed, the script, and the farm's country.
 * The script wins over the model for Devanagari/Arabic; country decides Roman Hindi vs Urdu.
 */
export function resolveLanguage(modelGuess: string, script: Script, country: string | null): Lang {
  const g = modelGuess.toLowerCase();
  const cc = (country ?? "").toUpperCase();
  if (script === "devanagari") return "hi";
  if (script === "arabic") return g === "other" ? "other" : "ur";
  if (script === "latin") {
    if (g === "hi" || g === "ur" || g === "hi-latn" || g === "ur-latn") {
      if (cc === "PK") return "ur-Latn";
      if (cc === "IN") return "hi-Latn";
      return g.startsWith("ur") ? "ur-Latn" : "hi-Latn";
    }
    if (g === "sw") return "sw";
    if (g === "en") return "en";
    return g === "other" ? "other" : "en";
  }
  return "other";
}
