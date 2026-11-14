# FarmLine engine build: shared plan (Abdullah + Hareem)

Two people, each with their own Claude, build the rotation engine in parallel without
stepping on each other. **Both Claudes read this file first**, then their own workflow:

| Who | Owns | Workflow |
|---|---|---|
| **Abdullah** | the engine: the maths that turns a field's data into 3 rotation options | [ENGINE_WORKFLOW.md](ENGINE_WORKFLOW.md) |
| **Hareem** | the data: every dataset the engine reads, fetched, cleaned, stored and sourced | [DATA_WORKFLOW.md](DATA_WORKFLOW.md) |

The split is even: **8 tasks and about 12.75 hours each** (table below). Hareem gets the
dataset-heavy work, including the crop science tables, economics and water rights data, so
the engine side is pure modelling.

---

## What we're building

A farmer texts FarmLine. The Worker (already on `main`, `worker/`) parses the text with
Gemini, then calls **the engine**: a Python FastAPI service on Vultr. The engine replays about
200 three-year crop rotations through 25 years of real NASA weather on that exact field, and
returns 3 options: **most water saved, most income, safest in drought**. Gemini turns that JSON
into the SMS. Every number the farmer reads comes from the engine, and the engine only uses
real data that Hareem's pipeline delivered.

```
 Hareem's pipeline ──► field bundle (files + Tiger Data) ──► Abdullah's engine ──► EngineResult JSON ──► worker (Gemini) ──► SMS
   pipeline/ db/ data/          contract A                    engine/                contract B          worker/ (done)
```

## Who touches what (never edit the other person's folders)

| Path | Owner | Notes |
|---|---|---|
| `engine/` | Abdullah | Python 3.11+ FastAPI service and rotation model |
| `contracts/engine-*` | Abdullah | Contract B: engine request/response |
| `pipeline/` | Hareem | Python fetchers and loaders |
| `db/` | Hareem | Tiger Data (TimescaleDB) schema |
| `data/` | Hareem | Field bundles and reference tables (the engine reads them, never writes them) |
| `contracts/field-bundle*` | Hareem | Contract A: what a field bundle contains |
| `worker/` | already on main | Abdullah may change `worker/src/gemini/engine-types.ts` (to match contract B) and add the engine call |
| `docs/engine-plan/` | both | Change only your own workflow file; edit this README together |

**Changing a contract:** the owner makes it a small separate commit, keeps old fields working
when possible, and messages the other person *before* merging it. Never change the other
person's contract yourself; ask.

## Contract A: the field bundle (Hareem → Abdullah)

One folder per field: `data/fields/<field_id>/`. The same data also goes into Tiger Data, but
**the engine reads the files** (fast, offline, demo-proof). Shared tables live in
`data/reference/`.

| File | What it holds | Key columns / fields |
|---|---|---|
| `field.json` | identity + `provenance` | `field_id, name, lat, lon, county, state, country, zip, provenance: "real" \| "sample"` |
| `weather_daily.csv` | NASA POWER, 2001-01-01 to 2025-12-31, no gaps | `day, tmax_c, tmin_c, tmean_c, precip_mm, solar_mj, rh_pct, wind_ms` |
| `crop_history.json` | USDA CDL crop on the pixel, 2008 onward | `[{year, cdl_code, crop}]`, where `crop` is an engine crop code or `null` |
| `soil.json` | USDA SSURGO | `aws_0_100_cm, aws_0_150_cm, drainage, slope_pct, organic_matter_pct, clay_pct, ph, ec_ds_m, map_unit` |
| `water.json` | irrigation supply | `source, full_allocation_af_per_acre, allocation_fraction_by_year: {"2001": 1.0, …}` |
| `satellite.json` | optional extras | `smap_soil_moisture, ecostress_et, ndvi, imerg_monthly_precip, slope_from_srtm` (each `{date: value}` or a number) |
| `data/reference/crops.csv` | crop science, one row per crop code | see DATA_WORKFLOW task D4 |
| `data/reference/economics.csv` | price, yield, cost per crop and region | see DATA_WORKFLOW task D5 |
| `data/reference/places.csv` | ZIP or town → nearest field | `key, kind (zip\|town), country, lat, lon, field_id` |

Rules:
- **Crop codes** are the ones in `worker/src/gemini/crops.ts` (`alfalfa, wheat, barley, sorghum, dry_beans, safflower, corn, corn_silage, cover_crop, fallow, rice, cotton, mustard, chickpea, millet, sugarcane`). Add a new code there first if one is ever needed.
- **Every number has a source.** Each reference table has a `source` column (or a `sources` key) naming the dataset, page or paper.
- `provenance: "sample"` marks hand-made placeholder bundles. The engine may compute on them during development, but its response then carries `"sample_data": true`, and the demo must never run on one.

