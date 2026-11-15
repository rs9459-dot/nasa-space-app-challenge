# Datasets FarmLine uses

One row per dataset that is actually fetched and used. Both slices add rows (append at the
end of the table). The Space Apps submission lists these.

| Dataset | Owner | What it does in FarmLine | How we get it | Script | Accessed |
|---|---|---|---|---|---|
| NASA POWER (daily agroclimatology) | NASA | 25 years of daily temperature, rain, sunshine, humidity and wind at the field; drives the water balance and the 25-year stress test | REST API, no key: `power.larc.nasa.gov/api/temporal/daily/point` | `pipeline/weather.py` | 2026-11-14 |
| SSURGO (Soil Survey Geographic Database) | USDA NRCS | The field's soil: how much water it holds (the size of the water bucket), salinity (cuts the yield of salt-sensitive crops), slope, drainage, texture | Soil Data Access REST service, no key: `sdmdataaccess.sc.egov.usda.gov` | `pipeline/soil.py` | 2026-11-14 |
| USGS National Water Information System (NWIS) | USGS | Daily Carson River flow above Lahontan Reservoir (gauge 10312000), 2001-2025; independent evidence of drought years, checked against the allocation cuts | REST API, no key: `waterservices.usgs.gov/nwis/dv` | `pipeline/water_data.py` | 2026-11-14 |
| Newlands Project water allocations | Truckee-Carson Irrigation District (TCID), via press reports and board minutes; duty from the Alpine decree / 43 CFR 418 | The share of their water right Fallon farmers were allowed each year (e.g. 20% in 2015, 70% in 2021); caps irrigation in the water balance and drives the 2021 hindcast | Hand-collected, one cited source per year, in the script | `pipeline/water_data.py` | 2026-11-14 |

| Cropland Data Layer point service | USDA NASS / GMU CropScape | 2008-2025 crop classification at the reference pixel; four 2025 neighbours checked; not a farmer survey | https://nassgeodata.gmu.edu/CropScape/devhelp/cropscapews.html ; per-year URLs retained in crop_history.json | pipeline/crops.py | 2026-11-14 |
| FAO-56 Tables 12, 22, 23 | FAO | Partial sourced crop coefficients, depletion fractions and salinity response; unresolved parameters stay blank | https://www.fao.org/4/x0490e/x0490e0b.htm ; https://www.fao.org/4/x0490e/x0490e0e.htm | data/reference/crops.csv; docs/H2_CROPS_STATUS.md | 2026-11-14 |
| FAO irrigation-scheduling annex, Table 12 | FAO | Published seasonal yield-response parameters for four crops; crop interpretation retained | https://www.fao.org/4/X5647E/x5647e0e.htm | data/reference/crop_parameter_provenance.json | 2026-11-14 |
| Alternative Crops for Cache Valley | Utah State University Extension | Frost-free screening thresholds; explicitly a regional proxy, not local observation | https://extension.usu.edu/crops/tools/alternative-crops-for-cache-valley | data/reference/crop_parameter_provenance.json | 2026-11-14 |
| USDA NASS annual state overviews | USDA NASS | Annual yield/price observations; Nevada 2022-2024 and explicitly labeled state proxies for 2024; no county suppression inferred | https://www.nass.usda.gov/Quick_Stats/Ag_Overview/stateOverview.php ; exact query URLs in economics-observations-*.json | pipeline/economics.py | 2026-11-14 |
| Historical regional enterprise budgets | University of Nevada Reno, Utah State University, UC Davis/UCCE | Seven reviewed cost records, 2008-2022 nominal currency; NOT approved as current income inputs; source and irrigation cost classification retained | URLs/tables in economics-cost-evidence.json | pipeline/economics.py build | 2026-11-14 |
| Feed Grains documentation | USDA ERS | Standard grain sorghum bushel=56 lb; match USD/cwt price to bushel yield | https://ers.usda.gov/data-products/feed-grains-database/documentation | pipeline/economics.py build | 2026-11-14 |

| University enterprise cost-and-return budgets (active prototype cost inputs) | University of Nevada, Reno Extension; UC Davis / UCCE | Seven published full crop-enterprise costs less identified water charges; nominal 2008-2016 USD/acre, not inflation adjusted; cover crop unavailable | Full citations, budget year, table and water subtraction in data/reference/university-costs.json and economics.csv source_cost | pipeline/university_costs.py via pipeline/economics.py build | 2026-11-14 |

| USDA NASS 2022 Census county/state and Idaho annual bean records | USDA NASS | Suppression evidence, derived Nevada spring-wheat/barley yields and labeled Idaho bean proxy; no forecast records averaged | QuickStats API, sanitized raw JSON and source columns retained | pipeline/nevada_census.py; pipeline/regional_economics.py | 2026-11-15 |
