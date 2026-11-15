-- Adds map coordinates to the question log (run once on a database created before this change):
--   npx wrangler d1 execute farmline --remote --file=db/migrate_002_map.sql
ALTER TABLE queries ADD COLUMN lat REAL;
ALTER TABLE queries ADD COLUMN lon REAL;
