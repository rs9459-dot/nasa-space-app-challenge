// Offline tests: NASA POWER, Zippopotam, the engine and Twilio are mocked.
// Signatures are made with Twilio's own Python library, so validation is checked against the real algorithm.
import { execFileSync } from "node:child_process";
import { app } from "../src/index";
import { handleAlertBatch, runDailyCheck } from "../src/alerts";
import { makeSession } from "../src/auth";
import { makeAI, makeD1, makeDO, makeKV, makeQueue, makeR2, makeVectorize } from "./mocks";
import { saveDailyReport } from "../src/report";
import worker from "../src/index";
import type { Env } from "../src/types";

const TOKEN = "test_auth_token_123";
const env: Env = {
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: TOKEN,
  TWILIO_NUMBER: "+17025550100",
  ENGINE_URL: "",
  VALIDATE_TWILIO_SIGNATURE: "true",
};

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + detail}`);
  if (!cond) failures++;
}

function twilioSign(url: string, params: Record<string, string>): string {
  const py = `import sys,json\nfrom twilio.request_validator import RequestValidator\nprint(RequestValidator(sys.argv[1]).compute_signature(sys.argv[2], json.loads(sys.argv[3])))`;
  return execFileSync("python3", ["-c", py, TOKEN, url, JSON.stringify(params)]).toString().trim();
}

async function post(path: string, params: Record<string, string>, opts: { badSig?: boolean; e?: Env } = {}) {
  const url = "http://localhost" + path;
  const sig = opts.badSig ? "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" : twilioSign(url, params);
  const res = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
    body: new URLSearchParams(params).toString(),
  }, opts.e ?? env);
  return { status: res.status, text: await res.text() };
}

// ---- fake outside world ----
let powerDown = false;
let auth0Claims: Record<string, unknown> = {};
const recordingsDeleted: string[] = [];
let powerCalls = 0;
let geminiBreaksNumbers = false;
const smsSent: Record<string, string>[] = [];
const days: Record<string, number> = {};
const soilDays: Record<string, number> = {};
let forecastDaily: number[] = [0, 0, 0, 0, 0, 0, 0];
const engineBodies: any[] = [];
const tmax: Record<string, number> = {};
{
  const end = new Date(Date.now() - 3 * 864e5);
  for (let i = 44; i >= 0; i--) {
    const k = new Date(end.getTime() - i * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    days[k] = i < 3 ? -999 : 0.1; // newest 3 days missing, like real POWER lag
    tmax[k] = i < 3 ? -999 : 20;
    soilDays[k] = i < 3 ? -999 : 0.25;
  }
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("zippopotam.us/us/89406"))
    return json({ places: [{ "place name": "Fallon", "state abbreviation": "NV", latitude: "39.4735", longitude: "-118.7774" }] });
  if (u.includes("zippopotam.us/in/141001"))
    return json({ places: [{ "place name": "Ludhiana", state: "Punjab", latitude: "30.9", longitude: "75.85" }] });
  if (u.includes("zippopotam.us")) return json({}, 404);
  if (u.includes("geocoding-api.open-meteo.com")) {
    const name = new URL(u).searchParams.get("name");
    if (name === "Nakuru") return json({ results: [{ name: "Nakuru", latitude: -0.28, longitude: 36.07, country_code: "KE", admin1: "Nakuru" }] });
    if (name === "Fallon") return json({ results: [{ name: "Fallon", latitude: 39.47, longitude: -118.78, country_code: "US", admin1: "Nevada" }] });
    return json({ generationtime_ms: 0.1 });
  }
  if (u.includes("generativelanguage.googleapis.com")) {
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
    const english = prompt.split("Reply:\n<<<")[1].replace(/>>>$/, "");
    const reply = geminiBreaksNumbers ? english.replace(/\d+/, "999") : "[BN] " + english;
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply }) }] } }] });
  }
  if (u.includes("power.larc.nasa.gov")) {
    powerCalls++;
    if (powerDown) return json({}, 500);
    if (u.includes("/daily/")) return json({ properties: { parameter: { PRECTOTCORR: days, T2M_MAX: tmax, GWETROOT: soilDays } } });
    const monthly = Object.fromEntries(["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC","ANN"].map((m) => [m, 0.5]));
    return json({ properties: { parameter: { PRECTOTCORR: monthly } } });
  }
  if (u.includes("api.open-meteo.com/v1/forecast")) return json({ daily: { precipitation_sum: forecastDaily } });
  if (u.includes("engine.test")) {
    engineBodies.push(JSON.parse(String(init?.body)));
    return json({ options: [
      { rotation: ["wheat", "dry beans", "barley"], water_saving_pct: 35, income_change_pct: -4, bad_year_income_change_pct: -10, kind: "water" },
      { rotation: ["alfalfa", "wheat", "alfalfa"], water_saving_pct: 12, income_change_pct: 8, bad_year_income_change_pct: -20, kind: "income" },
      { rotation: ["sorghum", "safflower", "wheat"], water_saving_pct: 28, income_change_pct: 1, bad_year_income_change_pct: 2, kind: "drought" },
    ] });
  }
  if (u.includes("farmline.test.auth0.com/oauth/token")) {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const claims = { iss: "https://farmline.test.auth0.com/", aud: "cid", exp: Math.floor(Date.now() / 1000) + 600, ...auth0Claims };
    return json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.sig` });
  }
  if (u.includes("/Recordings/")) {
    if (init?.method === "DELETE") { recordingsDeleted.push(u); return new Response(null, { status: 204 }); }
    return new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]), { status: 200 });
  }
  if (u.includes("api.twilio.com")) {
    smsSent.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
    return json({ sid: "SM1" }, 201);
  }
  throw new Error("unexpected fetch " + u);
}) as typeof fetch;

