# FarmLine Worker: SMS + phone call line on Cloudflare

One Cloudflare Worker answers both Twilio channels with real NASA POWER data:

- `POST /sms`: farmer texts e.g. `alfalfa 89406 water is short` and gets rain, heat and (once the engine is up) 3 crop plans back by SMS.
- `POST /voice`: farmer calls, presses 1 (English) or 2 (Hindi), types their ZIP/PIN code, says their crop and problem, hears the answer, and gets the same answer by SMS.

## Languages

| Language | SMS | Phone call | How the farm is found |
| --- | --- | --- | --- |
| English | Yes | Yes (press 1) | ZIP/PIN code or town name |
| Hindi | Yes (Devanagari, or Roman Hindi like "gehun 141001 pani kam hai") | Yes (press 2) | PIN code or town name |
| Urdu | Yes (Urdu script, or Roman Urdu like "gandum Multan pani kam hai") | Press 3: full call if `UR_VOICE` is set, otherwise a short Hindi-voice notice and an Urdu SMS | Built-in list of 20 Pakistani farming towns, then any town name (Pakistani postcodes look like US ZIPs, so they are skipped) |
| Swahili | Yes | Press 4: full call if `SW_VOICE` is set, otherwise FarmLine replies by Swahili SMS | Town name, e.g. Nakuru |
| Any other | Through Gemini translation if `GEMINI_API_KEY` is set, otherwise English | No | ZIP/PIN code or town name |

How the language is chosen: Devanagari script means Hindi, Urdu (Arabic) script means Urdu, common Swahili words mean Swahili. Roman Hindi and Roman Urdu are the same words in Latin letters, so FarmLine decides by the farm: Pakistan gets Urdu, anywhere else gets Hindi. Any other script goes to Gemini.

Replies for English, Hindi, Urdu and Swahili are hand-written templates, so a model can never change a number. Gemini translations are rejected (English is sent instead) if any number differs from the English reply.

Before the demo, have native speakers read the Urdu and Swahili texts in `src/i18n.ts`, and check the town coordinates in `src/places_pk.ts` (they are approximate city centres).

## Deploy to Cloudflare (about 20 minutes)

Run these from the `worker` folder.

1. **Install and log in**
   ```
   npm install
   npx wrangler login
   ```
2. **Create the Cloudflare resources** and paste the two IDs it prints into `wrangler.toml` (`PASTE_KV_ID_HERE`, `PASTE_D1_ID_HERE`):
   ```
   npx wrangler kv namespace create CACHE
   npx wrangler d1 create farmline
   npx wrangler d1 execute farmline --remote --file=db/schema.sql
   npx wrangler queues create farmline-alerts
   ```
   If your plan does not include Queues, delete the two `[[queues...]]` blocks in `wrangler.toml`: the daily check then runs the alerts directly.
3. **Twilio secrets** (from the Twilio Console home page):
   ```
   npx wrangler secret put TWILIO_ACCOUNT_SID
   npx wrangler secret put TWILIO_AUTH_TOKEN
   ```
   and set `TWILIO_NUMBER` in `wrangler.toml`.
4. **Optional, Gemini through AI Gateway** (so every Gemini call shows up live in the Cloudflare dashboard): create a gateway in Cloudflare dashboard > AI > AI Gateway, set `GEMINI_BASE_URL` to `https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_NAME>/google-ai-studio`, and `npx wrangler secret put GEMINI_API_KEY`. Without a Gemini key, Workers AI (Llama) translates instead.
5. **Deploy:** `npx wrangler deploy`. It prints the public URL, e.g. `https://farmline.<you>.workers.dev`. Open it: that is the live dashboard.
6. **Point Twilio at it:** Twilio Console > Phone Numbers > Active numbers > your number:
   - Messaging, "A message comes in": Webhook, `https://farmline.<you>.workers.dev/sms`, HTTP POST
   - Voice, "A call comes in": Webhook, `https://farmline.<you>.workers.dev/voice`, HTTP POST
7. **Trial account:** add every team and judge phone under Phone Numbers > Verified Caller IDs.
8. **Try it:** text `alfalfa 89406 water is short`, then `2`, then `ALERT`. Call the number. Refresh the dashboard.
9. **Custom domain (GoDaddy prize):** Workers & Pages > farmline > Settings > Domains & Routes > add your domain.

