import { buildSms } from "./reply";
import { escapeXml as esc } from "./twilio";
import type { EngineOption, Env, Lang, Place } from "./types";
import { WORLD } from "./world_dots";

export interface Stats {
  total: number;
  alertsOn: number;
  countries: number;
  langs: { lang: string; n: number }[];
  recent: { ts: string; channel: string; lang: string; place: string; crop: string | null; rain_pct: number | null }[];
  pins: { place: string; lat: number; lon: number; rain_pct: number | null }[];
}

/** Everything the public page shows. No phone numbers ever leave D1 through here. */
export async function getStats(env: Env): Promise<Stats> {
  const empty: Stats = { total: 0, alertsOn: 0, countries: 0, langs: [], recent: [], pins: [] };
  if (!env.DB) return empty;
  const [t, a, c, l, r] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM queries WHERE channel != 'alert'`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM farmers WHERE alerts = 1`),
    env.DB.prepare(`SELECT COUNT(DISTINCT country) AS n FROM queries WHERE country != ''`),
    env.DB.prepare(`SELECT lang, COUNT(*) AS n FROM queries GROUP BY lang ORDER BY n DESC`),
    env.DB.prepare(`SELECT ts, channel, lang, place, crop, rain_pct FROM queries ORDER BY id DESC LIMIT 8`),
  ]);
  let pins: Stats["pins"] = [];
  try {
    const p = await env.DB.prepare(
      `SELECT place, lat, lon, rain_pct FROM queries WHERE lat IS NOT NULL ORDER BY id DESC LIMIT 300`,
    ).all<Stats["pins"][number]>();
    const seen = new Set<string>();
    pins = (p.results ?? []).filter((x) => !seen.has(x.place) && seen.add(x.place)).slice(0, 40);
  } catch {
    // map columns not added yet (db/migrate_002_map.sql): page still works, map shows no pins
  }
  return {
    total: (t.results[0] as { n: number })?.n ?? 0,
    alertsOn: (a.results[0] as { n: number })?.n ?? 0,
    countries: (c.results[0] as { n: number })?.n ?? 0,
    langs: l.results as Stats["langs"],
    recent: r.results as Stats["recent"],
    pins,
  };
}

export async function renderStatsJson(env: Env): Promise<Response> {
  return Response.json(await getStats(env), { headers: { "Cache-Control": "no-store" } });
}

/** "+14066424428" -> "+1 (406) 642-4428"; other countries unchanged. */
export function formatPhone(n: string): string {
  const m = n.replace(/\s/g, "").match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : n;
}

/** Example conversations for the phone on the page, written by the real reply code with sample numbers. */
function examples(): { lang: Lang; ask: string; reply: string }[] {
  const w = { rain30mm: 3, normal30mm: 15, avgHighC: 21, days: 30 };
  const opts: EngineOption[] = [
    { rotation: ["wheat", "dry beans", "barley"], water_saving_pct: 35, income_change_pct: -4, bad_year_income_change_pct: -10, kind: "water" },
    { rotation: ["maize", "dry beans", "sorghum"], water_saving_pct: 12, income_change_pct: 8, bad_year_income_change_pct: -20, kind: "income" },
    { rotation: ["sorghum", "chickpea", "wheat"], water_saving_pct: 28, income_change_pct: 1, bad_year_income_change_pct: 2, kind: "drought" },
  ];
  const at = (name: string, country: string, localName?: string): Place => ({ lat: 0, lon: 0, name, country, localName });
  return [
    { lang: "en", ask: "alfalfa 89406 water is short", reply: buildSms(at("Fallon, NV", "us"), w, "en", "alfalfa", opts) },
    { lang: "hi", ask: "गेहूं 141001 पानी कम है", reply: buildSms(at("Ludhiana, Punjab", "in"), w, "hi", "wheat", opts) },
    { lang: "ur", ask: "گندم فیصل آباد پانی کم ہے", reply: buildSms(at("Faisalabad", "pk", "فیصل آباد"), w, "ur", "wheat", opts) },
    { lang: "sw", ask: "mahindi Nakuru maji ni kidogo", reply: buildSms(at("Nakuru", "ke"), w, "sw", "maize", opts) },
  ];
}

const CF_PRODUCTS = ["Workers", "Workers AI", "AI Gateway", "Vectorize", "D1", "R2", "KV", "Durable Objects", "Queues", "Cron Triggers"];

