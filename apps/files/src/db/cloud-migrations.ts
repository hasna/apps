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
  defineMigration(
    "files-content-tenant-0005-materialize-legacy-s3-lineage",
    `WITH lineage_rows AS (
       SELECT
         fv.id AS revision_id,
         f.id AS file_id,
         COALESCE(g.destination_source_id, s.id) AS object_source_id,
         COALESCE(NULLIF(btrim(g.canonical_bucket), ''),
           CASE WHEN g.storage_type = 's3' THEN NULLIF(btrim(ds.bucket), '') END,
           CASE WHEN s.type = 's3' THEN NULLIF(btrim(s.bucket), '') END) AS bucket,
         COALESCE(ds.region, s.region) AS region,
         CASE
           WHEN NULLIF(g.canonical_bucket, '') IS NOT NULL
             AND NULLIF(g.canonical_key, '') IS NOT NULL
             THEN btrim(g.canonical_key)
           WHEN g.storage_type = 's3'
             AND ds.type = 's3'
             AND NULLIF(g.storage_key, '') IS NOT NULL
             THEN btrim(g.storage_key)
           WHEN s.type = 's3' AND NULLIF(f.path, '') IS NOT NULL
             THEN btrim(f.path)
         END AS relative_key,
         CASE
           WHEN NULLIF(g.canonical_bucket, '') IS NOT NULL
             AND NULLIF(g.canonical_key, '') IS NOT NULL
             THEN ''
           WHEN g.storage_type = 's3' AND ds.type = 's3'
             THEN rtrim(btrim(COALESCE(ds.prefix, '')), '/')
           WHEN s.type = 's3'
             THEN rtrim(btrim(COALESCE(s.prefix, '')), '/')
         END AS object_prefix,
         f.tenant_id::text AS tenant_id,
         fv.content_hash_algorithm,
         fv.content_hash,
         fv.size,
         fv.mime,
         fv.indexed_at
       FROM file_versions fv
       JOIN files f ON f.id = fv.file_id
       JOIN sources s ON s.id = f.source_id
       LEFT JOIN google_drive_imported_objects g
         ON g.file_record_id = f.id AND g.deleted = FALSE
       LEFT JOIN sources ds ON ds.id = g.destination_source_id
       WHERE fv.s3_object_id IS NULL
         AND fv.state = 'active'
         AND f.status = 'active'
         AND f.tenant_id IS NOT NULL
         AND fv.tenant_id = f.tenant_id
         AND s.tenant_id = f.tenant_id
         AND (g.file_record_id IS NULL OR g.tenant_id = f.tenant_id)
         AND (ds.id IS NULL OR ds.tenant_id = f.tenant_id)
     ),
     exact_lineage AS (
       SELECT
         revision_id,
         file_id,
         object_source_id,
         bucket,
         region,
         CASE
           WHEN object_prefix = ''
             OR relative_key = object_prefix
             OR left(relative_key, length(object_prefix) + 1) = object_prefix || '/'
             THEN relative_key
           ELSE object_prefix || '/' || relative_key
         END AS object_key,
         tenant_id,
         content_hash_algorithm,
         content_hash,
         size,
         mime,
         indexed_at
       FROM lineage_rows
       WHERE NULLIF(bucket, '') IS NOT NULL
         AND NULLIF(relative_key, '') IS NOT NULL
         AND tenant_id IS NOT NULL
         AND relative_key !~ '^/'
         AND relative_key !~ '(^|/)\\.\\.?(/|$)'
         AND position('://' in relative_key) = 0
         AND position(E'\\\\' in relative_key) = 0
         AND object_prefix !~ '^/'
         AND object_prefix !~ '(^|/)\\.\\.?(/|$)'
         AND position('://' in object_prefix) = 0
         AND position(E'\\\\' in object_prefix) = 0
     ),
     unambiguous_lineage AS (
       SELECT
         revision_id,
         MIN(file_id) AS file_id,
         MIN(object_source_id) AS object_source_id,
         MIN(bucket) AS bucket,
         MIN(region) AS region,
         MIN(object_key) AS object_key,
         MIN(tenant_id) AS tenant_id,
         MIN(content_hash_algorithm) AS content_hash_algorithm,
         MIN(content_hash) AS content_hash,
         MIN(size) AS size,
         MIN(mime) AS mime,
         MIN(indexed_at) AS indexed_at
       FROM exact_lineage
       GROUP BY revision_id
       HAVING COUNT(*) = 1
         AND COUNT(DISTINCT bucket) = 1
         AND COUNT(DISTINCT object_key) = 1
         AND COUNT(DISTINCT tenant_id) = 1
     ),
     object_status AS (
       SELECT
         lineage.*,
         COUNT(objects.id) AS object_count,
         MIN(objects.id) AS existing_object_id,
         MIN(objects.org_id) AS existing_tenant_id,
         MIN(objects.tenant_id::text) AS existing_row_tenant_id
       FROM unambiguous_lineage lineage
       LEFT JOIN s3_objects objects
         ON objects.bucket = lineage.bucket
        AND objects.object_key = lineage.object_key
       GROUP BY
         lineage.revision_id,
         lineage.file_id,
         lineage.object_source_id,
         lineage.bucket,
         lineage.region,
         lineage.object_key,
         lineage.tenant_id,
         lineage.content_hash_algorithm,
         lineage.content_hash,
         lineage.size,
         lineage.mime,
         lineage.indexed_at
     ),
     inserted_objects AS (
       INSERT INTO s3_objects (
         id, source_id, identity, bucket, region, object_key,
         checksum_sha256, size, content_type, metadata, org_id, app,
         discovered_at, created_at, updated_at, tenant_id
       )
       SELECT
         's3obj_legacy_' || substr(md5(
           tenant_id || E'\\n' || bucket || E'\\n' || object_key
         ), 1, 20),
         object_source_id,
         'files-content-lineage-v1:' || md5(
           tenant_id || E'\\n' || bucket || E'\\n' || object_key
         ),
         bucket,
         region,
         object_key,
         CASE WHEN content_hash_algorithm = 'sha256' THEN content_hash END,
         size,
         mime,
         json_build_object(
           'migration', 'files-content-tenant-0005-materialize-legacy-s3-lineage',
           'file_id', file_id,
           'revision_id', revision_id
         )::text,
         tenant_id,
         'files',
         indexed_at,
         now()::text,
         now()::text,
         tenant_id::uuid
       FROM object_status
       WHERE object_count = 0
       ON CONFLICT (id) DO NOTHING
       RETURNING id, bucket, object_key, org_id
     ),
     resolvable_lineage AS (
       SELECT
         status.revision_id,
         status.bucket,
         status.region,
         status.object_key,
         COALESCE(
           CASE
             WHEN status.object_count = 1
               AND status.existing_tenant_id = status.tenant_id
               AND status.existing_row_tenant_id = status.tenant_id
               THEN status.existing_object_id
           END,
           inserted.id
         ) AS object_id
       FROM object_status status
       LEFT JOIN inserted_objects inserted
         ON inserted.bucket = status.bucket
        AND inserted.object_key = status.object_key
        AND inserted.org_id = status.tenant_id
       WHERE (status.object_count = 1
           AND status.existing_tenant_id = status.tenant_id
           AND status.existing_row_tenant_id = status.tenant_id)
          OR inserted.id IS NOT NULL
     )
     UPDATE file_versions versions
     SET s3_object_id = lineage.object_id,
         storage_provider = 's3',
         bucket = lineage.bucket,
         region = lineage.region,
         object_key = lineage.object_key
     FROM resolvable_lineage lineage
     WHERE versions.id = lineage.revision_id
       AND versions.s3_object_id IS NULL
       AND versions.state = 'active';

     WITH singleton_tenant AS (
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
];

/** Full ordered migration set applied by the runner and checked by /ready. */
export const CLOUD_MIGRATIONS: readonly Migration[] = [
  ...dataMigrations.slice(0, LEGACY_NUMERIC_MIGRATION_COUNT),
  ...authMigrations,
  ...bridgeMigrations,
  ...dataMigrations.slice(LEGACY_NUMERIC_MIGRATION_COUNT),
  ...FILE_CONTENT_TENANCY_MIGRATIONS,
];
