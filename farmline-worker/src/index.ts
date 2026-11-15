import { Hono } from "hono";
import { handleAlertBatch, runDailyCheck } from "./alerts";
import { farmerRedirect, renderAdmin } from "./admin";
import { adminOnly, callback, login, logout } from "./auth";
import { BALL_JS } from "./ball_bundle";
import { renderDashboard, renderStatsJson } from "./dashboard";
import { placeForCode, placeForName, weatherFor } from "./data";
import { askEngine } from "./engine";
import { computePlans, detailsText, flowAfterCall, handleSms, planWhy, plansText, shortPlace, toFlowLang, type Flow, type FlowResult } from "./flow";
import { FLOW, type FlowLang } from "./flow_text";
import { findPlace } from "./place";
import { reportResponse, saveDailyReport } from "./report";
import { askLibrary, indexLibrary, libraryReply } from "./library";
import { PACKS } from "./i18n";
import { findPakistanTown } from "./places_pk";
import { buildDetails, buildSms, buildSpeech, buildSpeechParts, detectLang, findCrop, findPostalCode, footer, placeCandidates, replyLang } from "./reply";
import { displayName, loadFlow, logMessage, logQuery, putCallResult, saveFlow, saveSession, takeCallResult, upsertFarmer, weatherTrace } from "./store";
import { FarmerSession } from "./session";
import { translateReply } from "./translate";
import { escapeXml, isValidTwilioSignature, sendSms, twiml } from "./twilio";
import type { AlertJob, Detected, Env, Lang, Place, Trace } from "./types";

type Vars = { params: Record<string, string>; admin: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Public live dashboard (no phone numbers), plus a plain health check.
app.get("/", (c) => renderDashboard(c.env));
app.get("/api/stats", (c) => renderStatsJson(c.env));
app.get("/ball.js", () =>
  new Response(BALL_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" } }),
);
app.get("/health", (c) => c.text("FarmLine is running"));

// Admin view: every farmer and conversation, behind the Auth0 login (phone numbers are private).
// Demo link for judges: the admin dashboard with no sign-in, read-only, phone numbers hidden.
// Off unless DEMO_KEY is set; the link is /demo/<DEMO_KEY>.
app.get("/demo/:key", async (c) => {
  const want = (c.env.DEMO_KEY ?? "").trim();
  const got = c.req.param("key");
  if (want.length < 12 || got.length !== want.length) return c.notFound();
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff) return c.notFound();
  return renderAdmin(c.env, "Demo view (read-only)", true);
});
app.get("/admin/login", (c) => login(c));
app.get("/admin/callback", (c) => callback(c));
app.get("/admin/logout", (c) => logout(c));
app.use("/admin", adminOnly);
app.use("/admin/*", adminOnly);
app.get("/admin", (c) => renderAdmin(c.env, c.get("admin")));
app.get("/admin/farmer/:phone", (c) => farmerRedirect(c.req.param("phone")));
app.get("/admin/reports/new", async (c) => {
  const r = await saveDailyReport(c.env);
  return r ? c.redirect(`/admin/reports/${r.date}.csv`) : c.text("R2 bucket not bound (REPORTS)", 503);
});
app.get("/admin/reports/:file", (c) => reportResponse(c.env, c.req.param("file").replace(/\.csv$/, "")));
app.get("/admin/library/rebuild", async (c) => c.json({ indexed: (await indexLibrary(c.env, true))?.length ?? 0 }));

// Every Twilio webhook: read the form fields and reject requests Twilio did not sign.
app.use("/sms", twilioOnly);
app.use("/voice", twilioOnly);
app.use("/voice/*", twilioOnly);

async function twilioOnly(c: any, next: () => Promise<void>) {
  if (c.get("params")) return next(); // already checked (route matched two patterns)
  const form = await c.req.parseBody();
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) if (typeof v === "string") params[k] = v;
  if (c.env.VALIDATE_TWILIO_SIGNATURE !== "false") {
    const ok = await isValidTwilioSignature(c.req.url, params, c.req.header("X-Twilio-Signature"), c.env.TWILIO_AUTH_TOKEN);
    if (!ok) return c.text("Forbidden", 403);
  }
  c.set("params", params);
  await next();
}

/** Run a promise after the response is sent (Cloudflare), or just let it run (tests). */
function background(c: any, p: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    void p;
  }
}

