# Engine workflow (Abdullah's Claude)

> **Kickoff prompt to paste into Claude Code** (from the repo root):
>
> *Read `docs/engine-plan/README.md`, then `docs/engine-plan/ENGINE_WORKFLOW.md`. You are
> building the FarmLine rotation engine in `engine/`. Work through tasks E1 to E8 in order,
> one at a time. Stay inside the folders this workflow gives you. Show me each finished task
> with its test results before starting the next, and ask me before every push.*

You own `engine/`, `contracts/engine-*`, and, in the worker, only
`worker/src/gemini/engine-types.ts` plus the code that calls the engine. You read
`data/` (Hareem's) and never write to it. If you need a data change, write the request down
for Abdullah to pass to Hareem.

## Ground rules for the model

- **No made-up numbers.** Every constant (crop coefficient, price, cost, allocation) comes from
  `data/reference/*.csv` or the field bundle, never from code. If a value is missing, fail loudly
  (`no_data`); don't fill in a guess. The only constants allowed in code are physics and
  method constants (Hargreaves 0.0023, the 0.408 MJ→mm factor, the FAO-56 p-value formula).
- **Sample data is labelled.** If any input bundle has `provenance: "sample"`, the response
  carries `"sample_data": true`.
- **Fast.** `/plan` must answer in under 2 seconds on Vultr: vectorise with NumPy (rotations ×
  weather sequences as arrays, looping only over days).
- **Python 3.11+**, with `fastapi`, `uvicorn`, `numpy`, `pandas`, `scipy`, `pymannkendall` and
  `pytest`, pinned in `engine/requirements.txt`. Use a venv in `engine/.venv` (gitignored).
  *Windows note:* the first time scipy loads in a new venv, Windows Application Control may
  block a DLL. Running it again works.

## Layout

```
engine/
  app.py              FastAPI: POST /plan, GET /health
  bundle.py           load + validate a field bundle and the reference tables
  rotations.py        E3: candidates, enumeration, rules
  water.py            E4: ET0, Kc curves, soil bucket, irrigation
  yields.py           E5: yield, salinity, income, soil score
  rank.py             E6: stress test, TOPSIS, labels, rounding
  climate.py          E7: trend + 2035 shift
  hindcast.py         E8
  tests/              pytest; fixtures point at data/fields/<id>/ (sample first, then real)
```

---

## E1. Contract B (0.75 h), due at the 17:00 checkpoint

- Write `contracts/engine-request.schema.json` and `contracts/engine-response.schema.json`
  (JSON Schema), matching the README's contract B and `worker/src/gemini/engine-types.ts`.
- Write `contracts/samples/`: `plan-normal.json`, `plan-drought-heavy.json`, `error-field-not-found.json`.
  Mark them clearly as samples.
- Add the optional `sample_data`, `climate_2035` and `hindcast` fields to `engine-types.ts`
  (all optional, so the worker keeps working). Run `cd worker && npm test`; all must still pass.
- **Done when** the schemas validate the samples (a pytest using `jsonschema`), worker tests
  pass, and it's merged to main. Abdullah tells Hareem.

## E2. Skeleton (1 h)

- `bundle.py`: load `data/fields/<id>/` and `data/reference/`. Validate the columns, check
  weather covers 2001–2025 with no gaps, and map crop codes. Raise clear errors naming the
  missing file or column.
- `app.py`: `GET /health`; `POST /plan` checks the bearer token (`ENGINE_API_TOKEN` env var),
  validates the request, resolves the field (`field_id`, then `zip`/`place` via
  `places.csv`, then nearest lat/lon), and returns a stub `EngineResult` for now.
- **Done when** `pytest` passes on Hareem's sample Fallon bundle, and `uvicorn engine.app:app`
  answers a curl.

## E3. Rotations (1.5 h)

- **Candidates:** from `crops.csv`, keep crops whose frost-free days and growing degree days
  (computed from the field's POWER temperatures, base temperature per crop) fit the field's
  climate, plus crops the county already grows (the field's CDL history and
  `economics.csv` rows for that county). Fallon should end up with about 8: alfalfa, wheat,
  barley, sorghum, dry beans, safflower, corn silage and a cover crop.
- **Enumerate** every 3-year sequence (8³ = 512). Then drop sequences that break the rules
  (put them in `crops.csv` columns, not code):
  - the same annual crop 3 years running (alfalfa is perennial: allowed);
  - two heavy feeders back to back (`heavy_feeder` column);
  - more than one fallow year.
  About 200 should remain.
- **Done when** a test shows Fallon's count and that each rule removes what it should.

## E4. Water balance (2.5 h): the core

For each rotation × each 3-year weather sequence, run a daily soil-water bucket (FAO-56):

- **ET0 (Hargreaves):** `ET0 = 0.0023 · 0.408 · Ra · (Tmean + 17.8) · √(Tmax − Tmin)`, where
  `Ra` (extraterrestrial radiation, MJ/m²/day) comes from latitude and day of year (FAO-56 eq. 21).
  Cross-check against POWER `solar_mj`; it should be the same order of magnitude.
- **Crop ET:** `ETc = Kc · ET0`, where Kc follows the crop's 4 stages (initial, development,
  mid, late) from `crops.csv`, starting at its planting day. Outside the season, use bare soil
  (`kc_ini`) or the cover crop's curve.
- **Bucket:** total available water `TAW = 10 · aws_0_100_cm` mm (or 0–150 cm for deep-rooted
  crops, per `root_depth_m`). Readily available `RAW = p · TAW`. Depletion `Dr` grows with ETc
  and shrinks with rain and irrigation. Stress `Ks = (TAW − Dr) / ((1 − p) · TAW)` once
  `Dr > RAW`, else 1. Actual ET is `ETa = Ks · ETc`.
- **Irrigation:** when `Dr > RAW`, irrigate back to field capacity, but never more in a year than
  `full_allocation_af_per_acre × allocation_fraction[year]` (1 acre-foot per acre = 304.8 mm).
  This is how water cuts enter the model. Fallon's real constraint is the Newlands Project
  allocation, not local rain.
- **Vectorise:** arrays of shape (rotations × 25 sequences). Loop only over the ~1095 days.
- **Calibrate** once Hareem's OpenET series arrives (D6): compare simulated alfalfa ETa with
  OpenET for the same field-years, and report the error in a test. Don't silently tune.
- **Done when** alfalfa on Fallon uses a plausible amount of irrigation water per year, a test
  shows that a water cut lowers ETa, and 200 × 25 runs in under 1 second.

## E5. Yield, income, soil (1.5 h)

- **Water stress (FAO-33):** `1 − Ya/Ym = Ky · (1 − ΣETa/ΣETc)` over each season.
- **Salinity (FAO-29):** `Ym_salt = Ym · (1 − b · (ECe − threshold)/100)` when ECe exceeds the
  threshold, using `ec_ds_m` from soil.json. Fallon is about 6 dS/m, which hurts alfalfa
  (threshold about 2) and beans badly, and barley little. Judges will notice this, so make sure
  it shows.
- **Income:** `Ya × price − production cost − water cost × water used`, from `economics.csv`.
  `Ym` is the county yield from economics.csv, treated as the unstressed yield.
- **Soil score (0–10):** points per year from `crops.csv` (legume nitrogen, residue, cover,
  deep roots), plus a bonus for cover on slopes over 2% (SRTM/SSURGO slope).
- **Done when** a test shows salinity lowering alfalfa's yield on Fallon soil, and incomes land
  in the range of economics.csv's county figures.

## E6. Stress test, ranking, options (2 h)

- **Weather sequences:** start in each year 2001–2025, then take the next 2 years (wrapping
  around), giving 25 sequences. Per rotation: mean and **10th-percentile ("bad year")** income,
  mean water use, soil score.
- **Baseline:** the farmer's current crop for 3 years, through the same 25 sequences.
- **TOPSIS** on 4 criteria: water (lower is better), mean income, P10 income (drought safety)
  and soil. Weights come from the request's priorities (water→water, income→mean income,
  drought→P10 income), with soil fixed at 0.1, then renormalised.
