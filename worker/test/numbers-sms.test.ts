import { describe, expect, it } from "vitest";
import { checkNumbers, extractNumbers, normalizeDigits, sameNumbers } from "../src/gemini/numbers";
import { smsInfo, toGsmFriendly } from "../src/gemini/sms";
import sample from "./fixtures/fallon-sample.json";

const vals = (s: string) => extractNumbers(s).map((n) => n.value);

describe("extractNumbers", () => {
  it("reads money, percents and decimals", () => {
    expect(vals("Water -33%, $780/ac, 3.5 AF")).toEqual([33, 780, 3.5]);
  });
  it("keeps thousands together but splits lists", () => {
    expect(vals("$1,200 and 1,20,000")).toEqual([1200, 120000]);
    expect(vals("options 1,2,3")).toEqual([1, 2, 3]);
  });
  it("reads Devanagari and Urdu digits", () => {
    expect(normalizeDigits("पानी ३३%")).toBe("पानी 33%");
    expect(vals("پانی ۳۳٪")).toEqual([33]);
  });
  it("reads English number words and flags fractions", () => {
    expect(vals("thirty-three percent")).toEqual([33]);
    expect(vals("seven out of ten")).toEqual([7, 10]);
    expect(extractNumbers("about half the water")).toEqual([{ raw: "half", value: null }]);
  });
});

describe("checkNumbers", () => {
  it("passes a reply that only uses engine numbers", () => {
    const r = checkNumbers("FarmLine: 1 sorghum, water -33%, $780/ac (bad yr $610). Tested on 25 yrs.", sample);
    expect(r).toEqual({ ok: true, unknown: [], missing: [] });
  });
  it("blocks an invented number", () => {
    const r = checkNumbers("Option 1 saves 35% water and earns $780/ac", sample);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["35"]);
  });
  it("blocks unverifiable words", () => {
    expect(checkNumbers("uses half the water", sample).ok).toBe(false);
  });
  it("reports required numbers that are missing", () => {
    const r = checkNumbers("Option 1 earns $780/ac", sample, { required: [780, 960] });
    expect(r.missing).toEqual([960]);
  });
  it("compares translations by their numbers", () => {
    expect(sameNumbers("water -33%, $780", "agua -33%, $780")).toBe(true);
    expect(sameNumbers("water -33%, $780", "agua -35%, $780")).toBe(false);
  });
});

describe("smsInfo", () => {
  it("counts GSM-7 segments", () => {
    expect(smsInfo("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(smsInfo("a".repeat(161))).toMatchObject({ encoding: "GSM-7", segments: 2 });
    expect(smsInfo("a".repeat(459))).toMatchObject({ segments: 3 });
  });
  it("counts extension characters twice", () => {
    expect(smsInfo("€".repeat(80)).units).toBe(160);
  });
  it("switches to UCS-2 on one curly quote, and toGsmFriendly fixes it", () => {
    const text = "It’s " + "a".repeat(100);
    expect(smsInfo(text)).toMatchObject({ encoding: "UCS-2", segments: 2 });
    expect(smsInfo(toGsmFriendly(text))).toMatchObject({ encoding: "GSM-7", segments: 1 });
  });
  it("folds accents GSM lacks so Spanish stays GSM-7", () => {
    const es = "Cártamo, sequía, cebada: ahorra 33% de agua";
    expect(smsInfo(es).encoding).toBe("UCS-2");
    expect(toGsmFriendly(es)).toBe("Cartamo, sequia, cebada: ahorra 33% de agua");
    expect(toGsmFriendly("é ñ ü stay")).toBe("é ñ ü stay"); // already GSM
    expect(toGsmFriendly("पानी")).toBe("पानी");
  });
  it("treats Hindi as UCS-2", () => {
    expect(smsInfo("पानी".repeat(20)).encoding).toBe("UCS-2");
  });
});
