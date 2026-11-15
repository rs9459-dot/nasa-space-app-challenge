> Historical checkpoint. Active cost policy and current values: [H3_UNIVERSITY_COSTS.md](H3_UNIVERSITY_COSTS.md). University costs are now user-authorized; statements below describe the earlier stage.

# H3 economics: data pipeline and evidence status

## Implemented

`pipeline/economics.py` fetches public USDA NASS annual state overviews without an API key,
retains source URLs and retrieval timestamps, parses missing/suppressed values as null,
and records crop-specific units. State observations are not farmer-specific potential yields.

Fetched 22 annual crop observations: Nevada 2022-2024, and Utah, Idaho, Kansas 2024.
Nevada observations cover alfalfa and silage maize. Other states are explicitly geographic
proxies, not additional evidence that these crops have local buyers or fit Fallon.
County estimates have not been queried by this keyless overview path; lack of a county
record here is not a claim that USDA suppressed it.

Eight economics.csv rows now contain the verified available yield/price values. Sorghum
USD/cwt is multiplied by 56/100 to match yield in bushels (USDA ERS standard test weight).
Safflower USD/cwt is divided by 100 to match yield in pounds. Cover crop zeros mean no
harvested sale in this scenario, not zero biomass or zero operating cost.

Seven reviewed historical budget records are separate in economics-cost-evidence.json,
including source geography, currency year, table, total cost and irrigation line. Every
record has approved_for_current_income=false. Pure-rye costs cannot be inferred without
qualification from a vetch/pea/rye seed mix; nitrogen credits are not assigned to sole rye.

## Reproduce

Install pipeline/requirements-crops.txt into the pipeline environment (shared pyproj and
truststore dependencies; economics itself needs only truststore plus Python standard library).
From the repository root:

    python -m pipeline.economics fetch --state Nevada --years 2022 2023 2024
    python -m pipeline.economics fetch --state Utah --years 2024
    python -m pipeline.economics fetch --state Idaho --years 2024
    python -m pipeline.economics fetch --state Kansas --years 2024
    python -m pipeline.economics build
    python -m pipeline.economics audit
    python -m unittest pipeline.tests.test_economics -v

The build command reconstructs the reference rows and historical budget ledger from
reviewed source records. Network retrieval uses the OS certificate store with TLS enabled.
Raw HTML is gitignored in data/raw/nass-overviews/. Source observation JSON is versionable.

## Remaining before income recommendations

- Obtain updated, comparable cost budgets or explicitly approve a documented economic
  scenario. Published 2008/2011 costs are not current nominal costs. No unverified inflation
  factor is silently applied. H3 does not yet meet its all-eight-crops completion criterion.
- Match barley market (feed versus contracted malt), wheat class, dry-bean species, harvest
  form, moisture basis and the cover-crop mix to the profile before accepting budget transfers.
- Verify current silage transaction prices and matching dry-bean observations. NASS does
  not report silage price in the retrieved state overview; do not infer it from grain price
  without an explicit sourced pricing method.
- Define the meaning of water_cost_usd_per_af with the water-slice owner. Deducting an
  entire budget irrigation line is not always valid: it may be pumping energy or labor,
  while another source separately charges water delivery. The arithmetic difference in
  the ledger is auditable, but is not an automatically approved replacement cost.
- Acquire county QuickStats data if available; explicitly accept and label any state proxy.
- Select a consistent money-year and cost basis (operating margin or full economic return).
  Do not compare a full-cost budget with an operating-cost-only cover-crop budget as if
  they describe the same margin. Avoid county-average yield being called unstressed yield.

Until these checks are satisfied, unknown costs remain blank and source_cost says
UNAVAILABLE; no current-income ranking can validly be produced from this reference table.
