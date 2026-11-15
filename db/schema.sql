-- FarmLine on Tiger Data (TimescaleDB). Safe to run again: every statement is "if not exists".
-- pipeline/tiger.py runs these one at a time, outside a transaction, because a continuous
-- aggregate cannot be created inside one. Keep one statement per ";" at the end of a line.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- One row per field; the soil survey and the water rules are kept whole as JSON.
CREATE TABLE IF NOT EXISTS fields (
    field_id    text PRIMARY KEY,
    name        text NOT NULL,
    place       text NOT NULL,
    country     text NOT NULL,
    lat         double precision NOT NULL,
    lon         double precision NOT NULL,
    provenance  text NOT NULL,
    soil        jsonb NOT NULL,
    water       jsonb NOT NULL,
    loaded_at   timestamptz NOT NULL DEFAULT now()
);

-- What grew on the field each year (USDA Cropland Data Layer).
CREATE TABLE IF NOT EXISTS crop_history (
    field_id  text NOT NULL REFERENCES fields ON DELETE CASCADE,
    year      integer NOT NULL,
    cdl_code  integer,
    crop      text,
    category  text,
    source    text,
    PRIMARY KEY (field_id, year)
);

-- Daily weather (NASA POWER): the series the water balance runs on.
CREATE TABLE IF NOT EXISTS weather_daily (
    field_id   text NOT NULL,
    day        date NOT NULL,
    tmax_c     double precision,
    tmin_c     double precision,
    tmean_c    double precision,
    precip_mm  double precision,
    solar_mj   double precision,
    rh_pct     double precision,
    wind_ms    double precision,
    PRIMARY KEY (field_id, day)
);

SELECT create_hypertable('weather_daily', by_range('day', INTERVAL '1 year'), if_not_exists => TRUE);

-- Satellite observations in long form: one row per time, source and variable (OpenET today;
-- SMAP, IMERG and HLS land here too).
CREATE TABLE IF NOT EXISTS satellite_obs (
    field_id     text NOT NULL,
    observed_at  timestamptz NOT NULL,
    source       text NOT NULL,
    variable     text NOT NULL,
    value        double precision NOT NULL,
    PRIMARY KEY (field_id, observed_at, source, variable)
);

SELECT create_hypertable('satellite_obs', by_range('observed_at', INTERVAL '1 year'), if_not_exists => TRUE);

-- Daily river flow at the field's gauge (USGS NWIS): the independent drought record.
CREATE TABLE IF NOT EXISTS river_flow_daily (
    field_id    text NOT NULL,
    day         date NOT NULL,
    flow_cfs    double precision,
    qualifiers  text,
    PRIMARY KEY (field_id, day)
);

SELECT create_hypertable('river_flow_daily', by_range('day', INTERVAL '1 year'), if_not_exists => TRUE);

-- The share of their water right farmers were allowed each year, one cited source per year.
CREATE TABLE IF NOT EXISTS water_allocations (
    field_id  text NOT NULL REFERENCES fields ON DELETE CASCADE,
    year      integer NOT NULL,
    fraction  double precision NOT NULL,
    note      text,
    source    text,
    PRIMARY KEY (field_id, year)
);

-- Yields and prices by crop and region (USDA NASS; some rows are labelled regional proxies).
CREATE TABLE IF NOT EXISTS county_yields (
    crop            text NOT NULL,
    region          text NOT NULL,
    yield_per_acre  double precision,
    unit            text,
    source          text,
    PRIMARY KEY (crop, region)
);

CREATE TABLE IF NOT EXISTS crop_prices (
    crop                text NOT NULL,
    region              text NOT NULL,
    price_usd_per_unit  double precision,
    unit                text,
    cost_usd_per_acre   double precision,
    source_price        text,
    source_cost         text,
    PRIMARY KEY (crop, region)
);

-- Farmer questions and the plans sent back (written by the worker; never a phone number).
CREATE TABLE IF NOT EXISTS requests (
    requested_at  timestamptz NOT NULL DEFAULT now(),
    request_id    text NOT NULL,
    field_id      text,
    language      text,
    current_crop  text,
    priorities    jsonb,
    result        jsonb,
    PRIMARY KEY (request_id, requested_at)
);

SELECT create_hypertable('requests', by_range('requested_at', INTERVAL '1 month'), if_not_exists => TRUE);

-- Monthly weather for the dashboard, kept up to date by TimescaleDB.
CREATE MATERIALIZED VIEW IF NOT EXISTS weather_monthly
WITH (timescaledb.continuous) AS
SELECT field_id,
       time_bucket(INTERVAL '1 month', day) AS month,
       avg(tmean_c)   AS tmean_c,
       max(tmax_c)    AS tmax_c,
       min(tmin_c)    AS tmin_c,
       sum(precip_mm) AS precip_mm,
       count(*)       AS days
FROM weather_daily
GROUP BY field_id, time_bucket(INTERVAL '1 month', day)
WITH NO DATA;
