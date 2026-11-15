-- FarmLine D1 schema. Apply with:
--   npx wrangler d1 execute farmline --remote --file=db/schema.sql

-- Farmers who texted FarmLine. Phone numbers are only used to send the drought alerts they asked for.
CREATE TABLE IF NOT EXISTS farmers (
  phone       TEXT PRIMARY KEY,
  lang        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  place       TEXT NOT NULL,      -- name shown in replies (Urdu script for Urdu farmers)
  country     TEXT NOT NULL,
  crop        TEXT,
  alerts      INTEGER NOT NULL DEFAULT 0,  -- 1 after the farmer replies ALERT
  last_alert  TEXT,               -- ISO time of the last drought alert sent
  updated_at  TEXT NOT NULL
);

-- Every answered question, with no phone number: feeds the public live dashboard.
CREATE TABLE IF NOT EXISTS queries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  channel   TEXT NOT NULL,        -- sms | call | alert
  lang      TEXT NOT NULL,
  place     TEXT NOT NULL,
  country   TEXT NOT NULL,
  crop      TEXT,
  rain_pct  INTEGER,              -- last-30-day rain as % of normal
  lat       REAL,                 -- rounded to 0.1 degree (about 10 km): enough for the map, not a farm address
  lon       REAL
);
CREATE INDEX IF NOT EXISTS queries_ts ON queries (ts);

-- Admin conversation log: one row per exchange (what the farmer sent, what FarmLine replied, and how the answer was made).
-- Holds phone numbers, so it is only shown on /admin, behind the Auth0 login.
CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  phone     TEXT NOT NULL,
  channel   TEXT NOT NULL,        -- sms | call | alert
  lang      TEXT NOT NULL,
  inbound   TEXT,                 -- the farmer's words (null for alerts FarmLine sends on its own)
  outbound  TEXT NOT NULL,        -- the reply exactly as sent
  outcome   TEXT NOT NULL,        -- plans | weather | details | alerts_on | help | not_found | no_session | need_place | busy | alert
  place     TEXT,
  country   TEXT,
  crop      TEXT,
  trace     TEXT                  -- JSON: language detected, how the farm was found, NASA numbers, engine result, translation
);
CREATE INDEX IF NOT EXISTS messages_phone ON messages (phone, ts);
CREATE INDEX IF NOT EXISTS messages_ts ON messages (ts);