// ---- tests ----
{
  const r = await post("/sms", { Body: "hello", From: "+1555" }, { badSig: true });
  check("forged Twilio signature is rejected", r.status === 403, String(r.status));
}
{
  const r = await post("/sms", { Body: "hello", From: "+1555" });
  check("new farmer's first message gets the language menu", r.status === 200 && r.text.includes("Choose your language") && r.text.includes("3 Kiswahili") && !r.text.includes("اردو"), r.text);
}
{
  const r = await post("/sms", { Body: "alfalfa 89406 water is short", From: "+1555" });
  // 30 valid days x 0.1 mm = 3 mm = 0.12 in; normal 30 x 0.5 = 15 mm = 0.59 in; 20 °C = 68 °F
  check("US SMS uses place, inches, °F", r.text.includes("Fallon, NV") && r.text.includes("0.12 in (normal 0.59 in, 20%)") && r.text.includes("68°F"), r.text);
  check("US SMS says drier than normal", r.text.includes("Drier than normal."), r.text);
  check("no plans claimed while engine is off", !r.text.includes("plans"), r.text);
}
{
  const r = await post("/sms", { Body: "गेहूं 141001 पानी कम है", From: "+91999" });
  check("Hindi SMS answers in Hindi with mm", r.text.includes("Ludhiana") && r.text.includes("मिमी") && r.text.includes("सामान्य से सूखा"), r.text);
}
{
  const r = await post("/sms", { Body: "alfalfa 89406", From: "+1555" }, { e: { ...env, ENGINE_URL: "https://engine.test/rotations" } });
  check("engine options appear in SMS", r.text.includes("3 plans instead of alfalfa") && r.text.includes("1) wheat &gt; dry beans &gt; barley: saves 35% water") && r.text.includes("3) sorghum &gt; safflower &gt; wheat: safest"), r.text);
}
{
  const r = await post("/sms", { Body: "alfalfa 00000", From: "+1555" });
  check("unknown ZIP from a new farmer gets the language menu", r.text.includes("Choose your language"), r.text);
}
{
  powerDown = true;
  const r = await post("/sms", { Body: "alfalfa 89406", From: "+1555" });
  powerDown = false;
  check("NASA outage gives a polite retry message", r.text.includes("not reachable"), r.text);
}
// ---- phone call ----
{
  const r = await post("/voice", { CallSid: "CA1", From: "+1555" });
  check("call starts with language menu", r.text.includes('<Gather input="dtmf" numDigits="1"') && r.text.includes("press 1"), r.text);
}
{
  const r = await post("/voice/lang", { Digits: "2" });
  check("pressing 2 switches to Hindi", r.text.includes('language="hi-IN"') && r.text.includes("पिन कोड"), r.text);
}
{
  const r = await post("/voice/code?lang=en", { Digits: "89406" });
  check("ZIP on keypad leads to speech question", r.text.includes('<Gather input="speech" language="en-US"') && r.text.includes("lat=39.4735") && r.text.includes("&amp;"), r.text);
}
{
  const r = await post("/voice/code?lang=en", { Digits: "12" });
  check("bad keypad code asks again", r.text.includes("could not find that place") && r.text.includes("/voice/askcode?lang=en"), r.text);
}
{
  smsSent.length = 0;
  const q = "/voice/question?lang=en&lat=39.4735&lon=-118.7774&name=Fallon%2C+NV&country=us";
  const r = await post(q, { SpeechResult: "I grow alfalfa and my water is getting cut", From: "+15551234" }, { e: { ...env, ENGINE_URL: "https://engine.test/rotations" } });
  await new Promise((res) => setTimeout(res, 50));
  check("call answer is spoken, then hangs up", r.text.includes("<Say") && r.text.includes("For Fallon, NV, here is NASA data.") && r.text.includes("Plan 1: wheat, then dry beans, then barley") && r.text.includes("<Hangup/>"), r.text);
  check("SMS summary sent after the call", smsSent.length === 1 && smsSent[0].To === "+15551234" && smsSent[0].Body.includes("saves 35% water"), JSON.stringify(smsSent));
}

// ---- languages ----
const withEngine = { ...env, ENGINE_URL: "https://engine.test/rotations" };
{
  const r = await post("/sms", { Body: "گندم فیصل آباد پانی کم ہے", From: "+92300" }, { e: withEngine });
  check("Urdu SMS finds Faisalabad, replies in Urdu, metric", r.text.includes("FarmLine - فیصل آباد (NASA ڈیٹا)") && r.text.includes("پچھلے 30 دنوں میں بارش: 3 ملی میٹر (معمول 15 ملی میٹر، 20%)".replace("، 20%", ", 20%")) && r.text.includes("معمول سے زیادہ خشک"), r.text);
  check("Urdu plans use Urdu crop names", r.text.includes("گندم کی جگہ 3 منصوبے") && r.text.includes("1) گندم &gt; لوبیا &gt; جو: 35% پانی کی بچت"), r.text);
}
{
  const r = await post("/sms", { Body: "gandum Multan pani kam hai", From: "+92301" });
  check("Roman Urdu + Pakistani town -> Urdu reply", r.text.includes("FarmLine - ملتان (NASA ڈیٹا)") && r.text.includes("اپنی فصل") === false, r.text);
}
{
  const r = await post("/sms", { Body: "gehun 141001 pani kam hai", From: "+91777" });
  check("Roman Hindi + Indian PIN -> Hindi reply", r.text.includes("FarmLine - Ludhiana, Punjab (NASA डेटा)") && r.text.includes("मिमी"), r.text);
}
{
  const r = await post("/sms", { Body: "پانی کم ہے", From: "+92302" });
  check("message without a place gets the language menu", r.text.includes("Choose your language"), r.text);
}
{
  const r = await post("/sms", { Body: "mahindi Nakuru maji ni kidogo", From: "+254700" }, { e: withEngine });
  check("Swahili SMS finds Nakuru by name, metric units", r.text.includes("FarmLine - Nakuru (data ya NASA)") && r.text.includes("Mvua, siku 30 zilizopita: 3 mm (kawaida 15 mm, 20%)") && r.text.includes("20°C"), r.text);
  check("Swahili plans in Swahili", r.text.includes("Mipango 3 badala ya mahindi") && r.text.includes("ngano &gt; maharagwe &gt; shayiri: inaokoa maji 35%"), r.text);
}
{
  const r = await post("/sms", { Body: "alfalfa near Fallon, water getting cut, what should I plant?", From: "+1555" });
  check("English SMS with a town name instead of ZIP", r.text.includes("Fallon, Nevada") && r.text.includes(" in (normal"), r.text);
}
{
  const r = await post("/sms", { Body: "ধান 141001 জল কম", From: "+91888" }, { e: { ...env, GEMINI_API_KEY: "k" } });
  check("other language goes through Gemini translation", r.text.startsWith('<?xml') && r.text.includes("[BN] FarmLine - Ludhiana"), r.text);
}
{
  geminiBreaksNumbers = true;
  const r = await post("/sms", { Body: "ধান 141001 জল কম", From: "+91888" }, { e: { ...env, GEMINI_API_KEY: "k" } });
  geminiBreaksNumbers = false;
  check("translation that changes a number is rejected (English sent)", !r.text.includes("999") && r.text.includes("FarmLine - Ludhiana"), r.text);
}
{
  const r = await post("/sms", { Body: "ধান 141001 জল কম", From: "+91888" });
  check("no Gemini key: other language gets English", r.text.includes("FarmLine - Ludhiana, Punjab (NASA data)"), r.text);
}
{
  smsSent.length = 0;
  const r = await post("/voice", { CallSid: "CA3" });
  check("call menu: 1 English, 2 Hindi, 3 Kiswahili (no Urdu)", r.text.includes("press 1") && r.text.includes("2 दबाएं") && r.text.includes("bonyeza 3") && !r.text.includes("اردو"), r.text);
}
{
  const urEnv = { ...env, UR_VOICE: "Google.ur-IN-Standard-A" };
  const r = await post("/voice/asktown?lang=ur", {}, { e: urEnv });
  check("Urdu town-speech step still works (older links)", r.text.includes('<Gather input="speech" language="ur-PK"') && r.text.includes("شہر یا گاؤں"), r.text);
  const t = await post("/voice/town?lang=ur", { SpeechResult: "فیصل آباد" }, { e: urEnv });
  check("spoken Faisalabad found from the built-in town list", t.text.includes("lat=31.42") && t.text.includes("country=pk"), t.text);
  const q = await post("/voice/question?lang=ur&lat=31.42&lon=73.08&name=Faisalabad&local=%D9%81%DB%8C%D8%B5%D9%84+%D8%A2%D8%A8%D8%A7%D8%AF&country=pk", { SpeechResult: "گندم" }, { e: urEnv });
  check("Urdu spoken answer uses the Urdu town name", q.text.includes("فیصل آباد، NASA ڈیٹا کے مطابق") && q.text.includes("<Hangup/>"), q.text);
}
{
  smsSent.length = 0;
  const r = await post("/voice/lang", { Digits: "3", From: "+254711" });
  await new Promise((res) => setTimeout(res, 50));
  check("Swahili call without a Swahili voice moves to SMS", r.text.includes("<Hangup/>") && smsSent.length === 1 && smsSent[0].Body.includes("Habari, hii ni FarmLine"), r.text + JSON.stringify(smsSent));
}
{
  const swEnv = { ...env, SW_VOICE: "Google.sw-KE-Standard-A" };
  const r = await post("/voice/lang", { Digits: "3" }, { e: swEnv });
  check("Swahili call with a voice asks for the town by speech", r.text.includes('<Gather input="speech" language="sw-KE"') && r.text.includes('voice="Google.sw-KE-Standard-A"') && r.text.includes("jina la mji"), r.text);
  const t = await post("/voice/town?lang=sw", { SpeechResult: "Nakuru" }, { e: swEnv });
  check("spoken town Nakuru leads to the question", t.text.includes("lat=-0.28") && t.text.includes("country=ke") && t.text.includes("Unalima zao gani"), t.text);
}

