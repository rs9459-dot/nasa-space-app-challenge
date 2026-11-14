# Hareem's workflow: the crops slice

> **Kickoff prompt to paste into Claude Code** (from the repo root):
>
> *Read `docs/engine-plan/README.md`, then `docs/engine-plan/HAREEM_WORKFLOW.md`. I own the
> crops slice of the FarmLine engine: crop, money and satellite data, plus the rotation, yield,
> NASA-signals and climate code, and Tiger Data. Do H1 first, submit the AppEEARS requests from
> H6 right after (they take hours), then work through H2 to H9, one task at a time, editing only
> the files this workflow gives me. Show me each finished task with its test results before
> starting the next, and ask me before every push.*

**Your files:**
- **Engine:** `engine/rotations.py`, `yields.py`, `signals.py`, `climate.py`, and their tests.
- **Pipeline:** `pipeline/crops.py`, `economics.py`, `satellite.py`, `tiger.py`; `db/`.
- **Data:** in `data/fields/<id>/`, the files `field.json`, `crop_history.json`, `satellite.json`; plus `data/reference/crops.csv` and `economics.csv`.
- **Contracts:** `contracts/field-bundle.md`.

Abdullah owns everything else (`types.py`, `bundle.py`, `water.py`, `rank.py`, `app.py`, the
weather, soil and water files). Read his files; never edit them.

## Ground rules

- **Real data only, with a source on every number** (`source` columns or keys: dataset plus the
  table, page or URL). If a value can't be found, leave it blank and say so; never estimate a
  value and present it as data. Your tables feed every number a farmer reads.
- **Code against the interfaces** in the README (`engine/types.py` once Abdullah merges it at
  17:00). Until his parts exist, use fakes: load the bundle with a few lines of pandas, and
  build a fake `WaterResult` with numpy (e.g. `eta = 0.8 * etc`) to test `yields.py`.
- **Python 3.11+**. Use `engine/.venv` for engine code and `pipeline/.venv` for pipeline code,
  both gitignored. Pin packages in `engine/requirements.txt` / `pipeline/requirements.txt`.
  Pipeline packages: `httpx, pandas, pyproj, psycopg[binary], earthaccess, python-dotenv, pytest`.
- Keys in the root `.env` (gitignored): `EARTHDATA_USERNAME/PASSWORD`, `NASS_API_KEY`,
  `AMS_API_KEY`, `DATABASE_URL`. **Never switch off TLS verification.**

---

## H1. Contract A + sample bundle (0.75 h), due at 17:00
This unblocks both of you, so do it first.
- `contracts/field-bundle.md`: every file in the README's data table, with columns, units and
  one example row, including the exact `crops.csv` and `economics.csv` columns below.
- `data/fields/nv-fallon-01-sample/`: a hand-made bundle with `"provenance": "sample"` in
  `field.json`. Use real shapes with obviously-sample values: one year of weather repeated is
  fine, a made-up soil and allocation, 3 crops. It also includes the files Abdullah owns
  (weather, soil, water): you make the sample versions, he makes the real ones.
- `data/reference/crops.csv` and `economics.csv` with the headers and the 8 Fallon crops,
  `source = "PROVISIONAL – replace in H2/H3"`.
- **Done when** it's merged to main and Abdullah knows.

## H2. CropScape history + crop science table (2.25 h)
- **CropScape (CDL)** → `crop_history.json` (`pipeline/crops.py`):
  `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=Y&x=X&y=Y`.
  **x and y are EPSG:5070 (CONUS Albers), not lat/lon** (convert with `pyproj`). The answer is
  XML wrapping `{x:…, y:…, value: 36, category: "Alfalfa"}`; use a regex. It takes about 2 s per
  call and sometimes fails, so retry and run up to 8 at once. Years 2008–2025. Map CDL codes to
  crop codes (36 alfalfa, 1 corn, 24/23 wheat, 21 barley, 4 sorghum, 42 dry beans,
  33 safflower, 61 fallow; others `null` with the category kept). Check the 4 neighbouring
  pixels about 100 m away to confirm the point is mid-field.
- **`data/reference/crops.csv`**, one row per crop code: at least the 8 Fallon crops (alfalfa,
  wheat, barley, sorghum, dry_beans, safflower, corn_silage, cover_crop) plus corn and fallow.

