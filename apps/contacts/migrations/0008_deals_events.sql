-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5);
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS timezone TEXT;

  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    stage TEXT NOT NULL DEFAULT 'lead' CHECK(stage IN ('lead','qualified','proposal','negotiation','won','lost','cancelled')),
    value_usd DOUBLE PRECISION,
    currency TEXT NOT NULL DEFAULT 'USD',
    close_date TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'meeting' CHECK(type IN ('meeting','call','lunch','email','demo','conference','intro','other')),
    event_date TEXT NOT NULL,
    duration_min INTEGER,
    contact_ids TEXT NOT NULL DEFAULT '[]',
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    notes TEXT,
    outcome TEXT,
    deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (version) VALUES (7) ON CONFLICT DO NOTHING;
