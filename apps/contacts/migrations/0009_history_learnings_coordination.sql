-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

CREATE TABLE IF NOT EXISTS contact_field_history (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT,
    confidence TEXT NOT NULL DEFAULT 'imported' CHECK(confidence IN ('verified','inferred','imported','stale')),
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS job_history (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    company_name TEXT NOT NULL,
    title TEXT,
    start_date TEXT,
    end_date TEXT,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    inferred BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_learnings (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'fact' CHECK(type IN ('preference','fact','inference','warning','signal')),
    confidence INTEGER NOT NULL DEFAULT 70 CHECK(confidence BETWEEN 0 AND 100),
    importance INTEGER NOT NULL DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
    learned_by TEXT,
    session_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('private','shared','human')),
    tags TEXT NOT NULL DEFAULT '[]',
    confirmed_count INTEGER NOT NULL DEFAULT 0,
    contradicts_id TEXT REFERENCES contact_learnings(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_locks (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    reason TEXT,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    session_id TEXT
  );

  CREATE TABLE IF NOT EXISTS contact_agent_activity (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE contact_relationships ADD COLUMN IF NOT EXISTS strength_score INTEGER NOT NULL DEFAULT 50;
  ALTER TABLE contact_relationships ADD COLUMN IF NOT EXISTS interaction_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contact_relationships ADD COLUMN IF NOT EXISTS last_interaction TEXT;
  ALTER TABLE contact_relationships ADD COLUMN IF NOT EXISTS relationship_status TEXT NOT NULL DEFAULT 'stable' CHECK(relationship_status IN ('warming','stable','cooling','ghost'));

  CREATE TABLE IF NOT EXISTS contact_identities (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    system TEXT NOT NULL,
    external_id TEXT NOT NULL,
    external_url TEXT,
    confidence TEXT NOT NULL DEFAULT 'inferred' CHECK(confidence IN ('verified','inferred')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(system, external_id)
  );
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS canonical_id TEXT;

  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relationship_health INTEGER NOT NULL DEFAULT 50;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avg_response_hours DOUBLE PRECISION;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_channel TEXT;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_status TEXT NOT NULL DEFAULT 'new' CHECK(engagement_status IN ('warming','stable','cooling','ghost','new'));
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS interaction_count_30d INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS interaction_count_90d INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS contact_field_confidence (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'imported' CHECK(confidence IN ('verified','inferred','imported','stale')),
    source TEXT,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(contact_id, field_name)
  );

  CREATE TABLE IF NOT EXISTS org_chart_edges (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_a_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contact_b_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL CHECK(edge_type IN ('reports_to','manages','collaborates_with','peer')),
    inferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, contact_a_id, contact_b_id, edge_type)
  );

  CREATE TABLE IF NOT EXISTS deal_contact_roles (
    id TEXT PRIMARY KEY,
    deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    account_role TEXT NOT NULL CHECK(account_role IN ('economic_buyer','technical_evaluator','champion','blocker','influencer','user','sponsor','other')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(deal_id, contact_id)
  );

  INSERT INTO _migrations (version) VALUES (8) ON CONFLICT DO NOTHING;