/**
 * Find the farm. Urdu / Roman Urdu: built-in Pakistani town list first. Then ZIP/PIN code (skipped for
 * Urdu and Swahili, whose 5-digit postcodes look like US ZIPs). Then any town name, any country.
 */
// ---------------- SMS: the main channel (menu flow, see flow.ts) ----------------

app.post("/sms", async (c) => {
  const { Body = "", From = "" } = c.get("params");
  const env = c.env;
  const channel = From.startsWith("whatsapp:") ? ("whatsapp" as const) : ("sms" as const); // same flow on WhatsApp
  const prev = await loadFlow<Flow>(env, From).catch(() => null);
  let r: FlowResult;
  try {
    r = await handleSms(env, From, Body, prev);
  } catch (e) {
    console.error("sms failed", e);
    const lang = prev?.lang ?? "en";
    background(c, logMessage(env, { phone: From, channel, lang, inbound: Body, outbound: PACKS[lang].busy, outcome: "busy" }));
    return twiml(`<Message>${escapeXml(PACKS[lang].busy)}</Message>`);
  }
  await saveFlow(env, From, r.flow).catch((e) => console.error("flow save failed", e));
  const where = r.place ? { place: displayName(r.place, r.lang), country: r.place.country } : {};
  if (r.text) background(c, logMessage(env, { phone: From, channel, lang: r.lang, inbound: Body, outbound: r.text, outcome: r.outcome, crop: r.crop ?? null, trace: r.trace, ...where }));
  if (r.later) {
    // Second SMS (crop plans) once the engine answers; the farmer already got "Checking NASA data...".
    background(c, (async () => {
      const t0 = Date.now();
      const out = await r.later!().catch((e) => { console.error("plans failed", e); return null; });
      if (!out) return;
      out.trace.ms = Date.now() - t0;
      await saveFlow(env, From, out.flow).catch(() => {});
      await sendSms(env, From, out.text);
      await logMessage(env, { phone: From, channel, lang: out.flow.lang, inbound: null, outbound: out.text, outcome: out.outcome, crop: out.flow.crop ?? null, trace: out.trace, ...where });
    })());
  }
  return twiml(r.text ? `<Message>${escapeXml(r.text)}</Message>` : "");
});

// ---------------- Phone call: for farmers who can't read or text ----------------

const VOICES: Record<Lang, { voice: string; language: string }> = {
  en: { voice: "Polly.Joanna", language: "en-US" },
  hi: { voice: "Polly.Aditi", language: "hi-IN" },
  ur: { voice: "", language: "ur-PK" }, // voice comes from UR_VOICE
  sw: { voice: "", language: "sw-KE" }, // voice comes from SW_VOICE
};

/** Swahili and Urdu need a voice set in the Worker config; without one they continue by SMS. */
const configuredVoice = (env: Env, lang: Lang) => (lang === "sw" ? env.SW_VOICE : lang === "ur" ? env.UR_VOICE : VOICES[lang].voice);

function say(env: Env, text: string, lang: Lang): string {
  let { language } = VOICES[lang];
  let voice = configuredVoice(env, lang);
  if (!voice) ({ voice, language } = VOICES.en); // fallback: read it with the English voice
  return `<Say voice="${voice}" language="${language}">${escapeXml(text)}</Say>`;
}
const url = (path: string, q: Record<string, string>) => escapeXml(`${path}?${new URLSearchParams(q)}`);
const asLang = (s: string | undefined): Lang => (s === "hi" || s === "ur" || s === "sw" ? s : "en");
const DIGIT_LANG: Record<string, Lang> = { "1": "en", "2": "hi", "3": "sw" }; // Urdu is no longer in the menu

// 1. Language menu: 1 English, 2 Hindi, 3 Urdu, 4 Swahili. No key pressed -> English.
app.post("/voice", (c) =>
  twiml(
    `<Gather input="dtmf" numDigits="1" timeout="6" action="/voice/lang">` +
      say(c.env, PACKS.en.menu, "en") + say(c.env, PACKS.hi.menu, "hi") +
      // Urdu menu line: Urdu voice if set, else the Hindi voice (spoken Hindi and Urdu are mutually understood)
      say(c.env, PACKS.sw.menu, "sw") +
      `</Gather><Redirect method="POST">/voice/lang</Redirect>`,
  ),
);

