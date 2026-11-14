/**
 * One way to ask a model for text: Gemini first, Workers AI (Llama) if Gemini fails.
 *
 * With CF_ACCOUNT_ID and AI_GATEWAY_ID set, both providers go through the same
 * Cloudflare AI Gateway, so every call is logged and cached in one dashboard and
 * the response says which provider answered.
 */
import type { Env } from "../env";

export interface GenerateOptions {
  system: string;
  prompt: string;
  /** JSON Schema the answer must follow. The caller still validates: models drift. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  provider: "gemini" | "workers-ai";
  model: string;
}

export class ModelError extends Error {
  constructor(message: string, readonly provider: string, readonly status?: number) {
    super(message);
  }
}

const DEFAULT_GEMINI = "gemini-3.5-flash-lite";
const DEFAULT_FALLBACK = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";

/** Base URL for Google AI Studio calls: through AI Gateway when configured, else direct. */
export function geminiBase(env: Env): string {
  if (env.CF_ACCOUNT_ID && env.AI_GATEWAY_ID) {
    return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio`;
  }
  return "https://generativelanguage.googleapis.com";
}

export function geminiHeaders(env: Env): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY };
  if (env.AI_GATEWAY_TOKEN) h["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
  return h;
}

export async function generate(env: Env, opts: GenerateOptions): Promise<GenerateResult> {
  try {
    if (!env.GEMINI_API_KEY) throw new ModelError("GEMINI_API_KEY is not set", "gemini");
    return await callGemini(env, opts);
  } catch (err) {
    console.warn(`Gemini failed, falling back to Workers AI: ${(err as Error).message}`);
    return await callWorkersAi(env, opts);
  }
}

async function callGemini(env: Env, opts: GenerateOptions): Promise<GenerateResult> {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI;
  const url = `${geminiBase(env)}/v1beta/models/${model}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 1024,
  };
  if (opts.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = opts.jsonSchema;
  }
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig,
  };

  let res = await post(url, env, body, opts.timeoutMs);
  // Older model versions reject responseJsonSchema; JSON mode alone still works, and the
  // caller validates the shape anyway.
  if (res.status === 400 && opts.jsonSchema) {
    delete generationConfig.responseJsonSchema;
    res = await post(url, env, body, opts.timeoutMs);
  }
  if (!res.ok) {
    throw new ModelError(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, "gemini", res.status);
  }
  const data = (await res.json()) as GeminiResponse;
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    const why = cand?.finishReason ?? data.promptFeedback?.blockReason ?? "empty response";
    throw new ModelError(`Gemini returned no text (${why})`, "gemini");
  }
  return { text, provider: "gemini", model };
}

function post(url: string, env: Env, body: unknown, timeoutMs = 12000): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function callWorkersAi(env: Env, opts: GenerateOptions): Promise<GenerateResult> {
  const model = env.FALLBACK_MODEL || DEFAULT_FALLBACK;
  const input: Record<string, unknown> = {
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    max_tokens: opts.maxOutputTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.jsonSchema) input.response_format = { type: "json_schema", json_schema: opts.jsonSchema };
  const gateway = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
  try {
    const out = (await env.AI.run(model as Parameters<Ai["run"]>[0], input as never, gateway as never)) as {
      response?: unknown;
    };
    const r = out?.response;
    const text = typeof r === "string" ? r : r == null ? "" : JSON.stringify(r);
    if (!text.trim()) throw new Error("empty response");
    return { text, provider: "workers-ai", model };
  } catch (err) {
    throw new ModelError(`Workers AI failed: ${(err as Error).message}`, "workers-ai");
  }
}

/** Pull the first JSON object out of model text (fallback models sometimes wrap it in prose). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error("no JSON object in model output");
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}