/** Crop furrows in perspective, running to the horizon: the field under the harvest moon. */
function fieldRows(): string {
  const lines: string[] = [];
  for (let i = -30; i <= 30; i++) {
    const x = 500 + i * 70;
    const w = (1.6 - Math.min(1, Math.abs(i) / 30) * 0.6).toFixed(2);
    lines.push(`<line x1="${500 + i * 2.2}" y1="0" x2="${x}" y2="300" stroke-width="${w}"/>`);
  }
  return `<svg class="rows" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ebc774" stop-opacity="0"/><stop offset=".35" stop-color="#ebc774" stop-opacity=".22"/><stop offset="1" stop-color="#ebc774" stop-opacity=".34"/></linearGradient></defs><g stroke="url(#fade)">${lines.join("")}</g></svg>`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The day's numbers as one sentence (the page's script rewrites it live with the same wording). */
function tallyHtml(s: Stats): string {
  if (!s.total) return "No questions yet. Be the first: text the number above.";
  return `<b>${s.total}</b> ${plural(s.total, "question", "questions")} answered from <b>${s.countries}</b> ${plural(s.countries, "country", "countries")}, in <b>${s.langs.length}</b> ${plural(s.langs.length, "language", "languages")}. ` +
    (s.alertsOn ? `<b>${s.alertsOn}</b> ${plural(s.alertsOn, "farmer gets", "farmers get")} drought alerts.` : "No farmers on drought alerts yet.");
}

