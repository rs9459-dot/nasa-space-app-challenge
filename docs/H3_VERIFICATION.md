> Historical checkpoint. Active cost policy and current values: [H3_UNIVERSITY_COSTS.md](H3_UNIVERSITY_COSTS.md). University costs are now user-authorized; statements below describe the earlier stage.

# H3 verification results

Verified November 14, 2026 (November 15 UTC).

- 22/22 stored USDA NASS yield/price observations matched re-fetched primary sources.
- Three original UC Davis PDF budget tables were rendered and visually checked: dry beans, safflower and cover-crop mix.
- Two University of Nevada publisher HTML budgets were checked: alfalfa and malting barley. Their original PDFs were not verified.
- One Utah State PDF returned HTTP 403, leaving its wheat and silage budget records unverified in this run.
- All eight economics rows remain unapproved for current income comparisons.

## Important irrigation interpretation

The historic alfalfa irrigation charge of $111/acre comprises $100 water, $1 parcel administration and $10 ditch maintenance. Replacing purchased water alone would retain the $11 overhead. The historic barley $56/acre irrigation charge is pumping power; retain it when replacing only purchased water. These are historical-dollar interpretations, not approved current costs.

## Remaining before farmer income rankings

Obtain comparable current costs in a common money-year and cost basis; confirm local markets, crop class, harvest form and moisture; obtain silage prices and matching dry-bean yield/price evidence; agree the exact water-charge boundary with the water engine owner. Missing costs remain blank rather than guessed.

## Reproduce

Run `python -m pipeline.economics_verify` from the repository root with truststore and pypdf installed. Source snapshots and SHA-256 hashes support the audit. Manual PDF reviews apply only to the exact inspected source hash; changed or unavailable sources require review. Run `python -m unittest pipeline.tests.test_crops pipeline.tests.test_crop_provenance pipeline.tests.test_economics -v` for regression checks. All 21 targeted tests passed. Broader unittest discovery could not import three partner test modules because pytest is not installed in this environment; those tests were not verified. Git diff whitespace checks passed.

The verification confirms transcription, not agronomic suitability or present-day profitability. Changes are local and have not been committed or pushed during this verification task.
