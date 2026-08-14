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

const ROOT_TENANT = "adfd95c7-ee8b-52cb-ae47-4ae65dae3313";

/** Tenant lineage already present in the production database. */
export const SECRETS_TENANCY_MIGRATIONS: Migration[] = [
  defineMigration(
    "secrets_0008_tenants",
    `CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'org',
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO tenants (id, slug, name, kind)
      VALUES ('${ROOT_TENANT}', 'hasna', 'Hasna Root', 'root')
      ON CONFLICT (id) DO NOTHING;`,
  ),
  defineMigration(
    "secrets_0009_memberships",
    `CREATE TABLE IF NOT EXISTS memberships (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL,
      principal_id TEXT NOT NULL,
      principal_type TEXT NOT NULL DEFAULT 'user',
      role TEXT NOT NULL DEFAULT 'member',
      scopes JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, principal_id, principal_type)
    );
    CREATE INDEX IF NOT EXISTS memberships_tenant_idx ON memberships (tenant_id);`,
  ),
  defineMigration(
    "secrets_0010_tenant_columns",
    `ALTER TABLE secrets      ADD COLUMN IF NOT EXISTS tenant_id UUID;
     ALTER TABLE vault_items  ADD COLUMN IF NOT EXISTS tenant_id UUID;
     ALTER TABLE users         ADD COLUMN IF NOT EXISTS tenant_id UUID;
     ALTER TABLE feedback      ADD COLUMN IF NOT EXISTS tenant_id UUID;
     ALTER TABLE audit_log     ADD COLUMN IF NOT EXISTS tenant_id UUID;
     ALTER TABLE audit_log     ADD COLUMN IF NOT EXISTS user_id   TEXT;`,
  ),
  defineMigration(
    "secrets_0011_api_key_tenant",
    `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id      UUID;
     ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id        TEXT;
     ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS principal_type TEXT;
     CREATE INDEX IF NOT EXISTS api_keys_kid_idx ON api_keys (kid);`,
  ),
  defineMigration(
    "secrets_0012_backfill",
    `UPDATE secrets      SET tenant_id = '${ROOT_TENANT}' WHERE tenant_id IS NULL;
     UPDATE vault_items  SET tenant_id = '${ROOT_TENANT}' WHERE tenant_id IS NULL;
     UPDATE users         SET tenant_id = '${ROOT_TENANT}' WHERE tenant_id IS NULL;
     UPDATE feedback      SET tenant_id = '${ROOT_TENANT}' WHERE tenant_id IS NULL;
     UPDATE audit_log     SET tenant_id = '${ROOT_TENANT}' WHERE tenant_id IS NULL;
     UPDATE api_keys      SET tenant_id = '${ROOT_TENANT}' WHERE tenant_id IS NULL;`,
  ),
];

/** Full ordered migration set for the secrets cloud database. */
export const SECRETS_MIGRATIONS: Migration[] = [
  ...SECRETS_APP_MIGRATIONS,
  ...SECRETS_AUTH_MIGRATIONS,
  ...SECRETS_TENANCY_MIGRATIONS,
];