/** Public live page at the Worker's URL. */
export async function renderDashboard(env: Env): Promise<Response> {
  const s = await getStats(env);
  const number = env.TWILIO_NUMBER ? esc(formatPhone(env.TWILIO_NUMBER)) : "";
  const tel = env.TWILIO_NUMBER ? esc(env.TWILIO_NUMBER.replace(/\s/g, "")) : "";
  const boot = JSON.stringify({ stats: s, world: WORLD, examples: examples() }).replace(/</g, "\\u003c");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FarmLine: NASA's view of your field, by text</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%2713%27 fill=%27%23142049%27 stroke=%27%23ebc774%27 stroke-width=%273%27/%3E%3C/svg%3E">
<meta name="description" content="Text a question from any phone and get NASA satellite data about your field back. No internet, no app.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
 --night:#0b1430;--dusk:#18244f;--soil:#1b1511;--soil2:#241c16;
 --wheat:#ebc774;--wheat-dim:rgba(235,199,116,.55);--dew:#eef1ea;--mist:#a4adc4;--clay:#b9a58c;
 --dry:#ef5d3c;--wet:#6cd4e0;--rule:rgba(235,199,116,.16);
 --serif:"Fraunces",Georgia,"Times New Roman",serif;--sans:"Public Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--soil);color:var(--dew);font:400 17px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit}
:focus-visible{outline:2px solid var(--wheat);outline-offset:3px;border-radius:4px}

/* ---------- hero: harvest moon over a field at night ---------- */
.hero{position:relative;overflow:hidden;min-height:min(100svh,880px);display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);align-items:center;gap:0 24px;
 padding:56px max(24px,calc((100vw - 1180px)/2)) calc(28vh + 40px);
 background:radial-gradient(70% 60% at 72% 34%,rgba(235,199,116,.16),transparent 62%),linear-gradient(180deg,var(--night) 0%,var(--dusk) 45%,#3b2f4a 62%,#7a5440 78%,#7a5440 100%)}
.hero:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.7;background-image:
 radial-gradient(1px 1px at 8% 14%,#fff,transparent),radial-gradient(1px 1px at 22% 32%,#fffc,transparent),radial-gradient(1px 1px at 41% 9%,#fff9,transparent),
 radial-gradient(1.4px 1.4px at 55% 26%,#fff,transparent),radial-gradient(1px 1px at 63% 6%,#fffb,transparent),radial-gradient(1px 1px at 88% 18%,#fff9,transparent),
 radial-gradient(1px 1px at 94% 40%,#fffa,transparent),radial-gradient(1px 1px at 33% 52%,#fff8,transparent),radial-gradient(1px 1px at 12% 44%,#fff9,transparent);
 mask-image:linear-gradient(180deg,#000 40%,transparent 68%)}
.rows{position:absolute;left:0;right:0;bottom:0;width:100%;height:28vh;fill:none;background:linear-gradient(180deg,#5c3f31 0%,#33251d 30%,var(--soil) 100%)}
.hero:after{content:"";position:absolute;left:0;right:0;bottom:28vh;height:90px;transform:translateY(50%);pointer-events:none;background:radial-gradient(50% 50% at 50% 50%,rgba(255,190,110,.32),transparent 70%)}
.copy{position:relative;z-index:2;max-width:560px}
.brand{font:600 15px/1 var(--sans);letter-spacing:.02em;color:var(--wheat);display:flex;align-items:center;gap:10px;margin:0 0 28px}
.brand i{width:10px;height:10px;border-radius:50%;background:var(--wheat);box-shadow:0 0 14px var(--wheat)}
h1{margin:0;font:700 clamp(46px,7.4vw,96px)/.95 var(--serif);font-variation-settings:"opsz" 144;letter-spacing:-.025em;color:var(--dew)}
.lede{margin:22px 0 0;max-width:30ch;font:400 clamp(19px,2.1vw,23px)/1.45 var(--serif);color:#d6dbe6}
.ask{margin:34px 0 0;display:flex;flex-direction:column;gap:8px}
.ask small{font-size:14px;color:var(--mist)}
.ask a{font:600 clamp(30px,4.2vw,46px)/1.05 var(--serif);font-variant-numeric:lining-nums tabular-nums;color:var(--wheat);text-decoration:none;letter-spacing:-.01em;width:fit-content}
.ask a:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:6px}
.ask .try{font-size:15px;color:var(--mist)}
.ask .try q{color:var(--dew);font-style:italic;quotes:"“" "”"}
.moon{position:relative;z-index:1;aspect-ratio:1;width:100%;max-width:560px;justify-self:center}
#ball{position:absolute;inset:-6%}
.globe{position:absolute;inset:15.6%;border-radius:50%;box-shadow:0 0 0 1px rgba(220,235,255,.18),0 30px 80px rgba(108,212,224,.18),inset 0 0 40px rgba(11,20,48,.5)}
.globe svg{display:block;width:100%;height:100%}
.globe .cloud{animation:drift 18s ease-in-out infinite alternate}
@keyframes drift{to{transform:translateX(26px)}}
.stand{position:absolute;left:50%;bottom:7%;width:34%;height:9%;transform:translateX(-50%);background:linear-gradient(#8a6a46,#4a3424 70%,#2e2017);clip-path:polygon(16% 0,84% 0,100% 100%,0 100%);border-radius:0 0 6px 6px;z-index:-1}
.stand::before{content:"";position:absolute;inset:-22% 8% auto;height:34%;border-radius:50%;background:#c9a46a;opacity:.55}
#ball{z-index:2;pointer-events:none}

/* ---------- the day's tally ---------- */
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.tally{margin:0 auto;padding:64px 0 24px;max-width:880px;text-align:center;font:400 clamp(24px,3.4vw,38px)/1.35 var(--serif);color:#e4ddcf}
.tally b{font-weight:700;color:var(--wheat);font-variant-numeric:lining-nums tabular-nums}
.pulse{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--wet);box-shadow:0 0 0 0 rgba(108,212,224,.6);vertical-align:middle;margin-right:10px;animation:ping 2.2s infinite}
@keyframes ping{70%{box-shadow:0 0 0 12px rgba(108,212,224,0)}100%{box-shadow:0 0 0 0 rgba(108,212,224,0)}}
.livenote{text-align:center;color:var(--clay);font-size:14px;margin:0 0 48px}

/* ---------- map band ---------- */
h2{margin:0;font:600 clamp(22px,2.4vw,28px)/1.2 var(--serif);color:var(--dew);letter-spacing:-.005em}
.sect-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.sect-head p{margin:0;color:var(--clay);font-size:14px}
.key{display:flex;gap:18px;font-size:14px;color:var(--clay)}
.key span{display:inline-flex;align-items:center;gap:7px}.key span:before{content:"";width:9px;height:9px;border-radius:50%;background:var(--c)}
.mapband{padding:40px 0 56px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);background:radial-gradient(60% 80% at 50% 40%,rgba(235,199,116,.05),transparent)}
.mapbox{position:relative;width:100%;aspect-ratio:2.35/1}
#map{position:absolute;inset:0;width:100%;height:100%}
.langs{margin:18px 0 0;color:var(--clay);font-size:15px}
.langs b{color:var(--dew);font-weight:600}

/* ---------- phone + field log ---------- */
.pair{display:grid;grid-template-columns:340px minmax(0,1fr);gap:56px;padding:64px 0 24px;align-items:start}
.phone{width:300px;height:580px;border-radius:46px;padding:11px;background:#2a2f3c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 40px 80px rgba(0,0,0,.45)}
.screen{position:relative;height:100%;border-radius:36px;overflow:hidden;background:#f3f1ec;color:#1d1d1f;display:flex;flex-direction:column}
.notch{width:96px;height:26px;border-radius:0 0 16px 16px;background:#2a2f3c;margin:0 auto}
.bar{padding:6px 14px 10px;text-align:center;border-bottom:1px solid #e1ddd3;background:#faf8f4}
.bar b{display:block;font:600 15px/1.2 var(--sans)}.bar span{font-size:12px;color:#7a7568}
.thread{flex:1;padding:14px 12px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;overflow:hidden}
.msg{max-width:86%;padding:9px 12px;border-radius:18px;font:400 12.5px/1.4 var(--sans);white-space:pre-line;opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s}
.msg.show{opacity:1;transform:none}
.me{align-self:flex-end;background:#3478f6;color:#fff;border-bottom-right-radius:6px}
.fl{align-self:flex-start;background:#e5e1d6;color:#1d1d1f;border-bottom-left-radius:6px}
.typing{align-self:flex-start;background:#e5e1d6;border-radius:18px;padding:11px 13px;display:none;gap:4px}
.typing.show{display:flex}.typing i{width:6px;height:6px;border-radius:50%;background:#8b8577;animation:blink 1s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes blink{50%{opacity:.25}}
.tabs{display:flex;gap:4px;margin:18px 0 0;width:300px;justify-content:center;flex-wrap:wrap}
.tabs button{font:500 14px/1 var(--sans);color:var(--clay);background:none;border:1px solid transparent;border-radius:999px;padding:8px 12px;cursor:pointer}
.tabs button:hover{color:var(--dew)}
.tabs button[aria-pressed="true"]{color:var(--soil);background:var(--wheat)}
.phonecol p{margin:14px 0 0;max-width:300px;color:var(--clay);font-size:14px}
.log{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
.log li{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:20px;align-items:center;padding:16px 0;border-bottom:1px solid var(--rule)}
.place{font:600 21px/1.25 var(--serif);color:var(--dew);text-align:left;unicode-bidi:plaintext}
.detail{margin-top:3px;font-size:14px;color:var(--clay)}
.detail .via{color:var(--mist)}
.rain{font-size:14px;color:var(--clay);text-align:right}
.rain b{display:block;font:700 22px/1.1 var(--serif);font-variant-numeric:lining-nums tabular-nums}
.gauge{position:relative;height:6px;margin-top:8px;border-radius:6px;background:rgba(255,255,255,.08)}
.gauge i{position:absolute;left:0;top:0;bottom:0;border-radius:6px}
.gauge:after{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:rgba(255,255,255,.35)}
.empty{padding:22px 0;color:var(--clay);font-size:16px}
.new{animation:flash 1.6s ease-out}@keyframes flash{from{background:rgba(235,199,116,.12)}to{background:transparent}}

footer{margin-top:72px;padding:36px 0 48px;border-top:1px solid var(--rule);color:var(--clay);font-size:14px;line-height:1.8}
footer .wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
footer b{color:var(--dew);font-weight:600}
footer .team{color:var(--wheat);font-weight:600;text-decoration:none}footer .team:hover{text-decoration:underline}

/* ---------- smaller screens ---------- */
@media (max-width:900px){
 .hero{grid-template-columns:1fr;padding:28px 22px calc(22vh + 32px);min-height:auto;text-align:left}
 .moon{order:-1;max-width:330px;margin:-8px auto 6px}
 .copy{max-width:none}
 .brand{margin-bottom:16px}
 .rows{height:22vh}.hero:after{bottom:22vh}
 .pair{grid-template-columns:1fr;gap:48px;padding-top:48px}
 .phonecol{display:flex;flex-direction:column;align-items:center}
 .phonecol p{text-align:center}
}
@media (max-width:520px){
 body{font-size:16px}
 .tally{padding-top:44px}
 .log li{grid-template-columns:minmax(0,1fr) 96px;gap:12px}
 .place{font-size:18px}
 .rain b{font-size:18px}
 .phone{width:280px;height:540px}.tabs{width:280px}
}
@media (prefers-reduced-motion:reduce){.globe .cloud{animation:none}.pulse,.typing i,.new{animation:none}.msg{transition:none}}
</style></head><body>

<header class="hero">
 <div class="copy">
  <p class="brand"><i></i>FarmLine</p>
  <h1>The almanac written by satellites.</h1>
  <p class="lede">Text a question from any phone and get NASA's view of your field back. No internet. No app. In your own language.</p>
  ${number ? `<div class="ask"><small>Text or call</small><a href="sms:${tel}">${number}</a><span class="try">Try <q>alfalfa 89406 water is short</q></span></div>` : ""}
 </div>
 <div class="moon" aria-hidden="true"><div class="globe"><svg viewBox="0 0 200 200" aria-hidden="true">
<defs>
<clipPath id="gc"><circle cx="100" cy="100" r="99"/></clipPath>
<linearGradient id="gsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b4a86"/><stop offset=".55" stop-color="#8fb3d9"/><stop offset=".8" stop-color="#f3d9a0"/></linearGradient>
<linearGradient id="gfar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f9a52"/><stop offset="1" stop-color="#3f6b35"/></linearGradient>
<linearGradient id="gwheat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8c56a"/><stop offset="1" stop-color="#b98a35"/></linearGradient>
<linearGradient id="ggreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cb35a"/><stop offset="1" stop-color="#2f5e2a"/></linearGradient>
<linearGradient id="gsoil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5f3e"/><stop offset="1" stop-color="#4a2f1f"/></linearGradient>
<radialGradient id="glens" cx=".5" cy=".5" r=".5"><stop offset=".62" stop-color="#0b1430" stop-opacity="0"/><stop offset=".9" stop-color="#0b1430" stop-opacity=".35"/><stop offset="1" stop-color="#0b1430" stop-opacity=".75"/></radialGradient>
<radialGradient id="gshine" cx=".32" cy=".26" r=".42"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<g clip-path="url(#gc)">
<rect width="200" height="200" fill="url(#gsky)"/>
<circle cx="138" cy="92" r="13" fill="#ffe7a6" opacity=".9"/>
<g class="cloud" fill="#eef3fb" opacity=".9"><ellipse cx="70" cy="62" rx="22" ry="9"/><ellipse cx="82" cy="56" rx="14" ry="10"/><ellipse cx="60" cy="58" rx="10" ry="7"/></g>
<path d="M0 104 Q30 86 62 98 T124 94 T200 100 V200 H0Z" fill="url(#gfar)"/>
<path d="M0 112 Q50 100 100 108 T200 106 V200 H0Z" fill="#4f7d3c"/>
<g><rect x="118" y="90" width="14" height="14" fill="#a8432f"/><path d="M116 91 L125 83 L134 91Z" fill="#7d2e22"/><rect x="123" y="97" width="4" height="7" fill="#f2e3c4"/><rect x="134" y="84" width="6" height="20" rx="3" fill="#c9ccd2"/><path d="M134 86 a3 3 0 0 1 6 0" fill="#9aa0aa"/></g>
<g><rect x="54" y="94" width="2.4" height="12" fill="#4a3424"/><circle cx="55" cy="91" r="7" fill="#355f2b"/><circle cx="51" cy="94" r="5" fill="#3d6b31"/></g>
<path d="M0 116 L100 112 L60 200 H0Z" fill="url(#gwheat)"/>
<path d="M100 112 L200 118 V200 H140Z" fill="url(#ggreen)"/>
<path d="M100 112 L140 200 H60Z" fill="url(#gsoil)"/>
<g stroke="#6b4a1f" stroke-opacity=".45" stroke-width=".8" fill="none"><path d="M100 112 L51 200"/><path d="M100 112 L42 200"/><path d="M100 112 L33 200"/><path d="M100 112 L24 200"/><path d="M100 112 L15 200"/><path d="M100 112 L6 200"/><path d="M100 112 L-3 200"/><path d="M100 112 L-12 200"/></g><g stroke="#2b4f24" stroke-opacity=".55" stroke-width=".9" fill="none"><path d="M100 112 L149 200"/><path d="M100 112 L158 200"/><path d="M100 112 L167 200"/><path d="M100 112 L176 200"/><path d="M100 112 L185 200"/><path d="M100 112 L194 200"/><path d="M100 112 L203 200"/><path d="M100 112 L212 200"/></g><g stroke="#3a2618" stroke-opacity=".6" stroke-width=".9" fill="none"><path d="M100 112 L70 200"/><path d="M100 112 L80 200"/><path d="M100 112 L90 200"/><path d="M100 112 L100 200"/><path d="M100 112 L110 200"/><path d="M100 112 L120 200"/><path d="M100 112 L130 200"/></g>
<g fill="#5f9b45"><ellipse cx="91.8" cy="130" rx="1.6" ry="1.1"/><ellipse cx="95.1" cy="130" rx="1.6" ry="1.1"/><ellipse cx="98.4" cy="130" rx="1.6" ry="1.1"/><ellipse cx="101.6" cy="130" rx="1.6" ry="1.1"/><ellipse cx="104.9" cy="130" rx="1.6" ry="1.1"/><ellipse cx="108.2" cy="130" rx="1.6" ry="1.1"/><ellipse cx="86.4" cy="142" rx="1.9" ry="1.3"/><ellipse cx="91.8" cy="142" rx="1.9" ry="1.3"/><ellipse cx="97.3" cy="142" rx="1.9" ry="1.3"/><ellipse cx="102.7" cy="142" rx="1.9" ry="1.3"/><ellipse cx="108.2" cy="142" rx="1.9" ry="1.3"/><ellipse cx="113.6" cy="142" rx="1.9" ry="1.3"/><ellipse cx="80.9" cy="154" rx="2.2" ry="1.5"/><ellipse cx="88.5" cy="154" rx="2.2" ry="1.5"/><ellipse cx="96.2" cy="154" rx="2.2" ry="1.5"/><ellipse cx="103.8" cy="154" rx="2.2" ry="1.5"/><ellipse cx="111.5" cy="154" rx="2.2" ry="1.5"/><ellipse cx="119.1" cy="154" rx="2.2" ry="1.5"/><ellipse cx="75.5" cy="166" rx="2.4" ry="1.7"/><ellipse cx="85.3" cy="166" rx="2.4" ry="1.7"/><ellipse cx="95.1" cy="166" rx="2.4" ry="1.7"/><ellipse cx="104.9" cy="166" rx="2.4" ry="1.7"/><ellipse cx="114.7" cy="166" rx="2.4" ry="1.7"/><ellipse cx="124.5" cy="166" rx="2.4" ry="1.7"/><ellipse cx="70.0" cy="178" rx="2.7" ry="1.8"/><ellipse cx="82.0" cy="178" rx="2.7" ry="1.8"/><ellipse cx="94.0" cy="178" rx="2.7" ry="1.8"/><ellipse cx="106.0" cy="178" rx="2.7" ry="1.8"/><ellipse cx="118.0" cy="178" rx="2.7" ry="1.8"/><ellipse cx="130.0" cy="178" rx="2.7" ry="1.8"/><ellipse cx="64.5" cy="190" rx="3.0" ry="2.0"/><ellipse cx="78.7" cy="190" rx="3.0" ry="2.0"/><ellipse cx="92.9" cy="190" rx="3.0" ry="2.0"/><ellipse cx="107.1" cy="190" rx="3.0" ry="2.0"/><ellipse cx="121.3" cy="190" rx="3.0" ry="2.0"/><ellipse cx="135.5" cy="190" rx="3.0" ry="2.0"/></g>
<rect width="200" height="200" fill="url(#glens)"/>
</g>
<circle cx="100" cy="100" r="99" fill="url(#gshine)"/>
<path d="M30 84 A72 72 0 0 1 52 44" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M150 158 A64 64 0 0 1 120 172" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round" fill="none"/>
<circle cx="100" cy="100" r="98.5" fill="none" stroke="#dfeaff" stroke-opacity=".35" stroke-width="1"/>
</svg></div><div class="stand"></div><div id="ball"></div></div>
 ${fieldRows()}
</header>

<main>
 <div class="wrap">
  <p class="tally" id="tally" aria-live="polite">${tallyHtml(s)}</p>
  <p class="livenote"><span class="pulse" aria-hidden="true"></span>Updates live as farmers text and call</p>
 </div>

 <section class="mapband" aria-labelledby="map-h">
  <div class="wrap">
   <div class="sect-head"><h2 id="map-h">Where farmers are asking from</h2>
    <div class="key"><span style="--c:var(--dry)">Drier than normal</span><span style="--c:var(--dew)">Normal</span><span style="--c:var(--wet)">Wetter</span></div></div>
   <div class="mapbox"><canvas id="map" role="img" aria-label="World map with a pin for each place a farmer asked from"></canvas></div>
   <p class="langs" id="langs"></p>
  </div>
 </section>

 <div class="wrap pair">
  <section class="phonecol" aria-labelledby="phone-h">
   <h2 id="phone-h" style="margin-bottom:22px">What a farmer receives</h2>
   <div class="phone"><div class="screen"><div class="notch"></div><div class="bar"><b>FarmLine</b><span>${number || "SMS"}</span></div>
    <div class="thread"><div class="msg me" id="ask" dir="auto"></div><div class="typing" id="typing"><i></i><i></i><i></i></div><div class="msg fl" id="reply" dir="auto"></div></div></div></div>
   <div class="tabs" id="tabs" role="group" aria-label="Show the example in another language"></div>
   <p>An example reply with sample numbers. Real replies use the farmer's own place and today's NASA data.</p>
  </section>
  <section aria-labelledby="log-h">
   <div class="sect-head"><h2 id="log-h">Latest questions</h2><p>Rain in the last 30 days, against normal for that place</p></div>
   <ul class="log" id="feed"></ul>
  </section>
 </div>
</main>

<footer><div class="wrap">
 <span>Weather from <b>NASA POWER</b>. Messages and calls by <b>Twilio</b>. No phone numbers are shown or kept with questions.</span>
 <span>Runs on Cloudflare ${CF_PRODUCTS.join(", ")}.</span>
 <a class="team" href="/admin">Team sign in</a>
</div></footer>

<script type="application/json" id="boot">${boot}</script>
<script type="module">
const B=JSON.parse(document.getElementById("boot").textContent);
const NAMES={en:"English",hi:"Hindi",ur:"Urdu",sw:"Swahili"};
const $=id=>document.getElementById(id);
const esc=t=>String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const tone=p=>p==null?css("--dew"):p<60?css("--dry"):p>140?css("--wet"):css("--dew");
const plural=(n,one,many)=>n===1?one:many;
function ago(ts){const s=Math.max(0,(Date.now()-Date.parse(ts))/1000);return s<60?"just now":s<3600?Math.floor(s/60)+" min ago":s<86400?Math.floor(s/3600)+" h ago":ts.slice(0,10)}

// ---- the day's tally, as a sentence ----
function tally(s){
 if(!s.total){$("tally").innerHTML="No questions yet. Be the first: text the number above.";return}
 $("tally").innerHTML='<b>'+s.total+'</b> '+plural(s.total,"question","questions")+' answered from <b>'+s.countries+'</b> '+plural(s.countries,"country","countries")+', in <b>'+s.langs.length+'</b> '+plural(s.langs.length,"language","languages")+'. '+
  (s.alertsOn?'<b>'+s.alertsOn+'</b> '+plural(s.alertsOn,"farmer gets","farmers get")+' drought alerts.':'No farmers on drought alerts yet.');
}

// ---- world map: golden land dots, a pulsing pin per place ----
const W=B.world,bits=Uint8Array.from(atob(W.bits),c=>c.charCodeAt(0));
const canvas=$("map"),ctx=canvas.getContext("2d");let pins=[],cw=0,ch=0;
function size(){const d=Math.min(2,devicePixelRatio||1),r=canvas.getBoundingClientRect();cw=r.width;ch=r.height;canvas.width=cw*d;canvas.height=ch*d;ctx.setTransform(d,0,0,d,0,0)}
const proj=(lat,lon)=>[(lon+180)/360*cw,(W.latTop-lat)/(W.rows*W.step)*ch];
function draw(t){
 const labels=[],cx=cw/W.cols,cy=ch/W.rows,rad=Math.max(.9,Math.min(cx,cy)*.3);ctx.clearRect(0,0,cw,ch);
 ctx.fillStyle="rgba(235,199,116,.30)";
 for(let r=0;r<W.rows;r++)for(let c=0;c<W.cols;c++){const i=r*W.cols+c;if(bits[i>>3]>>(i&7)&1){ctx.beginPath();ctx.arc((c+.5)*cx,(r+.5)*cy,rad,0,6.283);ctx.fill()}}
 pins.forEach((p,k)=>{const[x,y]=proj(p.lat,p.lon),col=tone(p.rain_pct),ph=reduce?.35:((t/1800+k*.37)%1);
  const sc=Math.min(1,Math.max(.45,cw/900));
  ctx.strokeStyle=col;ctx.globalAlpha=(1-ph)*.75;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,(4+ph*20)*sc,0,6.283);ctx.stroke();ctx.globalAlpha=1;
  ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,Math.max(2.5,4*sc),0,6.283);ctx.fill();
  if(cw>560&&labels.length<10){ctx.font="600 13px "+css("--sans");const w=ctx.measureText(p.place).width,b=[x+10,y-21,w,17];
   if(!labels.some(o=>b[0]<o[0]+o[2]+8&&o[0]<b[0]+b[2]+8&&b[1]<o[1]+o[3]+3&&o[1]<b[1]+b[3]+3)){labels.push(b);ctx.fillStyle="rgba(238,241,234,.92)";ctx.fillText(p.place,x+10,y-8)}}});
 if(!reduce)requestAnimationFrame(draw)}
size();addEventListener("resize",()=>{size();if(reduce)draw(0)});requestAnimationFrame(draw);

// ---- live log ----
let seen=new Set();
function render(s,first){
 tally(s);pins=s.pins||[];if(reduce)draw(0);
 $("langs").innerHTML=s.langs.length?"Asked in "+s.langs.map(l=>'<b>'+esc(NAMES[l.lang]||l.lang)+'</b> ('+l.n+')').join(", ")+".":"";
 $("feed").innerHTML=s.recent.length?s.recent.map(q=>{const key=q.ts+q.place,cls=!first&&!seen.has(key)?' class="new"':'';seen.add(key);
  const p=q.rain_pct,col=tone(p);
  const rain=p==null?'':'<div class="rain"><b style="color:'+col+'">'+p+'%</b>of normal rain<div class="gauge" aria-hidden="true"><i style="width:'+Math.min(100,p/2)+'%;background:'+col+'"></i></div></div>';
  return '<li'+cls+'><div><div class="place" dir="auto">'+esc(q.place)+'</div><div class="detail">'+[q.crop&&esc(q.crop),esc(NAMES[q.lang]||q.lang),'<span class="via">'+(q.channel==="call"?"by phone call":q.channel==="alert"?"drought alert":"by text")+'</span>',ago(q.ts)].filter(Boolean).join(", ")+'</div></div>'+rain+'</li>'}).join("")
  :'<li class="empty">Questions will appear here as farmers text and call.</li>';
}
render(B.stats,true);
if(location.protocol!=="file:")setInterval(async()=>{try{const r=await fetch("/api/stats",{cache:"no-store"});if(r.ok)render(await r.json(),false)}catch{}},8000);

// ---- example conversation, one language at a time ----
const ex=B.examples;let cur=0,timer;
$("tabs").innerHTML=ex.map((e,i)=>'<button type="button" data-i="'+i+'" aria-pressed="false">'+NAMES[e.lang]+'</button>').join("");
$("tabs").addEventListener("click",e=>{const b=e.target.closest("button");if(b)play(+b.dataset.i,true)});
function play(i,byUser){clearTimeout(timer);cur=i;const e=ex[i];
 [...$("tabs").children].forEach((b,k)=>b.setAttribute("aria-pressed",String(k===i)));
 const ask=$("ask"),rep=$("reply"),typ=$("typing");[ask,rep].forEach(m=>m.classList.remove("show"));typ.classList.remove("show");
 ask.textContent=e.ask;rep.textContent=e.reply;const d=reduce?0:1;
 timer=setTimeout(()=>{ask.classList.add("show");
  timer=setTimeout(()=>{typ.classList.add("show");
   timer=setTimeout(()=>{typ.classList.remove("show");rep.classList.add("show");
    if(!byUser&&!reduce)timer=setTimeout(()=>play((cur+1)%ex.length),7000)},1300*d)},600*d)},250*d)}
play(0);

// ---- the harvest moon ----
try{const c=document.createElement("canvas");if(!c.getContext("webgl2"))throw 0;
 const {mountCrystalBall}=await import("/ball.js");
 mountCrystalBall($("ball"),{preset:"frost",color:"#D8F1FF",crackle:0.25,flares:0.3,glow:0.45,sparks:0.1,particleCount:2200,fill:0.22,motion:"fall",size:0.62,paused:reduce});
}catch(e){document.body.classList.add("no-webgl")}
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
