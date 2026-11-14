/**
 * Gemini text-to-speech, for the languages Workers AI can't speak (Hindi first).
 *
 * Gemini returns raw 16-bit PCM at 24 kHz; Twilio's <Play> and WhatsApp need a real
 * file, so the PCM is wrapped in a WAV header. Save the result to R2 and hand Twilio
 * its URL.
 */
import type { Env } from "../env";
import { geminiBase, geminiHeaders, ModelError } from "./client";

const DEFAULT_TTS = "gemini-3.8-flash-tts";

export interface Speech {
  wav: Uint8Array;
  model: string;
  seconds: number;
}

/** Speak `text`. `style` is a short delivery note, e.g. "Say warmly and slowly, like a farm advisor". */
export async function speak(env: Env, text: string, style = "Say warmly and clearly, at a calm pace, like a trusted farm advisor:"): Promise<Speech> {
  const model = env.GEMINI_TTS_MODEL || DEFAULT_TTS;
  const res = await fetch(`${geminiBase(env)}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${style}\n${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new ModelError(`Gemini TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, "gemini", res.status);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!part?.data) throw new ModelError("Gemini TTS returned no audio", "gemini");

  const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? 24000);
  const pcm = base64ToBytes(part.data);
  return { wav: pcmToWav(pcm, rate), model, seconds: pcm.length / 2 / rate };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mono 16-bit little-endian PCM -> WAV file bytes. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}