// 2a. US / India: ZIP or PIN code on the keypad (more reliable than speech in a noisy field).
const askCode = (env: Env, lang: Lang) =>
  twiml(
    `<Gather input="dtmf" finishOnKey="#" timeout="10" action="${url("/voice/code", { lang })}">${say(env, PACKS[lang].askCode, lang)}</Gather>` +
      `${say(env, PACKS[lang].noInput, lang)}<Redirect method="POST">${url("/voice/askcode", { lang })}</Redirect>`,
  );

// 2b. Pakistan and Kenya (Urdu, Swahili): say the town name.
const askTown = (env: Env, lang: Lang) =>
  twiml(
    `<Gather input="speech" language="${VOICES[lang].language}" speechTimeout="auto" timeout="6" action="${url("/voice/town", { lang })}">${say(env, PACKS[lang].askTown, lang)}</Gather>` +
      `${say(env, PACKS[lang].noInput, lang)}<Redirect method="POST">${url("/voice/asktown", { lang })}</Redirect>`,
  );

/** Say a prompt in the caller's language. Urdu without an Urdu voice uses the Hindi voice (spoken Hindi and Urdu are mutually understood). */
function sayL(env: Env, lang: Lang, key: "askSpeak" | "checking" | "noInput" | "goodbye"): string {
  if (lang === "ur" && !env.UR_VOICE) return say(env, PACKS.hi[key], "hi");
  return say(env, PACKS[lang][key], lang);
}

/** Keypad / town-name flow (used when Workers AI Whisper isn't available or the caller stays silent). */
function classicFlow(c: any, lang: Lang) {
  const from = c.get("params").From;
  if ((lang === "sw" || lang === "ur") && !configuredVoice(c.env, lang)) {
    // No voice configured for this language yet: continue by SMS, which fully supports it.
    if (from) background(c, sendSms(c.env, from, PACKS[lang].help));
    const bye =
      lang === "sw"
        ? say(c.env, "Asante. Tumekutumia ujumbe kwa SMS. Tafadhali jibu kwa jina la mji wako na zao lako.", "sw")
        : say(c.env, "शुक्रिया। हमने आपको उर्दू में SMS भेजा है। कृपया अपने शहर का नाम और फ़सल लिखकर भेजें।", "hi");
    return twiml(`${bye}<Hangup/>`);
  }
  return lang === "sw" || lang === "ur" ? askTown(c.env, lang) : askCode(c.env, lang);
}

// 2. Speak freely: record the farmer's crop, town and question; Workers AI Whisper transcribes it (any of the 4 languages).
const speakPrompt = (env: Env, lang: Lang, tries: number) =>
  twiml(
    sayL(env, lang, "askSpeak") +
      `<Record action="${url("/voice/heard", { lang, tries: String(tries) })}" method="POST" maxLength="15" timeout="3" playBeep="true" trim="trim-silence"/>` +
      `<Redirect method="POST">${url("/voice/fallback", { lang })}</Redirect>`,
  );

app.post("/voice/lang", (c) => {
  const lang = DIGIT_LANG[c.get("params").Digits ?? ""] ?? "en";
  return c.env.AI ? speakPrompt(c.env, lang, 0) : classicFlow(c, lang);
});
app.post("/voice/fallback", (c) => classicFlow(c, asLang(c.req.query("lang"))));

// 3. Recording arrives: answer it in the background (the call hears "checking NASA data" meanwhile), so a slow
//    NASA or engine call never runs into Twilio's 15-second webhook limit.
app.post("/voice/heard", async (c) => {
  const lang = asLang(c.req.query("lang"));
  const tries = Number(c.req.query("tries") ?? 0);
  const { RecordingUrl = "", RecordingSid = "", CallSid = "", From = "" } = c.get("params");
  if (!RecordingUrl) return classicFlow(c, lang);
  const job = answerRecording(c.env, lang, RecordingUrl, RecordingSid, From);
  if (c.env.FARMER && From && CallSid) {
    background(c, job.then((r) => putCallResult(c.env, From, CallSid, r)));
    background(c, job.then((r) => (r.plant ? putCallResult(c.env, From, `plant-${CallSid}`, { plant: r.plant, lang: r.speechLang }) : undefined)));
    return twiml(`${sayL(c.env, lang, "checking")}<Pause length="2"/><Redirect method="POST">${url("/voice/result", { lang, tries: String(tries), n: "0" })}</Redirect>`);
  }
  return callAnswerTwiml(c.env, lang, tries, await job); // no Durable Object bound: answer in this request
});

