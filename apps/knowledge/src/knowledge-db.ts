import { Database } from 'bun:sqlite';
import { ensureParentDir } from './workspace';
import { usesKnowledgeHttpTransport } from './http-store';
import { KNOWLEDGE_API_URL_ENV } from './client-transport.js';

/**
 * The single choke point for every client-side sqlite catalog open. With the
 * HTTP transport selected, the on-box knowledge.db is NOT
 * the source of truth, and writing to it would be the split-brain the mission
 * forbids. Rather than silently touch local sqlite, we refuse loudly. Knowledge
 * items (notes) still flow through the server API; the local catalog subsystem
 * belongs to the on-box transport.
 * The HTTP server (src/serve) never calls this — it reads PostgreSQL
 * directly — so this guard applies to CLI/MCP/SDK clients only.
 * Recorded boundary decision (local-only-capability review, 2026-08-18):
 * docs/architecture/catalog-transport-boundary.md — the hosted half of the
 * catalog is a wrapper build with no server-side implementation at ea43dd336;
 * do not remove this guard without that build landing.
 */
export function assertSqliteClientTransport(operation = 'catalog'): void {
  if (usesKnowledgeHttpTransport()) {
    throw new Error(
      `knowledge: ${operation} builds/reads the on-box sqlite RAG catalog (source ingestion, chunk embeddings, `
        + `wiki compilation, cross-machine sync, machine registry). That local indexing pipeline is not available in `
        + `the HTTP client. Shared item commands route through the server API. Unset ${KNOWLEDGE_API_URL_ENV} `
        + `to use the full on-box catalog pipeline; run 'knowledge transport' to inspect the current route.`,
    );
  }
}

export const CURRENT_SCHEMA_VERSION = 10;

/**
 * FTS5 tokenizer for the chunk index. `porter` keeps English stemming; the
 * wrapped `unicode61 remove_diacritics 2` folds accents/diacritics fully
 * (level 2 also folds diacritics that level 1 leaves in place), so `cafe`
 * matches `café`. Kept in one constant so the create + rebuild paths never drift.
 */
export const CHUNKS_FTS_TOKENIZE = 'porter unicode61 remove_diacritics 2';

export interface KnowledgeDbStats {
  schema_version: number;
  sources: number;
  source_revisions: number;
  chunks: number;
  wiki_pages: number;
  citations: number;
  indexes: number;
  runs: number;
  run_events: number;
  redaction_findings: number;
  audit_events: number;
  approval_gates: number;
  storage_objects: number;
  embeddings: number;
  vector_entries: number;
  reindex_queue: number;
  knowledge_machines: number;
  sync_snapshots: number;
  sync_changes: number;
  sync_conflicts: number;
  sync_table_clocks: number;
  sync_imports: number;
  promotion_candidates: number;
  durable_records: number;
}

