/**
 * Ordered Postgres migrations for the files service.
 *
 * Combines the canonical data-plane schema (PG_MIGRATIONS) with the shared
 * @hasna/contracts api_keys migrations, wrapped in the vendored storage kit's
 * `defineMigration` so they run through the drift/downgrade-guarded
 * `MigrationLedger`.
 *
 * The service reads AND writes these tables in Postgres directly. There is no
 * sync engine in the service.
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
 * Immutable transitional kid→tenant bridge from the authoritative open-files
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
  defineMigration(
    "files-content-tenant-0006-quarantine-ambiguous-lineage",
    `LOCK TABLE tenants IN SHARE MODE;
     LOCK TABLE api_keys IN SHARE ROW EXCLUSIVE MODE;
     LOCK TABLE api_key_tenants IN SHARE ROW EXCLUSIVE MODE;
     LOCK TABLE file_versions IN SHARE ROW EXCLUSIVE MODE;

     CREATE TABLE IF NOT EXISTS api_key_tenant_quarantine (
       kid TEXT PRIMARY KEY,
       tenant_id TEXT NOT NULL,
       original_created_at TIMESTAMPTZ NOT NULL,
       repair_migration TEXT NOT NULL,
       quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );

     CREATE TABLE IF NOT EXISTS file_version_lineage_quarantine (
       revision_id TEXT PRIMARY KEY,
       s3_object_id TEXT,
       storage_provider TEXT NOT NULL,
       bucket TEXT,
       region TEXT,
       object_key TEXT,
       repair_migration TEXT NOT NULL,
       quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );

     CREATE OR REPLACE FUNCTION files_bind_single_tenant_api_key()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$
     BEGIN
       IF NEW.app = 'files' THEN
         INSERT INTO api_key_tenants (kid, tenant_id)
         SELECT NEW.kid, singleton.tenant_id
         FROM (
           SELECT MIN(id::text) AS tenant_id
           FROM tenants
           HAVING COUNT(*) = 1
         ) singleton
         ON CONFLICT (kid) DO NOTHING;
       END IF;
       RETURN NEW;
     END;
     $$;

     WITH multi_tenant AS (
       SELECT TRUE AS present
       FROM tenants
       HAVING COUNT(*) > 1
     )
     INSERT INTO api_key_tenant_quarantine (
       kid, tenant_id, original_created_at, repair_migration
     )
     SELECT
       bindings.kid,
       bindings.tenant_id,
       bindings.created_at,
       'files-content-tenant-0006-quarantine-ambiguous-lineage'
     FROM api_key_tenants bindings
     JOIN api_keys keys ON keys.kid = bindings.kid
     CROSS JOIN multi_tenant
     WHERE keys.app = 'files'
     ON CONFLICT (kid) DO NOTHING;

     DELETE FROM api_key_tenants bindings
     USING api_key_tenant_quarantine quarantine
     WHERE bindings.kid = quarantine.kid
       AND quarantine.repair_migration =
         'files-content-tenant-0006-quarantine-ambiguous-lineage'
       AND EXISTS (SELECT 1 FROM tenants HAVING COUNT(*) > 1);

     WITH ranked AS (
       SELECT
         fv.id AS revision_id,
         fv.file_id,
         fv.s3_object_id,
         fv.storage_provider,
         fv.bucket,
         fv.region,
         fv.object_key,
         fv.content_hash_algorithm,
         fv.content_hash,
         ROW_NUMBER() OVER (
           PARTITION BY fv.file_id
           ORDER BY fv.created_at DESC, fv.id DESC
         ) AS revision_rank
       FROM file_versions fv
       WHERE fv.state = 'active'
     ),
     ambiguous_history AS (
       SELECT older.*
       FROM ranked older
       JOIN ranked current
         ON current.file_id = older.file_id
        AND current.revision_rank = 1
       WHERE older.revision_rank > 1
         AND older.s3_object_id IS NOT NULL
         AND older.s3_object_id = current.s3_object_id
         AND NOT (
           COALESCE(
             lower(older.content_hash_algorithm) = 'sha256'
             AND lower(current.content_hash_algorithm) = 'sha256'
             AND lower(older.content_hash) = lower(current.content_hash),
             FALSE
           )
           OR COALESCE(
             lower(older.content_hash_algorithm) = 'etag'
             AND lower(current.content_hash_algorithm) = 'etag'
             AND lower(btrim(older.content_hash, '"')) =
               lower(btrim(current.content_hash, '"')),
             FALSE
           )
         )
     )
     INSERT INTO file_version_lineage_quarantine (
       revision_id, s3_object_id, storage_provider, bucket, region,
       object_key, repair_migration
     )
     SELECT
       revision_id,
       s3_object_id,
       storage_provider,
       bucket,
       region,
       object_key,
       'files-content-tenant-0006-quarantine-ambiguous-lineage'
     FROM ambiguous_history
     ON CONFLICT (revision_id) DO NOTHING;

     UPDATE file_versions versions
     SET s3_object_id = NULL,
         storage_provider = 'unknown',
         bucket = NULL,
         region = NULL,
         object_key = NULL
     FROM file_version_lineage_quarantine quarantine
     WHERE versions.id = quarantine.revision_id
       AND versions.s3_object_id = quarantine.s3_object_id
       AND quarantine.repair_migration =
         'files-content-tenant-0006-quarantine-ambiguous-lineage';

     WITH ranked AS (
       SELECT
         fv.id AS revision_id,
         fv.file_id,
         fv.s3_object_id,
         fv.content_hash_algorithm,
         fv.content_hash,
         fv.size,
         fv.mime,
         ROW_NUMBER() OVER (
           PARTITION BY fv.file_id
           ORDER BY fv.created_at DESC, fv.id DESC
         ) AS revision_rank
       FROM file_versions fv
       WHERE fv.state = 'active'
     )
     UPDATE s3_objects objects
     SET checksum_sha256 = CASE
           WHEN lower(current.content_hash_algorithm) = 'sha256'
             THEN current.content_hash
           ELSE NULL
         END,
         size = current.size,
         content_type = current.mime,
         metadata = json_build_object(
           'migration', 'files-content-tenant-0005-materialize-legacy-s3-lineage',
           'file_id', current.file_id,
           'revision_id', current.revision_id
         )::text,
         updated_at = now()::text
     FROM ranked current
     WHERE current.revision_rank = 1
       AND objects.id = current.s3_object_id
       AND objects.app = 'files'
       AND objects.identity LIKE 'files-content-lineage-v1:%';`,
  ),
];

/**
 * Durable, tenant-bound knowledge-manifest snapshots.
 *
 * The existing per-file sync_version is not globally monotonic and relation
 * mutations do not advance it. This append-only log assigns every affected
 * file a sequence cursor and stores the safe manifest projection at that exact
 * point, allowing a paginated walk to remain pinned to one high watermark even
 * while later writes occur.
 */
