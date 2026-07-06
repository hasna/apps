-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK(sensitivity IN ('normal','confidential','restricted'));

  CREATE TABLE IF NOT EXISTS contact_documents (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL,
    label TEXT,
    encrypted_value TEXT NOT NULL,
    iv TEXT NOT NULL,
    encrypted_file_path TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    expires_at TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_health (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
    blood_type TEXT,
    allergies TEXT NOT NULL DEFAULT '[]',
    medical_conditions TEXT NOT NULL DEFAULT '[]',
    medications TEXT NOT NULL DEFAULT '[]',
    emergency_contacts TEXT NOT NULL DEFAULT '[]',
    health_insurance_provider TEXT,
    health_insurance_id TEXT,
    primary_physician TEXT,
    primary_physician_phone TEXT,
    organ_donor BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (version) VALUES (9) ON CONFLICT DO NOTHING;
