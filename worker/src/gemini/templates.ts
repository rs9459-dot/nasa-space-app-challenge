/**
 * Hand-written replies. No model touches these, so the numbers are always the engine's.
 *
 * Used directly for Hindi, Urdu, Swahili (and their Roman forms), and as the safe
 * fallback whenever a Gemini-written English reply fails the number checker.
 *
 * Hindi, Urdu and Swahili wording needs a native speaker's check before the demo.
 * SMS budget: 3 segments = 459 chars in GSM-7 (Latin), 201 in UCS-2 (Devanagari/Urdu),
 * so the UCS-2 SMS leaves out the bad-year income; the voice script keeps it.
 */
import { cropName } from "./crops";
import type { EngineError, EngineResult, RotationOption } from "./engine-types";
import type { BuiltInLang } from "./languages";

export type Channel = "sms" | "voice";

interface Strings {
  header: (place: string, years: number) => string;
  labels: [string, string, string];
  rotationSep: string;
  water: (sign: string, pct: number) => string;
  income: (usd: number) => string;
  badYear: ((usd: number) => string) | null; // null = left out of SMS to fit
  footer: string;
  voice: (r: EngineResult, names: (o: RotationOption) => string) => string;
  detail: (o: RotationOption, label: string, names: string, base: EngineResult["baseline"]) => string;
  errors: { field_not_found: string; other: string };
}

const sign = (pct: number) => (pct >= 0 ? "-" : "+");
const abs = Math.abs;

