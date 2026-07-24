// PostgreSQL schema for the Personal Notes store.
//
// Migrators can import this module WITHOUT pulling in the app or a live
// connection (hasna-storage-standard). The migration list mirrors the SQLite
// schema logically; dialect differences (JSONB, BOOLEAN, TIMESTAMPTZ) are
// expected. NEVER edit a released migration — append a new one.

import type { StorageMigration } from "./contract.js";
import { checksumStorageSql } from "./checksum.js";

export { checksumStorageSql };

export const POSTGRES_MIGRATION_LEDGER_TABLE = "personalnotes_schema_migrations";

/**
 * Transaction-scoped advisory lock so concurrent migrators serialize. The two
 * int4 keys are a fixed, arbitrary namespace for Personal Notes migrations.
 */
export const POSTGRES_MIGRATION_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(1347767636, 1398362962)";

function migration(id: string, sql: string): StorageMigration {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumStorageSql(sql) });
}

export const POSTGRES_STORAGE_MIGRATIONS: readonly StorageMigration[] = Object.freeze([
  migration(
    "0001_init",
    `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  folder TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'markdown',
  title_locked BOOLEAN NOT NULL DEFAULT FALSE,
  title_source TEXT NOT NULL DEFAULT 'manual',
  title_content_fingerprint TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT '',
  created_by_actor_type TEXT NOT NULL DEFAULT 'human',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ,
  trashed_at TIMESTAMPTZ,
  trash_expires_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notes_tenant_updated_idx ON notes (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_tenant_status_idx ON notes (tenant_id, status);
CREATE INDEX IF NOT EXISTS notes_tenant_folder_idx ON notes (tenant_id, folder);

CREATE TABLE IF NOT EXISTS labels (
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT NOT NULL DEFAULT 'local',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
`,
  ),
]);
