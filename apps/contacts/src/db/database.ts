import { SqliteAdapter as Database } from "@hasna/cloud";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newDir = join(home, ".hasna", "contacts");
  const oldDir = join(home, ".contacts");

  // Auto-migrate old dir to new location
  if (existsSync(oldDir) && !existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file);
      if (statSync(oldPath).isFile()) {
        copyFileSync(oldPath, join(newDir, file));
      }
    }
  }

  mkdirSync(newDir, { recursive: true });
  return newDir;
}

export function getDbPath(): string {
  if (process.env["HASNA_CONTACTS_DB_PATH"]) return process.env["HASNA_CONTACTS_DB_PATH"];
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  return join(getDataDir(), "contacts.db");
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    logo_url TEXT,
    description TEXT,
    industry TEXT,
    size TEXT,
    founded_year INTEGER,
    notes TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    notes TEXT,
    birthday TEXT,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    job_title TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_tags (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS company_tags (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'work' CHECK(type IN ('work','personal','other')),
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS phones (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    country_code TEXT,
    type TEXT NOT NULL DEFAULT 'mobile' CHECK(type IN ('mobile','work','home','fax','whatsapp','other')),
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'physical' CHECK(type IN ('physical','mailing','billing','virtual','other')),
    street TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS social_profiles (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('twitter','linkedin','github','instagram','telegram','discord','youtube','tiktok','bluesky','facebook','whatsapp','snapchat','reddit','other')),
    handle TEXT,
    url TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_relationships (
    id TEXT PRIMARY KEY,
    contact_a_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contact_b_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN ('colleague','friend','family','reports_to','mentor','investor','partner','client','vendor','other')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["*"]',
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
    id UNINDEXED,
    display_name,
    first_name,
    last_name,
    nickname,
    notes,
    job_title
  );

  CREATE TRIGGER IF NOT EXISTS contacts_fts_insert AFTER INSERT ON contacts BEGIN
    INSERT INTO contacts_fts(rowid, id, display_name, first_name, last_name, nickname, notes, job_title)
    VALUES (new.rowid, new.id, new.display_name, new.first_name, new.last_name, new.nickname, new.notes, new.job_title);
  END;

  CREATE TRIGGER IF NOT EXISTS contacts_fts_update AFTER UPDATE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE rowid = old.rowid;
    INSERT INTO contacts_fts(rowid, id, display_name, first_name, last_name, nickname, notes, job_title)
    VALUES (new.rowid, new.id, new.display_name, new.first_name, new.last_name, new.nickname, new.notes, new.job_title);
  END;

  CREATE TRIGGER IF NOT EXISTS contacts_fts_delete AFTER DELETE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE rowid = old.rowid;
  END;

  CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY);
  `,

  `
  ALTER TABLE contacts ADD COLUMN last_contacted_at TEXT;
  ALTER TABLE contacts ADD COLUMN website TEXT;
  ALTER TABLE contacts ADD COLUMN preferred_contact_method TEXT;

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_groups (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, group_id)
  );
  `,

  `
  ALTER TABLE contacts ADD COLUMN status TEXT DEFAULT 'active';
  ALTER TABLE contacts ADD COLUMN follow_up_at TEXT;
  ALTER TABLE contacts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN project_id TEXT;
  ALTER TABLE companies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE companies ADD COLUMN project_id TEXT;

  CREATE TABLE IF NOT EXISTS company_groups (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, group_id)
  );
  `,

  `
  CREATE TABLE IF NOT EXISTS company_relationships (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN ('client','vendor','partner','employee','contractor','investor','advisor','other')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_company_relationships_contact ON company_relationships(contact_id);
  CREATE INDEX IF NOT EXISTS idx_company_relationships_company ON company_relationships(company_id);
  `,

  `
  ALTER TABLE groups ADD COLUMN project_id TEXT;

  CREATE TABLE IF NOT EXISTS contact_projects (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    PRIMARY KEY (contact_id, project_id)
  );

  CREATE INDEX IF NOT EXISTS idx_contact_projects_project ON contact_projects(project_id);
  CREATE INDEX IF NOT EXISTS idx_contact_projects_contact ON contact_projects(contact_id);

  INSERT OR IGNORE INTO contact_projects (contact_id, project_id)
  SELECT id, project_id FROM contacts WHERE project_id IS NOT NULL;
  `,

  `
  CREATE TABLE IF NOT EXISTS contact_notes (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id);
  `,

  `
  ALTER TABLE companies ADD COLUMN is_owned_entity INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE companies ADD COLUMN entity_type TEXT CHECK(entity_type IN ('operating','holding','dissolved','nonprofit','trust','branch','other'));

  ALTER TABLE company_relationships ADD COLUMN start_date TEXT;
  ALTER TABLE company_relationships ADD COLUMN end_date TEXT;
  ALTER TABLE company_relationships ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE company_relationships ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','ended'));

  CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    title TEXT,
    specialization TEXT,
    office_phone TEXT,
    response_sla_hours INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    invoice_amount REAL,
    invoice_currency TEXT,
    invoice_ref TEXT,
    follow_up_date TEXT,
    follow_up_done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    program_name TEXT NOT NULL,
    provider_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'other' CHECK(type IN ('ai_credits','grant','startup_program','visa','trademark','tax_filing','loan','other')),
    value_usd REAL,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE contact_notes ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE SET NULL;
  `,

  `
  ALTER TABLE contacts ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5);
  ALTER TABLE contacts ADD COLUMN timezone TEXT;

  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    stage TEXT NOT NULL DEFAULT 'lead' CHECK(stage IN ('lead','qualified','proposal','negotiation','won','lost','cancelled')),
    value_usd REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    close_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  `
  -- CON-00069: temporal field history
  CREATE TABLE IF NOT EXISTS contact_field_history (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    valid_from TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT,
    confidence TEXT NOT NULL DEFAULT 'imported' CHECK(confidence IN ('verified','inferred','imported','stale')),
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- CON-00070: job history
  CREATE TABLE IF NOT EXISTS job_history (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    company_name TEXT NOT NULL,
    title TEXT,
    start_date TEXT,
    end_date TEXT,
    is_current INTEGER NOT NULL DEFAULT 0,
    inferred INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- CON-00071: learnings
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- CON-00072: coordination
  CREATE TABLE IF NOT EXISTS contact_locks (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    reason TEXT,
    acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    session_id TEXT
  );
  CREATE TABLE IF NOT EXISTS contact_agent_activity (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- CON-00073: relationship graph extra columns
  ALTER TABLE contact_relationships ADD COLUMN strength_score INTEGER NOT NULL DEFAULT 50;
  ALTER TABLE contact_relationships ADD COLUMN interaction_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contact_relationships ADD COLUMN last_interaction TEXT;
  ALTER TABLE contact_relationships ADD COLUMN relationship_status TEXT NOT NULL DEFAULT 'stable' CHECK(relationship_status IN ('warming','stable','cooling','ghost'));

  -- CON-00074: identity resolution
  CREATE TABLE IF NOT EXISTS contact_identities (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    system TEXT NOT NULL,
    external_id TEXT NOT NULL,
    external_url TEXT,
    confidence TEXT NOT NULL DEFAULT 'inferred' CHECK(confidence IN ('verified','inferred')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(system, external_id)
  );
  ALTER TABLE contacts ADD COLUMN canonical_id TEXT;

  -- CON-00076: relationship signals
  ALTER TABLE contacts ADD COLUMN relationship_health INTEGER NOT NULL DEFAULT 50;
  ALTER TABLE contacts ADD COLUMN avg_response_hours REAL;
  ALTER TABLE contacts ADD COLUMN preferred_channel TEXT;
  ALTER TABLE contacts ADD COLUMN engagement_status TEXT NOT NULL DEFAULT 'new' CHECK(engagement_status IN ('warming','stable','cooling','ghost','new'));
  ALTER TABLE contacts ADD COLUMN interaction_count_30d INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN interaction_count_90d INTEGER NOT NULL DEFAULT 0;

  -- CON-00079: freshness scoring
  CREATE TABLE IF NOT EXISTS contact_field_confidence (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'imported' CHECK(confidence IN ('verified','inferred','imported','stale')),
    source TEXT,
    last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(contact_id, field_name)
  );

  -- CON-00080: org chart
  CREATE TABLE IF NOT EXISTS org_chart_edges (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_a_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contact_b_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL CHECK(edge_type IN ('reports_to','manages','collaborates_with','peer')),
    inferred INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, contact_a_id, contact_b_id, edge_type)
  );
  CREATE TABLE IF NOT EXISTS deal_contact_roles (
    id TEXT PRIMARY KEY,
    deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    account_role TEXT NOT NULL CHECK(account_role IN ('economic_buyer','technical_evaluator','champion','blocker','influencer','user','sponsor','other')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(deal_id, contact_id)
  );

  -- CON-00075: embeddings
  CREATE TABLE IF NOT EXISTS contact_embeddings (
    contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'tfidf',
    embedded_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  `
  ALTER TABLE contacts ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK(sensitivity IN ('normal','confidential','restricted'));

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    organ_donor INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

let _db: Database | null = null;

export function getDatabase(path?: string): Database {
  if (_db) return _db;
  const dbPath = path || getDbPath();
  ensureDir(dbPath);
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  runMigrations(db);
  _db = db;
  return db;
}

export function resetDatabase(): void {
  _db = null;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

function runMigrations(db: Database): void {
  try {
    const row = db.query("SELECT MAX(version) as v FROM _migrations").get() as { v: number | null };
    const current = row?.v ?? -1;
    for (let i = current + 1; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]!);
      db.exec(`INSERT OR REPLACE INTO _migrations(version) VALUES(${i})`);
    }
  } catch {
    for (const m of MIGRATIONS) {
      try { db.exec(m); } catch {}
    }
    try { db.exec(`INSERT OR REPLACE INTO _migrations(version) VALUES(${MIGRATIONS.length - 1})`); } catch {}
  }
}