const S: Record<BuiltInLang, Strings> = {
  en: {
    header: (p, y) => `FarmLine ${p}: 3 plans tested on ${y} yrs of NASA weather`,
    labels: ["Save water", "Most income", "Drought-safe"],
    rotationSep: ", ",
    water: (s, p) => `water ${s}${p}%`,
    income: (u) => `$${u}/ac`,
    badYear: (u) => `(bad yr $${u})`,
    footer: "Reply 1, 2 or 3 for details",
    voice: (r, n) => {
      const [a, b, c] = r.options;
      return `Here are 3 plans for your field near ${r.field.place}, tested against ${r.years_tested} years of NASA weather. ` +
        `Option 1 saves the most water: ${n(a)}. It uses ${a.water_saved_pct} percent less water and earns about ${a.income_usd_per_acre} dollars an acre, or ${a.bad_year_income_usd_per_acre} in a bad year. ` +
        `Option 2 earns the most: ${n(b)}, about ${b.income_usd_per_acre} dollars an acre, or ${b.bad_year_income_usd_per_acre} in a bad year. ` +
        `Option 3 is safest in drought: ${n(c)}. It uses ${c.water_saved_pct} percent less water and still earns ${c.bad_year_income_usd_per_acre} dollars in a bad year. ` +
        `We will text you this summary. You decide what fits your farm.`;
    },
    detail: (o, l, n, b) =>
      `Option ${o.rank} (${l}): ${n}. Water ${o.water_af_per_acre} AF/ac (now ${b.water_af_per_acre}). ` +
      `Income $${o.income_usd_per_acre}/ac, $${o.bad_year_income_usd_per_acre} in a bad year (now $${b.income_usd_per_acre}, bad yr $${b.bad_year_income_usd_per_acre}). Soil health ${o.soil_score}/10.`,
    errors: {
      field_not_found: "FarmLine: we couldn't find that place. Text your crop and ZIP code or nearest town, e.g. alfalfa 89406",
      other: "FarmLine: sorry, we couldn't check your field right now. Please try again in a few minutes.",
    },
  },

  hi: {
    header: (_p, y) => `FarmLine: ${y} साल NASA मौसम पर 3 योजना, $/एकड़`,
    labels: ["पानी बचत", "अधिक कमाई", "सूखा-रोधी"],
    rotationSep: "-",
    water: (s, p) => `पानी ${s}${p}%`,
    income: (u) => `$${u}`,
    badYear: null,
    footer: "1/2/3 भेजें",
    voice: (r, n) => {
      const [a, b, c] = r.options;
      // Kept to ~30 s spoken: Hindi numbers are long to say ("सात सौ अस्सी"), so only
      // option 3 keeps its bad-year figure (the drought story); the SMS that follows has the rest.
      return `${r.years_tested} साल के NASA मौसम पर 3 योजनाएँ। ` +
        `पहली, पानी बचत: ${n(a)}, ${a.water_saved_pct} प्रतिशत कम पानी, ${a.income_usd_per_acre} डॉलर प्रति एकड़। ` +
        `दूसरी, ज़्यादा कमाई: ${n(b)}, ${b.income_usd_per_acre} डॉलर। ` +
        `तीसरी, सूखे में सुरक्षित: ${n(c)}, बुरे साल में भी ${c.bad_year_income_usd_per_acre} डॉलर। ` +
        `फ़ैसला आपका।`;
    },
    detail: (o, l, n, b) =>
      `योजना ${o.rank} (${l}): ${n}। पानी ${o.water_af_per_acre} AF/एकड़ (अभी ${b.water_af_per_acre})। कमाई $${o.income_usd_per_acre}, बुरे साल $${o.bad_year_income_usd_per_acre}। मिट्टी ${o.soil_score}/10`,
    errors: {
      field_not_found: "FarmLine: जगह नहीं मिली। अपनी फसल और पिन कोड या पास का शहर भेजें",
      other: "FarmLine: अभी जाँच नहीं हो पाई। कुछ मिनट बाद फिर भेजें।",
    },
  },

  "hi-Latn": {
    header: (_p, y) => `FarmLine: ${y} saal ke NASA mausam par jaanche 3 plan`,
    labels: ["Pani bachat", "Zyada kamai", "Sookhe mein surakshit"],
    rotationSep: ", ",
    water: (s, p) => `pani ${s}${p}%`,
    income: (u) => `$${u}/acre`,
    badYear: (u) => `(bura saal $${u})`,
    footer: "Details ke liye 1, 2 ya 3 bhejein",
    voice: (r, n) => S.hi.voice(r, n),
    detail: (o, l, n, b) =>
      `Plan ${o.rank} (${l}): ${n}. Pani ${o.water_af_per_acre} AF/acre (abhi ${b.water_af_per_acre}). Kamai $${o.income_usd_per_acre}, bura saal $${o.bad_year_income_usd_per_acre}. Mitti ${o.soil_score}/10`,
    errors: {
      field_not_found: "FarmLine: jagah nahi mili. Apni fasal aur pin code ya paas ka shehar bhejein",
      other: "FarmLine: abhi jaanch nahi ho payi. Kuch minute baad phir bhejein.",
    },
  },

  ur: {
    header: (_p, y) => `FarmLine: ${y} سال NASA موسم پر 3 پلان $/ایکڑ`,
    labels: ["پانی بچت", "زیادہ آمدنی", "سوکھے میں محفوظ"],
    rotationSep: "-",
    water: (s, p) => `پانی ${s}${p}%`,
    income: (u) => `$${u}`,
    badYear: null,
    footer: "1/2/3 بھیجیں",
    voice: (r, n) => {
      const [a, b, c] = r.options;
      return `آپ کے کھیت کے لیے 3 منصوبے، ${r.years_tested} سال کے NASA موسم پر جانچے گئے۔ ` +
        `پہلا، سب سے زیادہ پانی کی بچت: ${n(a)}۔ ${a.water_saved_pct} فیصد کم پانی، عام سال میں ${a.income_usd_per_acre} ڈالر فی ایکڑ، برے سال میں ${a.bad_year_income_usd_per_acre}۔ ` +
        `دوسرا، سب سے زیادہ آمدنی: ${n(b)}۔ عام سال میں ${b.income_usd_per_acre} ڈالر فی ایکڑ، برے سال میں ${b.bad_year_income_usd_per_acre}۔ ` +
        `تیسرا، خشک سالی میں سب سے محفوظ: ${n(c)}۔ ${c.water_saved_pct} فیصد کم پانی، برے سال میں بھی ${c.bad_year_income_usd_per_acre} ڈالر۔ ` +
        `فیصلہ آپ کا ہے۔`;
    },
    detail: (o, l, n, b) =>
      `منصوبہ ${o.rank} (${l}): ${n}۔ پانی ${o.water_af_per_acre} AF/ایکڑ (ابھی ${b.water_af_per_acre})۔ آمدنی $${o.income_usd_per_acre}، برا سال $${o.bad_year_income_usd_per_acre}۔ مٹی ${o.soil_score}/10`,
    errors: {
      field_not_found: "FarmLine: جگہ نہیں ملی۔ اپنی فصل اور قریبی شہر کا نام بھیجیں",
      other: "FarmLine: ابھی جانچ نہیں ہو سکی۔ چند منٹ بعد دوبارہ بھیجیں۔",
    },
  },

  "ur-Latn": {
    header: (_p, y) => `FarmLine: ${y} saal ke NASA mausam par jaanche 3 mansoobay`,
    labels: ["Pani ki bachat", "Zyada aamdani", "Khushk saali mein mehfooz"],
    rotationSep: ", ",
    water: (s, p) => `pani ${s}${p}%`,
    income: (u) => `$${u}/acre`,
    badYear: (u) => `(bura saal $${u})`,
    footer: "Tafseel ke liye 1, 2 ya 3 bhejein",
    voice: (r, n) => S.ur.voice(r, n),
    detail: (o, l, n, b) =>
      `Mansooba ${o.rank} (${l}): ${n}. Pani ${o.water_af_per_acre} AF/acre (abhi ${b.water_af_per_acre}). Aamdani $${o.income_usd_per_acre}, bura saal $${o.bad_year_income_usd_per_acre}. Mitti ${o.soil_score}/10`,
    errors: {
      field_not_found: "FarmLine: jagah nahi mili. Apni fasal aur qareebi shehar ka naam bhejein",
      other: "FarmLine: abhi jaanch nahi ho saki. Chand minute baad dobara bhejein.",
    },
  },

  sw: {
    header: (_p, y) => `FarmLine: mipango 3 iliyopimwa kwa miaka ${y} ya hali ya hewa ya NASA`,
    labels: ["Okoa maji", "Mapato zaidi", "Salama kwenye ukame"],
    rotationSep: ", ",
    water: (s, p) => `maji ${s}${p}%`,
    income: (u) => `$${u}/ekari`,
    badYear: (u) => `(mwaka mbaya $${u})`,
    footer: "Jibu 1, 2 au 3 kwa maelezo",
    voice: (r, n) => {
      const [a, b, c] = r.options;
      return `Hii ni mipango 3 kwa shamba lako, iliyopimwa kwa miaka ${r.years_tested} ya hali ya hewa ya NASA. ` +
        `Mpango wa kwanza unaokoa maji zaidi: ${n(a)}. Unatumia maji asilimia ${a.water_saved_pct} kidogo, mapato dola ${a.income_usd_per_acre} kwa ekari, au ${a.bad_year_income_usd_per_acre} mwaka mbaya. ` +
        `Mpango wa pili una mapato zaidi: ${n(b)}, dola ${b.income_usd_per_acre} kwa ekari, au ${b.bad_year_income_usd_per_acre} mwaka mbaya. ` +
        `Mpango wa tatu ni salama zaidi kwenye ukame: ${n(c)}. Maji asilimia ${c.water_saved_pct} kidogo, na dola ${c.bad_year_income_usd_per_acre} hata mwaka mbaya. ` +
        `Uamuzi ni wako.`;
    },
    detail: (o, l, n, b) =>
      `Mpango ${o.rank} (${l}): ${n}. Maji ${o.water_af_per_acre} AF/ekari (sasa ${b.water_af_per_acre}). Mapato $${o.income_usd_per_acre}, mwaka mbaya $${o.bad_year_income_usd_per_acre}. Udongo ${o.soil_score}/10`,
    errors: {
      field_not_found: "FarmLine: hatukupata mahali hapo. Tuma zao lako na jina la mji wa karibu, mfano mahindi Nakuru",
      other: "FarmLine: samahani, hatukuweza kuangalia shamba lako sasa. Jaribu tena baada ya dakika chache.",
    },
  },
};

