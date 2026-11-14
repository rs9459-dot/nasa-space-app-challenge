# Datasets FarmLine uses

One row per dataset that is actually fetched and used. Both slices add rows (append at the
end of the table). The Space Apps submission lists these.

| Dataset | Owner | What it does in FarmLine | How we get it | Script | Accessed |
|---|---|---|---|---|---|
| NASA POWER (daily agroclimatology) | NASA | 25 years of daily temperature, rain, sunshine, humidity and wind at the field; drives the water balance and the 25-year stress test | REST API, no key: `power.larc.nasa.gov/api/temporal/daily/point` | `pipeline/weather.py` | 2026-11-14 |
| SSURGO (Soil Survey Geographic Database) | USDA NRCS | The field's soil: how much water it holds (the size of the water bucket), salinity (cuts the yield of salt-sensitive crops), slope, drainage, texture | Soil Data Access REST service, no key: `sdmdataaccess.sc.egov.usda.gov` | `pipeline/soil.py` | 2026-11-14 |
