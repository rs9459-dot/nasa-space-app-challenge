/**
 * Crop codes shared with the engine, and how each is said in each built-in language.
 *
 * Hindi, Urdu and Swahili names need a native speaker's check before the demo.
 * `aliases` are words farmers might type (any language), used by the rules fallback.
 */
import type { BuiltInLang } from "./languages";

type Names = Record<"en" | "hi" | "ur" | "roman" | "sw", string>;

export const CROPS: Record<string, { names: Names; aliases: string[] }> = {
  alfalfa: {
    names: { en: "alfalfa", hi: "रिज़का", ur: "لوسرن", roman: "lucerne", sw: "alfalfa" },
    aliases: ["alfalfa", "lucerne", "rijka", "rizka", "lusern", "lucern", "रिज़का", "रिजका", "لوسرن"],
  },
  wheat: {
    names: { en: "wheat", hi: "गेहूं", ur: "گندم", roman: "gehun", sw: "ngano" },
    aliases: ["wheat", "gehun", "gehu", "gandum", "ngano", "गेहूं", "गेहूँ", "گندم"],
  },
  barley: {
    names: { en: "barley", hi: "जौ", ur: "جو", roman: "jau", sw: "shayiri" },
    aliases: ["barley", "jau", "jow", "shayiri", "जौ"],
  },
  sorghum: {
    names: { en: "sorghum", hi: "ज्वार", ur: "جوار", roman: "jowar", sw: "mtama" },
    aliases: ["sorghum", "milo", "jowar", "juwar", "mtama", "ज्वार", "جوار"],
  },
  dry_beans: {
    names: { en: "dry beans", hi: "राजमा", ur: "لوبیا", roman: "rajma", sw: "maharagwe" },
    aliases: ["beans", "dry beans", "rajma", "lobia", "maharagwe", "राजमा", "لوبیا"],
  },
  safflower: {
    names: { en: "safflower", hi: "कुसुम", ur: "کسنبہ", roman: "kusum", sw: "safflower" },
    aliases: ["safflower", "kusum", "kardi", "कुसुम", "کسنبہ"],
  },
  corn: {
    names: { en: "corn", hi: "मक्का", ur: "مکئی", roman: "makka", sw: "mahindi" },
    aliases: ["corn", "maize", "makka", "makki", "makai", "mahindi", "मक्का", "مکئی"],
  },
  corn_silage: {
    names: { en: "corn silage", hi: "मक्का चारा", ur: "مکئی چارہ", roman: "makka chara", sw: "mahindi ya silaji" },
    aliases: ["silage", "corn silage", "maize silage"],
  },
  cover_crop: {
    names: { en: "cover crop", hi: "ढकाव फसल", ur: "ڈھکاؤ فصل", roman: "dhakav fasal", sw: "zao la kufunika" },
    aliases: ["cover crop", "cover"],
  },
  fallow: {
    names: { en: "fallow", hi: "परती", ur: "پرتی", roman: "parti", sw: "kupumzisha" },
    aliases: ["fallow", "parti", "idle"],
  },
  rice: {
    names: { en: "rice", hi: "धान", ur: "چاول", roman: "dhan", sw: "mpunga" },
    aliases: ["rice", "paddy", "dhan", "chawal", "mpunga", "mchele", "धान", "चावल", "چاول", "دھان"],
  },
  cotton: {
    names: { en: "cotton", hi: "कपास", ur: "کپاس", roman: "kapas", sw: "pamba" },
    aliases: ["cotton", "kapas", "pamba", "कपास", "کپاس"],
  },
  mustard: {
    names: { en: "mustard", hi: "सरसों", ur: "سرسوں", roman: "sarson", sw: "haradali" },
    aliases: ["mustard", "sarson", "rapeseed", "सरसों", "سرسوں"],
  },
  chickpea: {
    names: { en: "chickpea", hi: "चना", ur: "چنا", roman: "chana", sw: "dengu" },
    aliases: ["chickpea", "chana", "gram", "चना", "چنا"],
  },
  millet: {
    names: { en: "millet", hi: "बाजरा", ur: "باجرہ", roman: "bajra", sw: "uwele" },
    aliases: ["millet", "bajra", "uwele", "बाजरा", "باجرہ"],
  },
  sugarcane: {
    names: { en: "sugarcane", hi: "गन्ना", ur: "گنا", roman: "ganna", sw: "miwa" },
    aliases: ["sugarcane", "ganna", "kamad", "miwa", "गन्ना", "گنا"],
  },
};

export const CROP_CODES = Object.keys(CROPS);

export function cropName(code: string, lang: BuiltInLang): string {
  const c = CROPS[code];
  if (!c) return code.replace(/_/g, " ");
  const key = lang === "hi-Latn" || lang === "ur-Latn" ? "roman" : lang;
  return c.names[key];
}

/** First crop mentioned in free text, by alias (rules fallback only). */
export function findCrop(text: string): string | null {
  const t = ` ${text.toLowerCase()} `;
  let best: { code: string; at: number } | null = null;
  for (const [code, { aliases }] of Object.entries(CROPS)) {
    for (const a of aliases) {
      const latin = /^[a-z ]+$/.test(a);
      const at = latin ? t.search(new RegExp(`[^a-z]${a}s?[^a-z]`)) : t.indexOf(a);
      if (at >= 0 && (!best || at < best.at)) best = { code, at };
    }
  }
  return best?.code ?? null;
}