const rotationText = (o: RotationOption, lang: BuiltInLang, sep: string) =>
  o.rotation.map((c) => cropName(c, lang)).join(sep);

const LABEL_ORDER = { most_water_saved: 0, most_income: 1, safest_in_drought: 2 } as const;

/** Options in label order (water, income, drought), numbered 1-3 in that order. */
export function ordered(r: EngineResult): EngineResult {
  const options = [...r.options]
    .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label])
    .map((o, i) => ({ ...o, rank: (i + 1) as 1 | 2 | 3 }));
  return { ...r, options };
}

/** The 3 options as an SMS or a spoken script, in a built-in language. */
export function renderPlan(result: EngineResult, lang: BuiltInLang, channel: Channel): string {
  const s = S[lang];
  const r = ordered(result);
  if (channel === "voice") return s.voice(r, (o) => rotationText(o, lang, ", "));
  const lines = [s.header(r.field.place, r.years_tested)];
  r.options.forEach((o, i) => {
    const parts = [
      `${o.rank} ${s.labels[i]}: ${rotationText(o, lang, s.rotationSep)}`,
      s.water(sign(o.water_saved_pct), abs(o.water_saved_pct)),
      s.income(o.income_usd_per_acre),
    ];
    let line = parts.join(lang === "ur" ? "، " : ", ");
    if (s.badYear) line += ` ${s.badYear(o.bad_year_income_usd_per_acre)}`;
    lines.push(line);
  });
  lines.push(s.footer);
  return lines.join("\n");
}

/** Reply to "tell me more about option N". */
export function renderOptionDetail(result: EngineResult, lang: BuiltInLang, n: 1 | 2 | 3): string {
  const s = S[lang];
  const r = ordered(result);
  const o = r.options[n - 1];
  return s.detail(o, s.labels[n - 1], rotationText(o, lang, s.rotationSep), r.baseline);
}

export function renderError(e: EngineError, lang: BuiltInLang): string {
  return e.error === "field_not_found" ? S[lang].errors.field_not_found : S[lang].errors.other;
}
