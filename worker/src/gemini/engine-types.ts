/**
 * What the rotation engine sends back (contract B). The Gemini layer reads only this:
 * every number a farmer hears must already be in here, rounded as it should be said.
 *
 * The source of truth is contracts/engine-response.schema.json; samples are in
 * contracts/samples/. Keep this file and that schema in step (engine/tests and
 * worker/test/contract.test.ts check the samples against both).
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
  /** True if the engine ran on a hand-made sample bundle. Never show one in the demo. */
  sample_data?: boolean;
  /** The 3 chosen options rerun on weather shifted to 2035 by the 2001-2025 trend. */
  climate_2035?: Climate2035;
  /** The engine replayed on a past drought with only the weather known before it. */
  hindcast?: Hindcast;
}

export interface Climate2035 {
  temp_trend_c_per_decade: number;
  temp_trend_significant: boolean;
  rain_trend_mm_per_decade: number;
  rain_trend_significant: boolean;
  options: { label: OptionLabel; water_af_per_acre: number; income_usd_per_acre: number }[];
}

export interface Hindcast {
  /** Last weather year the engine was allowed to see. */
  weather_through: number;
  years: number[];
  /** Whole percent of full allocation, keyed by year ("2021": 56). */
  allocation_pct_by_year: Record<string, number>;
  safest_rotation: string[];
  safest_water_af_per_acre: number;
  /** What the field actually grew in `years` (CDL), null where unknown. */
  actual_crops: (string | null)[];
  /** One sentence for the slide. */
  summary: string;
}

export interface EngineError {
  error: "field_not_found" | "no_data" | "engine_failed" | "bad_request" | "unauthorized" | string;
  message: string;
}

export function isEngineError(r: EngineResult | EngineError): r is EngineError {
  return typeof (r as EngineError).error === "string";
}