Watch live logs with `npx wrangler tail`. Test the daily alert run locally with `npx wrangler dev --test-scheduled` and open `/__scheduled`.

Optional phone voices: in Twilio Console > Voice > Text-to-Speech, check for an Urdu (ur-PK or ur-IN) or Swahili (sw-KE) voice; if one exists, set `UR_VOICE` or `SW_VOICE` to its exact name. Without them those callers continue by SMS.

## What each Cloudflare product does (the judging slide)

| Cloudflare product | Job in FarmLine |
| --- | --- |
| Workers | Every SMS and call: language detection, finding the farm, NASA data, the reply in 4 languages, the call menu |
| Workers AI | Llama translates replies into any other language when Gemini is not available (numbers are checked) |
| AI Gateway | Every Gemini call is logged and cached, and visible live in the dashboard |
| D1 | Farmers who asked for drought alerts; anonymous log of every answered question |
| KV | Caches NASA POWER weather (6 h) and ZIP/town lookups (30 days), so repeat questions are instant |
| Durable Objects | One per farmer: remembers the last answer, so replying 1, 2 or 3 gets that plan's details |
| Cron Triggers | Every day, checks NASA rain for every farmer who replied ALERT |
| Queues | One drought check per farmer, so a slow NASA call never holds up the others |
| Workers URL / custom domain | Public live dashboard: questions answered, languages, latest questions (no phone numbers) |

## SMS commands

| Farmer sends | FarmLine replies |
| --- | --- |
| `alfalfa 89406 water is short` (any language) | NASA rain and heat for the place, 3 plans when the engine is on |
| `1`, `2` or `3` | Full numbers for that plan |
| `ALERT` | Turns on daily drought alerts for the farmer's last place |
| `STOP` | Handled by Twilio: stops all messages |

## Connecting the rotation engine (Lane A)

Set `ENGINE_URL` in `wrangler.toml` and redeploy. Until then, replies give the NASA weather only and never claim plans.

The Worker sends `POST ENGINE_URL` with JSON:
```json
{ "lat": 39.4735, "lon": -118.7774, "country": "us", "crop": "alfalfa", "question": "alfalfa 89406 water is short" }
```
The engine must answer within 6 seconds with:
```json
{ "options": [
  { "rotation": ["wheat", "dry beans", "barley"], "water_saving_pct": 35, "income_change_pct": -4, "bad_year_income_change_pct": -10, "kind": "water" },
  { "rotation": ["alfalfa", "wheat", "alfalfa"], "water_saving_pct": 12, "income_change_pct": 8, "bad_year_income_change_pct": -20, "kind": "income" },
  { "rotation": ["sorghum", "safflower", "wheat"], "water_saving_pct": 28, "income_change_pct": 1, "bad_year_income_change_pct": 2, "kind": "drought" }
] }
```
`kind` decides what each SMS line highlights: water saved, income, or bad-year income.

## Data sources

- Location: Zippopotam.us (US ZIP and Indian PIN codes) and Open-Meteo geocoding (town names, any country); both free, no key
- Weather: NASA POWER daily API (last 30 days of rain and max temperature) and POWER climatology (normal rain for the same months), agriculture community, no key

## Tests

`npm test` runs 53 offline tests (D1 runs on real SQLite through `node:sqlite`; KV, Durable Objects, Queues and Workers AI are in-memory fakes) with NASA, Zippopotam, the engine and Twilio mocked. The Twilio signature check is verified against Twilio's own Python library (`pip install twilio`).

## If something breaks on stage

- **403 from the Worker:** the webhook URL in Twilio must match exactly (https, no trailing slash). For curl testing only, set `VALIDATE_TWILIO_SIGNATURE = "false"`.
- **Hindi voice rejected:** change `Polly.Aditi` in `src/reply.ts` to `Google.hi-IN-Standard-A`.
- **SMS not delivered after upgrading from trial:** US numbers need A2P 10DLC registration (or toll-free verification) for real traffic. For the demo, stay on trial with verified numbers.