- **Pick 3 options** from the top 20 by TOPSIS: the least water, the highest mean income and the
  highest P10 income, all distinct (if two coincide, take the next best).
  `water_saved_pct = round(100 · (baseline_water − option_water) / baseline_water)`.
- **Round** as contract B says. Fill `years_tested: 25` and `data_sources` from the bundle's
  provenance (e.g. "NASA POWER", "USDA CropScape", "USDA SSURGO", plus each one actually used).
- **Done when** `/plan` returns a schema-valid EngineResult for real Fallon in under 2 s, the
  worker's `/dev/reply` accepts it as `result` and its number checker passes, and both of you
  agree the 3 options make agronomic sense (01:00 checkpoint).

## E7. Climate shift (1 h)

- Mann-Kendall test and Sen's slope (`pymannkendall`) on the annual mean temperature and annual
  rain, 2001–2025.
- Shift the daily series by slope × 10 years to make a 2035 scenario, rerun E4–E6 for the 3
  chosen options, and add `climate_2035: { temp_trend_c_per_decade, rain_trend_mm_per_decade,
  options: [{label, income_usd_per_acre, water_af_per_acre}] }`, rounded.
- Only report a trend as significant if p < 0.05; otherwise say so in the response.

## E8. Hindcast, deploy, wire (2.5 h)

