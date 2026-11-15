# Datasets FarmLine uses

One row per dataset that is actually fetched and used. Both slices add rows (append at the
end of the table). The Space Apps submission lists these.

| Dataset | Owner | What it does in FarmLine | How we get it | Script | Accessed |
|---|---|---|---|---|---|
| NASA POWER (daily agroclimatology) | NASA | 25 years of daily temperature, rain, sunshine, humidity and wind at the field; drives the water balance and the 25-year stress test | REST API, no key: `power.larc.nasa.gov/api/temporal/daily/point` | `pipeline/weather.py` | 2026-11-14 |
| SSURGO (Soil Survey Geographic Database) | USDA NRCS | The field's soil: how much water it holds (the size of the water bucket), salinity (cuts the yield of salt-sensitive crops), slope, drainage, texture | Soil Data Access REST service, no key: `sdmdataaccess.sc.egov.usda.gov` | `pipeline/soil.py` | 2026-11-14 |
| USGS National Water Information System (NWIS) | USGS | Daily Carson River flow above Lahontan Reservoir (gauge 10312000), 2001-2025; independent evidence of drought years, checked against the allocation cuts | REST API, no key: `waterservices.usgs.gov/nwis/dv` | `pipeline/water_data.py` | 2026-11-14 |
| Newlands Project water allocations | Truckee-Carson Irrigation District (TCID), via press reports and board minutes; duty from the Alpine decree / 43 CFR 418 | The share of their water right Fallon farmers were allowed each year (e.g. 20% in 2015, 70% in 2021); caps irrigation in the water balance and drives the 2021 hindcast | Hand-collected, one cited source per year, in the script | `pipeline/water_data.py` | 2026-11-14 |