| Column | Used by | Source |
|---|---|---|
| `perennial, heavy_feeder, legume` | your rotations | agronomy / extension guides |
| `plant_month, plant_day` | Abdullah's water model | Great Basin planting calendars |
| `stage_ini_days, stage_dev_days, stage_mid_days, stage_late_days` | water model | FAO-56 Table 11 |
| `kc_ini, kc_mid, kc_end` | water model | FAO-56 Table 12 |
| `root_depth_m, p_depletion` | water model | FAO-56 Table 22 |
| `ky` | your yields | FAO-33 (Doorenbos & Kassam) |
| `ece_threshold_ds_m, salinity_slope_pct` | your yields | FAO-29 (Ayers & Westcot) / Maas & Hoffman |
| `base_temp_c, gdd_required, frost_free_days_min` | your rotations | extension sources |
| `residue_score, deep_roots, cover_benefit` (0–3) | your soil score | NRCS soil-health guidance (say how you scored) |
| `source` | — | every table and page used |

Alfalfa is perennial with several cuttings a year. Record how FAO-56 treats it (averaged
cutting cycles) in `contracts/field-bundle.md`.
- **Done when** every cell for the 10 crops is filled or blank with a reason, and the CDL test
  confirms (re-verify): alfalfa 2009–2020, corn 2021, fallow 2022, alfalfa 2023–2025.