app.post("/voice/result", async (c) => {
  const lang = asLang(c.req.query("lang"));
  const tries = Number(c.req.query("tries") ?? 0);
  const n = Number(c.req.query("n") ?? 0);
  const { CallSid = "", From = "" } = c.get("params");
  const r = await takeCallResult<CallAnswer>(c.env, From, CallSid);
  if (r) return callAnswerTwiml(c.env, lang, tries, r);
  if (n >= 8) return twiml(`${sayL(c.env, lang, "goodbye")}<Hangup/>`); // the SMS still arrives when the answer is ready
  return twiml(`<Pause length="2"/><Redirect method="POST">${url("/voice/result", { lang, tries: String(tries), n: String(n + 1) })}</Redirect>`);
});

interface CallAnswer { ok: boolean; retry?: boolean; speech?: string; plant?: string; speechLang?: Lang }

// After the NASA summary: "What to plant instead? Press 1."
const PLANT_ASK: Record<Lang, string> = {
  en: "Do you want to know what to plant instead? Press 1. To end the call, press 2.",
  hi: "क्या आप जानना चाहते हैं कि इसकी जगह क्या बोएं? 1 दबाएं। कॉल खत्म करने के लिए 2 दबाएं।",
  ur: "کیا آپ جاننا چاہتے ہیں کہ اس کی جگہ کیا بوئیں؟ 1 دبائیں۔ کال ختم کرنے کے لیے 2 دبائیں۔",
  sw: "Je, ungependa kujua cha kupanda badala yake? Bonyeza 1. Kumaliza simu, bonyeza 2.",
};
const speakIn = (env: Env, lang: Lang) => (lang === "ur" && !env.UR_VOICE ? "hi" : lang);
const sayIn = (env: Env, text: Record<Lang, string>, lang: Lang) => say(env, text[speakIn(env, lang)], speakIn(env, lang));

app.post("/voice/plant", async (c) => {
  const lang = asLang(c.req.query("lang"));
  const { CallSid = "", From = "", Digits = "" } = c.get("params");
  const saved = await takeCallResult<{ plant: string; lang?: Lang }>(c.env, From, `plant-${CallSid}`);
  if (Digits === "1" && saved?.plant) {
    const sl = saved.lang ?? lang;
    return twiml(`${say(c.env, saved.plant, sl)}${sayL(c.env, lang, "goodbye")}<Hangup/>`);
  }
  return twiml(`${sayL(c.env, lang, "goodbye")}<Hangup/>`);
});

