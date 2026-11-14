# Data workflow (Hareem's Claude)

> **Kickoff prompt to paste into Claude Code** (from the repo root):
>
> *Read `docs/engine-plan/README.md`, then `docs/engine-plan/DATA_WORKFLOW.md`. You are
> building FarmLine's data pipeline in `pipeline/`, `db/` and `data/`. Do D1 first, submit the
> AppEEARS requests from D7 straight after (they take hours to process), then work through
> D2 to D8. Stay inside the folders this workflow gives you. Show me each finished task with
> its checks before starting the next, and ask me before every push.*

You own `pipeline/`, `db/`, `data/` and `contracts/field-bundle*`. Abdullah's engine
(`engine/`) reads your files and never writes them, and you never edit `engine/` or
`worker/`. If the engine needs something different, you'll hear it through Hareem; if you
need something from the engine side, write it down for Hareem to pass on.

## Ground rules for the data

- **Real data only, with a source on every number.** Each reference table has `source`
  column(s) naming the dataset and the table, page or URL. If a value can't be found, leave it
  empty and say so in the task report. Never estimate a value and present it as data.
- **One field bundle per field**, exactly as contract A in the README says. The engine depends
  on the column names, so changing them is a contract change (message first).
- **Keep raw downloads** under `data/raw/` (gitignored if large), and commit only the cleaned
  bundle and reference tables. A script in `pipeline/` must rebuild every committed file from
  scratch: `python -m pipeline.<name>`.
- **Python 3.11+** in `pipeline/.venv` (gitignored), with `httpx`, `pandas`, `pyproj`,
  `psycopg[binary]`, `earthaccess`, `python-dotenv` and `pytest`, pinned in
  `pipeline/requirements.txt`. Keys go in `.env` at the repo root (gitignored): `EARTHDATA_USERNAME/PASSWORD`, `NASS_API_KEY`,
  `AMS_API_KEY`, `OPENET_API_KEY`, `DATABASE_URL` (Tiger Cloud).
- **Never switch off TLS verification**, even when an API's certificate looks wrong. Report it
  instead.

---

## D1. Contract A + sample bundle (0.75 h), due at the 17:00 checkpoint

This unblocks Abdullah, so do it first.

- `contracts/field-bundle.md`: contract A from the README, with the exact columns for
  `crops.csv`, `economics.csv` and `places.csv` (below), units, and an example row for each.
- `data/fields/nv-fallon-01-sample/`: a **hand-made sample** bundle with
  `"provenance": "sample"`. Use real shapes with obviously-sample values, e.g. weather for a
  single year repeated is fine. It exists so the engine can start; it's replaced in D2.
- `data/reference/crops.csv`: header plus the 8 Fallon crops, values marked
  `source = "PROVISIONAL – replace in D4"`.
- **Done when** it's merged to main and Hareem has told Abdullah.

## D7 (part 1). Submit the AppEEARS requests right after D1 (15 min, then wait)

AppEEARS (appeears.earthdatacloud.nasa.gov, Earthdata login) processes point requests in a
queue that can take hours. Submit now; download in D7 part 2. One **point request** for the
Fallon field (39.3800, −118.7700), 2015-01-01 to 2025-12-31, with:
- SMAP soil moisture (`SPL3SMP_E`, enhanced 9 km, AM and PM soil moisture)
- ECOSTRESS evapotranspiration (the L3 ET product AppEEARS lists, e.g. `ECO_L3T_JET` / `ECO3ETPTJPL`)
- HLS NDVI inputs (`HLSL30` and `HLSS30`: red, NIR and Fmask bands)
- SRTM elevation (`SRTMGL1_NC`)

Save the request JSON in `pipeline/appeears/` so it can be resubmitted for other fields.

## D2. Real Fallon bundle (1.5 h)

`python -m pipeline.fetch_field nv-fallon-01 39.3800 -118.7700` writes `data/fields/nv-fallon-01/`:

- **NASA POWER** (no key): `https://power.larc.nasa.gov/api/temporal/daily/point`,
  `community=AG`, `time-standard=LST`, parameters `T2M_MAX, T2M_MIN, T2M, PRECTOTCORR,
  ALLSKY_SFC_SW_DWN, RH2M, WS2M`, 20010101–20251231. Missing days come back as **−999**; turn them into
  empty, then check there are none. Expect 9,131 days with no gaps.
