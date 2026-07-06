-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

CREATE TABLE IF NOT EXISTS company_relationships (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN ('client','vendor','partner','employee','contractor','investor','advisor','other')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_company_relationships_contact ON company_relationships(contact_id);
  CREATE INDEX IF NOT EXISTS idx_company_relationships_company ON company_relationships(company_id);

  INSERT INTO _migrations (version) VALUES (3) ON CONFLICT DO NOTHING;