// ---- Cloudflare products: KV, D1, Durable Objects, Queues, Cron, Workers AI, dashboard ----
const cf = () => ({ ...env, ENGINE_URL: "https://engine.test/rotations", CACHE: makeKV(), DB: makeD1(), FARMER: makeDO(), ALERTS: makeQueue() } as any);
const wait = () => new Promise((res) => setTimeout(res, 60));
{
  const e = cf();
  powerCalls = 0;
  const r = await post("/sms", { Body: "alfalfa 89406 water is short", From: "+15550001" }, { e });
  await wait();
  check("answer ends with details + ALERT footer", r.text.includes("Reply 1, 2 or 3 for details. Reply ALERT for drought alerts."), r.text);
  const farmer = e.DB.raw.prepare("SELECT * FROM farmers WHERE phone = '+15550001'").get();
  check("D1 remembers the farmer's place (alerts off by default)", farmer?.place === "Fallon, NV" && farmer?.alerts === 0, JSON.stringify(farmer));
  const q = e.DB.raw.prepare("SELECT * FROM queries").all();
  check("D1 logs the question without a phone number", q.length === 1 && q[0].rain_pct === 20 && !JSON.stringify(q).includes("5550001"), JSON.stringify(q));
  check("KV caches the ZIP and the NASA weather", [...e.CACHE.store.keys()].some((k: string) => k === "zip:89406") && [...e.CACHE.store.keys()].some((k: string) => k.startsWith("w:39.47:-118.78:")), JSON.stringify([...e.CACHE.store.keys()]));
  const before = powerCalls;
  await post("/sms", { Body: "alfalfa 89406 again", From: "+15550001" }, { e });
  check("second question is served from KV (no new NASA call)", powerCalls === before, `${before} -> ${powerCalls}`);

  const d = await post("/sms", { Body: "2", From: "+15550001" }, { e });
  check("reply '2' gives plan 2 details from the Durable Object", d.text.includes("Plan 2: Alfalfa &gt; Wheat &gt; Alfalfa") && d.text.includes("Year 1: Alfalfa, sow in April.") && d.text.includes("Uses about 12% less water than alfalfa") && d.text.includes("Income +8%, in a dry year -20%.") && d.text.includes("Reply WHY or MENU."), d.text);

  const a = await post("/sms", { Body: "ALERT", From: "+15550001" }, { e });
  check("ALERT turns drought alerts on", a.text.includes("You are signed up for alerts") && e.DB.raw.prepare("SELECT alerts FROM farmers").get().alerts === 1, a.text);

  // Daily cron -> queue -> consumer -> SMS
  const n = await runDailyCheck(e);
  check("cron queues one check per farmer with alerts on", n === 1 && e.ALERTS.sent.length === 1 && (e.ALERTS.sent[0].body as any).phone === "+15550001", JSON.stringify(e.ALERTS.sent));
  smsSent.length = 0;
  const acked: string[] = [];
  await handleAlertBatch({ messages: e.ALERTS.sent.map((m: any, i: number) => ({ id: String(i), body: m.body, ack: () => acked.push("ack"), retry: () => acked.push("retry") })) } as any, e);
  check("queue consumer texts a drought alert (20% of normal rain)", smsSent.length === 1 && smsSent[0].Body.includes("Alert: Dry spell near Fallon.") && smsSent[0].Body.includes("Reply WHY") && acked[0] === "ack", JSON.stringify(smsSent));
  check("no second alert within a week", (await runDailyCheck(e)) === 0, "");

  const dash = await app.request("/", {}, e);
  const html = await dash.text();
  check("public dashboard shows live questions, no phone numbers", dash.status === 200 && html.includes("questions answered") && html.includes("Fallon, NV") && !html.includes("5550001"), html.slice(0, 300));
}
{
  const e = cf();
  const r = await post("/sms", { Body: "ALERT", From: "+15559999" }, { e });
  check("ALERT before any place asks for the place first", r.text.includes("send your country and PIN or ZIP code"), r.text);
  const d = await post("/sms", { Body: "1", From: "+15559999" }, { e });
  check("then '1' isn't a place, so it asks for the village", d.text.includes("could not find that place"), d.text);
}
{
  const e = cf();
  const first = await post("/sms", { Body: "گندم فیصل آباد پانی کم ہے", From: "+92300111" }, { e });
  check("an Urdu message naming a town is still answered at once, in Urdu", first.text.includes("فیصل آباد") && first.text.includes("NASA"), first.text);
}
{
  const good = makeAI((p) => "[AI] " + p.split("Translate into that language:\n")[1]);
  const r = await post("/sms", { Body: "ধান 141001 জল কম", From: "+91888" }, { e: { ...env, AI: good } as any });
  check("no Gemini key: Workers AI Llama translates instead", r.text.includes("[AI] FarmLine - Ludhiana") && good.calls.length === 1, r.text);
  const bad = makeAI((p) => p.split("Translate into that language:\n")[1].replace(/\d+/, "777"));
  const r2 = await post("/sms", { Body: "ধান 141001 জল কম", From: "+91888" }, { e: { ...env, AI: bad } as any });
  check("Workers AI translation that changes a number is rejected", !r2.text.includes("777") && r2.text.includes("FarmLine - Ludhiana, Punjab (NASA data)"), r2.text);
}
{
  const e = cf();
  smsSent.length = 0;
  const q = "/voice/question?lang=en&lat=39.4735&lon=-118.7774&name=Fallon%2C+NV&country=us";
  await post(q, { SpeechResult: "alfalfa", From: "+15550002" }, { e });
  await wait();
  const row = e.DB.raw.prepare("SELECT channel FROM queries").get();
  check("calls are logged too, and the farmer can reply '1' afterwards", row?.channel === "call" && smsSent.length === 1, JSON.stringify(row));
  const d = await post("/sms", { Body: "1", From: "+15550002" }, { e });
  check("SMS '1' after a call gives plan 1 details", d.text.includes("Plan 1: Wheat &gt; Dry beans &gt; Barley"), d.text);
}

