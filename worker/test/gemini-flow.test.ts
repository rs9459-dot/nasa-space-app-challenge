/**
 * Parse and reply with Gemini and Workers AI faked: checks the fallbacks and the
 * number checker decide what the farmer gets, whatever the models do.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import type { EngineResult } from "../src/gemini/engine-types";
import { parseByRules, parseMessage } from "../src/gemini/parse";
import { composeReply, factsFor } from "../src/gemini/reply";
import { renderPlan } from "../src/gemini/templates";
import { pcmToWav } from "../src/gemini/tts";
import sample from "./fixtures/fallon-sample.json";

const R = sample as unknown as EngineResult;

function geminiSays(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeEnv(aiResponse?: unknown): Env {
  return {
    GEMINI_API_KEY: "test-key",
    AI: {
      run: vi.fn(async () => {
        if (aiResponse === undefined) throw new Error("workers ai down");
        return { response: aiResponse };
      }),
    } as unknown as Ai,
  };
}

afterEach(() => vi.unstubAllGlobals());

const PARSED = {
  intent: "rotation_plan", language: "en", language_name: "English", crop: "alfalfa", crop_raw: "",
  zip: "", place_name: "Fallon", country: "US", water_cut: "yes",
  priority_water: 0.6, priority_income: 0.3, priority_drought: 0.1, option_number: 0,
};

describe("parseMessage", () => {
  it("uses Gemini's JSON and cleans it", async () => {
    const fetchMock = vi.fn(async () => geminiSays(JSON.stringify(PARSED)));
    vi.stubGlobal("fetch", fetchMock);
    const p = await parseMessage(makeEnv(), "alfalfa near Fallon, water getting cut, what should I plant?");
    expect(p).toMatchObject({
      intent: "rotation_plan", language: "en", crop: "alfalfa", water_cut: true, source: "gemini",
      place: { zip: null, name: "Fallon", country: "US" },
      priorities: { water: 0.6, income: 0.3, drought: 0.1 },
      option_number: null,
    });
    // only the message text goes to Gemini
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(JSON.stringify(body)).toContain("alfalfa near Fallon");
  });

  it("drops a postal code the farmer never wrote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(JSON.stringify({ ...PARSED, zip: "89406" }))));
    const p = await parseMessage(makeEnv(), "alfalfa near Fallon");
    expect(p.place.zip).toBeNull();
  });

  it("falls back to Workers AI when Gemini errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    const p = await parseMessage(makeEnv(`Here you go: ${JSON.stringify(PARSED)}`), "alfalfa near Fallon");
    expect(p.source).toBe("workers-ai");
    expect(p.crop).toBe("alfalfa");
  });

  it("falls back to rules when both models are down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const p = await parseMessage(makeEnv(), "alfalfa 89406, water is short");
    expect(p).toMatchObject({ source: "rules", crop: "alfalfa", water_cut: true, place: { zip: "89406", country: "US" } });
    expect(p.priorities.water).toBeGreaterThan(p.priorities.income);
  });

  it("decides Roman Hindi vs Urdu by country", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(JSON.stringify({ ...PARSED, language: "hi", country: "" }))));
    expect((await parseMessage(makeEnv(), "gehun ugata hoon, pani kam hai", { country: "PK" })).language).toBe("ur-Latn");
    expect((await parseMessage(makeEnv(), "gehun ugata hoon, pani kam hai", { country: "IN" })).language).toBe("hi-Latn");
  });

  it("trusts the script for Devanagari", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(JSON.stringify({ ...PARSED, language: "en", crop: "wheat" }))));
    expect((await parseMessage(makeEnv(), "मैं गेहूं उगाता हूँ, पानी कम है")).language).toBe("hi");
  });
});

describe("parseByRules", () => {
  it("reads an option number", () => {
    expect(parseByRules("tell me more about option 2")).toMatchObject({ intent: "option_detail", option_number: 2 });
    expect(parseByRules("3")).toMatchObject({ option_number: 3 });
  });
  it("reads an Indian PIN code", () => {
    expect(parseByRules("wheat 452001 pani kam").place).toMatchObject({ zip: "452001", country: "IN" });
  });
});

describe("composeReply", () => {
  const good =
    "FarmLine: 3 plans for Fallon, NV, tested on 25 years of NASA weather.\n" +
    "1 Sorghum, safflower, barley: saves 33% water, $780/acre.\n" +
    "2 Alfalfa, alfalfa, wheat: saves 8% water, $960/acre.\n" +
    "3 Barley, sorghum, cover crop: saves 40% water, $640/acre.\n" +
    "Reply 1, 2 or 3 for details";

  it("sends Gemini's English reply when every number checks out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(good)));
    const r = await composeReply(makeEnv(), R, { language: "en", channel: "sms" });
    expect(r.source).toBe("gemini");
    expect(r.text).toBe(good);
    expect(r.sms).toMatchObject({ encoding: "GSM-7" });
    expect(r.sms!.segments).toBeLessThanOrEqual(3);
  });

  it("blocks an invented number and sends the template", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(good.replace("33%", "35%"))));
    const r = await composeReply(makeEnv(), R, { language: "en", channel: "sms" });
    expect(r.source).toBe("template-fallback");
    expect(r.text).toBe(renderPlan(R, "en", "sms"));
    expect(r.rejected?.check?.unknown).toEqual(["35"]);
  });

  it("blocks a reply that drops an option", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(good.split("\n").slice(0, 3).join("\n"))));
    const r = await composeReply(makeEnv(), R, { language: "en", channel: "sms" });
    expect(r.source).toBe("template-fallback");
    expect(r.rejected?.check?.missing.length).toBeGreaterThan(0);
  });

  it("cleans curly quotes so the SMS stays GSM-7", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(good.replace("FarmLine:", "FarmLine — here’s"))));
    const r = await composeReply(makeEnv(), R, { language: "en", channel: "sms" });
    expect(r.source).toBe("gemini");
    expect(r.sms?.encoding).toBe("GSM-7");
  });

  it("uses templates for Hindi without calling a model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await composeReply(makeEnv(), R, { language: "hi", channel: "sms" });
    expect(r.source).toBe("template");
    expect(r.text).toContain("ज्वार");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("translates other languages and rejects a changed number", async () => {
    const english = renderPlan(R, "en", "sms");
    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(english.replace("FarmLine", "FarmLine ES"))));
    const ok = await composeReply(makeEnv(), R, { language: "other", language_name: "Spanish", channel: "sms" });
    expect(ok.source).toBe("gemini-translation");

    vi.stubGlobal("fetch", vi.fn(async () => geminiSays(english.replace("$780", "$790"))));
    const bad = await composeReply(makeEnv(), R, { language: "other", language_name: "Spanish", channel: "sms" });
    expect(bad).toMatchObject({ source: "template-fallback", language: "en", text: english });
  });

  it("answers an option question from the template", async () => {
    const r = await composeReply(makeEnv(), R, { language: "en", channel: "sms", option_number: 2 });
    expect(r.text).toMatch(/^Option 2 \(Most income\): alfalfa, alfalfa, wheat/);
  });

  it("gives Gemini crop names, not codes", () => {
    expect(JSON.stringify(factsFor(R))).toContain("cover crop");
    expect(JSON.stringify(factsFor(R))).not.toContain("cover_crop");
  });
});

describe("pcmToWav", () => {
  it("writes a valid 44-byte WAV header", () => {
    const wav = pcmToWav(new Uint8Array(4800), 24000);
    const text = (a: number, b: number) => String.fromCharCode(...wav.slice(a, b));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 12)).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24000);
    expect(wav.length).toBe(44 + 4800);
  });
});
