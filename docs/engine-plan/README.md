# FarmLine engine build: shared plan (Abdullah + Hareem)

Two people, each with their own Claude, build the rotation engine **at the same time**.
**Both Claudes read this file first**, then their own workflow.

The split is by **slice**, not by layer: each person owns the data *and* the engine code for
their half, so both of you collect datasets and both of you build real model code.

| Who | Slice | Datasets | Engine code | Workflow |
|---|---|---|---|---|
| **Abdullah** | **Water**: how much water each rotation needs and gets, the ranking, the API | NASA POWER, USDA SSURGO, Newlands Project allocations, OpenET, USGS NWIS, PRISM | `water.py` (daily water balance), `rank.py` (stress test + choosing the 3 options), `hindcast.py`, `app.py` + deploy | [ABDULLAH_WORKFLOW.md](ABDULLAH_WORKFLOW.md) |
| **Hareem** | **Crops**: which crops and rotations fit, what they earn, what NASA satellites say | USDA CropScape, FAO-56/33/29 crop science, NASS QuickStats, AMS Market News, cost studies, SMAP, NLDAS, GPM IMERG, Landsat/Sentinel-2 (HLS) NDVI, SRTM, ECOSTRESS | `rotations.py`, `yields.py` (yield, salinity, income, soil score), `signals.py` (NASA signals), `climate.py` (2035) + Tiger Data | [HAREEM_WORKFLOW.md](HAREEM_WORKFLOW.md) |

**Even:** 9 tasks and **12.75 hours each**. Abdullah has the hardest single model (the daily
water balance) and the deploy; Hareem has more datasets (11 vs 6) and four smaller models.

---

## What we're building

A farmer texts FarmLine. The Worker (already on `main`, `worker/`) parses the text with
Gemini and calls the engine: a Python FastAPI service on Vultr. The engine replays about 200
three-year rotations through 25 years of real NASA weather on that exact field, and returns 3
options: **most water saved, most income, safest in drought**. Gemini turns them into the SMS.

How one `/plan` request flows through the engine (owner in brackets):

```
request ─► app.py [A] ─► bundle.load [A] ─► Field + Reference
                              │
         signals.compute [H] ─┤─► Signals ──────────────┐
  rotations.candidate_crops [H] ─► enumerate_rotations [H] ─► rotations
                              │                          │
                 water.simulate [A] ─► WaterResult ──────┤
                              │                          │
                 yields.evaluate [H] ─► Outcomes ────────┤
                              │                          │
                 rank.choose [A] ─► EngineResult JSON  ◄─┘   (+ climate.py [H], hindcast.py [A])
```

## The interfaces: agree once, then build in parallel

`engine/types.py` (Abdullah writes it in task A2, by 17:00, copied from here) is the only shared
code. **Each function below has one owner; nobody edits another person's file.** Until the real
function exists, build against a fake that returns the right shapes. Each workflow says which.

