export interface Env {
  // Cloudflare bindings (optional so the code still runs if one is not created yet)
  CACHE?: KVNamespace; // NASA + location cache
  DB?: D1Database; // farmers who asked for alerts, anonymous question log
  FARMER?: DurableObjectNamespace; // one FarmerSession per phone number
  ALERTS?: Queue<AlertJob>; // drought-alert fan-out
  AI?: Ai; // Workers AI (Llama backup translator, bge-m3 embeddings for the farming library)
  REPORTS?: R2Bucket; // R2: daily drought reports (CSV) for the admin view
  KB?: Vectorize; // Vectorize index of the farming library ("Ask anything")
  LIBRARY_MIN_SCORE?: string; // optional: minimum similarity for a library answer (default 0.55)

  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_NUMBER: string;
  WHATSAPP_FROM?: string; // optional: WhatsApp sender, e.g. "whatsapp:+14155238886" (Twilio sandbox, the default)
  ENGINE_URL: string;
  DEMO_KEY?: string; // /demo/<DEMO_KEY> opens a read-only admin view with no sign-in (unset = off)
  TIGER_DATABASE_URL?: string; // Tiger Data (TimescaleDB) connection string; NASA readings time series
  ENGINE_API_TOKEN?: string; // bearer token the Vultr engine checks on POST /plan
  VALIDATE_TWILIO_SIGNATURE: string;
  /** Optional: Gemini key for replies in languages without a built-in pack. */
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Optional: Cloudflare AI Gateway base, e.g. https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/google-ai-studio */
  GEMINI_BASE_URL?: string;
  /** Optional: Twilio <Say> voices for Swahili and Urdu (check Console > Voice > Text-to-Speech). Empty = that language continues by SMS. */
  SW_VOICE?: string;
  UR_VOICE?: string;

  /** Admin login (Auth0). /admin stays locked until all of these are set. */
  AUTH0_DOMAIN?: string; // e.g. farmline.us.auth0.com
  AUTH0_CLIENT_ID?: string;
  AUTH0_CLIENT_SECRET?: string; // secret
  ADMIN_EMAILS?: string; // comma-separated emails allowed into /admin
  SESSION_SECRET?: string; // secret: signs the admin login cookie
}

/** Languages with hand-written reply packs. "other" = translated by Gemini. */
export type Lang = "en" | "hi" | "ur" | "sw";
/** "roman" = Hindi/Urdu written in Latin letters; becomes Urdu for farms in Pakistan, Hindi otherwise. */
export type Detected = Lang | "roman" | "other";

export interface Place {
  lat: number;
  lon: number;
  name: string; // e.g. "Fallon, NV"
  localName?: string; // name in Urdu script, for Urdu replies
  country: string; // ISO 3166 alpha-2, lower case: "us", "in", "pk", "ke", ...
}

export interface Weather {
  rain30mm: number; // rain over the last 30 days with data, mm
  normal30mm: number; // long-term normal for the same 30 days, mm
  avgHighC: number; // mean daily max temperature over those days, °C
  days: number; // number of days with valid data
  soilRoot?: number; // NASA POWER root-zone soil wetness on the latest day, 0 (dry) to 1 (saturated)
}

/** What the Vultr engine returns (see README). */
export interface EngineOption {
  rotation: string[]; // e.g. ["wheat", "dry beans", "barley"]
  water_saving_pct: number; // vs. the farmer's current crop, positive = saves water
  income_change_pct: number; // vs. current crop, positive = earns more
  bad_year_income_change_pct: number; // same, in the 10th-percentile weather year
  kind: "water" | "income" | "drought";
  years?: { year: number; crop: string; sow?: string }[]; // optional: what to plant each year and when
  why?: string; // optional: one or two sentences, English, on why this plan fits
  builtIn?: boolean; // FarmLine's own rotation rules (no engine field here): no income figures
}

/** What a FarmerSession Durable Object remembers between messages. */
export interface Session {
  lang: Lang;
  place: Place;
  crop: string | null;
  options: EngineOption[] | null;
}

/** One farmer to check in the daily drought run. */
export interface AlertJob {
  phone: string;
  lang: Lang;
  lat: number;
  lon: number;
  place: string;
}

/** How one answer was made, saved with each exchange for the admin view. */
export interface Trace {
  detected?: Detected; // language FarmLine read from the message
  via?: "pk_town" | "postal" | "town_name" | "keypad" | "speech"; // how the farm was found
  lookup?: string; // the code or town name that matched
  lat?: number;
  lon?: number;
  weather?: { rain30mm: number; normal30mm: number; rainPct: number | null; avgHighC: number; days: number; soilPct?: number };
  engine?: { status: "answered" | "no_answer" | "not_connected"; ms: number; options?: EngineOption[] };
  translated?: boolean; // reply translated by Gemini / Workers AI (no built-in language pack)
  plan?: number; // which plan the farmer asked about ("1", "2", "3")
  heard?: { text: string; ms: number; model: string }; // phone call transcribed by Workers AI Whisper
  library?: { answered: boolean; ms: number; hits: { id: string; title: string; source: string; score: number }[] }; // farming library search (Vectorize)
  ms?: number; // total time to answer
}