const MIGRATION_1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  acl_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  hash TEXT,
  extracted_text_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, revision)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  wiki_page_id TEXT,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_uri TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_backlinks (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_page_id, to_page_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_uri TEXT NOT NULL,
  quote TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_indexes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  artifact_uri TEXT,
  shard_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, name, shard_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redaction_findings (
  id TEXT PRIMARY KEY,
  source_uri TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,
  artifact_uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content_type TEXT,
  hash TEXT,
  size_bytes INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  title,
  source_uri,
  content='',
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (1, datetime('now'));
`;

const MIGRATION_2 = `
DROP TABLE IF EXISTS chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (2, datetime('now'));
`;

const MIGRATION_3 = `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uri TEXT,
  decision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_uri TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (3, datetime('now'));
`;

const MIGRATION_4 = `
CREATE TABLE IF NOT EXISTS vector_index_entries (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  vector_norm REAL NOT NULL,
  source_uri TEXT,
  source_ref TEXT,
  revision TEXT,
  hash TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  token_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri);
CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (4, datetime('now'));
`;

const MIGRATION_5 = `
CREATE TABLE IF NOT EXISTS reindex_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_uri TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, target_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (5, datetime('now'));
`;

const MIGRATION_6 = `
CREATE TABLE IF NOT EXISTS knowledge_machines (
  machine_id TEXT PRIMARY KEY,
  hostname TEXT,
  platform TEXT,
  user_label TEXT,
  workspace_home TEXT,
  tailscale_dns TEXT,
  tailscale_ips_json TEXT NOT NULL DEFAULT '[]',
  ssh_target TEXT,
  last_seen_at TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace_home TEXT NOT NULL,
  sqlite_schema_version INTEGER NOT NULL,
  artifact_root_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tables_json TEXT NOT NULL,
  artifact_hashes_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
  id TEXT PRIMARY KEY,
  origin_machine_id TEXT NOT NULL,
  updated_by_machine_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_hash TEXT,
  next_hash TEXT,
  source_ref TEXT,
  source_revision_id TEXT,
  artifact_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_machine_id TEXT NOT NULL,
  remote_machine_id TEXT NOT NULL,
  local_hash TEXT,
  remote_hash TEXT,
  base_hash TEXT,
  status TEXT NOT NULL,
  resolution_strategy TEXT,
  proposed_patch_uri TEXT,
  approved_by TEXT,
  resolved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash);
CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (6, datetime('now'));
`;

const MIGRATION_7_TABLES_AND_INDEXES = `
CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
  table_name TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  logical_clock INTEGER NOT NULL DEFAULT 0,
  high_water_hash TEXT,
  high_water_bundle_id TEXT,
  origin_machine_id TEXT,
  updated_by_machine_id TEXT,
  last_applied_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(table_name, machine_id)
);

CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
  bundle_id TEXT PRIMARY KEY,
  source_machine_id TEXT NOT NULL,
  target_machine_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  table_clocks_json TEXT NOT NULL,
  tables_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock);
CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id);
CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (7, datetime('now'));
`;

const MIGRATION_8_TABLES_AND_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_wiki_pages_lifecycle_status ON wiki_pages(status, valid_to);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_last_verified ON wiki_pages(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_supersedes ON wiki_pages(supersedes);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_superseded_by ON wiki_pages(superseded_by);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (8, datetime('now'));
`;

// Rebuild chunks_fts with the diacritic-folding tokenizer. The current index
// (MIGRATION_2) stores its column values, so the rebuild backfills losslessly
// from the existing rows — no re-ingest from source required. Idempotent:
// guarded by needsMigration9 (schema version AND live tokenizer inspection).
// Wrapped in a transaction so the DROP + CREATE + backfill are atomic: a crash
// mid-migration rolls back to the old index rather than leaving an empty one
// (which the tokenizer guard would then treat as already-migrated).
const MIGRATION_9_REBUILD_FTS = `
BEGIN;

CREATE TEMP TABLE _chunks_fts_backup AS
  SELECT chunk_id, text, title, source_uri FROM chunks_fts;

DROP TABLE chunks_fts;

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='${CHUNKS_FTS_TOKENIZE}'
);

INSERT INTO chunks_fts (chunk_id, text, title, source_uri)
  SELECT chunk_id, text, title, source_uri FROM _chunks_fts_backup;

DROP TABLE _chunks_fts_backup;

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (9, datetime('now'));

COMMIT;
`;

