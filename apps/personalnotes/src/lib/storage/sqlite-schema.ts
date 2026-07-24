// SQLite schema for the Personal Notes store.
//
// Migrations are additive and ledgered. NEVER edit a released migration's SQL —
// append a new one; the checksum ledger will reject an edited migration on open
// (hasna-storage-standard: idempotent + ledgered migrations, both engines).

import type { StorageMigration } from "./contract.js";
import { checksumStorageSql } from "./checksum.js";

export const SQLITE_MIGRATION_LEDGER_TABLE = "personalnotes_schema_migrations";

/**
 * Compatibility floor. A database whose `user_version` is ABOVE the highest
 * migration index this binary knows about was written by a newer binary; we
 * refuse to open it read-write rather than silently corrupt it.
 */
export const SQLITE_USER_VERSION_KEY = "user_version";

function migration(id: string, sql: string): StorageMigration {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumStorageSql(sql) });
}

export const SQLITE_STORAGE_MIGRATIONS: readonly StorageMigration[] = Object.freeze([
  migration(
    "0001_init",
    `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  labels TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  folder TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'markdown',
  title_locked INTEGER NOT NULL DEFAULT 0,
  title_source TEXT NOT NULL DEFAULT 'manual',
  title_content_fingerprint TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT '',
  created_by_actor_type TEXT NOT NULL DEFAULT 'human',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  trashed_at TEXT,
  trash_expires_at TEXT,
  restored_at TEXT
);
CREATE INDEX IF NOT EXISTS notes_tenant_updated_idx ON notes (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_tenant_status_idx ON notes (tenant_id, status);
CREATE INDEX IF NOT EXISTS notes_tenant_folder_idx ON notes (tenant_id, folder);

CREATE TABLE IF NOT EXISTS labels (
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT NOT NULL DEFAULT 'local',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
`,
  ),
]);
