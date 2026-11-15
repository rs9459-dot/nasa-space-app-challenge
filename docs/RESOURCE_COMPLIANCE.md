> Historical checkpoint. Active cost policy and current values: [H3_UNIVERSITY_COSTS.md](H3_UNIVERSITY_COSTS.md). University costs are now user-authorized; statements below describe the earlier stage.

# Resource compliance remediation

User requirement: inputs must be accurate to the challenge-provided resources. Existing prototype assumptions are not approved production data.

## Started

- Added a reproducible audit of assumption/proxy/policy crop cells and economics readiness: `python -m pipeline.resource_audit`.
- Preserved existing prototype tables to avoid silently changing the partner's engine; the audit is standalone and does not claim to enforce the API.
- Recorded official AMS Nevada report 3926 dated November 13, 2026, separately with grade, packaging, region, quantity and freight/use. No automatic replacement of annual prices.
- Prepared `.env.example` with an empty NASS_API_KEY setting. Copy to gitignored `.env` and enter the key privately when received.

## Source categories

Challenge-listed families already used: POWER, SSURGO, CDL, NWIS; NASS state-overview observations are official NASS data but not the required county QuickStats query.
Supplementary references: FAO crop tables, university enterprise budgets and TCID allocation reports. Retain provenance, but do not describe these as challenge-listed datasets or automatically approved by the strict source requirement.
Assumptions/proxies: scenario planting dates, stage durations, crop response transfers and ordinal soil scores. Not observations and not valid substitutes for missing measurements.
SMAP, IMERG, HLS/NDVI, ECOSTRESS and SRTM are not integrated in this crops pipeline yet.

## Next acquisition steps

1. QuickStats: county Churchill, Nevada; annual survey yields by crop and class, recent available years. Query availability first. Record suppression, absence and retrieval errors separately. State fallback requires an explicit recorded decision; do not silently transfer another state.
2. Prices: annual state NASS price-received data or AMS records with matching harvest, quality, unit and delivery basis. Do not mix weekly transaction quotes and annual means without a stated method.
3. Costs: missing under the strict listed-source policy unless a matching published dataset is located. Historical supplementary budgets remain evidence only, not present-day approved costs.
4. Satellite acquisition: verify collection/version, bands, date coverage, resolution and QA using current provider documentation before requesting data. Earthdata credentials stay local; no credentials are needed for the current source audit.
5. Demo point remains a reference pixel, not a verified parcel. Confirm a boundary before field-specific claims.

Sources: challenge resources https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/?tab=resources ; QuickStats API https://quickstats.nass.usda.gov/api ; AMS index https://www.ams.usda.gov/market-news/hay-reports ; Nevada report https://www.ams.usda.gov/mnreports/AMS_3926.pdf
