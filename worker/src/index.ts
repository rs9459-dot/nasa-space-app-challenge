/**
 * FarmLine Worker entry. For now it only exposes /dev/* routes to try the Gemini layer;
 * the Twilio webhooks (SMS, Voice, WhatsApp) plug in here next.
 *
 *   POST /dev/parse  { "text": "alfalfa 89406, water is short", "country"?: "US" }
 *   POST /dev/reply  { "language": "en", "channel": "sms", "result"?: <engine JSON> }
 *   POST /dev/ask    { "text": "...", "channel"?: "sms" }   parse + sample engine + reply
 *   POST /dev/speak  { "text": "..." }                       -> audio/wav
 *
 * Until the engine exists, /dev/reply and /dev/ask use the made-up Fallon sample.
 */
import type { Env } from "./env";
import { composeReply, parseMessage, speak, type EngineResult } from "./gemini";
import sample from "../test/fixtures/fallon-sample.json";

const SAMPLE = sample as unknown as EngineResult;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response("FarmLine worker is running\n");
    if (!url.pathname.startsWith("/dev/") || env.DEV_ROUTES !== "1") return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("POST JSON to this route", { status: 405 });

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "body must be JSON" }, { status: 400 });
    }

    try {
      switch (url.pathname) {
        case "/dev/parse":
          return Response.json(await parseMessage(env, String(body.text ?? ""), { country: body.country }));

        case "/dev/reply":
          return Response.json(
            await composeReply(env, body.result ?? SAMPLE, {
              language: body.language ?? "en",
              language_name: body.language_name,
              channel: body.channel ?? "sms",
              option_number: body.option_number ?? null,
            }),
          );

        case "/dev/ask": {
          const parsed = await parseMessage(env, String(body.text ?? ""), { country: body.country });
          const reply = await composeReply(env, SAMPLE, {
            language: parsed.language,
            language_name: parsed.language_name,
            channel: body.channel ?? "sms",
            option_number: parsed.option_number,
          });
          return Response.json({ parsed, reply });
        }

        case "/dev/speak": {
          const s = await speak(env, String(body.text ?? ""));
          return new Response(s.wav, { headers: { "content-type": "audio/wav", "x-model": s.model } });
        }
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