export const FILE_KNOWLEDGE_MANIFEST_MIGRATIONS: readonly Migration[] = [
  defineMigration(
    "files-knowledge-manifest-0001-global-change-log",
    `CREATE TABLE IF NOT EXISTS files_knowledge_manifest_clock (
       singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
       cursor BIGINT NOT NULL CHECK (cursor >= 0)
     );
     INSERT INTO files_knowledge_manifest_clock(singleton, cursor)
     SELECT TRUE, COALESCE(MAX(cursor), 0)
     FROM knowledge_source_outbox_events
     ON CONFLICT (singleton) DO UPDATE SET cursor = GREATEST(
       files_knowledge_manifest_clock.cursor,
       EXCLUDED.cursor
     );
     ALTER TABLE knowledge_source_outbox_events
       ADD COLUMN IF NOT EXISTS manifest_snapshot JSONB;
     CREATE INDEX IF NOT EXISTS idx_knowledge_manifest_tenant_cursor
       ON knowledge_source_outbox_events(tenant_id, cursor)
       WHERE manifest_snapshot IS NOT NULL;
     CREATE INDEX IF NOT EXISTS idx_knowledge_manifest_tenant_file_cursor
       ON knowledge_source_outbox_events(tenant_id, file_id, cursor DESC)
       WHERE manifest_snapshot IS NOT NULL;

     CREATE OR REPLACE FUNCTION files_capture_knowledge_manifest_change(
       requested_file_id TEXT,
       requested_event_type TEXT DEFAULT 'updated',
       force_deleted BOOLEAN DEFAULT FALSE
     ) RETURNS VOID
     LANGUAGE plpgsql
     AS $$
     DECLARE assigned_cursor BIGINT;
     BEGIN
       UPDATE files_knowledge_manifest_clock
       SET cursor = cursor + 1
       WHERE singleton = TRUE
       RETURNING cursor INTO assigned_cursor;
       IF assigned_cursor IS NULL THEN
         RAISE EXCEPTION 'knowledge manifest clock unavailable';
       END IF;
       INSERT INTO knowledge_source_outbox_events (
         id, cursor, event_type, source_ref, file_id, source_id,
         revision_id, status, hash, size, mime, path,
         metadata, created_at, tenant_id, manifest_snapshot
       )
       SELECT
         'manifest_' || assigned_cursor::text || '_' || substr(md5(random()::text), 1, 8),
         assigned_cursor,
         CASE WHEN force_deleted THEN 'deleted' ELSE requested_event_type END,
         'open-files://file/' || f.id,
         f.id,
         f.source_id,
         revision.id,
         CASE WHEN force_deleted THEN 'deleted' ELSE f.status END,
         f.hash,
         f.size,
         f.mime,
         NULL,
         jsonb_build_object('manifest_change', requested_event_type)::text,
         NOW()::text,
         f.tenant_id,
         jsonb_build_object(
           'file_id', f.id,
           'source_id', f.source_id,
           'source_type', s.type,
           'source_enabled', s.enabled,
           'name', f.name,
           'mime', f.mime,
           'size', f.size,
           'hash', f.hash,
           'status', CASE WHEN force_deleted THEN 'deleted' ELSE f.status END,
           'indexed_at', f.indexed_at,
           'modified_at', f.modified_at,
           'tags', COALESCE((
             SELECT jsonb_agg(t.name ORDER BY t.name)
             FROM file_tags ft
             JOIN tags t ON t.id = ft.tag_id
             WHERE ft.file_id = f.id
               AND ft.tenant_id = f.tenant_id
               AND t.tenant_id = f.tenant_id
           ), '[]'::jsonb),
           'project_ids', COALESCE((
             SELECT jsonb_agg(pf.project_id ORDER BY pf.project_id)
             FROM project_files pf
             JOIN projects p ON p.id = pf.project_id
             WHERE pf.file_id = f.id
               AND pf.tenant_id = f.tenant_id
               AND p.tenant_id = f.tenant_id
           ), '[]'::jsonb),
           'collection_ids', COALESCE((
             SELECT jsonb_agg(cf.collection_id ORDER BY cf.collection_id)
             FROM collection_files cf
             JOIN collections c ON c.id = cf.collection_id
             WHERE cf.file_id = f.id
               AND cf.tenant_id = f.tenant_id
               AND c.tenant_id = f.tenant_id
           ), '[]'::jsonb),
           'revision', CASE WHEN revision.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', revision.id,
             'source_ref', revision.source_ref,
             'content_hash_algorithm', revision.content_hash_algorithm,
             'content_hash', revision.content_hash
           ) END,
           'extraction', CASE WHEN extraction.id IS NULL THEN
             jsonb_build_object('status', 'unavailable')
           ELSE jsonb_build_object(
             'status', extraction.status,
             'revision_id', extraction.revision_id
           ) END
         )
       FROM files f
       JOIN sources s
         ON s.id = f.source_id
        AND s.tenant_id = f.tenant_id
       LEFT JOIN LATERAL (
         SELECT fv.id, fv.source_ref, fv.content_hash_algorithm, fv.content_hash
         FROM file_versions fv
         WHERE fv.file_id = f.id
           AND fv.tenant_id = f.tenant_id
           AND fv.state = 'active'
         ORDER BY fv.created_at DESC, fv.id DESC
         LIMIT 1
       ) revision ON TRUE
       LEFT JOIN LATERAL (
         SELECT d.id, d.status, d.revision_id
         FROM file_search_documents d
         WHERE d.file_id = f.id
           AND d.tenant_id = f.tenant_id
           AND d.kind = 'extracted_text'
           AND revision.id IS NOT NULL
           AND d.revision_id = revision.id
         ORDER BY d.updated_at DESC, d.id DESC
         LIMIT 1
       ) extraction ON TRUE
       WHERE f.id = requested_file_id
         AND f.tenant_id IS NOT NULL;
     END;
     $$;

     CREATE OR REPLACE FUNCTION files_manifest_file_change_trigger()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     BEGIN
       IF TG_OP = 'DELETE' THEN
         PERFORM files_capture_knowledge_manifest_change(OLD.id, 'deleted', TRUE);
         RETURN OLD;
       END IF;
       PERFORM files_capture_knowledge_manifest_change(
         NEW.id,
         CASE WHEN TG_OP = 'INSERT' THEN 'indexed' ELSE 'updated' END,
         FALSE
       );
       RETURN NEW;
     END;
     $$;

     CREATE OR REPLACE FUNCTION files_manifest_relation_change_trigger()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     BEGIN
       IF TG_OP = 'UPDATE' AND OLD.file_id IS DISTINCT FROM NEW.file_id THEN
         PERFORM files_capture_knowledge_manifest_change(OLD.file_id, 'updated', FALSE);
       END IF;
       PERFORM files_capture_knowledge_manifest_change(
         CASE WHEN TG_OP = 'DELETE' THEN OLD.file_id ELSE NEW.file_id END,
         'updated',
         FALSE
       );
       RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
     END;
     $$;

     CREATE OR REPLACE FUNCTION files_manifest_file_child_change_trigger()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     BEGIN
       IF TG_OP = 'UPDATE' AND OLD.file_id IS DISTINCT FROM NEW.file_id THEN
         PERFORM files_capture_knowledge_manifest_change(
           OLD.file_id,
           CASE WHEN TG_TABLE_NAME = 'file_versions' THEN 'revision_changed' ELSE 'extraction_changed' END,
           FALSE
         );
       END IF;
       PERFORM files_capture_knowledge_manifest_change(
         CASE WHEN TG_OP = 'DELETE' THEN OLD.file_id ELSE NEW.file_id END,
         CASE WHEN TG_TABLE_NAME = 'file_versions' THEN 'revision_changed' ELSE 'extraction_changed' END,
         FALSE
       );
       RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
     END;
     $$;

     CREATE OR REPLACE FUNCTION files_manifest_parent_change_trigger()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     DECLARE affected RECORD;
     BEGIN
       IF TG_TABLE_NAME = 'sources' THEN
         FOR affected IN SELECT id AS file_id FROM files WHERE source_id = COALESCE(NEW.id, OLD.id) LOOP
           PERFORM files_capture_knowledge_manifest_change(
             affected.file_id,
             CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'source_updated' END,
             TG_OP = 'DELETE'
           );
         END LOOP;
       ELSIF TG_TABLE_NAME = 'tags' THEN
         FOR affected IN SELECT file_id FROM file_tags WHERE tag_id = COALESCE(NEW.id, OLD.id) LOOP
           PERFORM files_capture_knowledge_manifest_change(affected.file_id, 'updated', FALSE);
         END LOOP;
       ELSIF TG_TABLE_NAME = 'projects' THEN
         FOR affected IN SELECT file_id FROM project_files WHERE project_id = COALESCE(NEW.id, OLD.id) LOOP
           PERFORM files_capture_knowledge_manifest_change(affected.file_id, 'updated', FALSE);
         END LOOP;
       ELSIF TG_TABLE_NAME = 'collections' THEN
         FOR affected IN SELECT file_id FROM collection_files WHERE collection_id = COALESCE(NEW.id, OLD.id) LOOP
           PERFORM files_capture_knowledge_manifest_change(affected.file_id, 'updated', FALSE);
         END LOOP;
       END IF;
       RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
     END;
     $$;

     DROP TRIGGER IF EXISTS files_manifest_file_insert_update ON files;
     CREATE TRIGGER files_manifest_file_insert_update
       AFTER INSERT OR UPDATE ON files
       FOR EACH ROW EXECUTE FUNCTION files_manifest_file_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_file_delete ON files;
     CREATE TRIGGER files_manifest_file_delete
       BEFORE DELETE ON files
       FOR EACH ROW EXECUTE FUNCTION files_manifest_file_change_trigger();

     DROP TRIGGER IF EXISTS files_manifest_file_tags_change ON file_tags;
     CREATE TRIGGER files_manifest_file_tags_change
       AFTER INSERT OR UPDATE OR DELETE ON file_tags
       FOR EACH ROW EXECUTE FUNCTION files_manifest_relation_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_project_files_change ON project_files;
     CREATE TRIGGER files_manifest_project_files_change
       AFTER INSERT OR UPDATE OR DELETE ON project_files
       FOR EACH ROW EXECUTE FUNCTION files_manifest_relation_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_collection_files_change ON collection_files;
     CREATE TRIGGER files_manifest_collection_files_change
       AFTER INSERT OR UPDATE OR DELETE ON collection_files
       FOR EACH ROW EXECUTE FUNCTION files_manifest_relation_change_trigger();

     DROP TRIGGER IF EXISTS files_manifest_file_versions_change ON file_versions;
     CREATE TRIGGER files_manifest_file_versions_change
       AFTER INSERT OR UPDATE OR DELETE ON file_versions
       FOR EACH ROW EXECUTE FUNCTION files_manifest_file_child_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_search_documents_change ON file_search_documents;
     CREATE TRIGGER files_manifest_search_documents_change
       AFTER INSERT OR UPDATE OR DELETE ON file_search_documents
       FOR EACH ROW EXECUTE FUNCTION files_manifest_file_child_change_trigger();

     DROP TRIGGER IF EXISTS files_manifest_sources_change ON sources;
     DROP TRIGGER IF EXISTS files_manifest_sources_delete ON sources;
     CREATE TRIGGER files_manifest_sources_change
       AFTER UPDATE ON sources
       FOR EACH ROW EXECUTE FUNCTION files_manifest_parent_change_trigger();
     CREATE TRIGGER files_manifest_sources_delete
       BEFORE DELETE ON sources
       FOR EACH ROW EXECUTE FUNCTION files_manifest_parent_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_tags_change ON tags;
     CREATE TRIGGER files_manifest_tags_change
       AFTER UPDATE ON tags
       FOR EACH ROW EXECUTE FUNCTION files_manifest_parent_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_projects_change ON projects;
     CREATE TRIGGER files_manifest_projects_change
       AFTER UPDATE ON projects
       FOR EACH ROW EXECUTE FUNCTION files_manifest_parent_change_trigger();
     DROP TRIGGER IF EXISTS files_manifest_collections_change ON collections;
     CREATE TRIGGER files_manifest_collections_change
       AFTER UPDATE ON collections
       FOR EACH ROW EXECUTE FUNCTION files_manifest_parent_change_trigger();

     DO $$
     DECLARE existing_file RECORD;
     BEGIN
       FOR existing_file IN
         SELECT f.id
         FROM files f
         WHERE NOT EXISTS (
           SELECT 1 FROM knowledge_source_outbox_events e
           WHERE e.file_id = f.id
             AND e.tenant_id = f.tenant_id
             AND e.manifest_snapshot IS NOT NULL
         )
         ORDER BY f.id
       LOOP
         PERFORM files_capture_knowledge_manifest_change(existing_file.id, 'indexed', FALSE);
       END LOOP;
     END;
     $$;`,
  ),
  defineMigration(
    "files-knowledge-manifest-0002-normalize-snapshot-timestamps",
    `CREATE OR REPLACE FUNCTION files_manifest_rfc3339(value TEXT)
     RETURNS TEXT
     LANGUAGE plpgsql
     IMMUTABLE
     STRICT
     SET search_path = pg_catalog, public
     AS $$
     DECLARE instant TIMESTAMPTZ;
     BEGIN
       IF value ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN
         instant := value::timestamptz;
       ELSE
         instant := value::timestamp AT TIME ZONE 'UTC';
       END IF;
       RETURN to_char(
         instant AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
       );
     EXCEPTION WHEN OTHERS THEN
       RAISE EXCEPTION 'invalid knowledge manifest snapshot timestamp';
     END;
     $$;

     CREATE OR REPLACE FUNCTION files_normalize_manifest_snapshot_timestamps()
     RETURNS TRIGGER
     LANGUAGE plpgsql
     SET search_path = pg_catalog, public
     AS $$
     DECLARE indexed_value TEXT;
     DECLARE modified_value TEXT;
     BEGIN
       IF NEW.manifest_snapshot IS NULL THEN
         RETURN NEW;
       END IF;
       indexed_value := NEW.manifest_snapshot->>'indexed_at';
       IF indexed_value IS NULL OR btrim(indexed_value) = '' THEN
         RAISE EXCEPTION 'knowledge manifest snapshot indexed_at unavailable';
       END IF;
       NEW.manifest_snapshot := jsonb_set(
         NEW.manifest_snapshot,
         '{indexed_at}',
         to_jsonb(files_manifest_rfc3339(indexed_value)),
         FALSE
       );
       modified_value := NEW.manifest_snapshot->>'modified_at';
       IF modified_value IS NOT NULL THEN
         NEW.manifest_snapshot := jsonb_set(
           NEW.manifest_snapshot,
           '{modified_at}',
           to_jsonb(files_manifest_rfc3339(modified_value)),
           FALSE
         );
       END IF;
       RETURN NEW;
     END;
     $$;

     DROP TRIGGER IF EXISTS files_manifest_snapshot_timestamp_normalize
       ON knowledge_source_outbox_events;
     CREATE TRIGGER files_manifest_snapshot_timestamp_normalize
       BEFORE INSERT OR UPDATE OF manifest_snapshot
       ON knowledge_source_outbox_events
       FOR EACH ROW
       WHEN (NEW.manifest_snapshot IS NOT NULL)
       EXECUTE FUNCTION files_normalize_manifest_snapshot_timestamps();

     ALTER FUNCTION files_capture_knowledge_manifest_change(TEXT, TEXT, BOOLEAN)
       SECURITY DEFINER;
     ALTER FUNCTION files_capture_knowledge_manifest_change(TEXT, TEXT, BOOLEAN)
       SET search_path TO pg_catalog, public;

     UPDATE knowledge_source_outbox_events
     SET manifest_snapshot = manifest_snapshot
     WHERE manifest_snapshot IS NOT NULL
       AND (
         manifest_snapshot->>'indexed_at' !~
           '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR (
           manifest_snapshot->>'modified_at' IS NOT NULL
           AND manifest_snapshot->>'modified_at' !~
             '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         )
       );`,
  ),
];

/** Full ordered migration set applied by the runner and checked by /ready. */
export const CLOUD_MIGRATIONS: readonly Migration[] = [
  ...dataMigrations.slice(0, LEGACY_NUMERIC_MIGRATION_COUNT),
  ...authMigrations,
  ...bridgeMigrations,
  ...dataMigrations.slice(LEGACY_NUMERIC_MIGRATION_COUNT),
  ...FILE_CONTENT_TENANCY_MIGRATIONS,
  ...FILE_KNOWLEDGE_MANIFEST_MIGRATIONS,
];