- **USDA CropScape (CDL)** (no key): `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=Y&x=X&y=Y`.
  **x and y must be EPSG:5070 (CONUS Albers), not lat/lon** (use `pyproj`). The answer is XML
  wrapping `{x:…, y:…, value: 36, category: "Alfalfa", …}`; pull out `value` and `category`
  with a regex. It takes about 2 s per call and sometimes fails, so retry and run up to 8 at once.
  Years 2008–2025. Map CDL codes to engine crop codes (36 alfalfa, 1 corn, 24/23 wheat,
  21 barley, 4 sorghum, 42 dry beans, 33 safflower, 61 fallow; anything else `null` with the
  category kept). Also check the 4 neighbouring pixels about 100 m away to confirm the point is mid-field.
- **USDA SSURGO** (no key): POST `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest` with
  `{"query": …, "format": "JSON+COLUMNNAME"}`. Find the map unit with
  `SDA_Get_Mukey_from_intersection_with_WktWgs84('point(lon lat)')`. From `muaggatt` take
  `aws0100wta, aws0150wta, drclassdcd, hydgrpdcd, slopegraddcp`. From the dominant `component`
  and its top `chorizon` take `om_r, claytotal_r, ph1to1h2o_r, ec_r`.
- `field.json` with `"provenance": "real"` and a `sources` list.
- **Done when** a pytest checks every contract A column, weather has no gaps, and the values
  match what earlier exploration found (re-verify): CDL alfalfa 2009–2020, corn 2021,
  fallow 2022, alfalfa 2023–2025. Soil: Carcity clay, AWS 0–100 = 13.65 cm, EC about 6, slope 0.5%.

## D3. Tiger Data (1.5 h), for the "Best Use of Tiger Data" prize

Create a Tiger Cloud service and put `DATABASE_URL` in `.env`. Write `db/schema.sql`
(idempotent) and `python -m pipeline.load_tiger <field_id>`:
- `fields` (soil as jsonb), `crop_history`
- `weather_daily` as a **hypertable** on `day` (PK `field_id, day`)
- `satellite_obs` as a hypertable, long form: `field_id, observed_at, source, variable, value`
- `weather_monthly`: a **continuous aggregate** of monthly rain and temperatures (for the dashboard)
- `county_yields`, `crop_prices`, `water_allocations`
- `requests` as a hypertable (the worker will log each farmer question and answer later)

Two traps:
- Run schema statements **one at a time**. A continuous aggregate can't be created inside the
  transaction that a multi-statement string runs in.
- Load weather with `COPY` into a temporary table, then upsert, so re-running the loader is safe.

To test locally before Tiger Cloud: `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=… timescale/timescaledb:latest-pg17`.
**Done when** loading Fallon twice gives the same row counts and `weather_monthly` has 300 rows.

## D4. Crop science table (2 h)

Replace the provisional `data/reference/crops.csv` with sourced values for at least the 8
Fallon crops (alfalfa, wheat, barley, sorghum, dry_beans, safflower, corn_silage, cover_crop)
plus corn and fallow. One row per crop code:

| Column | Meaning | Source |
|---|---|---|
| `perennial, heavy_feeder, legume` | rotation rules (true/false) | agronomy refs / extension guides |
| `plant_month, plant_day` | typical planting date for the US Great Basin | extension planting calendars |
| `stage_ini_days, stage_dev_days, stage_mid_days, stage_late_days` | growth stage lengths | FAO-56 Table 11 |
| `kc_ini, kc_mid, kc_end` | crop coefficients | FAO-56 Table 12 (and the climate adjustment, eq. 62, if you apply it) |
| `root_depth_m, p_depletion` | max root depth, readily-available fraction | FAO-56 Table 22 |
| `ky` | seasonal yield response to water | FAO-33 (Doorenbos & Kassam) |
| `ece_threshold_ds_m, salinity_slope_pct` | salinity tolerance | FAO-29 (Ayers & Westcot) / Maas & Hoffman |
| `base_temp_c, gdd_required, frost_free_days_min` | climate fit | extension sources |
| `residue_score, deep_roots, cover_benefit` | soil-health scoring inputs (0–3 scales; say how you scored) | NRCS soil health guidance |
| `source` | every table and page used | — |

Alfalfa is perennial with several cuttings a year. Note how FAO-56 treats it (averaged
cutting cycles) in a comment row or in `contracts/field-bundle.md`.
**Done when** every cell for the 10 crops is filled or explicitly blank with a reason, and every
row has a source.

## D5. Economics (1.5 h)

`data/reference/economics.csv`, one row per crop and region (Churchill County NV first, then
Nevada state where county data is suppressed):
`crop, region, years_averaged, yield_per_acre, unit, price_usd_per_unit, cost_usd_per_acre,
water_cost_usd_per_af, source_yield, source_price, source_cost`.