function callAnswerTwiml(env: Env, lang: Lang, tries: number, r: CallAnswer): Response {
  if (r.retry) {
    // Couldn't hear or place it: one more try by voice, then the keypad / town flow.
    if (tries < 1) return twiml(sayL(env, lang, "noInput") + speakPromptInner(env, lang, tries + 1));
    return twiml(`${sayL(env, lang, "noInput")}<Redirect method="POST">${url("/voice/fallback", { lang })}</Redirect>`);
  }
  if (!r.ok) return twiml(`${say(env, PACKS[lang === "ur" && !env.UR_VOICE ? "hi" : lang].busy, lang === "ur" && !env.UR_VOICE ? "hi" : lang)}<Hangup/>`);
  const spoken = r.speech && r.speechLang ? say(env, r.speech, r.speechLang) : "";
  if (r.ok && r.speech && env.FARMER) {
    // Same questions as the SMS flow, on the keypad: water, water outlook, soil, then the 3 plans.
    return twiml(`${spoken}<Redirect method="POST">${url("/voice/q", { lang, step: "start" })}</Redirect>`);
  }
  if (r.plant && env.FARMER) {
    // Ask; if no key is pressed, Twilio falls through to the goodbye (the SMS still has the crops).
    return twiml(
      `${spoken}<Gather numDigits="1" timeout="6" method="POST" action="${url("/voice/plant", { lang })}">${sayIn(env, PLANT_ASK, lang)}</Gather>` +
        `${sayL(env, lang, "goodbye")}<Hangup/>`,
    );
  }
  return twiml(`${spoken}${sayL(env, lang, "goodbye")}<Hangup/>`);
}
// ---- The plan questions on a call (keypad), the same steps and wording as the SMS flow ----
const KEYPAD: Record<FlowLang, { press: (d: string, x: string) => string; plansAsk: string; detailAsk: string; bye: string; noPlace: string }> = {
  en: { press: (d, x) => `Press ${d} for ${x}.`, plansAsk: "Press 1, 2 or 3 to hear a plan, or 0 to hear why.", detailAsk: "Press 0 to hear why, 1, 2 or 3 for another plan, or 9 to end the call.", bye: "We have sent your plans by text. Thank you for calling FarmLine.", noPlace: "Please call again and say your town and crop." },
  hi: { press: (d, x) => `${x} के लिए ${d} दबाएं।`, plansAsk: "किसी योजना को सुनने के लिए 1, 2 या 3 दबाएं, या क्यों जानने के लिए 0 दबाएं।", detailAsk: "क्यों जानने के लिए 0, दूसरी योजना के लिए 1, 2 या 3, या कॉल खत्म करने के लिए 9 दबाएं।", bye: "हमने आपकी योजनाएं SMS से भेज दी हैं। FarmLine को कॉल करने के लिए धन्यवाद।", noPlace: "कृपया फिर से कॉल करें और अपने शहर और फसल का नाम बताएं।" },
  sw: { press: (d, x) => `Bonyeza ${d} kwa ${x}.`, plansAsk: "Bonyeza 1, 2 au 3 kusikia mpango, au 0 kusikia kwa nini.", detailAsk: "Bonyeza 0 kusikia kwa nini, 1, 2 au 3 kwa mpango mwingine, au 9 kumaliza simu.", bye: "Tumekutumia mipango yako kwa SMS. Asante kwa kupiga FarmLine.", noPlace: "Tafadhali piga tena na useme mji na zao lako." },
};
/** SMS text -> words to say: "1 Irrigated" -> "Press 1 for irrigated", "A > B" -> "A, then B", no Reply lines. */
function spoken(text: string, fl: FlowLang, lang: Lang): string {
  const K = KEYPAD[fl], P = PACKS[lang];
  return text
    .split("\n")
    .filter((l) => !/^(reply|jibu)\b|भेजें।$/i.test(l.trim()))
    .map((l) => {
      const opt = l.match(/^(\d) (.+)$/);
      if (opt) return K.press(opt[1], opt[2].toLowerCase());
      const plan = l.match(/^(\d)\) (.+)$/);
      return (plan ? `${P.plan} ${plan[1]}: ${plan[2]}` : l).replace(/ > /g, P.then.replace(/^,/, ","));
    })
    .map((l) => (/[.?!।:]$/.test(l.trim()) ? l : `${l}.`))
    .join(" ");
}