## Contract B: the engine API (Abdullah → worker)

`POST /plan` on the engine, with `Authorization: Bearer <ENGINE_API_TOKEN>`.

Request:
```json
{ "zip": "89406", "place": null, "lat": null, "lon": null, "field_id": null,
  "current_crop": "alfalfa", "priorities": { "water": 0.5, "income": 0.25, "drought": 0.25 } }
```
Provide one of `field_id`, `zip`, `place` or `lat/lon`. The engine resolves it with
`data/reference/places.csv`.

Response: exactly the `EngineResult` shape in `worker/src/gemini/engine-types.ts` (`field`,
`baseline`, `options[3]` labelled `most_water_saved | most_income | safest_in_drought`,
`years_tested`, `data_sources`), plus optional `sample_data`, `climate_2035` and `hindcast`.
Errors look like `{ "error": "field_not_found" | "no_data" | "engine_failed", "message": "…" }`.

**Rounding happens in the engine**, because the worker's number checker matches exactly:
water in acre-feet to 1 decimal, percentages as whole numbers, dollars to the nearest 10,
soil score as a whole number from 0 to 10.

## The work split

| # | Abdullah: engine | hrs | # | Hareem: data | hrs |
|---|---|---|---|---|---|
| E1 | Contract B: JSON schema, 3 sample responses, sync `engine-types.ts` | 0.75 | D1 | Contract A: schema + hand-made **sample** Fallon bundle + provisional crops.csv | 0.75 |
| E2 | Engine skeleton: FastAPI, bundle loader, tests | 1 | D2 | Real Fallon bundle: POWER, CropScape, SSURGO fetchers | 1.5 |
| E3 | Candidate crops + rotation enumeration + agronomy rules | 1.5 | D3 | Tiger Data schema + loader (hypertables, continuous aggregate) | 1.5 |
| E4 | Daily water balance (Hargreaves ET0, FAO-56 Kc, soil bucket, allocation) | 2.5 | D4 | Crop science table (FAO-56 Kc and stages, roots, FAO-33 Ky, FAO-29 salinity, frost/GDD) | 2 |
| E5 | Yield (water stress + salinity), income, soil-health score | 1.5 | D5 | Economics: NASS yields, NASS/AMS prices, extension cost studies | 1.5 |
| E6 | 25-year stress test, TOPSIS ranking, 3 labelled options, rounding | 2 | D6 | Water: Newlands Project allocation history + OpenET calibration | 1.5 |
| E7 | Climate trend (Mann-Kendall, Sen's slope) + 2035 scenario | 1 | D7 | Satellite: SMAP, ECOSTRESS, HLS NDVI, GPM IMERG, SRTM via AppEEARS/Earthdata | 2.5 |
| E8 | 2021 hindcast + deploy on Vultr + wire the worker to `/plan` | 2.5 | D8 | Place resolver (places.csv) + 2 more demo fields (one in India) + dataset list for submission | 1.5 |
| | **Total** | **12.75** | | **Total** | **12.75** |

## Checkpoints (Saturday Nov 14 → Sunday Nov 15)

| When | Abdullah has | Hareem has | Together |
|---|---|---|---|
| **17:00 Sat** | E1 contract B on main | D1 contract A + sample bundle on main | Read each other's contract; agree on any changes now |
| **20:30 Sat** | E2–E3 done, E4 running on the sample bundle | D2 real Fallon bundle + D4 crops.csv on main | Engine switches to the real bundle |
| **01:00 Sun** | E5–E6: real 3 options from `/plan` | D3 Tiger Data loaded, D5 economics, D6 water on main | Look at the 3 options together: do they make sense for Fallon? |
| **09:00 Sun** | E7–E8: hindcast number, engine live on Vultr, worker calls it | D7 satellite extras, D8 resolver + extra fields + dataset list | Full SMS round trip on a real phone |
| **10:00 Sun** | **Code freeze.** Record the backup video. | | |

If something slips, cut in this order: D7 ECOSTRESS/SRTM → E7 climate shift → D8 extra
fields → D7 SMAP. Never cut D2, D4, D5, E4–E6: they are the product.

## Git rules for both Claudes

- Work on your own branch: `feat/engine` (Abdullah) or `feat/data` (Hareem). Start each task with `git pull origin main`.
- Merge your branch into `main` at each checkpoint, once your tests pass. The folders don't overlap, so merges are clean.
- **Ask your human before every push.** Commit as your human, with no AI co-author line.
- Never commit secrets: API keys go in `.env` (gitignored). Earthdata, NASS, AMS, OpenET and Tiger Data credentials stay local.
- Your human talks to the other human. If you need something from the other side, write it down for your human to pass on; don't edit their files.