- **Hindcast:** run the engine with weather up to 2020 only and the 2021 and 2022 allocation
  fractions (D6). Compare the "safest in drought" option's water and income with what the field
  actually did (CDL: corn in 2021, fallow in 2022). Output `hindcast: { years, safest_water_af,
  actual_crops, … }` and one sentence for the slide. Use only real allocation data: if D6 hasn't
  arrived, skip it rather than guess.
- **Vultr:** Ubuntu VM with Python 3.11, `uvicorn engine.app:app` under systemd. Expose it over
  HTTPS with a Cloudflare Tunnel (`cloudflared`) instead of opening ports, and set
  `ENGINE_API_TOKEN`. Copy `data/` to the VM.
- **Worker:** add `callEngine(parsed)` in the worker, which POSTs `/plan` with the token (a
  worker secret `ENGINE_API_TOKEN`) and the engine URL (a var). Use it where the worker
  currently uses the sample, and with Hareem wire `/webhooks/sms` to `parseMessage →
  callEngine → composeReply`. Run `cd worker && npm test`.
- **Done when** a real phone texts "alfalfa 89406, water is short" and gets 3 options computed
  by the engine on Vultr (09:00 checkpoint).

---

## Handy facts (from earlier exploration; re-verify before relying on them)

- **Demo field `nv-fallon-01`:** 39.3800, −118.7700, south of Fallon, Churchill County, NV,
  ZIP 89406. CDL: alfalfa 2009–2020, corn 2021, fallow 2022, alfalfa 2023–2025.
- **Soil:** Carcity clay, slightly saline: AWS 13.65 cm (0–100), 17.28 cm (0–150), EC about 6 dS/m,
  pH 7.9, slope 0.5%, somewhat poorly drained.
- **NASA POWER 2001–2025:** 9,131 days with no gaps. Local rain was 78–307 mm/yr, and 2021
  was *wetter* than average (223 mm). The 2021 drought reached Fallon through the river
  allocation, which is why E4 models allocation and not rain.
- **The worker's number checker** blocks any number in a reply that isn't in your JSON, so
  include every figure the reply might quote (baseline values included).
