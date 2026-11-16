# Latest H6 update: IMERG and NLDAS retrieved and integrated

NASA GES DISC access was approved by the user. Giovanni CSV results were downloaded and preserved under ignored data/raw/giovanni; metadata, exact reproduction URLs and SHA-256 hashes are in docs/H6_GIOVANNI_VALIDATION.json.

IMERG Final V07: 297 monthly records, January 2001–September 2025, native mm/hr converted to mm/month using calendar days * 24. Giovanni's catalog ended at September 2025; October–December were NOT filled. Actual selected grid center is (-118.75,39.35), a 0.1-degree pixel near the requested Fallon point, not field-scale rainfall.

NLDAS Noah V2.0: 300 monthly records, January 2001–December 2025, native SoilM_0_100cm kg/m2 divided by 1000 kg/m3 * 1 m to obtain m3/m3. Direct 0–100 cm aggregate avoids an invented layer weighting. Actual selected grid center is approximately (-118.812,39.4375), a coarse 0.125-degree model grid cell. Model-derived soil moisture is not a satellite observation and is not interchangeable with SMAP surface or SSURGO top-horizon moisture.

Rebuild full bundle: python -m pipeline.appeears_import (also imports Giovanni files when raw directory exists). Standalone monthly rebuild: python -m pipeline.giovanni_import. 39 combined tests passed. H7–H9 implementation files were not changed; H7 check output and a test expectation were refreshed for the new inputs. Existing H7 now calculates rain_scale=1.0338678449815533 over 24 complete overlapping years, 2001–2024. 2025 is excluded from the annual ratio because IMERG is incomplete. This is a prototype climatological ratio, not a live forecast.

Remaining acceptance limitations: ECOSTRESS unit metadata conflict/full quality screening; a defensible reviewed HLS-CDL comparison; and moisture depth comparability before initial soil-depletion inference. These are explicitly unavailable, not forced into advice. H8/H9 completion is reported by the user/team and was not audited or modified here. No commit/push/deployment in this update.

Sources: https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07 ; https://doi.org/10.5067/WB224IA3PVOJ ; https://ldas.gsfc.nasa.gov/faq/ldas ; https://ldas.gsfc.nasa.gov/nldas/soils

---
## Earlier notes (superseded where above updates status)

# H6 update: full 2015–2025 extraction integrated locally

The completed eleven-year AppEEARS task 6935203f-0a90-4846-8a99-eccd74bd0ee2 and SRTM task 2abbfbc7-cb15-4a7a-9811-624c73bfb118 were downloaded. The separate one-year demo was NOT used.

Rebuild: python -m pipeline.appeears_import. Raw CSV/XML/README files are preserved under ignored data/raw/appeears. SHA-256 evidence and filtering counts are in H6_FULL_VALIDATION.json. satellite.json now loads through the existing bundle loader.

Accepted data: 3,002 SMAP AM/PM observations, 195 Landsat HLS plus 375 Sentinel HLS NDVI observations. Both have accepted observations in each year 2015–2025, with gaps retained. HLS CSV reflectance was already scaled by AppEEARS; it was not scaled a second time. Annual/monthly summaries are observation-weighted, not continuous annual crop productivity estimates.

SRTM neighborhood slope is 1.047135%, based on actual returned raster indices: east-west separation 8 arcseconds (~190.997 m), north-south 6 arcseconds (~185.325 m). Central elevation is 1199 m; surrounding samples 1204–1206 m show that this simple gradient does not fully describe local microtopography. It is not a parcel survey. H7 now uses the derived slope, producing ordinal erosion_weight 1.209427; SSURGO mapped slope is 0.5%.

SMAP is surface moisture (0–5 cm), not depth-equivalent to SSURGO's 0–18 cm FC/WP. It is archived and inspectable but does not set H7 initial depletion without a validated depth method. History confirmation remains unknown: lower observed 2021 NDVI does not by itself identify crop type or prove drought causality.

ECOSTRESS: 290 finite clear-sky ETdaily observations retained in a quarantined series, NOT mm/day output. Official Collection 2 guide section 5.4 (p16) describes mm/day integrated sunrise–sunset, but its Table 10 and AppEEARS metadata label W/m2. Retain this conflict explicitly pending authoritative confirmation/full quality checks; no arbitrary conversion. Source: https://lpdaac.usgs.gov/documents/1655/ECO_L1C-4_Grid_Tile_User_Guide_V2.pdf

Still pending: IMERG and NLDAS retrieval, validated moisture depth treatment, reviewed HLS-CDL comparison, and ECOSTRESS unit/quality resolution. H6 is PARTIAL, not complete. No commit, push or deployment performed in this update. 35 combined satellite/H4/H5/H7 tests passed.

---
## Earlier acquisition notes (superseded where above updates status)

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
