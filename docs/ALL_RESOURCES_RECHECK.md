> Historical checkpoint. Active cost policy and current values: [H3_UNIVERSITY_COSTS.md](H3_UNIVERSITY_COSTS.md). University costs are now user-authorized; statements below describe the earlier stage.

# Recheck of all challenge resource links

Reviewed November 14, 2026. This is an access, coverage and source-discovery review, not proof that every product has been downloaded and validated. Web fetch errors are not evidence that data is absent or that a login is required.

## Resolved county acquisition issue

A simplified QuickStats Census query returned 15 Churchill County HAY records for 2022. Alfalfa: 20,995 acres harvested, 90,762 tons production. Derived county yield = 4.323029 tons/harvested acre. This is one Census year, not a 2021–2025 annual series, field yield or unstressed potential yield. Stored raw official records and derivation separately in quickstats-churchill-census-hay-2022.json. No production economics row replaced.

NASS documents that annual county estimates for hay and dry edible beans ended beginning with 2019; small-grain county estimates were suspended for crop year 2024. These statements do not imply Census data are absent or that every API error has the same cause.
Source: https://www.nass.usda.gov/charts-and-maps/crops-county

## Every listed resource family

| Resource | Recheck result and relevance |
|---|---|
| SMAP | Mission page fetch blocked; existing signed-in Earthdata collection search works. Soil moisture acquisition/QA remains implementation work, not proven absence. |
| GPM/IMERG | Official data page works; links GES DISC, Giovanni and STORM for spatial subsets. Rainfall, not crop economics. |
| Landsat | EarthExplorer search page works. Imagery/NDVI route; EarthExplorer account requirements depend on download route. No new account requested now. |
| MODIS | Listed LP DAAC page returned 403 to web fetch. Existing Earthdata route is alternative. |
| VIIRS | Earthdata URL requires JavaScript; use signed-in browser. |
| POWER | Public site/API route available; weather already acquired by partner pipeline. |
| SRTM | Listed instrument page fetch failed; use Earthdata catalog/AppEEARS route after product verification. |
| ECOSTRESS | Official page works; explicitly links Earthdata and AppEEARS point/area samples. Collection/version and ET units must be verified. |
| Ag Data Commons | Public catalog works, no download account required. Discovered ERS costs and potential agronomy datasets. |
| Web Soil Survey | Public official soil data page works. Survey estimates are not on-farm soil measurements. |
| CropScape/CDL | Listed homepage redirected toward CropSmart sign-in and failed web fetch. Previously acquired official point-service records remain separate evidence. No new account assumed necessary until selected route requires it. |
| PRISM | Public downloads and grid-cell time series advertised, including climate validation inputs. |
| SSURGO/STATSGO2 | Listed NRCS page works and links WSS; queried soil service is existing pipeline route. |
| NAIP | ArcGIS hub is JavaScript-only in web reader. Imagery/boundary validation, not prices/costs. |
| NLCD | Listed USGS page timed out. Land-cover context, not economics. |
| NLDAS/GLDAS | Generic Earthdata homepage returned 403 to web reader; use existing signed-in catalog for collection discovery. |
| FAO GAEZ | Portal returned no readable text; interactive product review still needed. Suitability/yield-potential route, not automatically a local enterprise budget. |
| CoCoRaHS | Map URL inaccessible to web reader. Rain-gauge validation; station availability must be checked for the demo area. |
| NWIS | Listed page returned 403 to web reader; existing partner API observations are separate evidence. |
| AMS | Public report pages work. Found dedicated dry-bean daily, weekly and annual report links; matching bean class/market and units still needed. |
| QuickStats | Existing key works. County Census HAY totals now retrieved with simpler query. |
| OpenET | Public site/API instructions work. API access offers account registration; optional separate OpenET account if we choose this ET route. |
| LANDFIRE | Public products/download links work. Vegetation/fuels context; not a crop cost table. |
| GEDI | Listed link redirects to an old mission news article; current product/access links exist in its navigation. Not a direct crop-cost source. |
| Sentinel-2 / Copernicus | Portal works; direct download/service route may require Copernicus account. Optional because Earthdata vegetation routes are available. |
| ERA5 / CDS | Dataset documentation works; Login/Register displayed for services. Optional CDS account/API setup if ERA5 is selected, not needed for existing POWER weather. |

## New concrete economics leads

ERS has current downloadable CSV/XLSX files for barley, wheat, sorghum and grain corn, with a page update of November 10, 2026. Major-region or U.S. estimates are not automatically Nevada farm costs, and grain maize is not silage maize. Inspect accounting basis, year, region and irrigation components before adoption.
https://www.ers.usda.gov/data-products/commodity-costs-and-returns

AMS has public daily grower-bid, weekly market-review and annual-review links for dry edible beans. This resolves source discovery, not matching a specific bean class and Fallon market.
https://www.ams.usda.gov/market-news/dry-edible-beans-peas-and-lentils

## Accounts

No new account is necessary for the current county/ERS/public AMS work. Earthdata and NASS access are already sufficient to continue. OpenET registration, Copernicus Data Space or CDS setup are conditional choices, not mandatory sign-ups for every resource. Do not share credentials in chat.

## Remaining work accurately described

County Census retrieval now succeeds. Recent annual county hay coverage is a documented publication limitation. ERS/AMS candidate downloads, crop/region matching, money-year alignment, satellite download/QA and engine integration are unfinished work—not a claim that the resources contain no data. Exact current local costs for every crop have not been established.