{
  const r = await post("/sms", { Body: "trigo 141001 poca lluvia", From: "+5215550001" }, { e: { ...env, GEMINI_API_KEY: "k" } as any });
  check("Spanish message is answered through Gemini, with the crop understood", r.text.includes("[BN] FarmLine - Ludhiana") && !r.text.includes("Text your crop"), r.text);
}

// ---- WhatsApp (Twilio sandbox): same flow, replies from the WhatsApp sender ----
{
  const e = cf();
  const wa = "whatsapp:+13476260000";
  const r = await post("/sms", { Body: "hi", From: wa }, { e });
  check("WhatsApp message gets the same language menu", r.text.includes("Choose your language"), r.text);
  for (const b of ["1", "India 141001", "1", "1", "cotton", "2"]) await post("/sms", { Body: b, From: wa }, { e });
  smsSent.length = 0;
  await post("/sms", { Body: "1", From: wa }, { e });
  await wait(); await wait();
  const second = smsSent.find((x) => x.To === wa);
  check("second message (plans) goes back over WhatsApp from the sandbox sender", second?.From === "whatsapp:+14155238886" && (second?.Body ?? "").includes("3 plans"), JSON.stringify(smsSent));
  const row = e.DB.raw.prepare(`SELECT channel FROM messages WHERE phone = '${wa}' LIMIT 1`).get();
  check("admin logs it as WhatsApp", row?.channel === "whatsapp", JSON.stringify(row));
}

// ---- The menu flow (flow.ts) ----
{
  const e = cf();
  const me = "+919800001111";
  const say = async (b: string) => (await post("/sms", { Body: b, From: me }, { e })).text;
  const flow = async () => JSON.parse(await (await e.FARMER.get(e.FARMER.idFromName(me)).fetch("https://session/flow")).text());
  check("1. any first text -> language menu", (await say("hello")).includes("1 English\n2 हिंदी\n3 Kiswahili"), "");
  const w = await say("1");
  check("2. '1' -> English welcome asking for country + PIN", w.includes("Welcome to FarmLine") && w.includes("Example: India 413512"), w);
  const c = await say("India 141001");
  check("3. 'India 141001' -> confirm Ludhiana", c.includes("Is your farm near Ludhiana, Punjab, India?") && c.includes("1 Yes\n2 No"), c);
  check("4a. '2' (no) -> asks for the village", (await say("2")).includes("Send your village name."), "");
  const c2 = await say("Nakuru");
  check("   village -> confirm again", c2.includes("Is your farm near Nakuru"), c2);
  const m = await say("1");
  check("4b. '1' (yes) -> the menu with 3 options", m.includes("What do you need?\n1 Plan my next 3 years of crops\n2 Get drought and flood alerts\n3 Ask anything else") && !m.includes("\n4 "), m);
  check("   farmer saved to D1 at confirm", e.DB.raw.prepare(`SELECT place FROM farmers WHERE phone = '${me}'`).get()?.place === "Nakuru", "");
  check("5. option 1 -> what is growing", (await say("1")).includes("What is growing now"), "");
  check("6. crop -> is your field watered?", (await say("cotton")).includes("1 Irrigated\n2 Rain only"), "");
  check("7. irrigated -> water outlook", (await say("1")).includes("1 Same\n2 Less\n3 Much less"), "");
  check("8. outlook -> how is your soil?", (await say("2")).includes("How is your soil?\n1 Good\n2 Tired or low yields\n3 Don’t know"), "");
  smsSent.length = 0; engineBodies.length = 0;
  const chk = await say("1");
  await wait(); await wait();
  check("9. soil -> 'Checking 25 years of NASA data for your farm near Nakuru...' now", chk.includes("Checking 25 years of NASA data for your farm near Nakuru..."), chk);
  const body = engineBodies[0] ?? {};
  check("   engine gets contract B: place, lat/lon, crop code, water-first priorities", body.current_crop === "cotton" && body.place === "Nakuru" && typeof body.lat === "number" && body.priorities?.water > body.priorities?.income && body.priorities?.drought > body.priorities?.income && Object.keys(body).every((k) => ["place", "lat", "lon", "current_crop", "priorities"].includes(k)), JSON.stringify(body));
  const plans = smsSent.find((x) => x.To === me)?.Body ?? "";
  check("10. plans arrive as a second SMS", plans.startsWith("3 plans for the next 3 years:") && plans.includes("1) Wheat > Dry beans > Barley: least water") && plans.includes("3) Sorghum > Safflower > Wheat: safest in a dry year") && plans.includes("Reply 1, 2 or 3 for details, or WHY."), plans);
  const d = await say("1");
  check("11a. '1' -> plan details by year, vs cotton", d.includes("Plan 1: Wheat &gt; Dry beans &gt; Barley") && d.includes("Year 2: Dry beans, sow at the start of the rains.") && d.includes("Uses about 35% less water than cotton and adds nitrogen to the soil.") && d.includes("Reply WHY or MENU."), d);
  const why = await say("WHY");
  check("11b. WHY -> NASA rain + why this plan", why.includes("After cotton, your soil needs nitrogen back.") && why.includes("Dry beans add it naturally.") && why.includes("NASA data: rain near Nakuru in the last 30 days was 20% of normal."), why);
  check("MENU -> menu from anywhere", (await say("menu")).includes("What do you need?"), "");
  const al = await say("2");
  check("option 2 -> drought and flood alerts on (D1)", al.includes("You are signed up for alerts.") && al.includes("STOP ALERTS") && e.DB.raw.prepare(`SELECT alerts FROM farmers WHERE phone = '${me}'`).get()?.alerts === 1, al);
  const off = await say("STOP ALERTS");
  check("STOP ALERTS -> alerts off", off.includes("Alerts are off") && e.DB.raw.prepare(`SELECT alerts FROM farmers WHERE phone = '${me}'`).get()?.alerts === 0, off);
  check("option 3 -> type your question", (await say("3")).includes("Type your question."), "");
  const nope = await say("blah");
  check("not understood -> MENU hint (no AI bound)", nope.includes("Sorry, I did not understand. Reply MENU."), nope);
  check("LANG -> language menu", (await say("LANG")).includes("Choose your language"), "");
  const hiMenu = await say("2");
  check("choose Hindi -> Hindi welcome asking where the farm is", hiMenu.includes("FarmLine में आपका स्वागत है") && hiMenu.includes("पिन कोड"), hiMenu);
  const st = await say("STOP");
  check("STOP -> stopped message", st.includes("अब आपको कोई संदेश नहीं मिलेगा"), st);
  const silent = await post("/sms", { Body: "hello", From: me }, { e });
  check("stopped farmer gets no reply", !silent.text.includes("<Message>"), silent.text);
  const back = await say("START");
  check("START -> welcome back + menu", back.includes("फिर से स्वागत है") && back.includes("आपको क्या चाहिए?"), back);
  const f = await flow();
  f.at = new Date(Date.now() - 13 * 3600e3).toISOString();
  f.step = "plans";
  await e.FARMER.get(e.FARMER.idFromName(me)).fetch("https://session/flow", { method: "PUT", body: JSON.stringify(f) });
  const wb = await say("मौसम");
  check("returning after 12+ hours -> welcome back menu", wb.includes("फिर से स्वागत है"), wb);
  const z = await say("alfalfa 89406");
  check("a ZIP code mid-flow still gets an answer at once", z.includes("Fallon, NV") && z.includes("NASA"), z);
  const log = e.DB.raw.prepare(`SELECT outcome FROM messages WHERE phone = '${me}' ORDER BY id`).all().map((r: any) => r.outcome);
  check("every step is logged for /admin", ["lang_menu", "welcome", "confirm_place", "ask_village", "menu", "ask_crop", "ask_water", "ask_outlook", "ask_soil", "checking", "plans", "details", "why", "alerts_on", "alerts_off"].every((o) => log.includes(o)), log.join(","));
}
{
  // Hindi and Kiswahili onboarding
  const e = cf();
  const hi = async (b: string) => (await post("/sms", { Body: b, From: "+919800002222" }, { e })).text;
  await hi("नमस्ते");
  const w = await hi("2");
  check("Hindi welcome", w.includes("FarmLine में आपका स्वागत है") && w.includes("उदाहरण: India 413512"), w);
  check("Hindi confirm", (await hi("India 141001")).includes("क्या आपका खेत Ludhiana, Punjab, India के पास है?"), "");
  const sw = async (b: string) => (await post("/sms", { Body: b, From: "+254700003333" }, { e })).text;
  await sw("habari");
  const ws = await sw("3");
  check("Kiswahili welcome", ws.includes("Karibu FarmLine") && ws.includes("Mfano: Kenya Nakuru"), ws);
  const cs = await sw("Kenya Nakuru");
  check("Kiswahili confirm", cs.includes("Je, shamba lako liko karibu na Nakuru"), cs);
  const ms = await sw("1");
  check("Kiswahili menu", ms.includes("Unahitaji nini?"), ms);
}
{
  // Heavy-rain alert from the forecast, and WHY afterwards
  const e = cf();
  const me = "+919800004444";
  for (const b of ["hi", "1", "India 141001", "1", "2"]) await post("/sms", { Body: b, From: me }, { e });
  const oldDays = { ...days };
  for (const k of Object.keys(days)) if (days[k] > -900) days[k] = 1; // normal rain: no drought
  forecastDaily = [5, 48, 20, 0, 0, 0, 0];
  smsSent.length = 0;
  await runDailyCheck(e);
  await handleAlertBatch({ messages: e.ALERTS.sent.map((m: any, i: number) => ({ id: String(i), body: m.body, ack: () => {}, retry: () => {} })) } as any, e);
  const alert = smsSent.find((x) => x.To === me)?.Body ?? "";
  check("heavy rain in the forecast -> heavy-rain alert", alert.includes("Alert: Heavy rain expected near Ludhiana in 2 days.") && alert.includes("Clear drains"), alert);
  const why = (await post("/sms", { Body: "why", From: me }, { e })).text;
  check("WHY after an alert explains it", why.includes("The forecast shows about 73 mm of rain in the next 3 days."), why);
  Object.assign(days, oldDays);
  forecastDaily = [0, 0, 0, 0, 0, 0, 0];
}

