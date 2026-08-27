import { Database } from "bun:sqlite";
import { join } from "path";
import { getDataDir } from "../lib/paths.js";
export { getDataDir } from "../lib/paths.js";

// The effective data dir now resolves through @hasna/paths (XDG / macOS home
// layout) with gated legacy adoption — see src/lib/paths.ts. The pre-resolver
// explicit data-dir overrides (HASNA_FILES_DATA_DIR / FILES_DATA_DIR) are
// preserved as exact-app overrides and win there, and the one-time ~/.files
// auto-migration is preserved and targets the effective root.

export function getDbPath(): string {
  return process.env.HASNA_FILES_DB_PATH ?? process.env.FILES_DB_PATH ?? join(getDataDir(), "files.db");
}

let _db: Database | null = null;
let _dbPath: string | null = null;

export const DB_PATH = getDbPath();

export function getDb(): Database {
  const dbPath = getDbPath();
  if (_db && _dbPath === dbPath) return _db;
  _db?.close();
  _db = new Database(dbPath, { create: true });
  _dbPath = dbPath;
  _db.exec("PRAGMA busy_timeout=5000");
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA foreign_keys=ON");
  _db.exec("PRAGMA synchronous=NORMAL");
  migrate(_db);
  _db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return _db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all().map((r) => r.version)
  );

  const migrations: Array<{ version: number; sql: string }> = [
    { version: 1, sql: migration_v1 },
    { version: 2, sql: migration_v2 },
    { version: 3, sql: migration_v3 },
    { version: 4, sql: migration_v4 },
    { version: 5, sql: migration_v5 },
    { version: 6, sql: migration_v6 },
    { version: 7, sql: migration_v7 },
    { version: 8, sql: migration_v8 },
    { version: 9, sql: migration_v9 },
    { version: 10, sql: migration_v10 },
    { version: 11, sql: migration_v11 },
    { version: 12, sql: migration_v12 },
    { version: 13, sql: migration_v13 },
    { version: 14, sql: migration_v14 },
    { version: 15, sql: migration_v15 },
    { version: 16, sql: migration_v16 },
    { version: 17, sql: migration_v17 },
    { version: 18, sql: migration_v18 },
    { version: 19, sql: migration_v19 },
    { version: 20, sql: migration_v20 },
    { version: 21, sql: migration_v21 },
  ];

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      if (m.version === 15) applyMigrationV15(db);
      else db.exec(m.sql);
      db.run("INSERT INTO schema_migrations (version) VALUES (?)", [m.version]);
    })();
  }
}

// v1: core tables
const migration_v1 = `
  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('local', 's3')),
    path TEXT,
    bucket TEXT,
    prefix TEXT,
    region TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_indexed_at TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
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
    indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, path)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS file_tags (
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (file_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_files (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, file_id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id);
  CREATE INDEX IF NOT EXISTS idx_files_machine ON files(machine_id);
  CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
  CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
  CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
  CREATE INDEX IF NOT EXISTS idx_sources_machine ON sources(machine_id);
  CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
`;

// v2: FTS5 for search
const migration_v2 = `
  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    id UNINDEXED,
    name,
    path,
    ext,
    mime,
    tags,
    content='',
    tokenize='unicode61'
  );
`;

