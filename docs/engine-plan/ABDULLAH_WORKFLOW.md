# Abdullah's workflow: the water slice

> **Kickoff prompt to paste into Claude Code** (from the repo root):
>
> *Read `docs/engine-plan/README.md`, then `docs/engine-plan/ABDULLAH_WORKFLOW.md`. I own the
> water slice of the FarmLine engine: weather, soil and water data, the water balance, the
> ranking, the API and deploying it. Work through A2 to A9 in order (A1 is done), one task at a
> time, editing only the files this workflow gives me. Show me each finished task with its test
> results before starting the next, and ask me before every push.*

**Your files:**
- **Engine:** `engine/types.py`, `bundle.py`, `water.py`, `rank.py`, `hindcast.py`, `app.py`, and their tests.
- **Pipeline:** `pipeline/weather.py`, `soil.py`, `water_data.py`, `places.py`.
- **Data:** in `data/fields/<id>/`, the files `weather_daily.csv`, `soil.json`, `water.json`, `openet_monthly.csv`, `nwis_flow.csv`, `prism_check.csv`; plus `data/reference/places.csv`.
- **Contracts:** `contracts/engine-*`.
- **Worker:** only `worker/src/gemini/engine-types.ts` and the code that calls the engine.

Hareem owns everything else in `engine/`, `pipeline/` and `data/`. Read her files; never edit
them.

## Ground rules

- **No made-up numbers.** Crop and money constants come from Hareem's `crops.csv` and
  `economics.csv`; water and weather from your bundle files. Missing value = fail with `no_data`.
  Only physics and method constants live in code (Hargreaves 0.0023, 0.408 MJ→mm, 304.8 mm per
  acre-foot).
- **Fast:** `/plan` in under 2 s on Vultr. Use NumPy arrays of shape (rotations × sequences),
  looping only over days.
- **Python 3.11+**, venv in `engine/.venv` (already set up for A1), packages pinned in
  `engine/requirements.txt`. *Windows note:* the first scipy load in a fresh venv may be blocked
  once by Application Control. Rerun it.
- **Before Hareem's parts exist, use fakes:** a hard-coded list of 3 rotations instead of
  `rotations.py`; a toy `Outcomes` built from your `WaterResult` instead of `yields.py`;
  `Signals()` (all neutral) instead of `signals.py`. Delete each fake as soon as her real part
  lands on main.

---

## A1. Contract B ✅ done
Commit `79f9e37` on the branch: request and response schemas, 3 samples, contract tests
(`engine/tests/test_contracts.py`), and `engine-types.ts` updated. Reuse `contract_problems()`
from that test file in A6, so every real response gets the same checks.

## A2. Interfaces + skeleton (1.25 h), due at 17:00
- `engine/types.py`: copy the dataclasses from the README exactly. Hareem builds against them
  the moment this lands on main, so **merge it first**.
- `engine/bundle.py`: `load(field_id) -> (Field, Reference)`. It validates columns, checks
  weather covers 2001–2025 with no gaps, and raises a clear error naming any missing file or
  column. `satellite.json` and `water.json` may be missing on the sample bundle. Build
  `Field.sources` from the files present: `weather_daily.csv` → "NASA POWER",
  `crop_history.json` → "USDA CropScape", `openet_monthly.csv` → "OpenET", `nwis_flow.csv` →
  "USGS NWIS", plus the `source`/`sources` key inside each JSON file.
- `engine/app.py`: `GET /health`; `POST /plan` checks the bearer token (`ENGINE_API_TOKEN`),
  validates the request against `contracts/engine-request.schema.json`, resolves the field
  (field_id → places.csv for zip/place → nearest lat/lon), and returns contract sample 1 for now.
- **Done when** `pytest engine/tests` passes on Hareem's sample bundle (or a minimal one of
  your own until hers lands), and a curl to `/plan` returns a schema-valid response.

## A3. Weather + soil data (1.25 h)
`python -m pipeline.weather nv-fallon-01 39.3800 -118.7700` and `python -m pipeline.soil …`:
- **NASA POWER** (no key): `https://power.larc.nasa.gov/api/temporal/daily/point`,
  `community=AG`, `time-standard=LST`, parameters `T2M_MAX, T2M_MIN, T2M, PRECTOTCORR,
  ALLSKY_SFC_SW_DWN, RH2M, WS2M`, 20010101–20251231. **−999 means missing**: turn it into empty,
  then assert there are none. Expect 9,131 days.
