/**
 * Contract B from the worker's side: the engine's sample responses must flow through the
 * Gemini layer. Every language's template renders them, the number checker accepts them,
 * and errors become the right template.
 */
import { describe, expect, it } from "vitest";
import type { EngineError, EngineResult } from "../src/gemini/engine-types";
import { BUILT_IN } from "../src/gemini/languages";
import { checkNumbers } from "../src/gemini/numbers";
import { renderError, renderOptionDetail, renderPlan } from "../src/gemini/templates";
import normal from "../../contracts/samples/plan-normal.json";
import drought from "../../contracts/samples/plan-drought-heavy.json";
import notFound from "../../contracts/samples/error-field-not-found.json";

const samples: [string, EngineResult][] = [
  ["plan-normal", normal as unknown as EngineResult],
  ["plan-drought-heavy", drought as unknown as EngineResult],
];

describe.each(samples)("contract sample %s", (_name, r) => {
  it("has one option per label", () => {
    expect(r.options.map((o) => o.label).sort()).toEqual(["most_income", "most_water_saved", "safest_in_drought"]);
  });

  it.each(BUILT_IN)("renders in %s with only engine numbers", (lang) => {
    for (const channel of ["sms", "voice"] as const) {
      expect(checkNumbers(renderPlan(r, lang, channel), r).unknown).toEqual([]);
    }
    for (const n of [1, 2, 3] as const) expect(checkNumbers(renderOptionDetail(r, lang, n), r).unknown).toEqual([]);
  });
});

it("the drought sample shows a water increase as +", () => {
  expect(renderPlan(drought as unknown as EngineResult, "en", "sms")).toContain("water +5%");
});

it("negative dollars read as -$40, not $-40", () => {
  const text = renderOptionDetail(drought as unknown as EngineResult, "en", 1);
  expect(text).toContain("bad yr -$40");
  expect(text).not.toContain("$-");
});

it("an engine error becomes the place-not-found template", () => {
  expect(renderError(notFound as EngineError, "en")).toMatch(/couldn't find that place/);
});
