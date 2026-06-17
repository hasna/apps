/**
 * PostgreSQL migrations for open-signatures cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: projects table
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: collections table
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 3: tags table
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 4: documents table
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    status TEXT NOT NULL DEFAULT 'draft',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 5: document_tags join table
  `CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
  )`,

  // Migration 6: signatures table
  `CREATE TABLE IF NOT EXISTS signatures (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    font_family TEXT,
    font_size INTEGER NOT NULL DEFAULT 48,
    color TEXT NOT NULL DEFAULT '#000000',
    text_value TEXT,
    image_path TEXT,
    image_prompt TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: signature_fields table
  `CREATE TABLE IF NOT EXISTS signature_fields (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL,
    height REAL,
    unit TEXT NOT NULL DEFAULT 'percent',
    anchor TEXT,
    field_type TEXT NOT NULL DEFAULT 'signature',
    label TEXT,
    required BOOLEAN NOT NULL DEFAULT TRUE,
    detected BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_to TEXT,
    signer_type TEXT NOT NULL DEFAULT 'human',
    role TEXT,
    signing_order INTEGER NOT NULL DEFAULT 1,
    parallel_group INTEGER NOT NULL DEFAULT 1,
    recipient_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 8: signature_placements table
  `CREATE TABLE IF NOT EXISTS signature_placements (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signature_id TEXT NOT NULL REFERENCES signatures(id) ON DELETE CASCADE,
    field_id TEXT REFERENCES signature_fields(id) ON DELETE SET NULL,
    page INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL,
    height REAL,
    signed_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 9: signing_sessions table
  `CREATE TABLE IF NOT EXISTS signing_sessions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    person_id TEXT,
    signer_name TEXT,
    signer_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    token TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL DEFAULT 'local',
    connector_name TEXT,
    metadata TEXT,
    signing_url TEXT,
    attachment_id TEXT,
    share_link TEXT,
    share_expires_at TEXT,
    signed_document_path TEXT,
    certificate_path TEXT,
    completed_at TEXT,
    signature_level TEXT NOT NULL DEFAULT 'ses',
    assurance_level TEXT,
    provider_status TEXT,
    validation_status TEXT,
    signer_type TEXT NOT NULL DEFAULT 'human',
    agent_id TEXT,
    agent_provider TEXT,
    agent_run_id TEXT,
    agent_thread_id TEXT,
    agent_policy_id TEXT,
    agent_reason TEXT,
    agent_input_hash TEXT,
    agent_output_hash TEXT,
    field_id TEXT,
    role TEXT,
    signing_order INTEGER NOT NULL DEFAULT 1,
    parallel_group INTEGER NOT NULL DEFAULT 1,
    recipient_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS signature_level TEXT NOT NULL DEFAULT 'ses'`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS assurance_level TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS provider_status TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS validation_status TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS signer_type TEXT NOT NULL DEFAULT 'human'`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_id TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_provider TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_run_id TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_thread_id TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_policy_id TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_reason TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_input_hash TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS agent_output_hash TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS field_id TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS role TEXT`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS signing_order INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS parallel_group INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS recipient_status TEXT NOT NULL DEFAULT 'pending'`,

  `ALTER TABLE signature_fields ADD COLUMN IF NOT EXISTS signer_type TEXT NOT NULL DEFAULT 'human'`,
  `ALTER TABLE signature_fields ADD COLUMN IF NOT EXISTS role TEXT`,
  `ALTER TABLE signature_fields ADD COLUMN IF NOT EXISTS signing_order INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE signature_fields ADD COLUMN IF NOT EXISTS parallel_group INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE signature_fields ADD COLUMN IF NOT EXISTS recipient_status TEXT NOT NULL DEFAULT 'pending'`,

  // Migration 10: settings table
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 11: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    company TEXT,
    role TEXT,
    signer_type TEXT NOT NULL DEFAULT 'human',
    agent_id TEXT,
    agent_provider TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `ALTER TABLE people ADD COLUMN IF NOT EXISTS signer_type TEXT NOT NULL DEFAULT 'human'`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS agent_id TEXT`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS agent_provider TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS people_agent_id_unique ON people(agent_id) WHERE agent_id IS NOT NULL AND agent_id <> ''`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES signing_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message TEXT,
    actor_name TEXT,
    actor_email TEXT,
    actor_signer_type TEXT,
    actor_agent_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_signer_type TEXT`,
  `ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_agent_id TEXT`,

  `CREATE TABLE IF NOT EXISTS signing_certificates (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES signing_sessions(id) ON DELETE CASCADE,
    certificate_path TEXT NOT NULL,
    original_document_hash TEXT,
    signed_document_hash TEXT,
    verification_code TEXT NOT NULL UNIQUE,
    metadata TEXT,
    issued_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS provider_evidence (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES signing_sessions(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    connector_slug TEXT,
    operation TEXT,
    signature_level TEXT NOT NULL DEFAULT 'ses',
    signer_type TEXT,
    recipient_role TEXT,
    status TEXT NOT NULL DEFAULT 'prepared',
    validation_status TEXT NOT NULL DEFAULT 'pending',
    remote_document_id TEXT,
    remote_status TEXT,
    request TEXT,
    response TEXT,
    evidence TEXT,
    original_document_hash TEXT,
    signed_document_hash TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS provider_evidence_document_idx ON provider_evidence(document_id)`,
  `CREATE INDEX IF NOT EXISTS provider_evidence_session_idx ON provider_evidence(session_id)`,
  `ALTER TABLE provider_evidence ADD COLUMN IF NOT EXISTS signer_type TEXT`,
  `ALTER TABLE provider_evidence ADD COLUMN IF NOT EXISTS recipient_role TEXT`,
  `ALTER TABLE provider_evidence ALTER COLUMN signature_level SET DEFAULT 'ses'`,
  `UPDATE provider_evidence SET signature_level = 'ses' WHERE signature_level = 'provider' OR signature_level IS NULL`,
];