- **Yields:** NASS QuickStats API (free key): `quickstats.nass.usda.gov/api`, county yields,
  averaged over recent years (say which). NASS hides many small-county values; fall back to state
  level and record that.
- **Prices:** NASS "price received" (state, annual), or USDA AMS Market News (free key), e.g.
  the Nevada/Western hay report for alfalfa. Match the yield unit (tons, bu, cwt).
- **Production costs:** University of Nevada Reno Extension or UC Davis cost-and-return studies
  for each crop (closest region). Cite the study and year.
- **Water cost:** the Truckee-Carson Irrigation District (TCID) assessment per acre or per acre-foot.
- Also load these into Tiger Data (`county_yields`, `crop_prices`).
- **Done when** all 8 Fallon crops have yield, price and cost, each sourced.

## D6. Water (1.5 h): this is what makes the hindcast real

- `data/fields/nv-fallon-01/water.json`:
  - `source`: Newlands Project, operated by TCID (Truckee and Carson rivers, Bureau of Reclamation).
  - `full_allocation_af_per_acre`: the water-righted duty per acre for this land type (TCID
    distinguishes bench and bottom land, so find which applies near the field and cite it).
  - `allocation_fraction_by_year`: the announced allocation percentage for each year 2001–2025
    (TCID/Reclamation announcements, Lahontan Reservoir reports, news archives). Cite each
    year's source. **2021 and 2022 are the ones the hindcast needs**, so find those first.
  - Leave a year out rather than guess it.
- **OpenET** (free key): monthly actual ET for the field, 2016–2025, saved to
  `data/fields/nv-fallon-01/openet_monthly.csv` (`month, et_mm, model`) for Abdullah's calibration.
- **Done when** 2021 and 2022 are sourced, at least 15 years total, and OpenET is saved.

## D7 (part 2). Satellite extras (2.5 h total including part 1)

Download the AppEEARS results and build `satellite.json` (and `satellite_obs` rows in Tiger Data):
- `smap_soil_moisture`: daily m³/m³. Keep the quality-flagged good retrievals only.
- `ecostress_et`: per overpass, mm/day.
- `ndvi`: from HLS, `(NIR − red)/(NIR + red)`, with Fmask cloud/shadow pixels dropped. Give a
  per-season summary as well as the series, since that confirms the CDL crop history.
- `slope_from_srtm`: degrees/percent at the field, cross-checked with SSURGO slope.
- **GPM IMERG** monthly precipitation (GES DISC, `GPM_3IMERGM`) at the field for 2001–2025,
  compared with POWER rain (a simple correlation is enough). Through `earthaccess`.
- **Done when** each product has a series in `satellite.json` with its source, and a short
  note on what each shows for Fallon (for the pitch and the dashboard).

## D8. Resolver, more fields, dataset list (1.5 h)

- `data/reference/places.csv`: `key, kind, country, lat, lon, field_id`. Fallon by ZIP (89406)
  and by town name, plus every field you build. The engine resolves farmer locations with it.
- **Two more demo fields**, using the same scripts:
  1. A second US field (another western irrigated crop area), D2 sources.
  2. **One field in India** for the "Kisan Voice" demo (e.g. a wheat district in Madhya Pradesh
     or Punjab). POWER works worldwide, but CDL and SSURGO are US only, so:
     - soil from **ISRIC SoilGrids** (REST API, no key): water capacity, clay, organic carbon, pH;
     - crop suitability from **FAO GAEZ**;
     - crop history: none, so set `crop_history: []` and `provenance` notes.
     - India economics (MSP prices, district yields) is a stretch goal; skip it if short on time
       and say so.
- `docs/DATASETS.md`: every dataset used, with owner (NASA, USDA, FAO…), what it does in
  FarmLine, URL and access date. The Space Apps submission needs this list.
- **Done when** `places.csv` resolves all fields, and DATASETS.md lists every source used anywhere.

---

## Handy facts (from earlier exploration; re-verify)

- **Demo field `nv-fallon-01`:** 39.3800, −118.7700, south of Fallon, Churchill County, NV, ZIP 89406.
- **NASA POWER** for this point returned 9,131 days (2001–2025) with no gaps; yearly rain 78–307 mm.
  2021 local rain was *above* average, so the 2021 drought must come from the allocation data (D6).
- **SSURGO** map unit 643787, "Carcity clay, slightly saline, 0 to 1 percent slopes". EC about 6 dS/m
  matters a lot to the engine's yields, so double-check `ec_r`.
- **Windows:** in a fresh venv, the first scipy/numpy DLL load may be blocked by Application
  Control once. Retrying works. Docker is available for a local TimescaleDB.