app.post("/voice/q", async (c) => {
  const lang = asLang(c.req.query("lang"));
  const step = c.req.query("step") ?? "start";
  const { From = "", Digits = "", SpeechResult = "" } = c.get("params");
  const env = c.env;
  const f = await loadFlow<Flow>(env, From);
  const fl: FlowLang = f?.lang ?? toFlowLang(lang);
  const L = FLOW[fl], K = KEYPAD[fl];
  const sl: Lang = fl === "en" || fl === "hi" ? fl : configuredVoice(env, fl) ? fl : "en";
  const sayIt = (t: string) => say(env, t, sl);
  const bye = () => twiml(`${sayIt(K.bye)}<Hangup/>`);
  if (!f?.place) return twiml(`${sayIt(K.noPlace)}<Hangup/>`);
  const ask = (next: string, text: string) =>
    twiml(`<Gather numDigits="1" timeout="8" method="POST" action="${url("/voice/q", { lang, step: next })}">${sayIt(spoken(text, fl, sl))}</Gather>${sayIt(K.bye)}<Hangup/>`);
  const save = (nf: Flow) => saveFlow(env, From, { ...nf, at: new Date().toISOString() });
  const d = Digits.trim();

  if (step === "start") {
    if (!f.crop) {
      const code = VOICES[sl].language;
      return twiml(`<Gather input="speech" language="${code}" speechTimeout="auto" method="POST" action="${url("/voice/q", { lang, step: "crop" })}">${sayIt(L.askCrop)}</Gather>${sayIt(K.bye)}<Hangup/>`);
    }
    return ask("water", L.askWater);
  }
  if (step === "crop") {
    const heard = SpeechResult.trim();
    const found = findCrop(heard);
    const crop = found === "maize" && /\bcorn\b/i.test(heard) ? "corn" : found ?? (heard.toLowerCase().replace(/[^\p{L} ]/gu, "").trim().slice(0, 30) || null);
    await save({ ...f, crop, step: "water" });
    return ask("water", L.askWater);
  }
  if (step === "water") {
    if (d === "1") { await save({ ...f, irrigated: true, step: "outlook" }); return ask("outlook", L.askOutlook); }
    if (d === "2") { await save({ ...f, irrigated: false, outlook: undefined, step: "soil" }); return ask("soil", L.askSoil); }
    return ask("water", L.askWater);
  }
  if (step === "outlook") {
    if (!["1", "2", "3"].includes(d)) return ask("outlook", L.askOutlook);
    await save({ ...f, outlook: (["same", "less", "much_less"] as const)[Number(d) - 1], step: "soil" });
    return ask("soil", L.askSoil);
  }
  if (step === "soil") {
    if (!["1", "2", "3"].includes(d)) return ask("soil", L.askSoil);
    const soil = (["good", "tired", "unknown"] as const)[Number(d) - 1];
    const snap: Flow = { ...f, soil, priority: f.outlook === "less" || f.outlook === "much_less" ? "water" : soil === "tired" ? "safe" : "income", step: "plans" };
    const started = Date.now();
    const r = await computePlans(env, snap, 8000); // a call webhook must answer within 15 s
    await save(r.flow);
    r.trace.ms = Date.now() - started;
    background(c, sendSms(env, From, r.text).catch((e) => console.error("plans sms failed", e)));
    background(c, logMessage(env, { phone: From, channel: "call", lang, inbound: `soil: ${soil}`, outbound: r.text, outcome: "plans", place: displayName(f.place, lang), country: f.place.country, crop: f.crop ?? null, trace: r.trace }).catch(() => {}));
    const checking = L.checking(shortPlace(f.place));
    return twiml(`${sayIt(checking)}<Gather numDigits="1" timeout="8" method="POST" action="${url("/voice/q", { lang, step: "plans" })}">${sayIt(spoken(plansText(fl, r.flow.options!), fl, sl))}${sayIt(K.plansAsk)}</Gather>${sayIt(K.bye)}<Hangup/>`);
  }
  if (step === "plans") {
    const again = (t: string) => twiml(`<Gather numDigits="1" timeout="8" method="POST" action="${url("/voice/q", { lang, step: "plans" })}">${sayIt(t)}${sayIt(K.detailAsk)}</Gather>${sayIt(K.bye)}<Hangup/>`);
    if (["1", "2", "3"].includes(d) && f.options?.[Number(d) - 1]) {
      const det = detailsText(f, Number(d))!;
      await save({ ...f, why: planWhy(f, f.options[Number(d) - 1]) });
      return again(spoken(det, fl, sl));
    }
    if (d === "0") return again(f.why ?? L.noWhy);
    return bye();
  }
  return bye();
});

const speakPromptInner = (env: Env, lang: Lang, tries: number) =>
  sayL(env, lang, "askSpeak") +
  `<Record action="${url("/voice/heard", { lang, tries: String(tries) })}" method="POST" maxLength="15" timeout="3" playBeep="true" trim="trim-silence"/>` +
  `<Redirect method="POST">${url("/voice/fallback", { lang })}</Redirect>`;

const WHISPER = "@cf/openai/whisper-large-v3-turbo";

/** Fetch the call recording from Twilio (it can take a moment to be ready), as base64. */
async function fetchRecording(env: Env, recordingUrl: string): Promise<string | null> {
  const auth = "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${recordingUrl}.wav`, { headers: { Authorization: auth } });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
      return btoa(bin);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Delete the recording from Twilio once it is transcribed: FarmLine keeps the words, not the voice. */
async function deleteRecording(env: Env, recordingSid: string) {
  if (!recordingSid) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.json`, {
    method: "DELETE",
    headers: { Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`) },
  }).catch((e) => console.error("recording delete failed", e));
}

/** Language the answer can be spoken in (Urdu falls back to Hindi speech; Swahili/Urdu need a configured voice otherwise). */
function speechLangFor(env: Env, lang: Lang): Lang | null {
  if (lang === "en" || lang === "hi") return lang;
  if (configuredVoice(env, lang)) return lang;
  return lang === "ur" ? "hi" : null;
}

