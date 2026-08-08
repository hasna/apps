/**
 * Ordered cloud (Postgres) migrations for the open-files self-hosted service.
 *
 * Combines the canonical data-plane schema (PG_MIGRATIONS) with the shared
 * @hasna/contracts api_keys migrations, wrapped in the vendored storage kit's
 * `defineMigration` so they run through the drift/downgrade-guarded
 * `MigrationLedger`.
 *
 * PURE REMOTE (Amendment A1): the service reads AND writes these tables in
 * cloud Postgres directly. There is no sync engine in the service.
 */
import { apiKeyMigrations } from "@hasna/contracts/auth";
import { defineMigration, type Migration } from "../generated/storage-kit/index.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

/** Data-plane schema, one ledger entry per statement, stable zero-padded ids. */
const dataMigrations: Migration[] = PG_MIGRATIONS.map((sql, index) =>
  defineMigration(`files-${String(index + 1).padStart(4, "0")}`, sql),
);

/**
 * The legacy production ledger ended its numeric lineage at files-0154, then
 * applied the contracts auth migrations and the tenancy bridge below. Keep
 * later numeric migrations after that immutable historical prefix.
 */
const LEGACY_NUMERIC_MIGRATION_COUNT = 154;

/** Shared api_keys table + indexes from @hasna/contracts. */
const authMigrations: Migration[] = apiKeyMigrations().map((m) =>
  defineMigration(m.id, m.sql),
);

/**
 * Immutable transitional kid→tenant bridge from the authoritative iapp-files
 * R1 lineage (7c92523, retained unchanged through 64782ab). These ids and SQL
 * may already exist in production schema_migrations and must remain recognized.
 */
const bridgeMigrations: Migration[] = [
  defineMigration(
    "files-tenancy-bridge-0001-api-keys-tenant-id",
    `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313'::uuid`,
  ),
  defineMigration(
    "files-tenancy-bridge-0002-api-keys-user-id",
    `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id UUID`,
  ),
  defineMigration(
    "files-tenancy-bridge-0003-api-keys-principal-type",
    `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS principal_type TEXT`,
  ),
  defineMigration(
    "files-tenancy-bridge-0004-api-keys-kid-idx",
    `CREATE INDEX IF NOT EXISTS api_keys_kid_tenant_idx ON api_keys (kid, tenant_id)`,
  ),
];

/**
 * Content-tenancy migrations must run after the contracts-owned api_keys
 * table exists. They deliberately populate only unambiguous single-tenant
 * installations; multi-tenant deployments must bind each key explicitly.
 */
export const FILE_CONTENT_TENANCY_MIGRATIONS: readonly Migration[] = [
  defineMigration(
    "files-content-tenant-0001-key-map",
    `CREATE TABLE IF NOT EXISTS api_key_tenants (
       kid TEXT PRIMARY KEY REFERENCES api_keys(kid) ON DELETE CASCADE,
       tenant_id TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );
     CREATE INDEX IF NOT EXISTS idx_api_key_tenants_tenant
       ON api_key_tenants(tenant_id);`,
  ),
  defineMigration(
    "files-content-tenant-0002-link-scoped-revisions",
    `WITH unique_scoped_objects AS (
       SELECT bucket, object_key, MIN(id) AS object_id
       FROM s3_objects
       WHERE org_id IS NOT NULL
       GROUP BY bucket, object_key
       HAVING COUNT(*) = 1
     )
     UPDATE file_versions fv
     SET s3_object_id = scoped.object_id
     FROM unique_scoped_objects scoped
     WHERE fv.s3_object_id IS NULL
       AND fv.storage_provider = 's3'
       AND fv.bucket = scoped.bucket
       AND fv.object_key = scoped.object_key;`,
  ),
  defineMigration(
    "files-content-tenant-0003-backfill-single-tenant-keys",
    `WITH singleton_tenant AS (
       SELECT MIN(org_id) AS tenant_id
       FROM s3_objects
       WHERE org_id IS NOT NULL
       HAVING COUNT(DISTINCT org_id) = 1
     )
     INSERT INTO api_key_tenants (kid, tenant_id)
     SELECT keys.kid, singleton.tenant_id
     FROM api_keys keys
     CROSS JOIN singleton_tenant singleton
     WHERE keys.app = 'files'
       AND keys.revoked_at IS NULL
       AND (keys.expires_at IS NULL OR keys.expires_at > now())
     ON CONFLICT (kid) DO NOTHING;`,
  ),
  defineMigration(
    "files-content-tenant-0004-bind-future-single-tenant-keys",
    `CREATE OR REPLACE FUNCTION files_bind_single_tenant_api_key()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$
     BEGIN
       IF NEW.app = 'files' THEN
         INSERT INTO api_key_tenants (kid, tenant_id)
         SELECT NEW.kid, MIN(org_id)
         FROM s3_objects
         WHERE org_id IS NOT NULL
         HAVING COUNT(DISTINCT org_id) = 1
         ON CONFLICT (kid) DO NOTHING;
       END IF;
       RETURN NEW;
     END;
     $$;
     DROP TRIGGER IF EXISTS files_bind_single_tenant_api_key ON api_keys;
     CREATE TRIGGER files_bind_single_tenant_api_key
       AFTER INSERT ON api_keys
       FOR EACH ROW
       EXECUTE FUNCTION files_bind_single_tenant_api_key();`,
  ),
];

/** Full ordered migration set applied by the runner and checked by /ready. */
export const CLOUD_MIGRATIONS: readonly Migration[] = [
  ...dataMigrations.slice(0, LEGACY_NUMERIC_MIGRATION_COUNT),
  ...authMigrations,
  ...bridgeMigrations,
  ...dataMigrations.slice(LEGACY_NUMERIC_MIGRATION_COUNT),
  ...FILE_CONTENT_TENANCY_MIGRATIONS,
];
