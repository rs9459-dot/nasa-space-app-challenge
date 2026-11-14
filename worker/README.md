# FarmLine: farmer messaging module

Your part is the phone interface: an ordinary SMS enters Twilio, reaches a Cloudflare Worker, and produces an SMS reply. The crop/data engine is a teammate's service. This starter does not claim to have fetched NASA data or calculated recommendations.

## What is implemented

- POST /webhooks/sms: signed Twilio SMS webhook, official SDK validation, account and recipient checks.
- Immediate TwiML welcome/help reply, with explicit prototype wording.
- One Durable Object per farmer phone number; saved messages, duplicate suppression, STOP/START state.
- Private integration API to read a known farmer's recent requests and send one reply per request.
- Seven-day message retention; opt-out suppression remains saved.
- No credentials in source control, no phone numbers or message bodies in application logs.

Not implemented: NASA fetches, rotation computation, automatic engine dispatch, proactive alert consent, delivery-status callbacks, voice or WhatsApp. The /health endpoint reports the standalone starter's crop engine as disconnected. This is a small prototype, not a bulk messaging service. Inbound carrier messages can still cost money; add account spend controls before sharing the number widely.

## Gemini layer (src/gemini)

This Worker also holds FarmLine's Gemini layer: it turns a farmer's message into JSON for the
engine (`parseMessage`) and the engine's JSON into a checked reply (`composeReply`), plus Hindi
speech (`speak`). Calls go through the team's AI Gateway "default" with a Workers AI fallback.
It is not wired into `/webhooks/sms` yet; the webhook still sends the welcome above. Details,
safety rules and how to try it: [src/gemini/README.md](src/gemini/README.md). Local test routes
are `/dev/*` (src/dev-routes.ts), off unless `DEV_ROUTES=1` in `.dev.vars`.

`npm test` runs both suites: `test:sms` (node:test, this module) and `test:gemini` (vitest).
Deploying also needs `npx wrangler secret put GEMINI_API_KEY` and `AI_GATEWAY_TOKEN`.

Validation: TypeScript check, four unit tests and Wrangler deployment dry-run passed. A full local Durable Object runtime check was attempted but the managed Windows sandbox blocked workerd's SQLite file access. No live Cloudflare deployment or Twilio handset delivery has been verified. Complete the phone demo below before claiming end-to-end success.

## 1. Install and check locally (PowerShell)

Open the worker folder in a terminal:

```powershell
cd worker
npm.cmd ci
npm.cmd run check
npm.cmd test
Copy-Item .dev.vars.example .dev.vars
```

Edit .dev.vars privately. Never put real tokens in GitHub or chat. The template phone number is fictional.

```powershell
npm.cmd run dev
```

Open http://localhost:8787/health. An unsigned webhook intentionally receives HTTP 403. Localhost cannot receive Twilio webhooks directly; deploy next. Do not disable validation for a live endpoint.

## 2. Set up Twilio

1. Create/sign in to a Twilio account. Apply event credits if available.
2. Choose an SMS-capable number and note its E.164 value (+country code and number).
3. Locate the Account SID and Auth Token in the Twilio Console. Keep the token private.
4. Check the account's trial recipient restrictions and the number's messaging registration/verification requirements. Buying a number alone does not guarantee outbound SMS works. Use the Console's messaging logs to diagnose delivery failures.
5. Use a team phone you control for initial testing. Avoid inviting judges to test until your own phone works.

## 3. Deploy Cloudflare

Inside worker/:

```powershell
npx.cmd wrangler login
npx.cmd wrangler secret put TWILIO_ACCOUNT_SID
npx.cmd wrangler secret put TWILIO_AUTH_TOKEN
npx.cmd wrangler secret put TWILIO_PHONE_NUMBER
npx.cmd wrangler secret put TWILIO_WEBHOOK_URL
npx.cmd wrangler secret put ENGINE_REPLY_TOKEN
npm.cmd run deploy
```

Enter values at the private prompts. TWILIO_WEBHOOK_URL must be the exact deployed URL, for example https://farmline-messaging.YOUR-SUBDOMAIN.workers.dev/webhooks/sms (no trailing slash). Use a long random ENGINE_REPLY_TOKEN, shared privately only with your engine teammate. If Wrangler needs the Worker to exist before setting secrets, allow it to create the named Worker, then deploy. Confirm Durable Objects are enabled for your Cloudflare account and review usage limits.

