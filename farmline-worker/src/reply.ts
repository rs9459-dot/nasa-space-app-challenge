import { CROP_NAMES, CROP_WORDS, MARKERS, PACKS, STOPWORDS } from "./i18n";
import type { Detected, EngineOption, Lang, Place, Session, Weather } from "./types";

// ---------- Understanding the farmer's message ----------

const tokens = (text: string) => text.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
const isLatin = (w: string) => /^[\p{Script=Latin}]+$/u.test(w);

/** Which language the farmer wrote in. Script first, then common Swahili / Roman Hindi-Urdu words. */
const LATIN_CROPS = new Set(["trigo", "maíz", "maiz", "milho", "frijol", "frijoles", "feijão", "arroz", "algodón", "algodão", "cebada", "cevada", "blé", "riz", "maïs", "papa", "batata", "cebolla", "cebola"]);

export function detectLang(text: string): Detected {
  if (/\p{Script=Devanagari}/u.test(text)) return "hi";
  if (/\p{Script=Arabic}/u.test(text)) return "ur";
  if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text)) return "other";
  const words = tokens(text);
  const score = (lang: "roman" | "sw" | "latin") => words.filter((w) => MARKERS[lang].includes(w)).length;
  const roman = score("roman");
  const sw = score("sw");
  const latin = score("latin") + words.filter((w) => LATIN_CROPS.has(w)).length;
  if (latin > roman && latin > sw && latin >= 1) return "other"; // Spanish / Portuguese / French: Gemini translates the reply
  if (roman === 0 && sw === 0) return "en";
  return sw > roman ? "sw" : roman > sw ? "roman" : "en";
}

/** Final reply language once the farm is known: Roman Hindi/Urdu -> Urdu in Pakistan, Hindi elsewhere. */
export function replyLang(detected: Detected, place: Place | null): Lang {
  if (detected === "roman") return place?.country === "pk" ? "ur" : "hi";
  if (detected === "other") return "en";
  return detected;
}

/** First 5- or 6-digit number in the text (US ZIP or Indian PIN). Handles "8 9 4 0 6" from speech. */
export function findPostalCode(text: string): string | null {
  const plain = text.match(/\b(\d{6}|\d{5})\b/);
  if (plain) return plain[1];
  const spaced = text.match(/\b(\d(?:[\s-]\d){4,5})\b/);
  return spaced ? spaced[1].replace(/[\s-]/g, "") : null;
}

export function findCrop(text: string): string | null {
  const words = new Set(tokens(text));
  const lower = text.toLowerCase();
  for (const [crop, list] of Object.entries(CROP_WORDS)) {
    // Latin words must match a whole word ("papa" is not "papaya"); other scripts match anywhere.
    if (list.some((w) => (isLatin(w) ? words.has(w) : lower.includes(w)))) return crop;
  }
  return null;
}

const ALL_CROP_WORDS = new Set(Object.values(CROP_WORDS).flat());

/** Words that might be a town name, best guesses first (capitalised words first). */
export function placeCandidates(text: string): string[] {
  const raw = text.split(/[^\p{L}\p{M}]+/u).filter((w) => w.length >= 3);
  const ok = raw.filter((w) => !STOPWORDS.has(w.toLowerCase()) && !ALL_CROP_WORDS.has(w.toLowerCase()));
  const caps = ok.filter((w) => /^\p{Lu}/u.test(w));
  return [...new Set([...caps, ...ok])].slice(0, 3);
}

// ---------- Writing the reply ----------

const fmt = (n: number, digits = 1) => n.toFixed(digits).replace(/\.0+$/, "");
const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);
export const cropName = (crop: string, lang: Lang) => (lang === "en" ? crop : CROP_NAMES[lang][crop] ?? crop);

/** When the engine has no tested plan for this place: what to plant next, from the current
 *  crop and NASA rain. General rotation rules (legume after cereal, hardy crops when dry),
 *  no made-up numbers. */