/** Recording -> Whisper text -> the same brain as SMS (farm + NASA + engine, or the farming library) -> SMS + speech. */
async function answerRecording(env: Env, lang: Lang, recordingUrl: string, recordingSid: string, from: string): Promise<CallAnswer> {
  const started = Date.now();
  try {
    const audio = await fetchRecording(env, recordingUrl);
    if (!audio) return { ok: false };
    const t = Date.now();
    const out = (await env.AI!.run(WHISPER as any, { audio, language: lang, task: "transcribe", vad_filter: true })) as { text?: string };
    const text = (out.text ?? "").trim();
    await deleteRecording(env, recordingSid);
    const trace: Trace = { heard: { text, ms: Date.now() - t, model: "whisper-large-v3-turbo" }, detected: lang };
    if (!text) return { ok: true, retry: true };

    const detected = detectLang(text);
    const { place, via, lookup } = await findPlace(env, text, detected === "en" && lang !== "en" ? (lang as Detected) : detected);
    const crop = findCrop(text);
    if (place) {
      const [weather, { options, engine }] = await Promise.all([weatherFor(env, place.lat, place.lon), askEngine(env, place, crop, text, { timeoutMs: 12000 })]);
      const smsText = `${buildSms(place, weather, lang, crop, options)}\n${footer(lang, Boolean(options?.length))}`;
      Object.assign(trace, { via, lookup, lat: place.lat, lon: place.lon, weather: weatherTrace(weather), engine, ms: Date.now() - started });
      if (from) {
        await sendSms(env, from, smsText);
        await Promise.all([
          logMessage(env, { phone: from, channel: "call", lang, inbound: text, outbound: smsText, outcome: options?.length ? "plans" : "weather", place: displayName(place, lang), country: place.country, crop, trace }),
          saveSession(env, from, { lang, place, crop, options }).catch((e) => console.error("session save failed", e)),
          loadFlow<Flow>(env, from).then((prev) => saveFlow(env, from, flowAfterCall(prev, lang, place, crop, options))).catch(() => {}),
          upsertFarmer(env, from, lang, place, crop).catch((e) => console.error("farmer save failed", e)),
          logQuery(env, "call", lang, place, crop, weather).catch((e) => console.error("log failed", e)),
        ]);
      }
      const sl = speechLangFor(env, lang);
      const parts = sl ? buildSpeechParts(place, weather, sl, crop, options) : null;
      return { ok: true, speech: parts?.summary, plant: parts?.plant || undefined, speechLang: sl ?? undefined };
    }

    // No place in what they said: try the farming library (Vectorize), like SMS.
    const lib = await askLibrary(env, text);
    if (lib.hits.length || lib.ms) trace.library = { answered: Boolean(lib.entry), ms: lib.ms, hits: lib.hits };
    if (!lib.entry) {
      if (from) await logMessage(env, { phone: from, channel: "call", lang, inbound: text, outbound: PACKS[lang].noInput, outcome: "not_found", trace: { ...trace, ms: Date.now() - started } });
      return { ok: true, retry: true };
    }
    const english = libraryReply(lib.entry);
    const smsText = lang === "en" ? english : await translateReply(env, text, english);
    trace.translated = lang !== "en" && smsText !== english;
    trace.ms = Date.now() - started;
    if (from) {
      await sendSms(env, from, smsText);
      await logMessage(env, { phone: from, channel: "call", lang, inbound: text, outbound: smsText, outcome: "library", trace });
    }
    const sl = speechLangFor(env, lang);
    const speakable = sl === lang ? smsText.replace(/^FarmLine:\s*/, "").split("\n")[0] : sl === "en" ? lib.entry.text : undefined;
    return { ok: true, speech: speakable, speechLang: speakable ? (sl as Lang) : undefined };
  } catch (e) {
    console.error("call recording answer failed", e);
    return { ok: false };
  }
}

app.post("/voice/askcode", (c) => askCode(c.env, asLang(c.req.query("lang"))));
app.post("/voice/asktown", (c) => askTown(c.env, asLang(c.req.query("lang"))));