In Twilio, open your active number's messaging configuration. Set **A message comes in** to **Webhook**, paste the exact /webhooks/sms URL, select **HTTP POST**, and save. If using a Messaging Service, check its inbound handling configuration too.

## 4. First phone demo

Text your Twilio number:

> alfalfa near Fallon, Nevada. I want to save water.

Expected: an SMS saying the FarmLine SMS connection works, asking for village/district, crop and goal, and disclosing that crop advice is not connected yet.

Also test HELP, STOP, and START. Twilio manages the carrier-facing opt-out confirmations; the application stores suppression too. This module does not enroll people in future alerts. Obtain separate alert consent when that feature is built.

If no reply arrives: check Twilio Messaging Logs and its error code, then the webhook response, exact configured URL, account/token/number match, destination permissions and sender registration. Do not paste message logs containing phone numbers or secrets into public issues.

## 5. Connect your engine teammate

This first version uses an explicit pull/reply contract. It has no global farmer directory. Your teammate uses a known, consenting test farmer's number. Add a Queue + authenticated engine dispatch later when the basic round trip works.

Both endpoints require POST and Authorization: Bearer <ENGINE_REPLY_TOKEN>. Keep that token server-side.

Read recent messages:

```http
POST /api/messages
Content-Type: application/json
Authorization: Bearer <private-token>

{"farmerPhone":"+15555550123"}
```

The response includes messages with sid, body, receivedAt, and optional sendState. Use the inbound sid as requestId. Phone numbers here are fictional. STOP/START/HELP are commands, not crop requests.

Send the engine's reviewed answer:

```http
POST /api/reply
Content-Type: application/json
Authorization: Bearer <private-token>

{
  "farmerPhone":"+15555550123",
  "requestId":"SM00000000000000000000000000000000",
  "text":"Your evidence-backed comparison from the engine goes here."
}
```

The phone must already have sent a valid inbound message; the request must be under 24 hours old. Replies to commands, opted-out farmers, unknown requests and already claimed requests are rejected. Text is limited to 480 characters, which does NOT guarantee three SMS segments, especially for Unicode. Calculate segment count before expanding languages.

HTTP 200 means Twilio accepted the send, not that the handset received it. A 502 means status is uncertain: inspect Twilio logs before retrying. This starter claims sends before the network request to avoid duplicate charged sends; it deliberately needs manual recovery after an ambiguous failure. Inbound deduplication also favors avoiding duplicate replies over guaranteed welcome delivery. Add signed status callbacks and a reconciled outbox before production use.

## Four-person ownership

1. You: worker/, Twilio setup, SMS tests, messaging integration.
2. Data teammate: pipeline/, dataset provenance and extracted NASA/soil records.
3. Engine teammate: engine/, sourced rotation rules and comparison JSON/text.
4. Dashboard/pitch teammate: web/, evidence display, demo recording and submission.

Agree on the API above before adding extra channels. Keep your change in worker/ so the other three can work independently.

## Share on your existing team GitHub repository

Do not create a replacement repository or overwrite main. In GitHub Desktop:

1. Sign in with the account invited to the private repository.
2. File > Clone repository > URL: https://github.com/rs9459-dot/nasa-space-app-challenge.git.
3. Choose a local folder, then Clone. Create branch feat/farmer-sms.
4. Copy this package's worker/ folder into the cloned repository. If a worker/ folder already exists, compare and integrate changes; do not replace it wholesale.
5. Copy this README as docs/farmer-messaging.md (create docs/ if needed).
6. Review Changes: include worker source/config/tests/package-lock and docs; exclude node_modules, .wrangler, .dev.vars and real tokens.
7. Commit: Add farmer SMS interface on Cloudflare Workers.
8. Publish branch, then Create Pull Request against main.

Suggested PR description:

> Adds the farmer SMS entry point with Twilio signature validation, Durable Object message state, opt-out handling and a private engine reply contract. Includes setup instructions and explicit disconnected-engine wording. Live SMS delivery requires the team's Twilio and Cloudflare configuration; NASA recommendations, voice and WhatsApp are follow-up work.

Official references:
- https://www.twilio.com/docs/messaging/tutorials/how-to-receive-and-reply/node-js
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://developers.cloudflare.com/workers/wrangler/configuration/