// ---- "Ask anything": farming library on Vectorize ----
{
  const e = { ...cf(), AI: makeAI((p) => "[AI] " + p.split("Translate into that language:\n")[1]), KB: makeVectorize(), LIBRARY_MIN_SCORE: "0.3" } as any;
  const onboard = async (from: string) => { for (const b of ["hi", "1", "Kenya Nakuru", "1", "3"]) await post("/sms", { Body: b, From: from }, { e }); };
  await onboard("+15550007777");
  const r = await post("/sms", { Body: "my wheat leaves are turning yellow, what should I do", From: "+15550007777" }, { e });
  await wait();
  check("a question with no place is answered from the library, with its source", r.text.includes("low nitrogen") && r.text.includes("Source: FAO") && r.text.includes("Text your crop and town"), r.text);
  check("the library was put into Vectorize once, with the KV flag set", e.KB.items.size >= 28 && [...e.CACHE.store.keys()].some((k: string) => k.startsWith("library:indexed:")), String(e.KB.items.size));
  const row = e.DB.raw.prepare("SELECT outcome, trace FROM messages WHERE phone = '+15550007777' AND outcome = 'library'").get();
  const tr = JSON.parse(row?.trace ?? "{}");
  check("admin log shows the library search and its closest matches", row?.outcome === "library" && tr.library?.answered === true && tr.library.hits[0].id === "yellow-leaves" && tr.library.hits.length === 3, JSON.stringify(tr.library));
  const embedCalls = e.AI.calls.filter((c: any) => c.text).length;
  await onboard("+15550007778");
  await post("/sms", { Body: "how do I store grain so insects don't get in", From: "+15550007778" }, { e });
  check("second question doesn't re-index the library", e.AI.calls.filter((c: any) => c.text).length === embedCalls + 1, String(e.AI.calls.length));
  const e2 = { ...e, LIBRARY_MIN_SCORE: "0.95", AI: makeAI(() => "Check the soil before planting.") } as any;
  for (const b of ["hi", "1", "Kenya Nakuru", "1", "3"]) await post("/sms", { Body: b, From: "+15550007779" }, { e: e2 });
  const far = await post("/sms", { Body: "zzzz qqqq", From: "+15550007779" }, { e: e2 });
  check("no close library match: a short AI answer marked as general advice", far.text.includes("Check the soil before planting.") && far.text.includes("General advice") && !far.text.includes("Source:"), far.text);
  const e3 = cf();
  for (const b of ["hi", "1", "Kenya Nakuru", "1", "3"]) await post("/sms", { Body: b, From: "+15550007780" }, { e: e3 });
  const plain = await post("/sms", { Body: "my wheat leaves are turning yellow", From: "+15550007780" }, { e: e3 });
  check("without Workers AI or Vectorize, FarmLine still replies (MENU hint)", plain.text.includes("did not understand"), plain.text);
  const lock = await app.request("/admin/library/rebuild", {}, e);
  check("library rebuild is admin-only", lock.status === 503 || lock.status === 302, String(lock.status));
}

