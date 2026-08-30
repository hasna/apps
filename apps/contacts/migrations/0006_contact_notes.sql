-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

CREATE TABLE IF NOT EXISTS contact_notes (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id);

  INSERT INTO _migrations (version) VALUES (5) ON CONFLICT DO NOTHING;
