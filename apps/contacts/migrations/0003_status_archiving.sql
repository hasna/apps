-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS follow_up_at TEXT;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS project_id TEXT;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS project_id TEXT;

  CREATE TABLE IF NOT EXISTS company_groups (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, group_id)
  );

  INSERT INTO _migrations (version) VALUES (2) ON CONFLICT DO NOTHING;
