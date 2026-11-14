import { describe, expect, it } from "vitest";
import type { EngineResult } from "../src/gemini/engine-types";
import { BUILT_IN } from "../src/gemini/languages";
import { checkNumbers } from "../src/gemini/numbers";
import { smsInfo } from "../src/gemini/sms";
import { renderError, renderOptionDetail, renderPlan } from "../src/gemini/templates";
import sample from "./fixtures/fallon-sample.json";

const R = sample as unknown as EngineResult;

describe.each(BUILT_IN)("templates: %s", (lang) => {
  const sms = renderPlan(R, lang, "sms");

  it("SMS fits in 3 segments", () => {
    const info = smsInfo(sms);
    expect(info.segments, `${info.encoding} ${info.units} units:\n${sms}`).toBeLessThanOrEqual(3);
  });

  it("SMS and voice use only engine numbers", () => {
    expect(checkNumbers(sms, R).unknown).toEqual([]);
    expect(checkNumbers(renderPlan(R, lang, "voice"), R).unknown).toEqual([]);
    for (const n of [1, 2, 3] as const) expect(checkNumbers(renderOptionDetail(R, lang, n), R).unknown).toEqual([]);
  });

  it("SMS mentions every option's water saving and income", () => {
    for (const o of R.options) {
      expect(sms).toContain(`${o.water_saved_pct}%`);
      expect(sms).toContain(`$${o.income_usd_per_acre}`);
    }
  });

  it("has error messages", () => {
    expect(renderError({ error: "field_not_found", message: "" }, lang)).toMatch(/FarmLine/);
    expect(renderError({ error: "engine_failed", message: "" }, lang)).toMatch(/FarmLine/);
  });
});

describe("option order", () => {
  it("numbers options water, income, drought whatever order the engine sends", () => {
    const shuffled = { ...R, options: [R.options[2], R.options[0], R.options[1]] };
    const lines = renderPlan(shuffled, "en", "sms").split("\n");
    expect(lines[1]).toMatch(/^1 Save water: sorghum/);
    expect(lines[2]).toMatch(/^2 Most income: alfalfa/);
    expect(lines[3]).toMatch(/^3 Drought-safe: barley/);
  });

  it("shows more water as +", () => {
    const more = { ...R, options: R.options.map((o, i) => (i === 1 ? { ...o, water_saved_pct: -5 } : o)) };
    expect(renderPlan(more, "en", "sms")).toContain("water +5%");
  });
});
