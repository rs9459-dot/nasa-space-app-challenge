# H3 gaps and H4 alternatives update

User authorized explicitly labeled official USDA regional proxies on November 15, 2026. This supersedes the earlier Nevada-only yield/price restriction. No proxy is represented as a Fallon measurement.

Recovered official 2022 Census records: Churchill wheat/barley production and acreage are suppressed (D). Nevada state spring wheat totals are 283,756 bushels on 4,019 harvested acres; barley totals are 90,111 bushels on 1,114 acres. Derived yields are separately identified from annual survey yields and potential yields. County corn-silage production/acreage is available as additional single-year evidence; the active silage yield retains the recent Nevada annual series.

Active prototype economics fills missing values using already verified 2024 USDA state-overview records: Idaho spring-wheat price, Utah barley price, Kansas grain-sorghum yield/price, Utah safflower yield/price. Nevada wheat/barley derived yields are preserved. Conversion of sorghum USD/cwt to USD/bushel uses 56 lb/bushel, and safflower price is converted to USD/lb. Exact source geographies, years and conversions remain in source columns and provenance.

New live QuickStats Idaho bean records provide matching aggregate dry-edible-bean yield and price (excluding chickpeas), 2021-2025. Only final YEAR yields and MARKETING YEAR prices are selected; August/October forecasts and named subclasses are excluded. Mean yield 25.94 cwt/acre, mean price 37.78 USD/cwt. This is a broad class proxy, not a pinto-specific or local-market estimate; the university budget remains a disclosed common-bean enterprise proxy.

The existing target-region column US-NV denotes the scenario target; source columns explicitly say REGIONAL PROXY, NOT FALLON OBSERVATION. Historical university costs retain their actual budget year in years_averaged; revenue years remain in provenance. No inflation applied.

Fallon H4 now returns three prototype candidates: alfalfa, grain sorghum, dry beans, giving 21 three-year sequences. Disabled GDD gates for these profiles remain disclosed as unchecked. Wheat, barley and safflower still fail the conservative planting-season frost screen despite now having economics. This screen has not been locally calibrated and does not establish biological impossibility. Corn-silage price, cover-crop full cost, and grain-corn economics remain unavailable. These gaps are not zero-filled.

Implementation: pipeline/nevada_census.py and pipeline/regional_economics.py are called by the economics rebuild; engine/rotations.py reports every exclusion and warning. This remains prototype work on local feat/engine-rotations, not committed or pushed. It has not altered the reviewed GitHub PR3 branch. Updated candidate details: docs/H4_FALLON_CHECK.json.
