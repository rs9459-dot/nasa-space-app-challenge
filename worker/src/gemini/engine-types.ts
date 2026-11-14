/**
 * What the rotation engine (Lane A) sends back. The Gemini layer reads only this:
 * every number a farmer hears must already be in here, rounded as it should be said.
 *
 * Provisional: Lane A will formalise it as contracts/engine-response.schema.json.
 * Keep this file and that schema in step.
 */

export type OptionLabel = "most_water_saved" | "most_income" | "safest_in_drought";

export interface RotationOption {
  rank: 1 | 2 | 3;
  label: OptionLabel;
  /** Crop codes, one per year, e.g. ["sorghum", "safflower", "barley"]. See crops.ts. */
  rotation: string[];
  water_af_per_acre: number;
  /** Water saved against the baseline, as a whole percent (32 = 32%). */
  water_saved_pct: number;
  /** Typical-year income. */
  income_usd_per_acre: number;
  /** Income in a bad (10th-percentile) year of the 25 replayed. */
  bad_year_income_usd_per_acre: number;
  /** 0-10. */
  soil_score: number;
}

export interface EngineResult {
  field: {
    id: string;
    /** Display name of the place, e.g. "Fallon, NV". */
    place: string;
    current_rotation: string[];
  };
  /** What the farmer's current rotation does, so "saves 32%" has a reference. */
  baseline: {
    water_af_per_acre: number;
    income_usd_per_acre: number;
    bad_year_income_usd_per_acre: number;
  };
  options: RotationOption[];
  years_tested: number;
  data_sources: string[];
}

export interface EngineError {
  error: "field_not_found" | "no_data" | "engine_failed" | string;
  message: string;
}

export function isEngineError(r: EngineResult | EngineError): r is EngineError {
  return typeof (r as EngineError).error === "string";
}
