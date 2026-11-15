# H3 university-cost update — November 14, 2026

This supersedes the previous restriction on university production costs. University costs are now permitted by the user's explicit instruction. Yields/prices retain their own source restrictions; ERS is benchmark-only.

| Crop | Full source cost | Water excluded | Entered USD/acre | Budget year |
|---|---:|---:|---:|---:|
| Alfalfa | 943.36 | 100.00 | 843.36 | 2008 |
| Barley | 963.07 | 0.00 | 963.07 | 2008 |
| Wheat | 1034.00 | 45.00 | 989.00 | 2016 |
| Corn silage | 1523.00 | 158.00 | 1365.00 | 2015 |
| Grain sorghum | 2107.00 | 408.00 | 1699.00 | 2016 |
| Safflower | 350.00 | 11.00 | 339.00 | 2011 |
| Common dry beans | 1065.00 | 100.00 | 965.00 | 2010 |
| Sole-rye cover crop | unavailable | unavailable | blank | unavailable |

UNR is selected for alfalfa and barley. UC Davis irrigated dry-West budgets are selected for the next five crops; no matching preferred intermountain budget was located in the searched current/archive listings. Search records are in university-costs.json; this is not a guarantee that no other publication exists.

Costs include the full operating/cash/noncash ownership total listed by the source, less the identified water charge. Irrigation labor, pumping power and capital ownership remain unless part of the source's removed water charge. In particular, UNR barley's 56 USD irrigation line is power and is retained. Alfalfa retains 1 USD parcel administration and 10 USD ditch maintenance. Sorghum's removed water charge blends well and district water; no invented energy allocation was made. Published rounding and interest totals are retained without recomputing financing.

The corn-silage and common-bean budgets allocate annual costs between double crops; entered amounts represent the source's single crop-enterprise allocation. They are not invented full-year sole-crop costs or multiplied by two. Wheat costs include straw operations but no straw revenue has been introduced. These system differences must remain visible in prototype comparisons.

Per user request, years_averaged now holds the actual budget year when a cost is present. Yield/price observation years remain in their source columns and provenance; they are not relabeled as budget-year observations. No inflation adjustment was applied, so net returns combine explicitly disclosed historical nominal costs and separately dated revenue observations. Do not label them current profit.

Use `python -m pipeline.economics build` to rebuild the active table. The earlier economics-strict.csv remains a no-university reference snapshot, not the active policy. `pipeline.university_costs.net_return` supplies labeled prototype arithmetic and returns 'estimate unavailable' for missing yield/price/cost/water. This helper is not automatically wired into the partner API. Engine owners must keep the Prototype label, subtract the TCID water charge exactly once and handle blank values; adding cost columns does not create missing crop prices/yields.

Cover crop remains blank: the UC Davis 2022 vetch/pea/rye study is a mixture with operating costs only, not the requested sole-rye full-cost budget. No zero-cost substitute was inserted. H3 overall remains incomplete where yields/prices or acceptable costs are missing. No current-farm advice approval is implied.

Seven cost rows added; citations include university, title, geography, year, URL and table. Relevant new PDF table pages were rendered and visually checked; UNR publisher HTML and previously checked safflower source retained. Changes are local, not committed or pushed.
