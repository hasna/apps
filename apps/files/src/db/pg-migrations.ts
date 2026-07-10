/**
 * PostgreSQL migrations for open-files remote storage.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 * Note: FTS5 virtual table (migration v2 in SQLite) is omitted — use PostgreSQL
 * tsvector / GIN indexes instead when full-text search is needed.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: machines table
  `CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen TEXT NOT NULL DEFAULT NOW()::text,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: sources table
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('local', 's3', 'google_drive')),
    path TEXT,
    bucket TEXT,
    prefix TEXT,
    region TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_indexed_at TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 3: files table
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    ext TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    hash TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted', 'moved')),
    indexed_at TEXT NOT NULL DEFAULT NOW()::text,
    modified_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(source_id, path)
  )`,

  // Migration 4: tags table
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 5: file_tags join table
  `CREATE TABLE IF NOT EXISTS file_tags (
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY (file_id, tag_id)
  )`,

  // Migration 6: collections table
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: collection_files join table
  `CREATE TABLE IF NOT EXISTS collection_files (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY (collection_id, file_id)
  )`,

  // Migration 8: projects table
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 9: project_files join table
  `CREATE TABLE IF NOT EXISTS project_files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY (project_id, file_id)
  )`,

  // Migration 10: indexes
  `CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_files_machine ON files(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext)`,
  `CREATE INDEX IF NOT EXISTS idx_files_status ON files(status)`,
  `CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_machine ON sources(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type)`,

  // Migration 11: peers table
  `CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT,
    auto_sync BOOLEAN NOT NULL DEFAULT FALSE,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 12: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 13: file normalization columns
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS original_name TEXT`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS canonical_name TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_files_canonical ON files(canonical_name)`,

  // Migration 14: agents table
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    session_id TEXT,
    project_id TEXT,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 15: agent_activity table
  `CREATE TABLE IF NOT EXISTS agent_activity (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    session_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_agent ON agent_activity(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_file ON agent_activity(file_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_action ON agent_activity(action)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_session ON agent_activity(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_created ON agent_activity(created_at)`,

  // Migration 16: smart collections
  `ALTER TABLE collections ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES collections(id)`,
  `ALTER TABLE collections ADD COLUMN IF NOT EXISTS auto_rules TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE collections ADD COLUMN IF NOT EXISTS metadata TEXT NOT NULL DEFAULT '{}'`,

  // Migration 17: project enhancements
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata TEXT NOT NULL DEFAULT '{}'`,

  // Migration 18: sync improvements
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'local_only'`,
  `ALTER TABLE peers ADD COLUMN IF NOT EXISTS last_sync_version INTEGER NOT NULL DEFAULT 0`,

  // Migration 19: file descriptions
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,

  // Migration 20: Google Drive sources + destination-aware imports
  `ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_type_check`,
  `ALTER TABLE sources ADD CONSTRAINT sources_type_check CHECK(type IN ('local', 's3', 'google_drive'))`,
  `CREATE TABLE IF NOT EXISTS google_drive_sync_state (
    source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    last_synced_at TEXT,
    last_full_scan_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS google_drive_imported_objects (
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    drive_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    profile TEXT,
    parent_id TEXT,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    modified_at TEXT,
    version TEXT,
    hash TEXT,
    storage_type TEXT NOT NULL DEFAULT 's3' CHECK(storage_type IN ('s3', 'local')),
    storage_key TEXT,
    destination_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    s3_key TEXT NOT NULL DEFAULT '',
    file_record_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    last_imported_at TEXT NOT NULL,
    PRIMARY KEY (source_id, drive_id, file_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_s3_key
    ON google_drive_imported_objects(source_id, s3_key)`,
  `CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_file_record
    ON google_drive_imported_objects(file_record_id)`,
  `CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_storage
    ON google_drive_imported_objects(source_id, storage_type, storage_key)`,
  `CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_destination
    ON google_drive_imported_objects(destination_source_id)`,

  // Migration 21: shared evidence vault metadata
  `CREATE TABLE IF NOT EXISTS file_assets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    company_id TEXT,
    app TEXT NOT NULL,
    kind TEXT NOT NULL,
    classification TEXT NOT NULL DEFAULT 'general',
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    checksum_algorithm TEXT NOT NULL DEFAULT 'sha256',
    storage_provider TEXT NOT NULL CHECK(storage_provider IN ('s3', 'local')),
    bucket TEXT,
    region TEXT,
    object_key TEXT NOT NULL,
    quarantine_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending_upload' CHECK(status IN ('pending_upload', 'uploaded', 'verified', 'archived', 'deleted')),
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending', 'clean', 'skipped', 'suspicious', 'blocked')),
    retention_until TEXT,
    retention_policy TEXT,
    storage_class TEXT,
    legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
    immutable BOOLEAN NOT NULL DEFAULT FALSE,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    verified_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS file_upload_intents (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT 'PUT',
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired', 'cancelled')),
    expected_checksum TEXT NOT NULL,
    expected_checksum_algorithm TEXT NOT NULL DEFAULT 'sha256',
    expected_size BIGINT NOT NULL,
    required_headers TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS file_links (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    company_id TEXT,
    app TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(asset_id, app, source_type, source_id, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS file_access_events (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    company_id TEXT,
    app TEXT,
    actor_id TEXT,
    action TEXT NOT NULL,
    purpose TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_file_assets_org ON file_assets(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_assets_company ON file_assets(org_id, company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_assets_app_kind ON file_assets(app, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_file_assets_checksum ON file_assets(checksum_algorithm, checksum)`,
  `CREATE INDEX IF NOT EXISTS idx_file_assets_status ON file_assets(status, scan_status)`,
  `CREATE INDEX IF NOT EXISTS idx_file_assets_retention ON file_assets(retention_until)`,
  `CREATE INDEX IF NOT EXISTS idx_file_upload_intents_asset ON file_upload_intents(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_upload_intents_status ON file_upload_intents(status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_links_asset ON file_links(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_links_source ON file_links(app, source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_access_events_asset ON file_access_events(asset_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_access_events_org ON file_access_events(org_id, created_at)`,

  // Migration 22: canonical Google Drive object mapping for Hasna XYZ S3 migration
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS raw_bucket TEXT`,
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS raw_key TEXT`,
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS canonical_bucket TEXT`,
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS canonical_key TEXT`,
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS canonical_sha256 TEXT`,
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS promotion_action TEXT`,
  `ALTER TABLE google_drive_imported_objects ADD COLUMN IF NOT EXISTS promotion_status TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_canonical_key
    ON google_drive_imported_objects(canonical_bucket, canonical_key)`,
  `CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_canonical_sha256
    ON google_drive_imported_objects(canonical_sha256)`,

  // Migration 23: large Drive objects exceed 32-bit integer size.
  `ALTER TABLE files ALTER COLUMN size TYPE BIGINT USING size::bigint`,

  // Migration 24: Drive archive organization/review workflow
  `CREATE TABLE IF NOT EXISTS file_organization_reviews (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    profile TEXT,
    drive_id TEXT,
    root_type TEXT NOT NULL DEFAULT 'unknown'
      CHECK(root_type IN ('my_drive', 'shared_drive', 'unknown')),
    original_path TEXT NOT NULL,
    current_path TEXT NOT NULL,
    target_path TEXT,
    target_collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    target_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    owner TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    duplicate_group_id TEXT,
    review_status TEXT NOT NULL DEFAULT 'unreviewed'
      CHECK(review_status IN ('unreviewed', 'in_review', 'approved', 'moved', 'duplicate', 'ignored')),
    priority TEXT NOT NULL DEFAULT 'normal',
    reviewer TEXT,
    reviewed_at TEXT,
    notes TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS file_organization_events (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES file_organization_reviews(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor TEXT,
    from_status TEXT,
    to_status TEXT,
    before_state TEXT,
    after_state TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_status
    ON file_organization_reviews(review_status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_root
    ON file_organization_reviews(profile, root_type)`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_owner
    ON file_organization_reviews(owner, review_status)`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_duplicate
    ON file_organization_reviews(duplicate_group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_events_review
    ON file_organization_events(review_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_events_file
    ON file_organization_events(file_id, created_at)`,

  // Migration 25: explicit Drive ACL/permission review state
  `ALTER TABLE file_organization_reviews ADD COLUMN IF NOT EXISTS acl_review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK(acl_review_status IN ('needs_review', 'approved', 'restricted', 'external_review', 'unknown'))`,
  `ALTER TABLE file_organization_reviews ADD COLUMN IF NOT EXISTS permission_scope TEXT NOT NULL DEFAULT 'unknown'
    CHECK(permission_scope IN ('unknown', 'private', 'domain', 'shared_drive', 'external', 'public', 'mixed'))`,
  `ALTER TABLE file_organization_reviews ADD COLUMN IF NOT EXISTS permission_risk TEXT NOT NULL DEFAULT 'unknown'
    CHECK(permission_risk IN ('unknown', 'low', 'medium', 'high'))`,
  `ALTER TABLE file_organization_reviews ADD COLUMN IF NOT EXISTS permission_notes TEXT`,
  `ALTER TABLE file_organization_reviews ADD COLUMN IF NOT EXISTS permissions_metadata TEXT NOT NULL DEFAULT '{}'`,
  `CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_acl
    ON file_organization_reviews(acl_review_status, permission_risk)`,

  // Migration 26: immutable file revision identities for source refs and knowledge indexing.
  `CREATE TABLE IF NOT EXISTS file_versions (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    source_ref TEXT NOT NULL UNIQUE,
    revision_identity TEXT NOT NULL,
    content_hash_algorithm TEXT NOT NULL DEFAULT 'unknown',
    content_hash TEXT,
    size BIGINT NOT NULL DEFAULT 0,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    storage_provider TEXT NOT NULL DEFAULT 'unknown'
      CHECK(storage_provider IN ('local', 's3', 'unknown')),
    bucket TEXT,
    region TEXT,
    object_key TEXT,
    local_path TEXT,
    source_path TEXT NOT NULL,
    source_modified_at TEXT,
    indexed_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active'
      CHECK(state IN ('active', 'deleted', 'moved')),
    source_provenance TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(file_id, revision_identity)
  )`,
  `WITH current_versions AS (
    SELECT
      f.id AS file_id,
      f.source_id AS source_id,
      COALESCE(g.canonical_sha256, f.hash, '') || '|' ||
        CASE
          WHEN g.canonical_sha256 IS NOT NULL AND g.canonical_sha256 != '' THEN 'sha256'
          WHEN s.type = 'local' AND f.hash IS NOT NULL AND f.hash != '' THEN 'blake3'
          WHEN s.type = 's3' AND f.hash IS NOT NULL AND f.hash != '' THEN 'etag'
          WHEN f.hash IS NOT NULL AND f.hash != '' THEN 'source'
          ELSE 'unknown'
        END || '|' ||
        f.size::text || '|' ||
        f.mime || '|' ||
        f.path || '|' ||
        COALESCE(f.modified_at, '') || '|' ||
        f.status || '|' ||
        COALESCE(g.canonical_bucket, CASE WHEN g.storage_type = 's3' THEN ds.bucket ELSE s.bucket END, '') || '|' ||
        COALESCE(g.canonical_key, CASE WHEN g.storage_type = 's3' THEN g.storage_key WHEN s.type = 's3' THEN f.path END, '') || '|' ||
        COALESCE(CASE
          WHEN g.storage_type = 'local' AND ds.path IS NOT NULL AND g.storage_key IS NOT NULL THEN ds.path || '/' || g.storage_key
          WHEN s.type = 'local' AND s.path IS NOT NULL THEN s.path || '/' || f.path
        END, '') AS revision_identity,
      CASE
        WHEN g.canonical_sha256 IS NOT NULL AND g.canonical_sha256 != '' THEN 'sha256'
        WHEN s.type = 'local' AND f.hash IS NOT NULL AND f.hash != '' THEN 'blake3'
        WHEN s.type = 's3' AND f.hash IS NOT NULL AND f.hash != '' THEN 'etag'
        WHEN f.hash IS NOT NULL AND f.hash != '' THEN 'source'
        ELSE 'unknown'
      END AS content_hash_algorithm,
      COALESCE(g.canonical_sha256, f.hash) AS content_hash,
      f.size AS size,
      f.mime AS mime,
      CASE
        WHEN g.canonical_bucket IS NOT NULL AND g.canonical_key IS NOT NULL THEN 's3'
        WHEN g.storage_type = 's3' THEN 's3'
        WHEN g.storage_type = 'local' THEN 'local'
        WHEN s.type = 's3' THEN 's3'
        WHEN s.type = 'local' THEN 'local'
        ELSE 'unknown'
      END AS storage_provider,
      COALESCE(g.canonical_bucket, CASE WHEN g.storage_type = 's3' THEN ds.bucket ELSE s.bucket END) AS bucket,
      COALESCE(ds.region, s.region) AS region,
      COALESCE(g.canonical_key, CASE WHEN g.storage_type = 's3' THEN g.storage_key WHEN s.type = 's3' THEN f.path END) AS object_key,
      CASE
        WHEN g.storage_type = 'local' AND ds.path IS NOT NULL AND g.storage_key IS NOT NULL THEN ds.path || '/' || g.storage_key
        WHEN s.type = 'local' AND s.path IS NOT NULL THEN s.path || '/' || f.path
      END AS local_path,
      f.path AS source_path,
      f.modified_at AS source_modified_at,
      f.indexed_at AS indexed_at,
      f.status AS state,
      json_build_object(
        'source_type', s.type,
        'source_name', s.name,
        'source_prefix', s.prefix,
        'google_drive_source_id', g.source_id,
        'google_drive_file_id', g.file_id,
        'google_drive_drive_id', g.drive_id,
        'raw_bucket', g.raw_bucket,
        'raw_key', g.raw_key,
        'destination_source_id', g.destination_source_id
      )::text AS source_provenance,
      f.created_at AS created_at
    FROM files f
    JOIN sources s ON s.id = f.source_id
    LEFT JOIN google_drive_imported_objects g
      ON g.file_record_id = f.id AND g.deleted = FALSE
    LEFT JOIN sources ds ON ds.id = g.destination_source_id
  ),
  numbered_versions AS (
    SELECT
      'rev_' || substr(md5(file_id || ':' || clock_timestamp()::text || ':' || random()::text), 1, 20) AS revision_id,
      *
    FROM current_versions
  )
  INSERT INTO file_versions (
    id, file_id, source_id, source_ref, revision_identity,
    content_hash_algorithm, content_hash, size, mime, storage_provider,
    bucket, region, object_key, local_path, source_path, source_modified_at,
    indexed_at, state, source_provenance, created_at
  )
  SELECT
    revision_id,
    file_id,
    source_id,
    'open-files://file/' || file_id || '/revision/' || revision_id,
    revision_identity,
    content_hash_algorithm,
    content_hash,
    size,
    mime,
    storage_provider,
    bucket,
    region,
    object_key,
    local_path,
    source_path,
    source_modified_at,
    indexed_at,
    state,
    source_provenance,
    created_at
  FROM numbered_versions
  ON CONFLICT (file_id, revision_identity) DO NOTHING`,
  `CREATE INDEX IF NOT EXISTS idx_file_versions_file
    ON file_versions(file_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_versions_source
    ON file_versions(source_id, source_path)`,
  `CREATE INDEX IF NOT EXISTS idx_file_versions_hash
    ON file_versions(content_hash_algorithm, content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_file_versions_storage
    ON file_versions(storage_provider, bucket, object_key)`,

  // Migration 27: first-class immutable S3 object identity records.
  `CREATE TABLE IF NOT EXISTS s3_objects (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    identity TEXT NOT NULL UNIQUE,
    bucket TEXT NOT NULL,
    region TEXT,
    object_key TEXT NOT NULL,
    version_id TEXT,
    etag TEXT,
    checksum_sha256 TEXT,
    size BIGINT NOT NULL DEFAULT 0,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    storage_class TEXT,
    server_side_encryption TEXT,
    sse_kms_key_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    org_id TEXT,
    company_id TEXT,
    project_id TEXT,
    app TEXT,
    discovered_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS s3_object_id TEXT REFERENCES s3_objects(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_s3_objects_bucket_key
    ON s3_objects(bucket, object_key)`,
  `CREATE INDEX IF NOT EXISTS idx_s3_objects_checksum
    ON s3_objects(checksum_sha256)`,
  `CREATE INDEX IF NOT EXISTS idx_s3_objects_source
    ON s3_objects(source_id, object_key)`,
  `CREATE INDEX IF NOT EXISTS idx_s3_objects_scope
    ON s3_objects(org_id, company_id, project_id, app)`,
  `CREATE INDEX IF NOT EXISTS idx_file_versions_s3_object
    ON file_versions(s3_object_id)`,

  // Migration 28: durable source change outbox for open-knowledge reindexing.
  `CREATE TABLE IF NOT EXISTS knowledge_source_outbox_events (
    id TEXT PRIMARY KEY,
    cursor BIGINT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK(event_type IN (
      'source_created', 'indexed', 'updated', 'deleted', 'moved', 'hash_changed',
      'revision_changed', 'extraction_ready', 'extraction_failed',
      'extraction_changed', 'permission_changed', 'acl_revoked',
      'canonical_key_changed', 'source_disabled', 'source_enabled',
      'source_updated'
    )),
    source_ref TEXT,
    file_id TEXT,
    source_id TEXT,
    revision_id TEXT,
    previous_revision_id TEXT,
    status TEXT,
    hash TEXT,
    size BIGINT,
    mime TEXT,
    path TEXT,
    idempotency_key TEXT UNIQUE,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_source_outbox_checkpoints (
    consumer_id TEXT PRIMARY KEY,
    cursor BIGINT NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_cursor
    ON knowledge_source_outbox_events(cursor)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_type
    ON knowledge_source_outbox_events(event_type, cursor)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_file
    ON knowledge_source_outbox_events(file_id, cursor)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_source
    ON knowledge_source_outbox_events(source_id, cursor)`,

  // Migration 29: derived search documents for extracted/OCR/transcript/AI summary artifacts.
  `CREATE TABLE IF NOT EXISTS file_search_documents (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES file_versions(id) ON DELETE SET NULL,
    source_ref TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN (
      'extracted_text',
      'extraction_summary',
      'ocr_text',
      'vision_summary',
      'transcript',
      'llm_summary',
      'semantic_metadata',
      'manual_note'
    )),
    extractor TEXT NOT NULL DEFAULT 'unknown',
    content_hash TEXT NOT NULL,
    searchable_text TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'partial', 'unsupported', 'error', 'stale')),
    private BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(file_id, kind, source_ref, content_hash)
  )`,
  `ALTER TABLE file_search_documents
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'simple',
        coalesce(kind, '') || ' ' ||
        coalesce(extractor, '') || ' ' ||
        coalesce(searchable_text, '') || ' ' ||
        coalesce(metadata, '')
      )
    ) STORED`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_file_search_documents_unique
    ON file_search_documents(file_id, kind, source_ref, content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_file_search_documents_file
    ON file_search_documents(file_id, status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_search_documents_kind
    ON file_search_documents(kind, status)`,
  `CREATE INDEX IF NOT EXISTS idx_file_search_documents_revision
    ON file_search_documents(revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_search_documents_hash
    ON file_search_documents(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_file_search_documents_search_vector
    ON file_search_documents USING GIN(search_vector)`,

  // Migration 30: signing/upload headers are ephemeral transport material.
  // Scrub legacy rows; adapters write only the empty compatibility object.
  `UPDATE file_upload_intents
    SET required_headers = '{}'
    WHERE required_headers <> '{}'`,
];