/** Once the place is known: ask the question by voice; silence still gets the NASA weather. */
function askQuestion(env: Env, lang: Lang, place: Place, via: "keypad" | "speech", lookup: string) {
  const next = url("/voice/question", {
    lang, via, lookup, lat: String(place.lat), lon: String(place.lon), name: place.name, local: place.localName ?? "", country: place.country,
  });
  return twiml(
    `<Gather input="speech" language="${VOICES[lang].language}" speechTimeout="auto" timeout="6" action="${next}">${say(env, PACKS[lang].askQuestion, lang)}</Gather>` +
      `<Redirect method="POST">${next}</Redirect>`,
  );
}

// 3a. Keypad code -> place.
app.post("/voice/code", async (c) => {
  const lang = asLang(c.req.query("lang"));
  const digits = (c.get("params").Digits ?? "").replace(/\D/g, "");
  let place: Place | null = null;
  try {
    place = await placeForCode(c.env, digits);
  } catch (e) {
    console.error("geocode failed", e);
  }
  if (!place) return twiml(`${say(c.env, PACKS[lang].notFound, lang)}<Redirect method="POST">${url("/voice/askcode", { lang })}</Redirect>`);
  return askQuestion(c.env, lang, place, "keypad", digits);
});

// 3b. Spoken town name -> place.
app.post("/voice/town", async (c) => {
  const lang = asLang(c.req.query("lang"));
  const spoken = c.get("params").SpeechResult ?? "";
  let place: Place | null = null;
  try {
    place = lang === "ur" ? findPakistanTown(spoken, true) : null;
    for (const n of place ? [] : [...placeCandidates(spoken), spoken]) {
      place = await placeForName(c.env, n);
      if (place) break;
    }
  } catch (e) {
    console.error("town lookup failed", e);
  }
  if (!place) return twiml(`${say(c.env, PACKS[lang].notFound, lang)}<Redirect method="POST">${url("/voice/asktown", { lang })}</Redirect>`);
  return askQuestion(c.env, lang, place, "speech", spoken);
});

// 4. Answer out loud, then send the same answer as an SMS.
app.post("/voice/question", async (c) => {
  const q = c.req.query();
  const lang = asLang(q.lang);
  const { SpeechResult = "", From = "" } = c.get("params");
  const place: Place = { lat: Number(q.lat), lon: Number(q.lon), name: q.name ?? "", localName: q.local || undefined, country: q.country ?? "" };
  const crop = findCrop(SpeechResult);
  const started = Date.now();
  try {
    const [weather, { options, engine }] = await Promise.all([weatherFor(c.env, place.lat, place.lon), askEngine(c.env, place, crop, SpeechResult)]);
    const smsText = `${buildSms(place, weather, lang, crop, options)}\n${footer(lang, Boolean(options?.length))}`;
    if (From) {
      background(c, sendSms(c.env, From, smsText));
      const trace: Trace = { detected: lang, via: q.via === "speech" ? "speech" : "keypad", lookup: q.lookup || undefined, lat: place.lat, lon: place.lon, weather: weatherTrace(weather), engine, ms: Date.now() - started };
      background(c, logMessage(c.env, { phone: From, channel: "call", lang, inbound: SpeechResult || null, outbound: smsText, outcome: options?.length ? "plans" : "weather", place: displayName(place, lang), country: place.country, crop, trace }));
      background(c, saveSession(c.env, From, { lang, place, crop, options }).catch((e) => console.error("session save failed", e)));
      background(c, loadFlow<Flow>(c.env, From).then((prev) => saveFlow(c.env, From, flowAfterCall(prev, lang, place, crop, options))).catch(() => {}));
      background(c, upsertFarmer(c.env, From, lang, place, crop).catch((e) => console.error("farmer save failed", e)));
    }
    background(c, logQuery(c.env, "call", lang, place, crop, weather).catch((e) => console.error("log failed", e)));
    return twiml(`${say(c.env, buildSpeech(place, weather, lang, crop, options), lang)}${say(c.env, PACKS[lang].goodbye, lang)}<Hangup/>`);
  } catch (e) {
    console.error("call answer failed", e);
    return twiml(`${say(c.env, PACKS[lang].busy, lang)}<Hangup/>`);
  }
});

// Cloudflare entry points: HTTP (Twilio webhooks + dashboard), the daily Cron Trigger, and the alert queue.
export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(Promise.all([runDailyCheck(env), saveDailyReport(env).catch((e) => console.error("daily report failed", e))])),
  queue: (batch: MessageBatch<AlertJob>, env: Env) => handleAlertBatch(batch, env),
};
export { FarmerSession };
export { app };
