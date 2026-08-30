-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent and forward-only: retains deletion metadata for remote sync.

CREATE TABLE IF NOT EXISTS _contacts_tombstones (
  table_name TEXT NOT NULL CHECK(table_name IN ('contacts','companies','tags')),
  row_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT,
  reason TEXT,
  PRIMARY KEY (table_name, row_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_tombstones_deleted_at ON _contacts_tombstones(deleted_at);

INSERT INTO _migrations (version) VALUES (12) ON CONFLICT DO NOTHING;
