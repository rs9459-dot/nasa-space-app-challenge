# FarmLine Worker: the Gemini layer

Turns a farmer's message into JSON for the engine, and the engine's JSON into a reply
the farmer can trust. Lives in `src/gemini/`.

```ts
import { parseMessage, composeReply, speak } from "./gemini";

const parsed = await parseMessage(env, smsBody, { country: "US" });
// -> { intent, language, crop, place: { zip, name, country }, water_cut, priorities, option_number, source }

const result = await callEngine(parsed); // Lane A

const reply = await composeReply(env, result, {
  language: parsed.language, language_name: parsed.language_name,
  channel: "sms", // or "voice"
  option_number: parsed.option_number,
});
// -> { text, source: "gemini" | "template" | "gemini-translation" | "template-fallback", sms: { segments, encoding } }

const audio = await speak(env, reply.text); // Hindi voice, WAV bytes -> R2 -> Twilio <Play>
```

## How it stays safe

| Step | Primary | If that fails |
|---|---|---|
| Parse | Gemini (structured JSON) through AI Gateway | Workers AI Llama, then keyword rules |
| English reply | Gemini writes from the engine JSON only | Hand-written template |
| Hindi / Urdu / Swahili | Hand-written template (no model) | — |
| Other languages | Gemini translates the English template | English template |

- **Number checker** (`numbers.ts`): every number in a model-written reply must be in the
  engine's JSON, and every option's water saving and income must appear. Otherwise the
  template is sent and `reply.rejected` says why.
- **SMS fit** (`sms.ts`): model replies must be GSM-7 and at most 3 segments. Curly quotes
  and dashes are swapped for plain ones so one character doesn't triple the cost.
- Only the message text goes to Gemini, never the phone number (the free tier may use
  inputs to improve Google's products).

## Run it

From `worker/`:

```bash
npm install
npm run test:gemini   # these unit tests, models faked (npm test runs the SMS tests too)
npm run check         # types
```

Live calls need `GEMINI_API_KEY`, `AI_GATEWAY_TOKEN` and `DEV_ROUTES=1` in `.dev.vars`
(copy `.dev.vars.example`), and `npx wrangler login` for the Workers AI binding. Then
`npm run dev` and:

```bash
curl -X POST localhost:8787/dev/ask -d '{"text":"alfalfa near Fallon, water getting cut, what should I plant?"}'
```

Routes: `/dev/parse`, `/dev/reply`, `/dev/ask`, `/dev/speak` (see `src/dev-routes.ts`). They
use the made-up Fallon sample in `test/fixtures/` until the engine exists. They are off on the
deployed Worker (`DEV_ROUTES` is `""` in `wrangler.jsonc`).

## To do before the demo

- Native speakers check the Hindi, Urdu and Swahili wording (`templates.ts`, `crops.ts`).
- Hindi and Urdu SMS sit at ~199-201 of the 201 characters that fit 3 segments; a longer
  crop name or a 4-digit income tips them to 4 (still delivered, one more segment).
- Wire `/webhooks/sms` to `parseMessage` -> engine -> `composeReply` (with the messaging owner).
- `engine-types.ts` is provisional; keep it in step with Lane A's engine output.
