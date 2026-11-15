/**
 * Calls the rotation engine (contract B). The engine is a Python service reached through
 * ENGINE_URL (a Cloudflare Tunnel to wherever it runs), guarded by ENGINE_API_TOKEN.
 *
 *   const req    = toEngineRequest(parsed);          // ParsedMessage -> POST /plan body
 *   const result = await callEngine(env, req);        // EngineResult | EngineError, never throws
 *
 * Anything that goes wrong (not configured, timeout, network, a reply that isn't contract B)
 * comes back as an EngineError, so the SMS flow can always answer with renderError().
 */
import type { Env } from "./env";
import type { ParsedMessage, Priorities } from "./gemini";
import type { EngineError, EngineResult } from "./gemini/engine-types";
import requestSchema from "../../contracts/engine-request.schema.json";

/** The crop codes the engine accepts (the request schema is the source of truth). */
export const ENGINE_CROPS: ReadonlySet<string> = new Set(requestSchema.$defs.cropCode.enum);
export const DEFAULT_TIMEOUT_MS = 6000;

export interface EngineRequest {
  field_id?: string;
  zip?: string;
  place?: string;
  current_crop?: string | null;
  priorities: Priorities;
}

/** The engine body for a parsed message, or an EngineError when there is no place to look up. */
export function toEngineRequest(parsed: ParsedMessage): EngineRequest | EngineError {
  const zip = parsed.place.zip?.trim();
  const place = parsed.place.name?.trim().slice(0, 100);
  const req: EngineRequest = { priorities: parsed.priorities };
  if (zip && /^[0-9]{5,6}$/.test(zip)) req.zip = zip;
  if (place) req.place = place;
  if (!req.zip && !req.place) return { error: "bad_request", message: "No ZIP or place in the message" };
  // An unknown crop is left out: the engine then uses the field's crop record.
  if (parsed.crop && ENGINE_CROPS.has(parsed.crop)) req.current_crop = parsed.crop;
  return req;
}

function failed(message: string): EngineError {
  return { error: "engine_failed", message };
}

function looksLikeResult(x: any): x is EngineResult {
  return !!x && Array.isArray(x.options) && x.options.length === 3 && !!x.baseline && !!x.field;
}

export async function callEngine(
  env: Env,
  req: EngineRequest,
  opts: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<EngineResult | EngineError> {
  if (!env.ENGINE_URL || !env.ENGINE_API_TOKEN) return failed("Engine is not configured (ENGINE_URL, ENGINE_API_TOKEN)");
  const timeoutMs = opts.timeoutMs ?? (Number(env.ENGINE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const doFetch = opts.fetcher ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${env.ENGINE_URL.replace(/\/+$/, "")}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.ENGINE_API_TOKEN}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    return failed(e.name === "TimeoutError" || e.name === "AbortError" ? `Engine took longer than ${timeoutMs} ms` : `Engine unreachable: ${e.message}`);
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return failed(`Engine sent HTTP ${res.status} without JSON`);
  }
  if (body && typeof body.error === "string") return { error: body.error, message: String(body.message ?? "") };
  if (!res.ok || !looksLikeResult(body)) return failed(`Engine sent HTTP ${res.status} that is not a plan`);
  return body;
}