## H3. Economics (1.5 h)
`data/reference/economics.csv`: `crop, region, years_averaged, yield_per_acre, unit,
price_usd_per_unit, cost_usd_per_acre, source_yield, source_price, source_cost`. Use Churchill
County NV first, Nevada where county data is suppressed. (Water cost lives in Abdullah's `water.json`.)
- **Yields:** NASS QuickStats API (free key), county or state, averaged over recent years (say which).
- **Prices:** NASS "price received" (state, annual), or AMS Market News (free key), e.g. the
  Western/Nevada hay report for alfalfa. Match the yield unit (tons, bu, cwt).
- **Costs:** University of Nevada Reno Extension or UC Davis cost-and-return studies, the
  closest region. Cite the study and year.
- **Done when** all 8 Fallon crops have yield, price and cost, each sourced. Add rows to `docs/DATASETS.md`.

## H4. `rotations.py` (1.25 h)
- `candidate_crops(field, ref) -> list[str]`: crops whose `frost_free_days_min` and
  `gdd_required` fit the field (compute frost-free days and GDD from `field.weather`, base
  temperature per crop), which have full rows in `crops.csv` **and** `economics.csv` for the
  field's region, and which the area grows (CDL history or economics rows). Fallon should give
  about 8.
- `enumerate_rotations(candidates, ref) -> list[Rotation]`: every 3-year sequence (8³ = 512)
  minus those breaking the rules: the same annual crop 3 years running (perennials allowed);
  two `heavy_feeder` crops back to back; more than one fallow year. About 200 should remain.
- **Done when** tests show Fallon's candidates and count, and that each rule removes what it should.

## H5. `yields.py` (1.5 h)
`evaluate(field, water_result, ref, signals) -> Outcomes`. For each rotation × sequence × year:
- **Water stress (FAO-33):** `1 − Ya/Ym = ky · (1 − ETa/ETc)` from `water_result` (clamp to 0..1).
- **Salinity (FAO-29):** multiply by `1 − salinity_slope_pct · (ECe − threshold)/100` when
  `soil.ec_ds_m` is above the crop's threshold. Fallon is about 6 dS/m, which hurts alfalfa
  (threshold about 2) and beans badly, and barley little. Make sure this shows in the results.
- **Income per year:** `yield_frac · yield_per_acre · price − cost − water_cost_usd_per_af ·
  irrigation_af`, with `yield_per_acre` (the county yield) treated as the unstressed yield Ym.
  Fallow earns 0 and costs 0. A cover crop has a cost but no sale.
- `income_usd` and `water_af` are averaged over the 3 years per acre (R, S).
  `soil_score` (R,) runs 0–10 from `legume`, `residue_score`, `deep_roots`, `cover_benefit`,
  with cover benefit × `signals.erosion_weight`. Document the scaling in the docstring.
- **Done when** tests (with a fake WaterResult) show salinity cutting alfalfa's yield on Fallon
  soil, a water cut lowering income, and incomes in the range of the county figures.

## H6. Satellite data (2 h)
**Submit first, right after H1.** AppEEARS (appeears.earthdatacloud.nasa.gov, Earthdata login)
queues point requests for hours. Make one point request for (39.3800, −118.7700),
2015-01-01 to 2025-12-31, with:
- **SMAP** soil moisture: `SPL3SMP_E`, AM and PM
- **ECOSTRESS** ET: the L3 ET product listed
- **HLS** `HLSL30` + `HLSS30`: red, NIR and Fmask bands
- **SRTM**: `SRTMGL1_NC`

Save the request JSON in `pipeline/appeears/`.

Later, `pipeline/satellite.py` builds `satellite.json` (`sources` list included):
- `smap_soil_moisture` (daily m³/m³, quality-flagged good only);
- `nldas_soil_moisture` (monthly 0–100 cm from NLDAS through GES DISC/`earthaccess`; it covers
  2001 onward, filling the years before SMAP);
- `imerg_monthly_precip_mm` (GPM IMERG `GPM_3IMERGM`, 2001–2025);
- `ndvi` from HLS (`(NIR − red)/(NIR + red)`, cloud/shadow pixels dropped by Fmask), plus a
  per-season summary;
- `ecostress_et_mm_day`;
- `slope_pct_srtm`.

**Done when** each product has a series with its source, and a 2-line note on what it shows for
Fallon (for the pitch and the dashboard). Add rows to `docs/DATASETS.md`.

## H7. `signals.py` (1.25 h): NASA data the engine actually uses
`compute(field) -> Signals`. Each field changes a number downstream; none are decoration.
- `start_depletion_frac`: from the latest SMAP (or NLDAS) soil moisture versus the soil's field
  capacity and wilting point (`soil.json` top-horizon values from Abdullah's SSURGO fetch):
  `(fc − sm) / (fc − wp)`, clamped to 0..1. **Used by:** the water model's starting soil water.
- `rain_scale`: IMERG ÷ POWER mean annual rainfall at the field (a bias correction).
  **Used by:** the water model, which scales POWER rain by it. Clamp to a sane range and report it.
- `erosion_weight`: from SRTM slope (cross-checked with SSURGO): 1 on flat land, rising with
  slope (document the formula). **Used by:** your soil score.
- `history_confirmed`: do HLS NDVI seasons match the CDL crops (alfalfa: repeated green-ups
  between cuttings; fallow: low all year)? **Used by:** the engine, to decide whether to trust
  CDL for the baseline crop.
- `drought_years`: years where Abdullah's `nwis_flow.csv` is in the bottom quartile **or** the
  `water.json` allocation is below 0.5. **Used by:** the hindcast and the dashboard.
- **Done when** each signal has a test on Fallon data, and missing inputs give the neutral
  default (never an invented value).

## H8. `climate.py` (1 h)
- `trend(field)`: Mann-Kendall test + Sen's slope (`pymannkendall`) on annual mean temperature
  and annual rain, 2001–2025, returning `temp_trend_c_per_decade, temp_trend_significant,
  rain_trend_mm_per_decade, rain_trend_significant` (significant = p < 0.05).
- `shift_weather(field, year=2035)`: the daily weather shifted by each trend × years past 2025
  (temperatures add; rain scales). Abdullah's `/plan` reruns the 3 chosen options on it to fill
  `climate_2035`.
- **Done when** tests cover a synthetic series with a known trend, plus Fallon's real result.

## H9. Tiger Data (1.25 h), for the "Best Use of Tiger Data" prize
Create a Tiger Cloud service (`DATABASE_URL` in `.env`). Write `db/schema.sql` (idempotent)
and `python -m pipeline.tiger <field_id>` to load every bundle file, Abdullah's included
(read-only):
- `fields` (soil as jsonb), `crop_history`;
- `weather_daily` as a **hypertable** on `day` (PK `field_id, day`);
- `satellite_obs` as a hypertable in long form (`field_id, observed_at, source, variable, value`);
- `weather_monthly`, a **continuous aggregate** for the dashboard;
- `county_yields`, `crop_prices`, `water_allocations`;
- `requests` as a hypertable (the worker logs farmer questions and answers later).

Two traps:
- Run schema statements **one at a time**. A continuous aggregate can't be created inside a
  multi-statement transaction.
- Load weather by `COPY` into a temporary table, then upsert, so re-runs are safe.

To test locally: `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=… timescale/timescaledb:latest-pg17`.
**Done when** loading Fallon twice gives the same row counts and `weather_monthly` has 300 rows.

## Handy facts (from earlier exploration; re-verify)
- **Demo field `nv-fallon-01`:** 39.3800, −118.7700, south of Fallon, Churchill County, NV, ZIP 89406.
- **CDL** for that pixel: oats 2008, alfalfa 2009–2020, corn 2021, fallow 2022, alfalfa 2023–2025.
  Neighbouring pixels match, so it's mid-field.
- **Soil** (Abdullah's fetch): Carcity clay, slightly saline, EC about 6 dS/m. This matters a lot
  for your salinity step.
- **Windows:** in a fresh venv, the first scipy/numpy DLL load may be blocked once by
  Application Control. Retrying works. Docker is available for a local TimescaleDB.
