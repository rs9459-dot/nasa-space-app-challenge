/**
 * /dev/* routes for trying the Gemini layer without a phone. Off unless DEV_ROUTES is "1"
 * (set it in .dev.vars locally; never on the deployed Worker, where anyone could call them).
 *
 *   POST /dev/parse  { "text": "alfalfa 89406, water is short", "country"?: "US" }
 *   POST /dev/reply  { "language": "en", "channel": "sms", "result"?: <engine JSON> }
 *   POST /dev/ask    { "text": "...", "channel"?: "sms" }   parse + sample engine + reply
 *   POST /dev/speak  { "text": "..." }                       -> audio/wav
 *   POST /dev/plan   { "text": "...", "channel"?: "sms" }   parse + REAL engine + reply
 *
 * /dev/reply and /dev/ask use the made-up Fallon sample; /dev/plan calls the engine at ENGINE_URL.
 */
import type { Env } from "./env";
import { composeReply, parseMessage, speak, type EngineResult } from "./gemini";
import { callEngine, toEngineRequest } from "./engine";
import sample from "../test/fixtures/fallon-sample.json";

const SAMPLE = sample as unknown as EngineResult;

export async function handleDev(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (env.DEV_ROUTES !== "1") return Response.json({ error: "Not found" }, { status: 404 });
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

      case "/dev/plan": {
        const parsed = await parseMessage(env, String(body.text ?? ""), { country: body.country });
        const request = toEngineRequest(parsed);
        const started = Date.now();
        const result = "error" in request ? request : await callEngine(env, request);
        const engine_ms = Date.now() - started;
        const reply = await composeReply(env, result, {
          language: parsed.language,
          language_name: parsed.language_name,
          channel: body.channel ?? "sms",
          option_number: parsed.option_number,
        });
        return Response.json({ parsed, request, engine_ms, result, reply });
      }

      case "/dev/speak": {
        const s = await speak(env, String(body.text ?? ""));
        // pcmToWav allocates an exact-size buffer, so the whole ArrayBuffer is the file.
        return new Response(s.wav.buffer as ArrayBuffer, { headers: { "content-type": "audio/wav", "x-model": s.model } });
      }
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