const MIGRATION_10_PROMOTION_INBOX = `
CREATE TABLE IF NOT EXISTS knowledge_promotion_candidates (
  id TEXT PRIMARY KEY,
  record_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  requires_approval INTEGER NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  duplicate_of TEXT,
  approved_by TEXT,
  promoted_record_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  promoted_at TEXT
);

CREATE TABLE IF NOT EXISTS durable_knowledge_records (
  id TEXT PRIMARY KEY,
  record_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  promoted_from_candidate_id TEXT NOT NULL UNIQUE
    REFERENCES knowledge_promotion_candidates(id) ON DELETE RESTRICT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_candidates_status
  ON knowledge_promotion_candidates(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_kind_key
  ON knowledge_promotion_candidates(record_kind, canonical_key);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_hash
  ON knowledge_promotion_candidates(record_kind, content_hash);
CREATE INDEX IF NOT EXISTS idx_durable_records_kind_key
  ON durable_knowledge_records(record_kind, canonical_key, status);
CREATE INDEX IF NOT EXISTS idx_durable_records_hash
  ON durable_knowledge_records(record_kind, content_hash, status);
CREATE INDEX IF NOT EXISTS idx_durable_records_validity
  ON durable_knowledge_records(status, valid_to);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (10, datetime('now'));
`;