const NEXT_AFTER: Record<string, [string, string, string]> = {
  // [saves water, earns more, safest if dry]
  rice: ["chickpea", "wheat", "mustard"], paddy: ["chickpea", "wheat", "mustard"],
  wheat: ["mung bean", "maize", "millet"], maize: ["beans", "soybean", "sorghum"], corn: ["beans", "soybean", "sorghum"],
  cotton: ["chickpea", "wheat", "sorghum"], sugarcane: ["chickpea", "wheat", "millet"], alfalfa: ["wheat", "maize", "sorghum"],
  soybean: ["wheat", "maize", "sorghum"], beans: ["sorghum", "maize", "millet"], sorghum: ["chickpea", "beans", "millet"],
  millet: ["chickpea", "groundnut", "sorghum"], potato: ["beans", "maize", "sorghum"], tomato: ["beans", "maize", "sorghum"],
};
const NEXT_TXT: Record<Lang, { head: (c: string | null) => string; tag: [string, string, string]; dry: string; footer: string }> = {
  en: { head: (c) => `What to plant next${c ? ` after ${c}` : ""}:`, tag: ["uses less water", "earns more", "safest if rain stays low"], dry: "Rain is low, so the hardy crop is the safer choice this season.", footer: "General advice from NASA rain data; check seed and market prices locally." },
  hi: { head: (c) => `${c ? c + " के बाद " : ""}अगली फसल:`, tag: ["कम पानी", "ज़्यादा कमाई", "कम बारिश में सबसे सुरक्षित"], dry: "बारिश कम है, इसलिए इस मौसम मज़बूत फसल ज़्यादा सुरक्षित है।", footer: "नासा बारिश डेटा पर आधारित सामान्य सलाह; बीज और बाज़ार भाव स्थानीय रूप से देखें।" },
  ur: { head: (c) => `${c ? c + " کے بعد " : ""}اگلی فصل:`, tag: ["کم پانی", "زیادہ کمائی", "کم بارش میں سب سے محفوظ"], dry: "بارش کم ہے، اس لیے اس موسم مضبوط فصل زیادہ محفوظ ہے۔", footer: "ناسا بارش ڈیٹا پر مبنی عمومی مشورہ۔" },
  sw: { head: (c) => `Cha kupanda kinachofuata${c ? ` baada ya ${c}` : ""}:`, tag: ["hutumia maji kidogo", "faida zaidi", "salama zaidi mvua ikiwa chache"], dry: "Mvua ni chache, kwa hiyo zao gumu ni salama zaidi msimu huu.", footer: "Ushauri wa jumla kutoka data ya mvua ya NASA; angalia bei za mbegu na soko." },
};
export function nextCrops(lang: Lang, crop: string | null, rainRatio: number, spoken: boolean): string[] {
  const T = NEXT_TXT[lang] ?? NEXT_TXT.en;
  const key = crop?.toLowerCase().trim() ?? "";
  const picks = NEXT_AFTER[key] ?? (rainRatio < 0.6 ? ["chickpea", "millet", "sorghum"] : rainRatio > 1.4 ? ["beans", "maize", "rice"] : ["beans", "maize", "sorghum"]);
  const L = PACKS[lang];
  const lines = [T.head(crop ? cropName(crop, lang) : null)];
  picks.forEach((c, i) => lines.push(`${spoken ? `${L.plan} ${i + 1}: ` : `${i + 1}) `}${cropName(c, lang)}: ${T.tag[i]}`));
  if (rainRatio < 0.6) lines.push(T.dry);
  lines.push(T.footer);
  return lines;
}

/** The reply as lines. spoken = wording for a phone call instead of an SMS. */
function compose(p: Place, w: Weather, lang: Lang, crop: string | null, options: EngineOption[] | null, spoken: boolean): string[] {
  const L = PACKS[lang];
  const us = p.country === "us";
  const amount = (mm: number) =>
    us ? `${fmt(mm / 25.4, 2)} ${spoken ? L.inchSpoken : L.inch}` : `${fmt(mm)} ${L.mm}`;
  const pct = w.normal30mm > 0 ? `, ${Math.round((w.rain30mm / w.normal30mm) * 100)}%` : "";
  const temp = us ? fmt((w.avgHighC * 9) / 5 + 32, 0) + (spoken ? L.degF : "°F") : fmt(w.avgHighC, 0) + (spoken ? L.degC : "°C");
  const ratio = w.normal30mm > 0 ? w.rain30mm / w.normal30mm : 1;

  const name = lang === "ur" && p.localName ? p.localName : p.name;
  const lines = [
    spoken ? L.spokenHeader(name) : L.header(name),
    L.rain(w.days, amount(w.rain30mm), amount(w.normal30mm), pct),
    L.high(temp),
    ratio < 0.6 ? L.drier : ratio > 1.4 ? L.wetter : L.normal,
  ];
  if (options && options.length) {
    lines.push(L.plans(crop ? cropName(crop, lang) : null));
    options.slice(0, 3).forEach((o, i) => {
      const rot = o.rotation.map((c) => cropName(c, lang)).join(spoken ? L.then : " > ");
      const why =
        o.kind === "water" ? L.saves(Math.round(o.water_saving_pct))
        : o.kind === "income" ? L.income(signed(o.income_change_pct))
        : L.safest(signed(o.bad_year_income_change_pct));
      lines.push(`${spoken ? `${L.plan} ${i + 1}: ` : `${i + 1}) `}${rot}: ${why}`);
    });
  } else {
    lines.push(...nextCrops(lang, crop, ratio, spoken));
    if (!crop) lines.push(L.textCrop);
  }
  return lines;
}

/** SMS text. Kept short: non-Latin SMS segments hold only 70 characters. */
export const buildSms = (p: Place, w: Weather, lang: Lang, crop: string | null, o: EngineOption[] | null) =>
  compose(p, w, lang, crop, o, false).join("\n");

/** The same answer as sentences for Twilio <Say>. */
export const buildSpeech = (p: Place, w: Weather, lang: Lang, crop: string | null, o: EngineOption[] | null) =>
  compose(p, w, lang, crop, o, true).join(" ");

/** For a call: the NASA summary first, then (only if the farmer presses 1) what to plant instead. */
export function buildSpeechParts(p: Place, w: Weather, lang: Lang, crop: string | null, o: EngineOption[] | null): { summary: string; plant: string } {
  const lines = compose(p, w, lang, crop, o, true);
  return { summary: lines.slice(0, 4).join(" "), plant: lines.slice(4).join(" ") };
}

/** Reply to "1", "2" or "3": the full numbers for that plan from the farmer's last answer. */
export function buildDetails(s: Session, n: number): string | null {
  const o = s.options?.[n - 1];
  if (!o) return null;
  const rot = o.rotation.map((c) => cropName(c, s.lang)).join(" > ");
  return PACKS[s.lang].details(n, rot, Math.round(o.water_saving_pct), signed(o.income_change_pct), signed(o.bad_year_income_change_pct));
}

/** Short line under every answer: how to get plan details and drought alerts. */
export function footer(lang: Lang, hasPlans: boolean): string {
  const L = PACKS[lang];
  return hasPlans ? `${L.footerPlans} ${L.footerAlert}` : L.footerAlert;
}