// ---- Speak freely on a call: Workers AI Whisper ----
{
  const ai = makeAI((p) => "[AI] " + p.split("Translate into that language:\n")[1]);
  const e = { ...cf(), AI: ai, KB: makeVectorize(), LIBRARY_MIN_SCORE: "0.3" } as any;
  const rec = "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1";
  const lang = await post("/voice/lang", { Digits: "1", From: "+15550008888" }, { e });
  check("with Workers AI, the call asks the farmer to speak freely and records", lang.text.includes("<Record") && lang.text.includes("After the beep") && lang.text.includes("/voice/heard?lang=en"), lang.text);
  ai.heard = "alfalfa in 89406, the water is short";
  smsSent.length = 0;
  const heard = await post("/voice/heard?lang=en&tries=0", { RecordingUrl: rec, RecordingSid: "RE1", CallSid: "CA77", From: "+15550008888" }, { e });
  check("while it works, the caller hears 'checking NASA data' and waits", heard.text.includes("Checking NASA satellite data") && heard.text.includes("/voice/result?lang=en"), heard.text);
  await wait(); await wait();
  const res = await post("/voice/result?lang=en&tries=0&n=0", { CallSid: "CA77", From: "+15550008888" }, { e });
  check("the answer is spoken from what Whisper heard (place + NASA rain)", res.text.includes("Fallon") && res.text.includes("Drier than normal"), res.text);
  check("call: after the NASA summary, the plan questions begin", res.text.includes("/voice/q?lang=en&amp;step=start") && !res.text.includes("Plan 1"), res.text);
  const vq = async (step: string, p: Record<string, string> = {}) => (await post(`/voice/q?lang=en&step=${step}`, { CallSid: "CA77", From: "+15550008888", ...p }, { e })).text;
  const q1 = await vq("start");
  check("call q1: is your field watered? press 1 / 2 (crop already heard)", q1.includes("Is your field watered?") && q1.includes("Press 1 for irrigated.") && q1.includes("Press 2 for rain only.") && q1.includes("step=water"), q1);
  const q2 = await vq("water", { Digits: "1" });
  check("call q2: irrigated -> water next season, press 1-3", q2.includes("How much water do you expect next season?") && q2.includes("Press 3 for much less."), q2);
  const q3 = await vq("outlook", { Digits: "2" });
  check("call q3: -> how is your soil?", q3.includes("How is your soil?") && q3.includes("Press 2 for tired or low yields."), q3);
  const q4 = await vq("soil", { Digits: "2" });
  await wait();
  check("call q4: 'Checking 25 years of NASA data...' then 3 plans spoken", q4.includes("Checking 25 years of NASA data for your farm near Fallon...") && q4.includes("Plan 1: Wheat, then Dry beans, then Barley: least water.") && q4.includes("Press 1, 2 or 3 to hear a plan, or 0 to hear why.") && q4.includes("step=plans"), q4);
  check("call q4: the plans are also sent by SMS", smsSent.some((m) => m.To === "+15550008888" && (m.Body ?? "").startsWith("3 plans for the next 3 years:")), JSON.stringify(smsSent));
  const q5 = await vq("plans", { Digits: "1" });
  check("call: press 1 -> plan 1 by year with sow months", q5.includes("Plan 1: Wheat, then Dry beans, then Barley") && q5.includes("Year 1: Wheat, sow in October.") && q5.includes("Press 0 to hear why"), q5);
  const q6 = await vq("plans", { Digits: "0" });
  check("call: press 0 -> why", q6.includes("NASA data: rain near Fallon"), q6);
  const q7 = await vq("plans", { Digits: "9" });
  check("call: press 9 -> goodbye", q7.includes("We have sent your plans by text.") && q7.includes("<Hangup/>"), q7);
  check("the same answer is sent by SMS", smsSent.some((m) => m.To === "+15550008888" && (m.Body ?? "").includes("Fallon")), JSON.stringify(smsSent));
  check("the recording is deleted from Twilio after transcription", recordingsDeleted.some((u) => u.endsWith("/Recordings/RE1.json")), JSON.stringify(recordingsDeleted));
  const row = e.DB.raw.prepare("SELECT inbound, channel, trace FROM messages WHERE phone = '+15550008888'").get();
  const tr = JSON.parse(row?.trace ?? "{}");
  check("admin log keeps the transcript, not the voice", row?.channel === "call" && row?.inbound === "alfalfa in 89406, the water is short" && tr.heard?.model === "whisper-large-v3-turbo" && tr.via === "postal", JSON.stringify(row));
  ai.heard = "";
  await post("/voice/heard?lang=en&tries=0", { RecordingUrl: rec, RecordingSid: "RE2", CallSid: "CA78", From: "+15550008889" }, { e });
  await wait();
  const again = await post("/voice/result?lang=en&tries=0&n=0", { CallSid: "CA78", From: "+15550008889" }, { e });
  check("silence: the caller gets one more chance to speak", again.text.includes("did not hear") && again.text.includes("<Record") && again.text.includes("tries=1"), again.text);
  ai.heard = "गेहूं 141001 पानी कम है";
  await post("/voice/heard?lang=hi&tries=0", { RecordingUrl: rec, RecordingSid: "RE3", CallSid: "CA79", From: "+919800000001" }, { e });
  await wait(); await wait();
  const hi = await post("/voice/result?lang=hi&tries=0&n=0", { CallSid: "CA79", From: "+919800000001" }, { e });
  check("Hindi call: Whisper text -> Ludhiana, answered in the Hindi voice", hi.text.includes("Polly.Aditi") && hi.text.includes("Ludhiana") && hi.text.includes("बारिश"), hi.text);
  ai.heard = "how do I store grain so insects don't get in";
  smsSent.length = 0;
  await post("/voice/heard?lang=en&tries=0", { RecordingUrl: rec, RecordingSid: "RE4", CallSid: "CA80", From: "+15550008890" }, { e });
  await wait(); await wait();
  const lib = await post("/voice/result?lang=en&tries=0&n=0", { CallSid: "CA80", From: "+15550008890" }, { e });
  check("a spoken question with no place is answered from the farming library", lib.text.includes("Store grain and seed dry") && smsSent.some((m) => (m.Body ?? "").includes("Source: FAO")), lib.text);
  const pending = await post("/voice/result?lang=en&tries=0&n=8", { CallSid: "CA999", From: "+15550008891" }, { e });
  check("if the answer takes too long, the call ends politely (the SMS still comes)", pending.text.includes("text message") && pending.text.includes("<Hangup/>"), pending.text);
  const noAI = await post("/voice/lang", { Digits: "1" }, { e: cf() });
  check("without Workers AI, calls use the keypad flow", noAI.text.includes('input="dtmf"') && !noAI.text.includes("<Record"), noAI.text);
}