```python
Rotation = tuple[str, str, str]          # crop codes for years 1, 2, 3 (codes from worker/src/gemini/crops.ts)

@dataclass
class Field:                             # one field bundle, loaded (bundle.py, A)
    field_id: str; name: str; place: str; lat: float; lon: float; country: str
    provenance: str                      # "real" | "sample"
    weather: pd.DataFrame                # daily, index 'day': tmax_c tmin_c tmean_c precip_mm solar_mj rh_pct wind_ms
    soil: dict                           # soil.json
    water: dict                          # water.json
    crop_history: list[dict]             # crop_history.json
    satellite: dict                      # satellite.json, {} if missing
    sources: list[str]                   # every dataset that went into this bundle

@dataclass
class Reference:                         # data/reference tables (bundle.py, A)
    crops: pd.DataFrame                  # crops.csv, index = crop code (H's table)
    economics: pd.DataFrame              # economics.csv (H's table)

@dataclass
class Signals:                           # signals.py, H. Neutral defaults = "no signal".
    start_depletion_frac: float = 0.0    # soil dryness at the start, 0 = full, 1 = wilting point (SMAP/NLDAS)
    rain_scale: float = 1.0              # IMERG / POWER rainfall ratio; the water model scales rain by it
    erosion_weight: float = 1.0          # >= 1, raises cover-crop value on slopes (SRTM/SSURGO)
    history_confirmed: bool | None = None  # NDVI agrees with CropScape history
    drought_years: list[int] = field(default_factory=list)  # NWIS low flow + allocation cuts
    sources: list[str] = field(default_factory=list)

@dataclass
class WaterResult:                       # water.py, A. R rotations, S weather sequences, 3 years.
    rotations: list[Rotation]
    sequences: np.ndarray                # (S, 3) calendar years used for years 1..3
    etc_mm: np.ndarray                   # (R, S, 3) seasonal crop water need without stress
    eta_mm: np.ndarray                   # (R, S, 3) actual crop water use
    irrigation_mm: np.ndarray            # (R, S, 3) irrigation delivered to the farm (capped by allocation)
    allocation: np.ndarray | None = None        # (S, 3) share of the water right available (added in A5)
    allocation_years: np.ndarray | None = None  # (S, 3) the sourced years those shares come from
    # S = weather sequences x allocation sequences (Fallon: 25 x 11 = 275). Only years with a
    # sourced allocation are used; yields.py needs no change, it just sees a larger S.

@dataclass
class Outcomes:                          # yields.py, H
    rotations: list[Rotation]
    yield_frac: np.ndarray               # (R, S, 3) Ya/Ym after water stress and salinity
    income_usd: np.ndarray               # (R, S) average USD per acre per year over the 3 years
    water_af: np.ndarray                 # (R, S) average irrigation, acre-feet per acre per year
    soil_score: np.ndarray               # (R,) 0..10
```

| Function | Owner | Signature |
|---|---|---|
| `bundle.load` | A | `(field_id) -> tuple[Field, Reference]` |
| `signals.compute` | H | `(field) -> Signals` |
| `rotations.candidate_crops` | H | `(field, ref) -> list[str]` |
| `rotations.enumerate_rotations` | H | `(candidates, ref) -> list[Rotation]` |
| `water.simulate` | A | `(field, rotations, ref, signals, *, weather=None, allocation=None) -> WaterResult` |
| `yields.evaluate` | H | `(field, water_result, ref, signals) -> Outcomes` |
| `rank.choose` | A | `(outcomes, baseline_outcomes, priorities, field) -> dict` (an EngineResult) |
| `climate.trend` / `climate.shift_weather` | H | `(field) -> dict` / `(field, year=2035) -> pd.DataFrame` |
| `hindcast.run` | A | `(field, ref, signals) -> dict` |

Changing an interface means messaging the other person first, then updating `types.py` and
this table in one small commit.

## Data: who writes which file

Field bundles live in `data/fields/<field_id>/`; shared tables in `data/reference/`. Ownership
is by **file**, so both of you can write into the same field folder without conflicts.

| File | Owner | From |
|---|---|---|
| `field.json` | H | identity + `provenance` (H1 makes it). Nobody appends sources here: `bundle.load` builds `Field.sources` from which files exist, plus the `source`/`sources` key inside each JSON file |
| `weather_daily.csv` | A | NASA POWER, 2001-01-01 to 2025-12-31, no gaps |
| `soil.json` | A | USDA SSURGO |
| `water.json` | A | Newlands Project allocation fractions by year + full duty |
| `openet_monthly.csv`, `nwis_flow.csv`, `prism_check.csv` | A | OpenET, USGS NWIS, PRISM |
| `crop_history.json` | H | USDA CropScape (CDL) |
| `satellite.json` | H | SMAP, NLDAS, IMERG, HLS NDVI, SRTM, ECOSTRESS |
| `data/reference/crops.csv`, `economics.csv` | H | FAO-56/33/29; NASS, AMS, cost studies |
| `data/reference/places.csv` | A | ZIP or town → field |
| `docs/DATASETS.md` | both | each adds a row per dataset they use (the Space Apps submission needs it) |

Scripts are split the same way: `pipeline/weather.py, soil.py, water_data.py, places.py` (A);
`pipeline/crops.py, economics.py, satellite.py, tiger.py` (H).

Rules for every dataset:
- **Every number has a source** (a `source` column or key). If a value can't be found, leave it
  blank and say so; never estimate a value and present it as data.