// v3: peers table
const migration_v3 = `
  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT,
    auto_sync INTEGER NOT NULL DEFAULT 0,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// v4: file normalization + agents + activity
const migration_v4 = `
  ALTER TABLE files ADD COLUMN original_name TEXT;
  ALTER TABLE files ADD COLUMN canonical_name TEXT;

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    session_id TEXT,
    project_id TEXT,
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_activity (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    session_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activity_agent ON agent_activity(agent_id);
  CREATE INDEX IF NOT EXISTS idx_activity_file ON agent_activity(file_id);
  CREATE INDEX IF NOT EXISTS idx_activity_action ON agent_activity(action);
  CREATE INDEX IF NOT EXISTS idx_activity_session ON agent_activity(session_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON agent_activity(created_at);
  CREATE INDEX IF NOT EXISTS idx_files_canonical ON files(canonical_name);
`;

// v5: smart collections + project enhancements
const migration_v5 = `
  ALTER TABLE collections ADD COLUMN parent_id TEXT REFERENCES collections(id);
  ALTER TABLE collections ADD COLUMN auto_rules TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE collections ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

  ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE projects ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
`;

// v6: sync improvements
const migration_v6 = `
  ALTER TABLE files ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE files ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local_only';
  ALTER TABLE peers ADD COLUMN last_sync_version INTEGER NOT NULL DEFAULT 0;
`;

// v7: file descriptions for search enrichment
const migration_v7 = `
  ALTER TABLE files ADD COLUMN description TEXT NOT NULL DEFAULT '';
`;

// v8: rebuild FTS5 with description + canonical_name (content-bearing so id is retrievable)
const migration_v8 = `
  DROP TABLE IF EXISTS files_fts;
  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    id UNINDEXED,
    name,
    path,
    ext,
    mime,
    tags,
    canonical_name,
    description,
    tokenize='unicode61'
  );
`;

// v9: google drive sources + import state
const migration_v9 = `
  PRAGMA foreign_keys=OFF;
  PRAGMA legacy_alter_table=ON;

  ALTER TABLE sources RENAME TO sources_old;

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('local', 's3', 'google_drive')),
    path TEXT,
    bucket TEXT,
    prefix TEXT,
    region TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_indexed_at TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT INTO sources (
    id, name, type, path, bucket, prefix, region, config, machine_id,
    enabled, last_indexed_at, file_count, created_at, updated_at
  )
  SELECT
    id, name, type, path, bucket, prefix, region, config, machine_id,
    enabled, last_indexed_at, file_count, created_at, updated_at
  FROM sources_old;

  DROP TABLE sources_old;

  CREATE INDEX IF NOT EXISTS idx_sources_machine ON sources(machine_id);
  CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);

  CREATE TABLE IF NOT EXISTS google_drive_sync_state (
    source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    last_synced_at TEXT,
    last_full_scan_at TEXT,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS google_drive_imported_objects (
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    drive_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    parent_id TEXT,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT,
    version TEXT,
    hash TEXT,
    s3_key TEXT NOT NULL,
    file_record_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    deleted INTEGER NOT NULL DEFAULT 0,
    last_imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_id, drive_id, file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_s3_key
    ON google_drive_imported_objects(source_id, s3_key);
  CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_file_record
    ON google_drive_imported_objects(file_record_id);

  PRAGMA legacy_alter_table=OFF;
  PRAGMA foreign_keys=ON;
`;

// v10: destination-aware google drive imports (S3 default, local override)
const migration_v10 = `
  CREATE TABLE IF NOT EXISTS sources_old (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('local', 's3', 'google_drive')),
    path TEXT,
    bucket TEXT,
    prefix TEXT,
    region TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_indexed_at TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR REPLACE INTO sources_old (
    id, name, type, path, bucket, prefix, region, config, machine_id,
    enabled, last_indexed_at, file_count, created_at, updated_at
  )
  SELECT
    id, name, type, path, bucket, prefix, region, config, machine_id,
    enabled, last_indexed_at, file_count, created_at, updated_at
  FROM sources;

  CREATE TRIGGER IF NOT EXISTS trg_sources_old_insert
  AFTER INSERT ON sources
  BEGIN
    INSERT OR REPLACE INTO sources_old (
      id, name, type, path, bucket, prefix, region, config, machine_id,
      enabled, last_indexed_at, file_count, created_at, updated_at
    )
    VALUES (
      NEW.id, NEW.name, NEW.type, NEW.path, NEW.bucket, NEW.prefix, NEW.region, NEW.config, NEW.machine_id,
      NEW.enabled, NEW.last_indexed_at, NEW.file_count, NEW.created_at, NEW.updated_at
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sources_old_update
  AFTER UPDATE ON sources
  BEGIN
    UPDATE sources_old
    SET name = NEW.name,
        type = NEW.type,
        path = NEW.path,
        bucket = NEW.bucket,
        prefix = NEW.prefix,
        region = NEW.region,
        config = NEW.config,
        machine_id = NEW.machine_id,
        enabled = NEW.enabled,
        last_indexed_at = NEW.last_indexed_at,
        file_count = NEW.file_count,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at
    WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sources_old_delete
  AFTER DELETE ON sources
  BEGIN
    DELETE FROM sources_old WHERE id = OLD.id;
  END;

  ALTER TABLE google_drive_imported_objects ADD COLUMN profile TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN storage_type TEXT NOT NULL DEFAULT 's3';
  ALTER TABLE google_drive_imported_objects ADD COLUMN storage_key TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN destination_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL;

  UPDATE google_drive_imported_objects
  SET storage_key = s3_key
  WHERE storage_key IS NULL;

  CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_storage
    ON google_drive_imported_objects(source_id, storage_type, storage_key);
  CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_destination
    ON google_drive_imported_objects(destination_source_id);
`;

// v11: shared evidence vault metadata for internal apps
const migration_v11 = `
  CREATE TABLE IF NOT EXISTS file_assets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    company_id TEXT,
    app TEXT NOT NULL,
    kind TEXT NOT NULL,
    classification TEXT NOT NULL DEFAULT 'general',
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL,
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
    legal_hold INTEGER NOT NULL DEFAULT 0,
    immutable INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at TEXT
  );

  CREATE TABLE IF NOT EXISTS file_upload_intents (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT 'PUT',
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired', 'cancelled')),
    expected_checksum TEXT NOT NULL,
    expected_checksum_algorithm TEXT NOT NULL DEFAULT 'sha256',
    expected_size INTEGER NOT NULL,
    required_headers TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS file_links (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    company_id TEXT,
    app TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(asset_id, app, source_type, source_id, kind)
  );

  CREATE TABLE IF NOT EXISTS file_access_events (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    company_id TEXT,
    app TEXT,
    actor_id TEXT,
    action TEXT NOT NULL,
    purpose TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_file_assets_org ON file_assets(org_id);
  CREATE INDEX IF NOT EXISTS idx_file_assets_company ON file_assets(org_id, company_id);
  CREATE INDEX IF NOT EXISTS idx_file_assets_app_kind ON file_assets(app, kind);
  CREATE INDEX IF NOT EXISTS idx_file_assets_checksum ON file_assets(checksum_algorithm, checksum);
  CREATE INDEX IF NOT EXISTS idx_file_assets_status ON file_assets(status, scan_status);
  CREATE INDEX IF NOT EXISTS idx_file_assets_retention ON file_assets(retention_until);
  CREATE INDEX IF NOT EXISTS idx_file_upload_intents_asset ON file_upload_intents(asset_id);
  CREATE INDEX IF NOT EXISTS idx_file_upload_intents_status ON file_upload_intents(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_file_links_asset ON file_links(asset_id);
  CREATE INDEX IF NOT EXISTS idx_file_links_source ON file_links(app, source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_file_access_events_asset ON file_access_events(asset_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_file_access_events_org ON file_access_events(org_id, created_at);
`;

// v12: canonical Google Drive object mapping for Hasna XYZ S3 migration
const migration_v12 = `
  ALTER TABLE google_drive_imported_objects ADD COLUMN raw_bucket TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN raw_key TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN canonical_bucket TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN canonical_key TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN canonical_sha256 TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN promotion_action TEXT;
  ALTER TABLE google_drive_imported_objects ADD COLUMN promotion_status TEXT;

  CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_canonical_key
    ON google_drive_imported_objects(canonical_bucket, canonical_key);
  CREATE INDEX IF NOT EXISTS idx_google_drive_imported_objects_canonical_sha256
    ON google_drive_imported_objects(canonical_sha256);
`;

// v13: Drive archive organization/review workflow
const migration_v13 = `
  CREATE TABLE IF NOT EXISTS file_organization_reviews (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS file_organization_events (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_status
    ON file_organization_reviews(review_status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_root
    ON file_organization_reviews(profile, root_type);
  CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_owner
    ON file_organization_reviews(owner, review_status);
  CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_duplicate
    ON file_organization_reviews(duplicate_group_id);
  CREATE INDEX IF NOT EXISTS idx_file_organization_events_review
    ON file_organization_events(review_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_file_organization_events_file
    ON file_organization_events(file_id, created_at);
`;

// v14: remove local one-off locks that pinned the first Drive archive source to legacy S3.
const migration_v14 = `
  DROP TRIGGER IF EXISTS guard_google_drive_destination_p8;
  DROP TRIGGER IF EXISTS guard_prod_emails_source_p8;
`;

// v15: explicit Drive ACL/permission review state for Google Drive replacement.
const migration_v15 = `
  ALTER TABLE file_organization_reviews ADD COLUMN acl_review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK(acl_review_status IN ('needs_review', 'approved', 'restricted', 'external_review', 'unknown'));
  ALTER TABLE file_organization_reviews ADD COLUMN permission_scope TEXT NOT NULL DEFAULT 'unknown'
    CHECK(permission_scope IN ('unknown', 'private', 'domain', 'shared_drive', 'external', 'public', 'mixed'));
  ALTER TABLE file_organization_reviews ADD COLUMN permission_risk TEXT NOT NULL DEFAULT 'unknown'
    CHECK(permission_risk IN ('unknown', 'low', 'medium', 'high'));
  ALTER TABLE file_organization_reviews ADD COLUMN permission_notes TEXT;
  ALTER TABLE file_organization_reviews ADD COLUMN permissions_metadata TEXT NOT NULL DEFAULT '{}';

  CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_acl
    ON file_organization_reviews(acl_review_status, permission_risk);
`;

// v16: immutable file revision identities for source refs and knowledge indexing.
const migration_v16 = `
  CREATE TABLE IF NOT EXISTS file_versions (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    source_ref TEXT NOT NULL UNIQUE,
    revision_identity TEXT NOT NULL,
    content_hash_algorithm TEXT NOT NULL DEFAULT 'unknown',
    content_hash TEXT,
    size INTEGER NOT NULL DEFAULT 0,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(file_id, revision_identity)
  );

  INSERT OR IGNORE INTO file_versions (
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
  FROM (
    SELECT
      'rev_' || lower(hex(randomblob(10))) AS revision_id,
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
        CAST(f.size AS TEXT) || '|' ||
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
      json_object(
        'source_type', s.type,
        'source_name', s.name,
        'source_prefix', s.prefix,
        'google_drive_source_id', g.source_id,
        'google_drive_file_id', g.file_id,
        'google_drive_drive_id', g.drive_id,
        'raw_bucket', g.raw_bucket,
        'raw_key', g.raw_key,
        'destination_source_id', g.destination_source_id
      ) AS source_provenance,
      f.created_at AS created_at
    FROM files f
    JOIN sources s ON s.id = f.source_id
    LEFT JOIN google_drive_imported_objects g
      ON g.file_record_id = f.id AND g.deleted = 0
    LEFT JOIN sources ds ON ds.id = g.destination_source_id
  );

  CREATE INDEX IF NOT EXISTS idx_file_versions_file
    ON file_versions(file_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_file_versions_source
    ON file_versions(source_id, source_path);
  CREATE INDEX IF NOT EXISTS idx_file_versions_hash
    ON file_versions(content_hash_algorithm, content_hash);
  CREATE INDEX IF NOT EXISTS idx_file_versions_storage
    ON file_versions(storage_provider, bucket, object_key);
`;

// v17: first-class immutable S3 object identity records.
const migration_v17 = `
  CREATE TABLE IF NOT EXISTS s3_objects (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    identity TEXT NOT NULL UNIQUE,
    bucket TEXT NOT NULL,
    region TEXT,
    object_key TEXT NOT NULL,
    version_id TEXT,
    etag TEXT,
    checksum_sha256 TEXT,
    size INTEGER NOT NULL DEFAULT 0,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE file_versions ADD COLUMN s3_object_id TEXT REFERENCES s3_objects(id) ON DELETE SET NULL;

  CREATE INDEX IF NOT EXISTS idx_s3_objects_bucket_key
    ON s3_objects(bucket, object_key);
  CREATE INDEX IF NOT EXISTS idx_s3_objects_checksum
    ON s3_objects(checksum_sha256);
  CREATE INDEX IF NOT EXISTS idx_s3_objects_source
    ON s3_objects(source_id, object_key);
  CREATE INDEX IF NOT EXISTS idx_s3_objects_scope
    ON s3_objects(org_id, company_id, project_id, app);
  CREATE INDEX IF NOT EXISTS idx_file_versions_s3_object
    ON file_versions(s3_object_id);
`;

// v18: durable source change outbox for open-knowledge reindexing.
const migration_v18 = `
  CREATE TABLE IF NOT EXISTS knowledge_source_outbox_events (
    id TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL UNIQUE,
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
    size INTEGER,
    mime TEXT,
    path TEXT,
    idempotency_key TEXT UNIQUE,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge_source_outbox_checkpoints (
    consumer_id TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_cursor
    ON knowledge_source_outbox_events(cursor);
  CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_type
    ON knowledge_source_outbox_events(event_type, cursor);
  CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_file
    ON knowledge_source_outbox_events(file_id, cursor);
  CREATE INDEX IF NOT EXISTS idx_knowledge_source_outbox_source
    ON knowledge_source_outbox_events(source_id, cursor);
`;

// v19: include organization metadata in the file FTS surface.
const migration_v19 = `
  DROP TABLE IF EXISTS files_fts;
  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    id UNINDEXED,
    name,
    path,
    ext,
    mime,
    tags,
    canonical_name,
    description,
    organization_owner,
    organization_target_path,
    organization_labels,
    organization_status,
    tokenize='unicode61'
  );

  INSERT INTO files_fts (
    id,
    name,
    path,
    ext,
    mime,
    tags,
    canonical_name,
    description,
    organization_owner,
    organization_target_path,
    organization_labels,
    organization_status
  )
  SELECT
    f.id,
    f.name,
    f.path,
    f.ext,
    f.mime,
    COALESCE((
      SELECT group_concat(t.name, ' ')
      FROM tags t
      JOIN file_tags ft ON ft.tag_id = t.id
      WHERE ft.file_id = f.id
    ), ''),
    COALESCE(f.canonical_name, ''),
    COALESCE(f.description, ''),
    COALESCE(r.owner, ''),
    COALESCE(r.target_path, ''),
    COALESCE(r.labels, ''),
    COALESCE(r.review_status, '')
  FROM files f
  LEFT JOIN file_organization_reviews r ON r.file_id = f.id;
`;

// v20: derived search documents for extracted/OCR/transcript/AI summary artifacts.
const migration_v20 = `
  CREATE TABLE IF NOT EXISTS file_search_documents (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES file_versions(id) ON DELETE SET NULL,
    source_ref TEXT NOT NULL,
    kind TEXT NOT NULL
      CHECK(kind IN (
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
    status TEXT NOT NULL DEFAULT 'ready'
      CHECK(status IN ('ready', 'partial', 'unsupported', 'error', 'stale')),
    private INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(file_id, kind, source_ref, content_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_file_search_documents_file
    ON file_search_documents(file_id, status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_file_search_documents_kind
    ON file_search_documents(kind, status);
  CREATE INDEX IF NOT EXISTS idx_file_search_documents_revision
    ON file_search_documents(revision_id);
  CREATE INDEX IF NOT EXISTS idx_file_search_documents_hash
    ON file_search_documents(content_hash);

  CREATE VIRTUAL TABLE IF NOT EXISTS file_search_documents_fts USING fts5(
    document_id UNINDEXED,
    file_id UNINDEXED,
    kind,
    extractor,
    searchable_text,
    metadata,
    tokenize='unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS trg_file_search_documents_delete
  AFTER DELETE ON file_search_documents
  BEGIN
    DELETE FROM file_search_documents_fts WHERE document_id = OLD.id;
  END;
`;

// v21: immutable evidence authority metadata and deterministic replay identity.
const migration_v21 = `
  ALTER TABLE file_assets ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE file_assets ADD COLUMN provenance_type TEXT NOT NULL DEFAULT 'legacy';
  ALTER TABLE file_assets ADD COLUMN provenance_id TEXT;
  ALTER TABLE file_assets ADD COLUMN provenance_ref TEXT;
  ALTER TABLE file_assets ADD COLUMN external_references TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE file_assets ADD COLUMN idempotency_key TEXT;

  CREATE INDEX IF NOT EXISTS idx_file_assets_provenance
    ON file_assets(provenance_type, provenance_id, version);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_file_assets_idempotency_key
    ON file_assets(org_id, app, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
`;

function applyMigrationV15(db: Database): void {
  const columns = new Set(
    db.query<{ name: string }, []>("PRAGMA table_info(file_organization_reviews)").all().map((row) => row.name),
  );
  const addColumn = (name: string, sql: string) => {
    if (!columns.has(name)) db.exec(sql);
  };

  addColumn("acl_review_status", `ALTER TABLE file_organization_reviews ADD COLUMN acl_review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK(acl_review_status IN ('needs_review', 'approved', 'restricted', 'external_review', 'unknown'))`);
  addColumn("permission_scope", `ALTER TABLE file_organization_reviews ADD COLUMN permission_scope TEXT NOT NULL DEFAULT 'unknown'
    CHECK(permission_scope IN ('unknown', 'private', 'domain', 'shared_drive', 'external', 'public', 'mixed'))`);
  addColumn("permission_risk", `ALTER TABLE file_organization_reviews ADD COLUMN permission_risk TEXT NOT NULL DEFAULT 'unknown'
    CHECK(permission_risk IN ('unknown', 'low', 'medium', 'high'))`);
  addColumn("permission_notes", "ALTER TABLE file_organization_reviews ADD COLUMN permission_notes TEXT");
  addColumn("permissions_metadata", "ALTER TABLE file_organization_reviews ADD COLUMN permissions_metadata TEXT NOT NULL DEFAULT '{}'");

  db.exec(`CREATE INDEX IF NOT EXISTS idx_file_organization_reviews_acl
    ON file_organization_reviews(acl_review_status, permission_risk)`);
}

export function closeDb(): void {
  _db?.close();
  _db = null;
  _dbPath = null;
}
