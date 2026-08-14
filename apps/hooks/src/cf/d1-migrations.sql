-- D1 schema for the hooks registry worker.
-- Mirrors the SQLite migration 004_hooks_table (D1-compatible subset).

CREATE TABLE IF NOT EXISTS hooks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  version          TEXT NOT NULL,
  sha256           TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  source_ref       TEXT,
  installed_at     TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hooks_name ON hooks (name);