- `provenance: "sample"` marks hand-made bundles. The engine still runs on them, but the
  response says `"sample_data": true`, and the demo must never use one.
- Keys stay in `.env` at the repo root (gitignored). Never switch off TLS verification.

## Contract B: what the engine returns (done, task A1)

`contracts/engine-request.schema.json` and `contracts/engine-response.schema.json`, with samples
in `contracts/samples/`. These match `worker/src/gemini/engine-types.ts`. Rounding happens in the
engine: acre-feet to 1 decimal, whole percentages, dollars to the nearest 10, soil score 0–10.

## The work split

| # | Abdullah (water slice) | hrs | # | Hareem (crops slice) | hrs |
|---|---|---|---|---|---|
| A1 | Contract B: engine request/response ✅ done | 0.75 | H1 | Contract A: field-bundle format + **sample** Fallon bundle | 0.75 |
| A2 | `types.py` interfaces + `bundle.py` loader + `app.py` skeleton | 1.25 | H2 | CropScape history + **crop science table** (FAO-56, 33, 29) | 2.25 |
| A3 | Data: NASA POWER weather + SSURGO soil | 1.25 | H3 | Data: economics (NASS yields, AMS prices, cost studies) | 1.5 |
| A4 | Data: Newlands allocations, OpenET, USGS NWIS, PRISM check | 1.75 | H4 | Code: `rotations.py`: candidate crops, all rotations, rules | 1.25 |
| A5 | Code: `water.py`: daily water balance + OpenET calibration | 2.5 | H5 | Code: `yields.py`: yield, salinity, income, soil score | 1.5 |
| A6 | Code: `rank.py`: 25-year stress test, TOPSIS, 3 options; wire `/plan` | 1.75 | H6 | Data: satellite (AppEEARS SMAP, ECOSTRESS, HLS, SRTM; IMERG; NLDAS) | 2 |
| A7 | Code: `hindcast.py`: the 2021 drought replay | 1 | H7 | Code: `signals.py`: NASA signals the engine uses | 1.25 |
| A8 | Deploy on Vultr + connect the worker (webhook → engine → SMS) | 1.75 | H8 | Code: `climate.py`: trends + 2035 scenario | 1 |
| A9 | `places.csv` resolver + a second US demo field | 0.75 | H9 | Tiger Data: schema + loader (the prize) | 1.25 |
| | **Total** | **12.75** | | **Total** | **12.75** |

An India demo field ("Kisan Voice": POWER + SoilGrids + FAO GAEZ + ERA5) is a stretch goal for
whoever finishes first.

## Checkpoints (Saturday Nov 14 → Sunday Nov 15)

| When | Abdullah | Hareem | Together |
|---|---|---|---|
| **17:00 Sat** | A1 ✅, A2 `types.py` + skeleton on main | H1 sample bundle on main; **AppEEARS requests submitted** | Both build against the sample from here |
| **20:30 Sat** | A3 real weather + soil; A5 water model running | H2 crops.csv + CDL history; H4 rotations | `water.simulate` runs on H4's real rotations |
| **01:00 Sun** | A4 water data; A5 calibrated; A6 real `/plan` | H3 economics; H5 yields; H9 Tiger Data | Look at the 3 options together: do they make sense for Fallon? |
| **09:00 Sun** | A7 hindcast; A8 live on Vultr + phone round trip; A9 | H6 satellite; H7 signals; H8 climate | Full SMS demo on a real phone |
| **10:00 Sun** | **Code freeze.** Record the backup video. | | |

If time runs short, cut in this order: H6 ECOSTRESS → H8 climate → A9 second field →
H7 (keep the slope and drought-year signals). Never cut A3, A5, A6, H2, H4, H5: they are the product.

## Git rules for both Claudes

- Your own branch: `feat/engine-water` (Abdullah) or `feat/engine-crops` (Hareem). Start each task with `git pull origin main`.
- Merge into `main` at each checkpoint once your tests pass. Ownership is by file, so merges are clean.
- Each module has its own tests in `engine/tests/test_<module>.py`, using fakes for the other person's parts.
- **Ask your human before every push.** Commit as your human, with no AI co-author line.
- If you need something from the other side, write it down for your human to pass on. Don't edit their files.
