# Field bundle contract (H1, draft for integration)

Data lives in `data/fields/<field_id>/`; shared tables live in `data/reference/`.
Crop codes match the Worker and engine. Dates use ISO 8601. CSV files are UTF-8,
with a header, decimal points, no thousands separators. JSON missing values are null;
CSV missing values are empty, never zero. Source fields explain unavailable values.

## Provenance and readiness

`field.json.provenance` is `real` or `sample`. Synthetic bundles must use `sample`,
and engine responses must carry `sample_data: true`. Never use samples as real demo evidence.
H1 reference tables have eight crop identifiers but blank numeric cells. They unblock
the loader and schema work only; H2/H3 must supply sourced values before model evaluation.
Do not impute missing crop/economic parameters silently.

Current loader caveat for Abdullah: `bundle._sources` assigns NASA POWER and USDA
CropScape from filenames even for synthetic bundles. These names are not evidence of
actual observations. Keep the sample flag visible and adjust attribution in the loader
before any sample result is displayed. This task does not modify his loader.

## Files and ownership

| File | Owner | Fields / columns and units | Example (synthetic) |
|---|---|---|---|
| field.json | Hareem | field_id, name, place, county, state, country (US), zip (string); lat/lon WGS84 degrees; provenance | See sample field.json |
| weather_daily.csv | Abdullah; H1 sample exception | day; tmax_c,tmin_c,tmean_c (C); precip_mm (mm/day); solar_mj (MJ/m2/day); rh_pct (0-100); wind_ms (m/s) | 2025-01-01,10,-4,3,2,10,50,2 |
| soil.json | Abdullah; H1 sample exception | aws_0_100_cm,aws_0_150_cm (cm available water over named depth); fc_top_vol_pct,wp_top_vol_pct (volumetric percent); drainage; slope_pct,organic_matter_pct,clay_pct (%); ph; ec_ds_m (dS/m, method required for real data); map_unit; source | aws_0_100_cm=12, ec_ds_m=3 |
| water.json | Abdullah; H1 sample exception | full_allocation_af_per_acre (acre-feet/acre/year); allocation_fraction_by_year (year keys, fractions 0-1); water_cost_usd_per_af (USD/acre-foot); source | 2021 allocation fraction=0.5 |
| crop_history.json | Hareem | list of year, cdl_code (integer or null), crop (code or null), source; retain unmapped category where present | {"year":2025,"cdl_code":null,"crop":"sorghum","source":"synthetic"} |
| satellite.json | Hareem | optional series listed below; sources list | {"sources":[]} |
| openet_monthly.csv | Abdullah | proposed: month (YYYY-MM), et_mm (monthly mm), model, source | 2025-01,10,SAMPLE,synthetic |
| nwis_flow.csv | Abdullah | proposed: day, discharge_cfs (ft3/s), site_id, source; convert units explicitly | 2025-01-01,20,SAMPLE,synthetic |
| prism_check.csv | Abdullah | proposed: month, precip_mm (monthly), tmean_c (monthly), source | 2025-01,2,3,synthetic |
| reference/places.csv | Abdullah | key,kind (zip or town),country,lat,lon,field_id; strings for ZIP | 89406,zip,US,39.38,-118.77,nv-fallon-01 |
| reference/crops.csv | Hareem | exact header below | alfalfa row exists; all numeric values pending H2 |
| reference/economics.csv | Hareem | exact header below | alfalfa,US-NV-Churchill; values pending H3 |
| docs/DATASETS.md | Shared | dataset, product/version, access URL, retrieval date, units/resolution, transformations, limitations | H1 fixture: synthetic; no external dataset accessed |

The three proposed auxiliary CSV formats must be agreed with Abdullah before acquisition;
they are not implemented or consumed by the current bundle loader. Absent files mean unavailable,
not zero observations. Field identity has no appended dataset list: loader assembles sources.

## Weather validation

Real bundles cover 2001-01-01 through 2025-12-31 inclusive: 9,131 unique consecutive days.
Sample bundles may use whole calendar years. Values must be finite, tmin <= tmean <= tmax,
rain/solar/wind nonnegative and humidity 0-100. Preserve quality flags and missing-value
rules during acquisition; never pad missing real observations with synthetic values.

## Crop reference

Exact header:

```csv
crop,perennial,heavy_feeder,legume,plant_month,plant_day,stage_ini_days,stage_dev_days,stage_mid_days,stage_late_days,kc_ini,kc_mid,kc_end,root_depth_m,p_depletion,ky,ece_threshold_ds_m,salinity_slope_pct,base_temp_c,gdd_required,frost_free_days_min,residue_score,deep_roots,cover_benefit,source
```

| Columns | Units / meaning |
|---|---|
| perennial,heavy_feeder,legume | boolean 0 or 1; blanks mean unknown |
| plant_month,plant_day | calendar month/day for regional planting assumptions |
| stage_ini_days,stage_dev_days,stage_mid_days,stage_late_days | days in each FAO growth stage |
| kc_ini,kc_mid,kc_end | dimensionless crop coefficients |
| root_depth_m | metres |
| p_depletion | fraction 0-1 |
| ky | dimensionless water-yield response |
| ece_threshold_ds_m | saturated-paste ECe threshold, dS/m |
| salinity_slope_pct | yield loss percentage points per dS/m above threshold |
| base_temp_c,gdd_required,frost_free_days_min | C; degree-days; days |
| residue_score,deep_roots,cover_benefit | custom scores 0-3; rubric must be documented in H2 |
| source | citations for every populated parameter, with table/page and regional assumptions |

Alfalfa requires explicit treatment of repeated cuttings and cycle-averaged coefficients
when FAO-56 values are populated in H2. Do not assume it is a single annual growth cycle.
SSURGO EC is not automatically equivalent to ECe: record measurement method/depth and
validate any conversion before applying salinity response equations.

## Economic reference

Exact header:

```csv
crop,region,years_averaged,yield_per_acre,unit,price_usd_per_unit,cost_usd_per_acre,source_yield,source_price,source_cost
```

region is a documented geographic code (initially US-NV-Churchill); years_averaged records
the actual observation years. yield_per_acre and price_usd_per_unit must use matching unit
(e.g. short_ton, bushel, cwt with commodity conversion documented). cost_usd_per_acre is
annual USD/acre excluding separately charged irrigation water. Each of source_yield,
source_price,source_cost cites dataset/study, geography, year and URL/table. State fallbacks
must be explicit. Missing prices or costs are not zero. County observed yield is not an
independently verified unstressed potential yield: document this modeling assumption in H5.

## Satellite observations

Proposed series objects have day (or month), value, unit, source, product/version and quality
metadata. Optional keys: smap_soil_moisture (m3/m3), nldas_soil_moisture (document native
layer depths and units before conversion), imerg_monthly_precip_mm (mm/month), ndvi
(dimensionless), ecostress_et_mm_day (mm/day), slope_pct_srtm (scalar percent).
Finalize series shapes against signals.py during H6. Do not fabricate observations in H1.
SMAP near-surface moisture and deeper NLDAS moisture are not interchangeable without a
documented depth-aware method. Convert soil volumetric percent to fractions before comparisons.

## H1 handoff

Load explicitly by nv-fallon-01-sample. Check 9,131 weather rows, three synthetic history
entries, eight reference rows and provenance=sample. This establishes loader compatibility,
not completed rotation planning. H2 replaces crop placeholders; H3 replaces economics.
