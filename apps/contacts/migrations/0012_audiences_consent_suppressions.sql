-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

CREATE TABLE IF NOT EXISTS audiences (
    id TEXT PRIMARY KEY,
    audience_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    match TEXT NOT NULL DEFAULT 'all' CHECK(match IN ('all','any')),
    predicates TEXT NOT NULL DEFAULT '[]',
    consent_policy TEXT NOT NULL DEFAULT 'opt_in' CHECK(consent_policy IN ('opt_in','opt_out','transactional','none')),
    suppression_synced_at TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_consent (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('email','telegram','sms')),
    status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('opt_in','opt_out','unknown')),
    source TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contact_id, channel)
  );

  CREATE TABLE IF NOT EXISTS contact_suppressions (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('email','telegram','sms')),
    address TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ,
    UNIQUE(channel, address)
  );

  CREATE INDEX IF NOT EXISTS idx_contact_suppressions_unsynced ON contact_suppressions(channel) WHERE synced_at IS NULL;

  INSERT INTO _migrations (version) VALUES (11) ON CONFLICT DO NOTHING;
