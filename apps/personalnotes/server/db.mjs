// PersonalNotes self-hosted server — SQLite storage layer (bun:sqlite).
// Single-file database, WAL mode, zero external services. Schema mirrors the
// hosted platform tables that are part of the personalnotes/v1 dialect
// (notes, note_events, sync_batches, api_keys, sessions, device/otp auth)
// plus the S2 superset: per-tenant monotonic `seq` and `purged_at`.

import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'self-hosted',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["full"]',
  created_by TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_login_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_auth_requests (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tenant_id TEXT,
  user_id TEXT,
  exchange_token_hash TEXT,
  api_key_id TEXT,
  approved_at TEXT,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT,
  slug TEXT,
  title TEXT NOT NULL DEFAULT 'Untitled',
  body_markdown TEXT NOT NULL DEFAULT '',
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  folder TEXT,
  labels TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  seq INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  agent_provenance_json TEXT NOT NULL DEFAULT '{}',
  deleted_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notes_tenant_client_id_uq
  ON notes (tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_tenant_seq_idx ON notes (tenant_id, seq);
CREATE INDEX IF NOT EXISTS notes_tenant_updated_idx ON notes (tenant_id, updated_at);

CREATE TABLE IF NOT EXISTS note_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  note_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied',
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_batches_tenant_idem_uq
  ON sync_batches (tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS seq_counters (
  tenant_id TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
`;

export function openDb(path) {
  if (path !== ':memory:') {
    // The database holds every tenant's note bodies, session rows, API-key
    // hashes, AND the persisted JWT signing secret (meta table) — it must
    // never be world-readable on a shared machine. Pre-create the file 0600
    // BEFORE SQLite touches it: SQLite copies the main DB file's mode onto
    // the -wal/-shm side files it creates, so they inherit the hardening.
    // The directory is created 0700 (mode applies to newly created dirs only;
    // an existing user-chosen directory is left alone).
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600));
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      try { chmodSync(file, 0o600); } catch { /* side file not created yet */ }
    }
  }
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

/** Per-tenant monotonic sequence (S2 dialect superset, gate doc GAP-5). */
export function nextSeq(db, tenantId) {
  const row = db
    .query(
      `INSERT INTO seq_counters (tenant_id, value) VALUES (?, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(tenantId);
  return row.value;
}

export function currentSeq(db, tenantId) {
  const row = db.query('SELECT value FROM seq_counters WHERE tenant_id = ?').get(tenantId);
  return row ? row.value : 0;
}

export function getMeta(db, key) {
  const row = db.query('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(db, key, value) {
  db.query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
