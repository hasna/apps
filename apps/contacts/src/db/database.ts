import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function getDbPath(): string {
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  const home = process.env["HOME"] || "~";
  return join(home, ".contacts", "contacts.db");
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
    job_title,
    content='contacts',
    content_rowid='rowid'
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
