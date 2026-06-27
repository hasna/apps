/**
 * PostgreSQL migrations for open-secrets remote storage sync.
 *
 * Equivalent to the SQLite schema in db.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 0: UUID helper for feedback rows
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  // Migration 1: secrets table
  `CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    label TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Migration 2: structured vault items for browser autofill and secure notes
  `CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    domains TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    favorite INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_vault_items_kind ON vault_items(kind)`,

  `CREATE INDEX IF NOT EXISTS idx_vault_items_title ON vault_items(title)`,

  // Migration 5: audit_log table
  `CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    key TEXT NOT NULL,
    agent TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`,

  // Migration 6: users table
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'human',
    registered_at TEXT NOT NULL,
    last_seen TEXT
  )`,

  // Migration 7: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
