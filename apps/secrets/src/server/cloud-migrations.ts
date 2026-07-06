/**
 * Cloud (PURE REMOTE) schema for the secrets service.
 *
 * The application tables mirror the local SQLite schema (db.ts) translated for
 * Postgres, plus the shared `api_keys` table from @hasna/contracts/auth. All
 * migrations are checksummed and run through the vendored kit's MigrationLedger
 * (drift + downgrade guards). Values are stored encrypted at rest (see
 * cloud-crypto.ts); the DB never sees plaintext secrets.
 */

import { apiKeyMigrations } from "@hasna/contracts/auth";
import { defineMigration, type Migration } from "../generated/storage-kit/index.js";

/** Canonical ordered app migrations. Never reorder or rewrite an applied one. */
export const SECRETS_APP_MIGRATIONS: Migration[] = [
  defineMigration(
    "secrets_0001_secrets",
    `CREATE TABLE IF NOT EXISTS secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      label TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ),
  defineMigration(
    "secrets_0002_vault_items",
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
  ),
  defineMigration(
    "secrets_0003_vault_items_indexes",
    `CREATE INDEX IF NOT EXISTS idx_vault_items_kind ON vault_items(kind);
     CREATE INDEX IF NOT EXISTS idx_vault_items_title ON vault_items(title);`,
  ),
  defineMigration(
    "secrets_0004_audit_log",
    `CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      key TEXT NOT NULL,
      agent TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )`,
  ),
  defineMigration(
    "secrets_0005_users",
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'human',
      registered_at TEXT NOT NULL,
      last_seen TEXT
    )`,
  ),
  defineMigration(
    "secrets_0006_feedback",
    `CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL
    )`,
  ),
];

/** api_keys table (hashed-at-rest issued keys) from the auth kit. */
export const SECRETS_AUTH_MIGRATIONS: Migration[] = apiKeyMigrations().map((m) =>
  defineMigration(m.id, m.sql),
);

/** Full ordered migration set for the secrets cloud database. */
export const SECRETS_MIGRATIONS: Migration[] = [
  ...SECRETS_APP_MIGRATIONS,
  ...SECRETS_AUTH_MIGRATIONS,
];