- **USDA SSURGO** (no key): POST `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest` with
  `{"query": …, "format": "JSON+COLUMNNAME"}`. Find the map unit with
  `SDA_Get_Mukey_from_intersection_with_WktWgs84('point(lon lat)')`. From `muaggatt` take
  `aws0100wta, aws0150wta, drclassdcd, hydgrpdcd, slopegraddcp`. From the dominant `component`
  and its top `chorizon` take `om_r, claytotal_r, ph1to1h2o_r, ec_r, wthirdbar_r, wfifteenbar_r`
  → `soil.json` (`ec_ds_m`, plus `fc_top_vol_pct` and `wp_top_vol_pct`: Hareem's SMAP signal
  needs field capacity and wilting point).
- Give `soil.json` a `"source"` key. `bundle.load` maps `weather_daily.csv` to "NASA POWER" itself.
  Never edit `field.json` (Hareem's).
- **Done when** a test checks the columns and the earlier-exploration values (re-verify):
  Carcity clay, AWS 0–100 = 13.65 cm, EC about 6 dS/m, slope 0.5%. Rain 78–307 mm/yr.

## A4. Water data (1.75 h): what makes the drought real
- **`water.json`**, Newlands Project, run by the Truckee-Carson Irrigation District (TCID):
  - `full_allocation_af_per_acre`: the water-righted duty for this land type. TCID separates
    bench and bottom land, so find which applies near the field and cite it.
  - `allocation_fraction_by_year`: the announced allocation for each year 2001–2025 (TCID or
    Reclamation announcements, Lahontan Reservoir reports, news archives), with a source per
    year. **Get 2021 and 2022 first**; the hindcast needs them. Leave a year out rather than guess it.
  - `water_cost_usd_per_af`: the TCID assessment, sourced.
- **USGS NWIS** (no key, `waterservices.usgs.gov`): daily discharge for the Carson River gauge
  above Lahontan Reservoir (find the site number, e.g. near Fort Churchill), 2001–2025 →
  `nwis_flow.csv`. Low-flow years independently confirm the allocation cuts.
- **OpenET** (free key): monthly actual ET at the field, 2016–2025 → `openet_monthly.csv`
  (`month, et_mm, model`), for calibrating A5.
- **PRISM** (Oregon State, no key): monthly precipitation and temperature at the field →
  `prism_check.csv`, compared with POWER (correlation, bias). If POWER is badly off, say so.
- Add each to `docs/DATASETS.md`.
- **Done when** 2021 and 2022 allocations are sourced, at least 15 years in total, and NWIS,
  OpenET and PRISM files are saved with sources.

## A5. `water.py`: the daily water balance (2.5 h), the core
`simulate(field, rotations, ref, signals, *, weather=None, allocation=None) -> WaterResult`.
Here `weather` overrides `field.weather` (for climate and hindcast runs) and `allocation`
overrides `water.json` fractions. For each rotation × each 3-year weather sequence:

- **Sequences:** start in each year 2001–2025, then take the next 2 years (wrapping around),
  giving S = 25. Store them in `sequences`.
- **ET0 (Hargreaves):** `ET0 = 0.0023 · 0.408 · Ra · (Tmean + 17.8) · √(Tmax − Tmin)`, where
  `Ra` comes from latitude and day of year (FAO-56 eq. 21). Sanity-check against POWER `solar_mj`.
- **Crop need:** `ETc = Kc · ET0`, with Kc following 4 stages from Hareem's `crops.csv`
  (`stage_*_days, kc_ini/mid/end, plant_month/day`). Outside the season, bare soil (`kc_ini`).
  A cover crop uses its own row.
- **Rain:** POWER `precip_mm × signals.rain_scale` (Hareem's IMERG correction; 1.0 until her
  signals land).
- **Bucket:** `TAW = 10 · aws` mm (0–100 cm, or 0–150 cm when `root_depth_m > 1`),
  `RAW = p · TAW`. Start depletion is `signals.start_depletion_frac · TAW`. When `Dr > RAW`,
  stress is `Ks = (TAW − Dr) / ((1 − p) · TAW)`, else 1. Actual use `ETa = Ks · ETc`.
- **Irrigation:** when `Dr > RAW`, refill to field capacity, but never past this year's cap:
  `full_allocation_af_per_acre × allocation_fraction[year] × 304.8 mm`. This is how water cuts
  enter the model.
- Return seasonal sums per rotation-year: `etc_mm`, `eta_mm`, `irrigation_mm`, each (R, S, 3).
- **Calibrate against OpenET** (A4): compare simulated alfalfa ETa with OpenET for the same
  field-years, and report the error in a test. If it's far off, look for the cause (Kc stage
  dates, TAW); never fudge a factor.