export function openKnowledgeDb(path: string): Database {
  assertSqliteClientTransport('opening the local knowledge.db catalog');
  ensureParentDir(path);
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/**
 * Read-only open of the on-box knowledge.db, gated by the same HTTP-transport guard
 * as {@link openKnowledgeDb}. This is the ONLY sanctioned read-only sqlite entry
 * point (used by the workspace-migration integrity/summary tooling) so that every
 * client-side `new Database(...)` lives in this module behind the gate — no path
 * can silently read the local catalog while HTTP transport is active.
 */
export function openKnowledgeDbReadonly(path: string): Database {
  assertSqliteClientTransport('reading the local knowledge.db catalog');
  return new Database(path, { readonly: true });
}

export function migrateKnowledgeDb(path: string): { path: string; schema_version: number } {
  const db = openKnowledgeDb(path);
  try {
    db.exec(MIGRATION_1);
    if (getSchemaVersion(db) < 2) db.exec(MIGRATION_2);
    if (getSchemaVersion(db) < 3) db.exec(MIGRATION_3);
    if (getSchemaVersion(db) < 4) db.exec(MIGRATION_4);
    if (getSchemaVersion(db) < 5) db.exec(MIGRATION_5);
    if (getSchemaVersion(db) < 6) db.exec(MIGRATION_6);
    if (needsMigration7(db)) applyMigration7(db);
    if (needsMigration8(db)) applyMigration8(db);
    if (needsMigration9(db)) applyMigration9(db);
    if (needsMigration10(db)) applyMigration10(db);
    return { path, schema_version: getSchemaVersion(db) };
  } finally {
    db.close();
  }
}

export function getSchemaVersion(db: Database): number {
  const row = db.query<{ version: number }, []>('SELECT MAX(version) AS version FROM schema_versions').get();
  return row?.version ?? 0;
}

function count(db: Database, table: string): number {
  const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query<{ name: string }, [string]>(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?",
  ).get(table);
  return Boolean(row);
}

function columnExists(db: Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return columns.some((row) => row.name === column);
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition};`);
  }
}

function needsMigration7(db: Database): boolean {
  return getSchemaVersion(db) < 7
    || !columnExists(db, 'knowledge_sync_changes', 'logical_clock')
    || !columnExists(db, 'knowledge_sync_changes', 'bundle_id')
    || !tableExists(db, 'knowledge_sync_table_clocks')
    || !tableExists(db, 'knowledge_sync_imports');
}

function applyMigration7(db: Database): void {
  if (!tableExists(db, 'knowledge_sync_changes')) db.exec(MIGRATION_6);
  ensureColumn(db, 'knowledge_sync_changes', 'logical_clock', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'knowledge_sync_changes', 'bundle_id', 'TEXT');
  db.exec(MIGRATION_7_TABLES_AND_INDEXES);
}

function needsMigration8(db: Database): boolean {
  return getSchemaVersion(db) < 8
    || !columnExists(db, 'wiki_pages', 'valid_from')
    || !columnExists(db, 'wiki_pages', 'valid_to')
    || !columnExists(db, 'wiki_pages', 'supersedes')
    || !columnExists(db, 'wiki_pages', 'superseded_by')
    || !columnExists(db, 'wiki_pages', 'confidence')
    || !columnExists(db, 'wiki_pages', 'last_verified_at');
}

function applyMigration8(db: Database): void {
  if (!tableExists(db, 'wiki_pages')) db.exec(MIGRATION_1);
  ensureColumn(db, 'wiki_pages', 'valid_from', 'TEXT');
  ensureColumn(db, 'wiki_pages', 'valid_to', 'TEXT');
  ensureColumn(db, 'wiki_pages', 'supersedes', 'TEXT');
  ensureColumn(db, 'wiki_pages', 'superseded_by', 'TEXT');
  ensureColumn(db, 'wiki_pages', 'confidence', 'REAL');
  ensureColumn(db, 'wiki_pages', 'last_verified_at', 'TEXT');
  db.exec(`
    UPDATE wiki_pages
    SET valid_from = COALESCE(valid_from, created_at),
        last_verified_at = COALESCE(last_verified_at, updated_at),
        confidence = COALESCE(confidence, 0.8)
    WHERE valid_from IS NULL OR last_verified_at IS NULL OR confidence IS NULL;
  `);
  db.exec(MIGRATION_8_TABLES_AND_INDEXES);
}

function ftsUsesDiacriticFolding(db: Database): boolean {
  const row = db.query<{ sql: string | null }, [string]>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get('chunks_fts');
  return Boolean(row?.sql && row.sql.includes('remove_diacritics'));
}

function needsMigration9(db: Database): boolean {
  if (!tableExists(db, 'chunks_fts')) return false;
  return getSchemaVersion(db) < 9 || !ftsUsesDiacriticFolding(db);
}

function applyMigration9(db: Database): void {
  if (!tableExists(db, 'chunks_fts')) return;
  if (ftsUsesDiacriticFolding(db)) {
    db.exec("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (9, datetime('now'));");
    return;
  }
  db.exec(MIGRATION_9_REBUILD_FTS);
}

function needsMigration10(db: Database): boolean {
  return getSchemaVersion(db) < 10
    || !tableExists(db, 'knowledge_promotion_candidates')
    || !tableExists(db, 'durable_knowledge_records');
}

function applyMigration10(db: Database): void {
  db.exec(MIGRATION_10_PROMOTION_INBOX);
}

export function getKnowledgeDbStats(path: string): KnowledgeDbStats {
  const db = openKnowledgeDb(path);
  try {
    return {
      schema_version: getSchemaVersion(db),
      sources: count(db, 'sources'),
      source_revisions: count(db, 'source_revisions'),
      chunks: count(db, 'chunks'),
      wiki_pages: count(db, 'wiki_pages'),
      citations: count(db, 'citations'),
      indexes: count(db, 'knowledge_indexes'),
      runs: count(db, 'runs'),
      run_events: count(db, 'run_events'),
      redaction_findings: count(db, 'redaction_findings'),
      audit_events: count(db, 'audit_events'),
      approval_gates: count(db, 'approval_gates'),
      storage_objects: count(db, 'storage_objects'),
      embeddings: count(db, 'chunk_embeddings'),
      vector_entries: count(db, 'vector_index_entries'),
      reindex_queue: count(db, 'reindex_queue'),
      knowledge_machines: count(db, 'knowledge_machines'),
      sync_snapshots: count(db, 'knowledge_sync_snapshots'),
      sync_changes: count(db, 'knowledge_sync_changes'),
      sync_conflicts: count(db, 'knowledge_sync_conflicts'),
      sync_table_clocks: count(db, 'knowledge_sync_table_clocks'),
      sync_imports: count(db, 'knowledge_sync_imports'),
      promotion_candidates: count(db, 'knowledge_promotion_candidates'),
      durable_records: count(db, 'durable_knowledge_records'),
    };
  } finally {
    db.close();
  }
}
