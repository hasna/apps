-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_owned_entity BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type TEXT CHECK(entity_type IN ('operating','holding','dissolved','nonprofit','trust','branch','other'));

  ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS start_date TEXT;
  ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS end_date TEXT;
  ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','ended'));

  CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    title TEXT,
    specialization TEXT,
    office_phone TEXT,
    response_sla_hours INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, contact_id)
  );

  CREATE TABLE IF NOT EXISTS vendor_communications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    comm_date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'email' CHECK(type IN ('email','call','meeting','invoice_request','invoice_received','payment','dispute','other')),
    direction TEXT NOT NULL DEFAULT 'outbound' CHECK(direction IN ('inbound','outbound')),
    subject TEXT,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','awaiting_response','responded','no_response','resolved')),
    invoice_amount DOUBLE PRECISION,
    invoice_currency TEXT,
    invoice_ref TEXT,
    follow_up_date TEXT,
    follow_up_done BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    assigned_by TEXT,
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','awaiting_response','in_progress','completed','cancelled','escalated')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
    entity_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    linked_todos_task_id TEXT,
    escalation_rules TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    program_name TEXT NOT NULL,
    provider_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'other' CHECK(type IN ('ai_credits','grant','startup_program','visa','trademark','tax_filing','loan','other')),
    value_usd DOUBLE PRECISION,
    applicant_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    primary_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','pending','approved','rejected','follow_up_needed','expired','cancelled')),
    submitted_date TEXT,
    decision_date TEXT,
    follow_up_date TEXT,
    notes TEXT,
    method TEXT CHECK(method IN ('email','form','typeform','hubspot','manual','browser','feathery','other')),
    form_url TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE contact_notes ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE SET NULL;

  CREATE TABLE IF NOT EXISTS contact_embeddings (
    contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'tfidf',
    embedded_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (version) VALUES (6) ON CONFLICT DO NOTHING;
