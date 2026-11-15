import type { Env } from "./types";

/**
 * Translate an English reply into the language of the farmer's message: Gemini first
 * (optionally through Cloudflare AI Gateway), then Llama on Workers AI. Every number in
 * the reply must survive, otherwise the English reply is sent: a wrong number is worse than English.
 */
export async function translateReply(env: Env, farmerMessage: string, englishReply: string): Promise<string> {
  const viaGemini = await translateWithGemini(env, farmerMessage, englishReply);
  if (viaGemini) return viaGemini;
  const viaWorkersAI = await translateWithWorkersAI(env, farmerMessage, englishReply);
  return viaWorkersAI ?? englishReply;
}

/** Backup translator: a Llama model on Workers AI, used when Gemini is not set up or fails. */
async function translateWithWorkersAI(env: Env, farmerMessage: string, englishReply: string): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const out = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
      messages: [
        {
          role: "system",
          content:
            "You translate short SMS replies for farmers. Answer with the translation only. Keep every number, percent sign, unit and the words FarmLine and NASA exactly as written, with Western digits. Keep line breaks.",
        },
        { role: "user", content: `Farmer's message (detect its language): ${farmerMessage}\n\nTranslate into that language:\n${englishReply}` },
      ],
      max_tokens: 600,
    })) as { response?: string };
    const reply = (out.response ?? "").trim();
    return reply && numbersKept(englishReply, reply) ? reply : null;
  } catch (e) {
    console.error("Workers AI translation failed", e);
    return null;
  }
}

async function translateWithGemini(env: Env, farmerMessage: string, englishReply: string): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;
  const base = (env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt =
    `A farmer sent this SMS:\n<<<${farmerMessage}>>>\n\n` +
    `Translate the reply below into the language the farmer wrote in. Rules: keep every number, percent sign, ` +
    `unit and the words FarmLine and NASA exactly as written, using Western digits (0-9); keep the line breaks; ` +
    `use simple words a farmer understands. Return JSON {"reply": "..."} and nothing else.\n\nReply:\n<<<${englishReply}>>>`;
  try {
    const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const reply = String((JSON.parse(text) as { reply?: string }).reply ?? "").trim();
    return reply && numbersKept(englishReply, reply) ? reply : null;
  } catch (e) {
    console.error("Gemini translation failed", e);
    return null;
  }
}

/** True when every number in the original appears in the translation. */
export function numbersKept(original: string, translated: string): boolean {
  const nums = original.match(/\d+(?:\.\d+)?/g) ?? [];
  const found = translated.match(/\d+(?:\.\d+)?/g) ?? [];
  const pool = [...found];
  for (const n of nums) {
    const i = pool.indexOf(n);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}
