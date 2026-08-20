/**
 * PostgreSQL migrations for cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 *
 * RECONSTRUCTION (2026-08-20): instantiated from the `pgMigrationsTs`
 * scaffold generator embedded in the published @hasna/agency@0.3.1 bundle.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: agents table
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
];