// ---- Daily drought report in R2 ----
{
  const e = { ...cf(), REPORTS: makeR2() } as any;
  await post("/sms", { Body: "alfalfa 89406 water is short", From: "+15550006001" }, { e });
  await post("/sms", { Body: "wheat 89406", From: "+15550006002" }, { e });
  await post("/sms", { Body: "गेहूं 141001 पानी कम है", From: "+919800006003" }, { e });
  await wait();
  const r = await saveDailyReport(e, "2026-11-14");
  const csv = e.REPORTS.objects.get("reports/2026-11-14.csv")?.body ?? "";
  check("report is saved to R2 with one row per town and NASA rain", r?.towns === 2 && csv.split("\n")[0].startsWith("date,town,country,farmers") && /2026-11-14,"?Fallon, NV"?,US,2,0,/.test(csv) && csv.includes("Dry spell"), csv);
  check("report has no phone numbers", !csv.includes("5550006001") && !csv.includes("9800006003"), csv);
  check("R2 metadata counts towns and dry towns", e.REPORTS.objects.get("reports/2026-11-14.csv")?.customMetadata?.towns === "2" && r?.dry === 2, JSON.stringify(r));
  const waits: Promise<unknown>[] = [];
  await (worker as any).scheduled({}, e, { waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  const today = new Date().toISOString().slice(0, 10);
  check("the daily Cron Trigger saves today's report", e.REPORTS.objects.has(`reports/${today}.csv`), [...e.REPORTS.objects.keys()].join(","));
  const anon = await app.request("/admin/reports/2026-11-14.csv", {}, e);
  check("report downloads are admin-only", anon.status === 503 || anon.status === 302, String(anon.status));
}

// ---- admin view (Auth0 login) ----
{
  const e = cf();
  const locked = await app.request("/admin", {}, e);
  check("admin is locked (503) until Auth0 is set up, and shows no data", locked.status === 503 && !(await locked.text()).includes("+1555"), String(locked.status));

  const A = { ...e, AUTH0_DOMAIN: "https://farmline.test.auth0.com/", AUTH0_CLIENT_ID: "cid", AUTH0_CLIENT_SECRET: "csecret", ADMIN_EMAILS: "Rhea@Example.com, team@example.com", SESSION_SECRET: "s3cret-for-tests" } as any;
  await post("/sms", { Body: "alfalfa 89406 water is short", From: "+15550009988" }, { e: { ...A, ENGINE_URL: "https://engine.test/rotations" } });
  await post("/sms", { Body: "2", From: "+15550009988" }, { e: A });
  await post("/sms", { Body: "hello", From: "+15550001111" }, { e: A });
  await wait();
  const rows = A.DB.raw.prepare("SELECT outcome, trace FROM messages WHERE phone = '+15550009988' ORDER BY id").all();
  const tr = JSON.parse(rows[0]?.trace ?? "{}");
  check("each exchange is logged with how it was made", rows.length === 2 && rows[0].outcome === "plans" && rows[1].outcome === "details" && tr.via === "postal" && tr.weather?.rainPct === 20 && tr.engine?.status === "answered" && tr.engine.options.length === 3, JSON.stringify(rows));

  const anon = await app.request("/admin", {}, A);
  check("signed-out admin visit goes to the login", anon.status === 302 && anon.headers.get("Location") === "/admin/login", String(anon.status));
  const lg = await app.request("http://localhost/admin/login", {}, A);
  const loc = lg.headers.get("Location") ?? "";
  const state = new URL(loc).searchParams.get("state") ?? "";
  check("login redirects to Auth0 with a state cookie", loc.startsWith("https://farmline.test.auth0.com/authorize?") && loc.includes("redirect_uri=http%3A%2F%2Flocalhost%2Fadmin%2Fcallback") && (lg.headers.get("Set-Cookie") ?? "").includes(`fl_state=${state}`), loc);

  const cb = (st: string, cookieState: string) => app.request(`http://localhost/admin/callback?code=abc&state=${st}`, { headers: { Cookie: `fl_state=${cookieState}` } }, A);
  auth0Claims = { email: "rhea@example.com", email_verified: true };
  const ok = await cb(state, state);
  const cookie = (ok.headers.get("Set-Cookie") ?? "").match(/fl_admin=([^;]+)/)?.[1] ?? "";
  check("Auth0 callback signs in an allowed, verified email", ok.status === 302 && ok.headers.get("Location") === "/admin" && cookie.length > 20, String(ok.status));
  check("callback with a wrong state is refused", (await cb("forged", state)).status === 400);
  auth0Claims = { email: "rhea@example.com", email_verified: false };
  check("unverified email is refused", (await cb(state, state)).status === 403);
  auth0Claims = { email: "stranger@example.com", email_verified: true };
  check("email not on ADMIN_EMAILS is refused", (await cb(state, state)).status === 403);

  const get = (path: string, c: string) => app.request(path, { headers: { Cookie: `fl_admin=${c}` } }, A);
  const get2 = (envX: any, path: string, c: string) => app.request(path, { headers: { Cookie: `fl_admin=${c}` } }, envX);
  const ov = await get("/admin", cookie);
  const html = await ov.text();
  const boot = JSON.parse(html.match(/<script type="application\/json" id="boot">([\s\S]*?)<\/script>/)![1]);
  const D = boot.data;
  check("admin page carries live data: farmers, masked numbers, KPIs", ov.status === 200 && D.kpis.questions === 3 && D.kpis.plans === 1 && D.kpis.registered === 2 && D.log.some((r: any) => r.phone === "+1 •••• ••88" && r.area === "Fallon, NV") && D.log.some((r: any) => r.outcomeId === "lang_menu"), JSON.stringify(D.kpis));
  {
    const key = "demo-key-1234567890";
    const DE = { ...A, DEMO_KEY: key } as any;
    check("demo link is off when DEMO_KEY isn't set", (await app.request(`/demo/${key}`, {}, A)).status === 404);
    check("demo link with a wrong key -> 404", (await app.request(`/demo/demo-key-1234567899`, {}, DE)).status === 404);
    const dm = await app.request(`/demo/${key}`, {}, DE);
    const dh = await dm.text();
    const DB2 = JSON.parse(dh.match(/<script type="application\/json" id="boot">([\s\S]*?)<\/script>/)![1]).data;
    check("demo link opens the dashboard with no sign-in", dm.status === 200 && DB2.kpis.questions === 3 && DB2.log.length > 0, String(dm.status));
    check("demo link hides every phone number (Farmer 1, Farmer 2...)", !/5550009988|5550001111|••88|••11/.test(dh) && DB2.log.every((r: any) => /^Farmer \d+$/.test(r.phone) && r.phone === r.phoneFull), JSON.stringify(DB2.log.map((r: any) => r.phone)));
    check("demo link is read-only: no sign-out, no report button", !dh.includes("/admin/logout") && !dh.includes("/admin/reports/new") && dh.includes("Demo view, read-only"), "");
  }
  const plan = D.log.find((r: any) => r.outcomeId === "plans");
  check("each conversation carries how its answer was made", plan.asked === "alfalfa 89406 water is short" && plan.tr.weather.rainPct === 20 && plan.tr.engine.options[0].rotation.join(" ") === "wheat dry beans barley" && plan.segs.includes("SMS segment"), JSON.stringify(plan.tr));
  check("advice tab: opened plan and crop shift come from real replies", D.advice.opened === 1 && D.advice.choice[0].r[1] === 1 && D.advice.avgSaving === 12 && D.advice.shifts.length === 0, JSON.stringify(D.advice));
  check("map has a country bubble with the farm's place", D.countries[0].cc === "us" && D.countries[0].farmers === 1, JSON.stringify(D.countries));
  check("the design's template and runtime are on the page, with no sample data", html.includes('id="app-template"') && html.includes("mountDC(Component") && !html.includes("Sample data") && !html.includes("SMAP"), "");
  const fp = await get("/admin/farmer/" + encodeURIComponent("+15550009988"), cookie);
  check("old farmer links open the Conversations tab for that farmer", fp.status === 302 && (fp.headers.get("Location") ?? "").includes("farmer=%2B15550009988"), String(fp.status));
  const A2 = { ...A, REPORTS: makeR2() };
  const made = await get2(A2, "/admin/reports/new", cookie);
  const dl = await get2(A2, made.headers.get("Location") ?? "", cookie);
  check("admin can make and download today's report", made.status === 302 && dl.status === 200 && (dl.headers.get("Content-Type") ?? "").includes("text/csv") && (await dl.text()).startsWith("date,town"), String(made.status) + " " + String(dl.status));
  check("tampered admin cookie is refused", (await get("/admin", cookie.slice(0, -2) + "xx")).status === 302);
  const other = await makeSession("s3cret-for-tests", "removed@example.com");
  check("someone removed from ADMIN_EMAILS loses access", (await get("/admin", other)).status === 302);
  const old = await makeSession("s3cret-for-tests", "rhea@example.com", Date.now() - 13 * 3600e3);
  check("admin session expires after 12 hours", (await get("/admin", old)).status === 302);
  const html2 = await (await get("/admin", cookie)).text();
  check("farmer text is escaped on the admin page", !html2.includes("<script>alert"), "");
}

// --- the real engine's answer (contract B) is translated, numbers kept exactly ---
{
  const { fromPlan, cropCode } = await import("../src/engine");
  const opts = fromPlan({
    field: { place: "Fallon, NV" }, years_tested: 25,
    baseline: { water_af_per_acre: 4.5, income_usd_per_acre: 900, bad_year_income_usd_per_acre: 300 },
    options: [
      { rank: 2, label: "most_income", rotation: ["alfalfa", "corn_silage", "wheat"], water_af_per_acre: 4, water_saved_pct: 11, income_usd_per_acre: 990, bad_year_income_usd_per_acre: 240, soil_score: 6 },
      { rank: 1, label: "most_water_saved", rotation: ["wheat", "dry_beans", "barley"], water_af_per_acre: 2.1, water_saved_pct: 53, income_usd_per_acre: 720, bad_year_income_usd_per_acre: 360, soil_score: 7 },
      { rank: 3, label: "safest_in_drought", rotation: ["sorghum", "safflower", "wheat"], water_af_per_acre: 2.6, water_saved_pct: 42, income_usd_per_acre: 760, bad_year_income_usd_per_acre: 420, soil_score: 8 },
    ],
  });
  check("contract B: options sorted by rank, kinds mapped", opts.map((o) => o.kind).join() === "water,income,drought", JSON.stringify(opts.map((o) => o.kind)));
  check("contract B: crop codes made readable", opts[0].rotation.join() === "wheat,dry beans,barley", opts[0].rotation.join());
  check("contract B: % vs baseline from engine numbers", opts[0].water_saving_pct === 53 && opts[0].income_change_pct === -20 && opts[0].bad_year_income_change_pct === 20, JSON.stringify(opts[0]));
  check("contract B: why quotes engine numbers only", (opts[0].why ?? "").includes("25 years") && (opts[0].why ?? "").includes("$720"), opts[0].why ?? "");
  check("crop codes: maize->corn, beans->dry_beans, unknown->null", cropCode("maize") === "corn" && cropCode("Beans") === "dry_beans" && cropCode("tomato") === null, "");
}

// ---- Plan flow with no engine field here: built-in rotations (the Jericho, NY example) ----
{
  const e = { ...cf(), ENGINE_URL: "" } as any;
  const me = "+15165550123";
  const say = async (b: string) => (await post("/sms", { Body: b, From: me }, { e })).text;
  for (const b of ["hi", "1", "USA 89406", "1"]) await say(b);
  check("built-in: menu option 1 -> crop", (await say("1")).includes("What is growing now"), "");
  await say("corn"); await say("1"); await say("2");
  smsSent.length = 0;
  const chk = await say("2");
  await wait(); await wait();
  check("built-in: 'Checking 25 years of NASA data for your farm near Fallon...'", chk.includes("Checking 25 years of NASA data for your farm near Fallon..."), chk);
  const plans = smsSent.find((x) => x.To === me)?.Body ?? "";
  if (process.env.SHOW) console.log("\n" + plans);
  check("built-in: 3 plans after corn, plan 1 builds soil", plans.includes("1) Soybean > Wheat > Clover: least water, builds soil") && plans.includes("2) Soybean > Corn > Wheat: most income") && plans.includes("3) Wheat > Soybean > Oats: safest in a dry year") && plans.includes("Reply 1, 2 or 3 for details, or WHY."), plans);
  const d = await say("1");
  if (process.env.SHOW) console.log("\n" + d);
  check("built-in: details with sow months, water vs corn, nitrogen for tired soil", d.includes("Year 1: Soybean, sow in May.") && d.includes("Year 2: Wheat, sow in October.") && d.includes("Year 3: Clover cover crop, sow in spring.") && /Uses about \d+% less water than corn and adds nitrogen to tired soil\./.test(d) && !d.includes("Income") && d.includes("Reply WHY or MENU."), d);
  const why = await say("WHY");
  if (process.env.SHOW) console.log("\n" + why);
  check("built-in: WHY -> nitrogen after corn, legumes, NASA rain, less water", why.includes("After corn, your soil needs nitrogen back.") && why.includes("Soybean and clover add it naturally.") && why.includes("NASA data: rain near Fallon") && why.includes("These crops need less water than corn."), why);
}

// ---- Greetings restart the flow; RESTART forgets the farm ----
{
  const e = cf();
  const me = "+15550123987";
  const say = async (b: string) => (await post("/sms", { Body: b, From: me }, { e })).text;
  for (const b of ["hi", "1", "India 141001", "1"]) await say(b);
  check("mid-flow 'hi' -> language menu (not 'did not understand')", (await say("hi")).includes("1 English\n2 हिंदी\n3 Kiswahili"), "");
  check("   then a language -> asks where the farm is", (await say("1")).includes("send your country and PIN or ZIP code"), "");
  check("'Hello' works too", (await say("Hello")).includes("1 English"), "");
  await say("1");
  check("RESTART -> language menu", (await say("RESTART")).includes("1 English"), "");
  check("   after RESTART the farm is forgotten: language -> asks for the place", (await say("1")).includes("Welcome to FarmLine"), "");
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

