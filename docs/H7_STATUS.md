# H7 update after full satellite extraction

SRTM is now present in the real bundle and consumed by compute(field): slope 1.047135% yields erosion weight 1.209427. This replaces the earlier SSURGO-only fallback of 1.1. H7_FALLON_CHECK.json has been regenerated. SMAP is present but depth-incomparable to top-horizon FC/WP, so depletion remains neutral; no IMERG correction exists yet; HLS history confirmation remains unknown. 35 combined tests pass, including the full extraction checks. The following earlier notes retain design details but acquisition/status statements are superseded by this update and H6_STATUS.md.

# H7 status â€” local module implemented; H6-dependent validation pending

engine/signals.py exposes compute(field) -> Signals without editing shared types or Abdullah-owned code. Thirteen H7 tests and 30 combined H4/H5/H6/H7 tests passed. Tests include water.simulate responses to moisture/rain changes and yields.evaluate response to erosion weighting.

Real Fallon check (docs/H7_FALLON_CHECK.json): drought years 2001, 2007, 2013, 2014, 2015, 2021. Rule: union of allocation fractions below 0.5 and calendar-year average USGS river flow strictly below its 25th percentile, using complete calendar years only. This retrospective classification is not a current drought alert. Flow threshold is 141.96609289617487 cfs over the available complete-year record. River flow is a regional hydrologic indicator, not field moisture.

SSURGO slope 0.5% gives erosion_weight=1.1 under the explicit prototype rubric 1+min(slope_pct,20)/5. SRTM, once validated, is cross-checked; disagreement over 2 percentage points returns neutral weight rather than claiming agreement. The rubric and tolerance are design choices, not measured erosion rates.

Unavailable satellite-dependent signals currently preserve interface defaults: start_depletion_frac=0 (no moisture signal, NOT measured full soil), rain_scale=1 (no rainfall correction), history_confirmed=null (unknown). Moisture needs accepted quality, source, units, recency and explicit depth comparability to SSURGO FC/WP; surface SMAP is not automatically equivalent to 0â€“100 cm NLDAS or the 0â€“18 cm SSURGO horizon. IMERG rainfall correction uses only common, complete calendar years and clamps to [0.5,2]. Duplicate monthly observations invalidate that year. Clamps are safeguards, not fitted parameters.

As-of date defaults to the final bundled weather day, 2025-12-31 for Fallon; observations are not described as current in 2026. HLS crop-history confirmation accepts only an explicit source-cited reviewed comparison; it does not infer alfalfa cuttings from an unvalidated threshold. H6 must supply the comparison and provenance.

Satellite contract for H7:
- Moisture: list under smap_soil_moisture or nldas_soil_moisture; day, value, unit=m3/m3, quality=accepted, source, depth_cm=[top,bottom].
- Rain: imerg_monthly_precip_mm list; month YYYY-MM, value, unit=mm/month, quality=accepted, source.
- Slope: slope_pct_srtm object; value, unit=percent, quality=accepted, source.
- History: history_comparison object; method='reviewed HLS-CDL comparison', reviewed=true, confirmed boolean, source pointing to the actual comparison evidence.

The H6 intermediate importer outputs need validation/adaptation to this contract before use. No satellite observations are present in the real bundle yet. Full H7 data acceptance therefore remains pending H6. Correction after inspecting engine/plan.py: the existing planner automatically imports engine.signals and calls compute(field), then passes its result into water.simulate and yields.evaluate. No API edit is needed for module discovery. Verified this import locally. A full Fallon make_plan run reaches ranking but fails with ValueError: cannot convert float NaN to integer; H5 correctly marks unavailable net returns NaN because this checkout lacks the water charge. Abdullah owns ranking and must handle unavailable economics before a complete API response can be claimed. No shared interface changes were made. Publication status is tracked in Git; this document does not assert deployment or completion of H6.
