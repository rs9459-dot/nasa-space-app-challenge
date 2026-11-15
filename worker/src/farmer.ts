/**
 * One farmer text -> one reply: Gemini reads it, the engine plans, Gemini writes it back.
 *
 *   const { text, result } = await answerFarmer(env, body, { from, lastResult });
 *
 * Never throws and never takes longer than BUDGET_MS (Twilio waits about 15 s for the
 * webhook): anything that fails or runs late becomes a short, honest fixed reply.
 */
import type { Env } from "./env";
import { callEngine, toEngineRequest } from "./engine";
import { composeReply, parseMessage, renderError, renderPlan, type EngineResult } from "./gemini";
import type { EngineError } from "./gemini/engine-types";
import { isBuiltIn, type BuiltInLang } from "./gemini/languages";

export const BUDGET_MS = 13000;
export const HELP_TEXT =
  "FarmLine: text your crop and ZIP code or town, e.g. \"alfalfa 89406, water is short\". You get 3 rotation options. Prototype advice. STOP to stop.";
const LATE_TEXT = "FarmLine: sorry, we couldn't check your field right now. Please try again in a few minutes.";

/** Country from the phone number, so the parser can tell Roman Hindi from Urdu, US ZIP from PIN. */
export function countryOf(phone: string): string | undefined {
  if (phone.startsWith("+1")) return "US";
  if (phone.startsWith("+91")) return "IN";
  if (phone.startsWith("+92")) return "PK";
  if (phone.startsWith("+254")) return "KE";
  return undefined;
}

export interface FarmerAnswer {
  text: string;
  /** The engine's plan, to keep for "tell me more about option 2". */
  result?: EngineResult;
}

async function answer(env: Env, body: string, from: string, lastResult?: EngineResult): Promise<FarmerAnswer> {
  const parsed = await parseMessage(env, body, { country: countryOf(from) });
  const lang = { language: parsed.language, language_name: parsed.language_name, channel: "sms" as const };

  if (parsed.intent === "option_detail" && parsed.option_number && lastResult) {
    const reply = await composeReply(env, lastResult, { ...lang, option_number: parsed.option_number });
    return { text: reply.text };
  }

  const request = toEngineRequest(parsed);
  if ("error" in request) {
    // No ZIP or town: the not-found template asks for exactly that, in their language.
    if (parsed.intent === "greeting" || (!parsed.crop && !parsed.place.name)) return { text: HELP_TEXT };
    const notFound: EngineError = { error: "field_not_found", message: request.message };
    return { text: (await composeReply(env, notFound, lang)).text };
  }

  const result = await callEngine(env, request);
  const plan = "error" in result ? undefined : result;
  // Gemini writes the reply, but a slow model must not cost the farmer the answer: after
  // WRITE_MS the fixed, number-checked template goes out instead (English when the farmer's
  // language has no template).
  const fallback = (): string => {
    const t: BuiltInLang = isBuiltIn(parsed.language) ? parsed.language : "en";
    return plan ? renderPlan(plan, t, "sms") : renderError(result as EngineError, t);
  };
  const text = await within(WRITE_MS, composeReply(env, result, { ...lang, option_number: parsed.option_number }).then((r) => r.text), fallback);
  return { text, result: plan };
}

const WRITE_MS = 5000;

async function within<T>(ms: number, work: Promise<T>, otherwise: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(otherwise()), ms); });
  try {
    return await Promise.race([work.catch(() => otherwise()), late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function answerFarmer(
  env: Env, body: string, opts: { from: string; lastResult?: EngineResult },
): Promise<FarmerAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<FarmerAnswer>((resolve) => { timer = setTimeout(() => resolve({ text: LATE_TEXT }), BUDGET_MS); });
  try {
    return await Promise.race([answer(env, body, opts.from, opts.lastResult), late]);
  } catch {
    return { text: renderError({ error: "engine_failed", message: "" }, "en") };
  } finally {
    clearTimeout(timer);
  }
}
