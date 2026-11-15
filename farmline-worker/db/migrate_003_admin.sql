-- Adds the admin conversation log (run once on a database created before this change):
--   npx wrangler d1 execute farmline --remote --file=db/migrate_003_admin.sql
CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  phone     TEXT NOT NULL,
  channel   TEXT NOT NULL,
  lang      TEXT NOT NULL,
  inbound   TEXT,
  outbound  TEXT NOT NULL,
  outcome   TEXT NOT NULL,
  place     TEXT,
  country   TEXT,
  crop      TEXT,
  trace     TEXT
);
CREATE INDEX IF NOT EXISTS messages_phone ON messages (phone, ts);
CREATE INDEX IF NOT EXISTS messages_ts ON messages (ts);
