# H6 acquisition status — not complete

NASA AppEEARS accepted two requests on 2026-11-15. See pipeline/appeears/submitted-jobs.json for task IDs and request JSON files. The time-series job was processing (25% displayed) and SRTM pending when checked.

Products are catalog-verified: SPL3SMP_E.006 AM/PM moisture plus retrieval flags, HLSL30.020 red B04/NIR B05/Fmask, HLSS30.020 red B04/NIR B8A/Fmask, ECO_L3T_JET.002 ETdaily/cloud. Request window 2015–2025 does not imply observations before each mission began (SMAP begins March 2015; ECOSTRESS July 2018). No missing days will be invented.

SRTMGL1_NC.003 uses its static February 2000 acquisition window in a separate request. Center and four approximately 90 m offsets allow a neighborhood central-difference slope after verifying actual sampled pixel positions and distances. This is not a field-survey slope.

pipeline/satellite.py implements strict SMAP retrieval-quality filtering, HLS NDVI/cloud filtering, explicit CSV column/scaling import, annual observed-only summaries, and slope calculations. Six synthetic unit tests pass; they verify transformations, not availability or validity of downloaded Fallon observations. Seasonal/cutting interpretation awaits actual observations. No satellite.json has been created with invented or empty data presented as observations.

Still required:
- Download completed AppEEARS bundles, verify CSV metadata/scaling and units, hash originals, import and inspect series.
- Resolve ECOSTRESS ETdaily units: AppEEARS catalog reports W/m2 while the intended output is mm/day. Do not assume a conversion before inspecting authoritative product/download metadata and daily temporal convention.
- Retrieve IMERG monthly Final V07 (CMR C2723754851-GES_DISC) and NLDAS Noah monthly V2.0 (C1887990023-GES_DISC), 2001–2025. Browser Earthdata is signed in, but local Earthdata credentials/token are not configured; no secrets were copied from browser state.
- NLDAS kg/m2 storage must be converted using documented layer thickness to volumetric moisture for a depth-weighted 0–100 cm aggregate. Never treat SMAP surface moisture as an interchangeable root-zone series.
- Validate coverage, quality, gaps and units, write satellite.json and evidence-based two-line interpretations; then test bundle loading.

Sources: https://appeears.earthdatacloud.nasa.gov/api/product ; https://cmr.earthdata.nasa.gov/search/collections.json ; https://nsidc.org/data/user-resources/help-center/how-do-i-interpret-surface-and-quality-flag-information-level-2-and-3-passive-soil-moisture-products ; https://github.com/nasa/HLS-Data-Resources/blob/main/r/HLS_Tutorial.Rmd
