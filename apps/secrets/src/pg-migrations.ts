/**
 * PostgreSQL migrations for open-secrets cloud sync.
 *
 * Equivalent to the SQLite schema in db.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
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

  // Migration 2: audit_log table
  `CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    key TEXT NOT NULL,
    agent TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`,

  // Migration 3: users table
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'human',
    registered_at TEXT NOT NULL,
    last_seen TEXT
  )`,

  // Migration 4: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 5: local migration metadata markers
  `CREATE TABLE IF NOT EXISTS migration_metadata (
    key TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    migrated_at TEXT NOT NULL,
    imported_secrets INTEGER NOT NULL DEFAULT 0,
    imported_audit_entries INTEGER NOT NULL DEFAULT 0
  )`,
];