- **Done when** alfalfa's yearly irrigation on Fallon is plausible, a test shows a water cut
  lowering ETa, and 200 × 25 runs in under 1 s.

## A6. `rank.py` + a real `/plan` (1.75 h)
- **Baseline:** the farmer's current crop for 3 years, through `water.simulate` and
  `yields.evaluate`, same sequences.
- **Criteria per rotation:** mean water (lower is better), mean income, **P10 income** (the "bad
  year", i.e. drought safety), soil score.
- **TOPSIS:** weights from the request (water→water, income→mean income, drought→P10 income),
  with soil fixed at 0.1, then renormalised.
- **Pick** from the top 20: least water, highest mean income, highest P10, all distinct (if two
  coincide, take the next best). Then `water_saved_pct = round(100·(base − option)/base)`.
- **Round** per contract B, fill `years_tested`, take `data_sources` from `field.sources` +
  `signals.sources`, and set `sample_data` from provenance. Run `contract_problems()` and the
  response schema on every output; on failure, return `engine_failed` rather than a bad answer.
- Wire `app.py` to the full pipeline (bundle → signals → rotations → water → yields → rank).
  Once Hareem's `climate.py` lands, rerun the 3 chosen options on `climate.shift_weather(field)`
  and fill `climate_2035` with `climate.trend(field)`. If `signals.history_confirmed` is False
  and the request has no `current_crop`, return `bad_request` asking for the crop, rather than
  trusting CDL.
- **Done when** `/plan` for real Fallon returns a valid EngineResult in under 2 s, the worker's
  `/dev/reply` accepts it (number check passes), and you both agree the options make sense
  (01:00 checkpoint).

## A7. `hindcast.py` (1 h)
Run the engine with weather up to 2020 only (`weather=` cut) and the real 2021 and 2022
allocation (`allocation=`). Compare the "safest in drought" option with what the field actually
did (CropScape: corn in 2021, fallow in 2022) and with NWIS flow. Fill `hindcast` per contract B
and write one sentence for the slide, using only numbers that are in the object. If A4 has no
sourced 2021 allocation, skip this rather than guess.

## A8. Deploy + connect (1.75 h)
- **Vultr:** Ubuntu VM, Python 3.11, `uvicorn engine.app:app` under systemd, `data/` copied over.
  Expose it with a **Cloudflare Tunnel** (`cloudflared`, a `farmline-engine` route on the team
  account) rather than open ports. Set `ENGINE_API_TOKEN`.
- **Worker:** add `callEngine()` (POST `/plan` with the token from a worker secret and the URL
  from a var). With Hareem, wire `/webhooks/sms` to `parseMessage → callEngine →
  composeReply`, replying through her `/api/reply` flow or TwiML. Run `cd worker && npm test`.
- **Done when** a real phone texts "alfalfa 89406, water is short" and gets 3 options computed on
  Vultr (09:00).

## A9. Places + a second field (0.75 h)
- `pipeline/places.py` → `data/reference/places.csv` (`key, kind, country, lat, lon, field_id`):
  Fallon by ZIP 89406 and by town, plus every field.
- A second US demo field in another irrigated western area. Run A3 and A4 for it, and ask Hareem
  to run her fetchers (H2/H6) for the same field_id.

## Handy facts (from earlier exploration; re-verify)
- **Demo field `nv-fallon-01`:** 39.3800, −118.7700, south of Fallon, Churchill County, NV, ZIP 89406.
- **POWER 2001–2025:** 9,131 days, no gaps; rain 78–307 mm/yr. 2021 was *wetter* than average
  locally (223 mm). The 2021 drought reached Fallon through the river allocation, which is why
  A4 and A5 matter more than rainfall.
- **SSURGO:** map unit 643787, "Carcity clay, slightly saline, 0 to 1 percent slopes".
- **The worker's number checker** rejects any number in a reply that isn't in your JSON, so put
  every figure the reply might quote in the response (baseline included).
