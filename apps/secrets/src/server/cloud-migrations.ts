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
  defineMigration(
    "secrets_0013_secret_versions",
    `CREATE TABLE IF NOT EXISTS secret_versions (
       key               TEXT NOT NULL,
       version           INTEGER NOT NULL,
       value_blob        TEXT NOT NULL,
       value_hash        TEXT NOT NULL,
       value_length      INTEGER NOT NULL,
       change_kind       TEXT NOT NULL DEFAULT 'initial',
       reason            TEXT,
       label             TEXT,
       source_version    INTEGER,
       batch_id          TEXT,
       provider_expires_at TEXT,
       created_at        TEXT NOT NULL,
       created_by        TEXT NOT NULL,
       PRIMARY KEY (key, version)
     );
     CREATE INDEX IF NOT EXISTS idx_secret_versions_key ON secret_versions(key, version);`,
  ),
];

export const VAULT_MIGRATION_SCHEMA = defineMigration("secrets_0014_lossless_vault_migrations", `
ALTER TABLE secret_versions ADD COLUMN tenant_id UUID;
UPDATE secret_versions v SET tenant_id=s.tenant_id FROM secrets s WHERE s.key=v.key;
ALTER TABLE secret_versions ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.secrets_tenant_id',true),'')::uuid;
CREATE TABLE secret_key_owners (key TEXT PRIMARY KEY, tenant_id UUID REFERENCES tenants(id));
INSERT INTO secret_key_owners(key,tenant_id) SELECT key,tenant_id FROM secrets;
INSERT INTO secret_key_owners(key,tenant_id) SELECT DISTINCT key,tenant_id FROM secret_versions ON CONFLICT(key) DO NOTHING;
DO $migration$ BEGIN
EXECUTE format($definition$
CREATE FUNCTION claim_secret_key_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, %I, pg_temp AS $function$
DECLARE owner_tenant UUID;
BEGIN
 IF NEW.tenant_id IS NULL OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.secrets_tenant_id',true),'')::uuid THEN
  RAISE EXCEPTION 'secret key tenant authority required' USING ERRCODE='42501';
 END IF;
 INSERT INTO secret_key_owners(key,tenant_id) VALUES(NEW.key,NEW.tenant_id) ON CONFLICT(key) DO NOTHING;
 SELECT tenant_id INTO owner_tenant FROM secret_key_owners WHERE key=NEW.key FOR UPDATE;
 IF owner_tenant IS DISTINCT FROM NEW.tenant_id THEN
  RAISE EXCEPTION 'secret key identity conflict' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $function$;
$definition$, current_schema());
END $migration$;
CREATE TRIGGER secrets_key_owner BEFORE INSERT OR UPDATE OF key,tenant_id ON secrets FOR EACH ROW EXECUTE FUNCTION claim_secret_key_owner();
CREATE TRIGGER secret_versions_key_owner BEFORE INSERT OR UPDATE OF key,tenant_id ON secret_versions FOR EACH ROW EXECUTE FUNCTION claim_secret_key_owner();
CREATE TABLE vault_migrations (
 id UUID NOT NULL, tenant_id UUID NOT NULL REFERENCES tenants(id), source_id UUID NOT NULL,
 manifest TEXT NOT NULL CHECK (manifest LIKE 'enc:v1:%'), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE vault_migration_keys (
 tenant_id UUID NOT NULL, migration_id UUID NOT NULL, key TEXT NOT NULL,
 PRIMARY KEY(tenant_id,migration_id,key),
 FOREIGN KEY(tenant_id,migration_id) REFERENCES vault_migrations(tenant_id,id)
);
` + ["secrets","vault_items","users","feedback","audit_log","secret_versions","vault_migrations","vault_migration_keys"].map(table => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY secrets_tenant_boundary ON ${table}
 USING (tenant_id = nullif(current_setting('app.secrets_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = nullif(current_setting('app.secrets_tenant_id',true),'')::uuid);
`).join("\n"));

/** Full ordered migration set for the secrets cloud database. */
export const SECRETS_MIGRATIONS: Migration[] = [
  ...SECRETS_APP_MIGRATIONS,
  ...SECRETS_AUTH_MIGRATIONS,
  ...SECRETS_TENANCY_MIGRATIONS,
  VAULT_MIGRATION_SCHEMA,
];
