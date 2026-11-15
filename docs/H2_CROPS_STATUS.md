# H2 handoff: crop history and complete prototype profiles

## Completed

- Real USDA CDL history for the reference point, 2008-2025 (18 years), plus four
  100-m neighbour checks in 2025. Original category, source URL and retrieval time retained.
- Ten numeric crop profiles: the eight planned Fallon choices plus grain corn and fallow.
- Defined spring wheat, grain sorghum, established alfalfa, silage maize, winter cereal rye
  cover crop, and bare fallow explicitly.
- A cell-level evidence ledger covers all 230 numeric/boolean entries: 59 published generic,
  2 published local, 32 regional proxies, 10 derived assumptions, 113 model assumptions,
  and 14 policy values. Model choices are not represented as empirical observations.
- Structural validation and real-water-engine integration pass for all ten profiles.

## What completion means

The table is computationally complete for prototype scenarios, not agronomically calibrated.
The documented assumptions replace absent numeric configuration; they do not manufacture
missing observations. The source record explicitly keeps validated_for_farmer_advice=false.
Read H2_MODEL_ASSUMPTIONS.md before interpreting any result. In particular, eight thermal
eligibility gates are explicitly disabled until compatible cultivar heat requirements exist.
The rye overwinter curve, barley/silage yield-response proxies and safflower salinity proxy
are model scenarios that need sensitivity checks, not newly established crop science.

## Run checks

From the repository root:

    python -m unittest pipeline.tests.test_crops pipeline.tests.test_crop_provenance -v
    python -m pipeline.crop_reference
    python -m pipeline.crop_reference --require-advice-ready

The first two checks pass. The last intentionally fails: it is a readiness report and
is not yet wired into Abdullah's API. Abdullah should enforce the advice gate before
serving production recommendations. H3 economics and local agronomic validation remain
separate dependencies; no end-to-end farmer advice is claimed by H2.

## Retrieve history

Use Python 3.12+ and install pipeline/requirements-crops.txt into a pipeline virtual
environment. Run python -m pipeline.crops. Requests use EPSG:5070 and verified system TLS.
Raw responses are in gitignored data/raw/cdl/nv-fallon-01/; partial failures preserve
existing history. Four matching neighbours do not prove parcel boundaries or ownership.
