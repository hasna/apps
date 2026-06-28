// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/knowledge-db.ts
import { Database } from "bun:sqlite";

// src/workspace.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");
var EXAMPLE_KNOWLEDGE_CANONICAL = {
  division: "xyz",
  app_type: "opensource",
  app: "knowledge",
  env: "prod",
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: "example-knowledge-prod",
    region: "us-east-1",
    profile: "example-infra",
    prefix: ".hasna/knowledge",
    server_side_encryption: "AES256"
  },
  secrets: {
    env: "example/knowledge/prod/env",
    aws: "example/knowledge/prod/aws",
    s3: "example/knowledge/prod/s3",
    rds: null,
    future_rds: "example/knowledge/prod/rds"
  },
  source_owner: "open-files",
  evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md"
};
function canonicalExampleKnowledgeStorage() {
  return {
    type: "s3",
    artifacts_root: "artifacts",
    s3: {
      bucket: EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: EXAMPLE_KNOWLEDGE_CANONICAL.s3.prefix,
      region: EXAMPLE_KNOWLEDGE_CANONICAL.s3.region,
      profile: EXAMPLE_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: EXAMPLE_KNOWLEDGE_CANONICAL.s3.server_side_encryption
    }
  };
}
function legacyGlobalStorePath() {
  return join(homedir(), ".open-knowledge", "db.json");
}
function globalKnowledgeHome() {
  return join(homedir(), ".hasna", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function legacyGlobalKnowledgeHome() {
  return join(homedir(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function legacyProjectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function resolveLegacyScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(legacyProjectKnowledgeHome(cwd));
  }
  return workspaceForHome(legacyGlobalKnowledgeHome());
}
function workspaceForHome(home) {
  return {
    home,
    configPath: join(home, "config.json"),
    jsonStorePath: join(home, "db.json"),
    knowledgeDbPath: join(home, "knowledge.db"),
    artifactsDir: join(home, "artifacts"),
    cacheDir: join(home, "cache"),
    exportsDir: join(home, "exports"),
    indexesDir: join(home, "indexes"),
    logsDir: join(home, "logs"),
    runsDir: join(home, "runs"),
    schemasDir: join(home, "schemas"),
    wikiDir: join(home, "wiki")
  };
}
function defaultKnowledgeConfig() {
  return {
    version: 1,
    mode: "local",
    hosted: {
      api_url: "https://knowledge.hasna.xyz"
    },
    storage: {
      type: "local",
      artifacts_root: "artifacts"
    },
    sources: {
      preferred_ref: "open-files",
      allowed_schemes: ["open-files", "s3", "file", "https", "http"]
    },
    providers: {
      default_model: "openai:gpt-5.2",
      aliases: {
        fast: "openai:gpt-5-mini",
        reasoning: "anthropic:claude-opus-4-6",
        sonnet: "anthropic:claude-sonnet-4-6",
        deepseek: "deepseek:deepseek-chat",
        "deepseek-reasoning": "deepseek:deepseek-reasoner"
      },
      openai: {
        api_key_env: "OPENAI_API_KEY",
        default_model: "gpt-5.2"
      },
      anthropic: {
        api_key_env: "ANTHROPIC_API_KEY",
        default_model: "claude-sonnet-4-6"
      },
      deepseek: {
        api_key_env: "DEEPSEEK_API_KEY",
        default_model: "deepseek-chat"
      }
    },
    embeddings: {
      default_model: "openai:text-embedding-3-small",
      dimensions: 1536,
      batch_size: 64,
      max_parallel_calls: 4
    },
    safety: {
      network: {
        web_search_enabled: false,
        s3_reads_enabled: false,
        allowed_s3_buckets: []
      },
      redaction: {
        enabled: true
      },
      approvals: {
        generated_writes_require_approval: true
      }
    }
  };
}
function ensureKnowledgeWorkspace(home) {
  const workspace = workspaceForHome(home);
  mkdirSync(workspace.home, { recursive: true });
  for (const dir of [
    workspace.artifactsDir,
    workspace.cacheDir,
    workspace.exportsDir,
    workspace.indexesDir,
    workspace.logsDir,
    workspace.runsDir,
    workspace.schemasDir,
    workspace.wikiDir
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
`);
  }
  return workspace;
}
function resolveScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(projectKnowledgeHome(cwd));
  }
  return workspaceForHome(globalKnowledgeHome());
}
function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}
function readKnowledgeConfig(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}
`);
}

// src/knowledge-db.ts
var CURRENT_SCHEMA_VERSION = 7;
var MIGRATION_1 = `
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
var MIGRATION_2 = `
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
var MIGRATION_3 = `
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
var MIGRATION_4 = `
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
var MIGRATION_5 = `
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
var MIGRATION_6 = `
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
var MIGRATION_7_TABLES_AND_INDEXES = `
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
function openKnowledgeDb(path) {
  ensureParentDir(path);
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
function migrateKnowledgeDb(path) {
  const db = openKnowledgeDb(path);
  try {
    db.exec(MIGRATION_1);
    if (getSchemaVersion(db) < 2)
      db.exec(MIGRATION_2);
    if (getSchemaVersion(db) < 3)
      db.exec(MIGRATION_3);
    if (getSchemaVersion(db) < 4)
      db.exec(MIGRATION_4);
    if (getSchemaVersion(db) < 5)
      db.exec(MIGRATION_5);
    if (getSchemaVersion(db) < 6)
      db.exec(MIGRATION_6);
    if (needsMigration7(db))
      applyMigration7(db);
    return { path, schema_version: getSchemaVersion(db) };
  } finally {
    db.close();
  }
}
function getSchemaVersion(db) {
  const row = db.query("SELECT MAX(version) AS version FROM schema_versions").get();
  return row?.version ?? 0;
}
function count(db, table) {
  const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}
function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function tableExists(db, table) {
  const row = db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?").get(table);
  return Boolean(row);
}
function columnExists(db, table, column) {
  if (!tableExists(db, table))
    return false;
  const columns = db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return columns.some((row) => row.name === column);
}
function ensureColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition};`);
  }
}
function needsMigration7(db) {
  return getSchemaVersion(db) < 7 || !columnExists(db, "knowledge_sync_changes", "logical_clock") || !columnExists(db, "knowledge_sync_changes", "bundle_id") || !tableExists(db, "knowledge_sync_table_clocks") || !tableExists(db, "knowledge_sync_imports");
}
function applyMigration7(db) {
  if (!tableExists(db, "knowledge_sync_changes"))
    db.exec(MIGRATION_6);
  ensureColumn(db, "knowledge_sync_changes", "logical_clock", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "knowledge_sync_changes", "bundle_id", "TEXT");
  db.exec(MIGRATION_7_TABLES_AND_INDEXES);
}
function getKnowledgeDbStats(path) {
  const db = openKnowledgeDb(path);
  try {
    return {
      schema_version: getSchemaVersion(db),
      sources: count(db, "sources"),
      source_revisions: count(db, "source_revisions"),
      chunks: count(db, "chunks"),
      wiki_pages: count(db, "wiki_pages"),
      citations: count(db, "citations"),
      indexes: count(db, "knowledge_indexes"),
      runs: count(db, "runs"),
      run_events: count(db, "run_events"),
      redaction_findings: count(db, "redaction_findings"),
      audit_events: count(db, "audit_events"),
      approval_gates: count(db, "approval_gates"),
      storage_objects: count(db, "storage_objects"),
      embeddings: count(db, "chunk_embeddings"),
      vector_entries: count(db, "vector_index_entries"),
      reindex_queue: count(db, "reindex_queue"),
      knowledge_machines: count(db, "knowledge_machines"),
      sync_snapshots: count(db, "knowledge_sync_snapshots"),
      sync_changes: count(db, "knowledge_sync_changes"),
      sync_conflicts: count(db, "knowledge_sync_conflicts"),
      sync_table_clocks: count(db, "knowledge_sync_table_clocks"),
      sync_imports: count(db, "knowledge_sync_imports")
    };
  } finally {
    db.close();
  }
}

// src/db/pg-migrations.ts
var PG_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    acl_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    artifact_uri TEXT,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS source_revisions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    hash TEXT,
    extracted_text_uri TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(source_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_backlinks (
    from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(from_page_id, to_page_id)
  )`,
  `CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    source_uri TEXT NOT NULL,
    quote TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_indexes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    artifact_uri TEXT,
    shard_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, name, shard_key)
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    prompt TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS provider_usage (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS redaction_findings (
    id TEXT PRIMARY KEY,
    source_uri TEXT,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    severity TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS storage_objects (
    id TEXT PRIMARY KEY,
    artifact_uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    content_type TEXT,
    hash TEXT,
    size_bytes INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    action TEXT NOT NULL,
    target_uri TEXT,
    decision TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS approval_gates (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_uri TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    approved_by TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS vector_index_entries (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    vector_norm DOUBLE PRECISION NOT NULL,
    source_uri TEXT,
    source_ref TEXT,
    revision TEXT,
    hash TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    token_count INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,
  `CREATE TABLE IF NOT EXISTS reindex_queue (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_uri TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, target_id, reason)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_machines (
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
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    workspace_home TEXT NOT NULL,
    sqlite_schema_version INTEGER NOT NULL,
    artifact_root_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tables_json TEXT NOT NULL,
    artifact_hashes_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
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
    logical_clock INTEGER NOT NULL DEFAULT 0,
    bundle_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS logical_clock INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS bundle_id TEXT`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
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
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
    table_name TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    high_water_hash TEXT,
    high_water_bundle_id TEXT,
    origin_machine_id TEXT,
    updated_by_machine_id TEXT,
    last_applied_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(table_name, machine_id)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_revisions_source ON source_revisions(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_source_revision ON chunks(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_wiki_page ON chunks(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_wiki_page ON citations(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_chunk ON citations(chunk_id)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_usage_run ON provider_usage(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status)`
];

// src/db/remote-storage.ts
import pg from "pg";
function translatePlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}
function normalizeParams(params) {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}
function sslConfigFor(connectionString) {
  return connectionString.includes("sslmode=require") || connectionString.includes("ssl=true") ? { rejectUnauthorized: false } : undefined;
}

class PgAdapterAsync {
  pool;
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, ssl: sslConfigFor(connectionString) });
  }
  async run(sql, ...params) {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }
  async all(sql, ...params) {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }
  async close() {
    await this.pool.end();
  }
}

// src/db/storage-sync.ts
var STORAGE_TABLES = [
  "sources",
  "wiki_pages",
  "source_revisions",
  "chunks",
  "chunk_embeddings",
  "wiki_backlinks",
  "citations",
  "knowledge_indexes",
  "runs",
  "run_events",
  "provider_usage",
  "redaction_findings",
  "storage_objects",
  "audit_events",
  "approval_gates",
  "vector_index_entries",
  "reindex_queue",
  "knowledge_machines",
  "knowledge_sync_snapshots",
  "knowledge_sync_changes",
  "knowledge_sync_conflicts",
  "knowledge_sync_table_clocks",
  "knowledge_sync_imports"
];
var KNOWLEDGE_STORAGE_TABLES = STORAGE_TABLES;
var KNOWLEDGE_STORAGE_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
var KNOWLEDGE_STORAGE_FALLBACK_ENV = "KNOWLEDGE_DATABASE_URL";
var KNOWLEDGE_STORAGE_MODE_ENV = "HASNA_KNOWLEDGE_STORAGE_MODE";
var KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = "KNOWLEDGE_STORAGE_MODE";
var STORAGE_DATABASE_ENV = [KNOWLEDGE_STORAGE_ENV, KNOWLEDGE_STORAGE_FALLBACK_ENV];
var STORAGE_MODE_ENV = [KNOWLEDGE_STORAGE_MODE_ENV, KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV];
var PRIMARY_KEYS = {
  sources: ["id"],
  wiki_pages: ["id"],
  source_revisions: ["id"],
  chunks: ["id"],
  chunk_embeddings: ["id"],
  wiki_backlinks: ["from_page_id", "to_page_id"],
  citations: ["id"],
  knowledge_indexes: ["id"],
  runs: ["id"],
  run_events: ["id"],
  provider_usage: ["id"],
  redaction_findings: ["id"],
  storage_objects: ["id"],
  audit_events: ["id"],
  approval_gates: ["id"],
  vector_index_entries: ["id"],
  reindex_queue: ["id"],
  knowledge_machines: ["machine_id"],
  knowledge_sync_snapshots: ["id"],
  knowledge_sync_changes: ["id"],
  knowledge_sync_conflicts: ["id"],
  knowledge_sync_table_clocks: ["table_name", "machine_id"],
  knowledge_sync_imports: ["bundle_id"]
};
function readEnv(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}
function normalizeStorageMode(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "remote")
    return normalized;
  return;
}
function openScopedDb(options = {}) {
  const workspace = ensureKnowledgeWorkspace(resolveScopedWorkspace(options.scope, options.cwd).home);
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return {
    db: openKnowledgeDb(workspace.knowledgeDbPath),
    path: workspace.knowledgeDbPath,
    scope: options.scope ?? "global"
  };
}
function getStorageDatabaseEnvName() {
  for (const name of STORAGE_DATABASE_ENV) {
    if (readEnv(name))
      return name;
  }
  return null;
}
function getStorageDatabaseEnv() {
  const name = getStorageDatabaseEnvName();
  return name ? { name } : null;
}
function getStorageDatabaseUrl() {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) ?? null : null;
}
function getStorageMode() {
  const mode = normalizeStorageMode(readEnv(KNOWLEDGE_STORAGE_MODE_ENV)) ?? normalizeStorageMode(readEnv(KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV));
  if (mode)
    return mode;
  return getStorageDatabaseUrl() ? "hybrid" : "local";
}
async function getStoragePg() {
  const url = getStorageDatabaseUrl();
  if (!url) {
    throw new Error("Missing HASNA_KNOWLEDGE_DATABASE_URL or KNOWLEDGE_DATABASE_URL");
  }
  return new PgAdapterAsync(url);
}
async function runStorageMigrations(remote) {
  await remote.run("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  for (const sql of PG_MIGRATIONS)
    await remote.run(sql);
}
async function storagePush(options = {}) {
  const remote = options.remote ?? await getStoragePg();
  const ownsRemote = !options.remote;
  const local = openScopedDb(options);
  try {
    await runStorageMigrations(remote);
    const results = [];
    for (const table of resolveTables(options.tables)) {
      results.push(await pushTable(local.db, remote, table));
    }
    recordSyncMeta(local.db, "push", results);
    return results;
  } finally {
    local.db.close();
    if (ownsRemote)
      await remote.close();
  }
}
async function storagePull(options = {}) {
  const remote = options.remote ?? await getStoragePg();
  const ownsRemote = !options.remote;
  const local = openScopedDb(options);
  try {
    await runStorageMigrations(remote);
    const results = [];
    for (const table of resolveTables(options.tables)) {
      results.push(await pullTable(remote, local.db, table));
    }
    recordSyncMeta(local.db, "pull", results);
    return results;
  } finally {
    local.db.close();
    if (ownsRemote)
      await remote.close();
  }
}
async function storageSync(options = {}) {
  const pull = await storagePull(options);
  const push = await storagePush(options);
  return { pull, push };
}
function getSyncMetaAll(options = {}) {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    return local.db.query("SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction").all();
  } finally {
    local.db.close();
  }
}
function getStorageStatus(options = {}) {
  const activeEnv = getStorageDatabaseEnv();
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    const sync = local.db.query("SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction").all();
    return {
      configured: Boolean(activeEnv),
      mode: getStorageMode(),
      env: STORAGE_DATABASE_ENV,
      activeEnv: activeEnv?.name ?? null,
      service: "knowledge",
      scope: local.scope,
      databasePath: local.path,
      tables: STORAGE_TABLES,
      sync
    };
  } finally {
    local.db.close();
  }
}
function resolveTables(tables) {
  if (!tables || tables.length === 0)
    return [...STORAGE_TABLES];
  const allowed = new Set(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0)
    throw new Error(`Unknown knowledge sync table(s): ${invalid.join(", ")}`);
  return requested;
}
function parseStorageTables(value) {
  if (!value)
    return;
  return resolveTables(Array.isArray(value) ? value : value.split(","));
}
async function pushTable(db, remote, table) {
  const result = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!tableExists2(db, table))
      return result;
    const rows = db.query(`SELECT * FROM ${quoteIdent(table)}`).all();
    result.rowsRead = rows.length;
    if (rows.length === 0)
      return result;
    const remoteColumns = await getRemoteColumns(remote, table);
    const columns = filterRemoteColumns(remoteColumns, Object.keys(rows[0]));
    result.rowsWritten = await upsertPg(remote, table, columns, rows, remoteColumns);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}
async function pullTable(remote, db, table) {
  const result = { table, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    if (!tableExists2(db, table))
      return result;
    const rows = await remote.all(`SELECT * FROM ${quoteIdent(table)}`);
    result.rowsRead = rows.length;
    if (rows.length === 0)
      return result;
    const columns = filterLocalColumns(db, table, Object.keys(rows[0]));
    result.rowsWritten = upsertSqlite(db, table, columns, rows);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}
async function getRemoteColumns(remote, table) {
  const rows = await remote.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", table);
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}
function filterRemoteColumns(remoteColumns, columns) {
  if (remoteColumns.size === 0)
    return columns;
  return columns.filter((column) => remoteColumns.has(column));
}
function filterLocalColumns(db, table, columns) {
  const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all();
  const allowed = new Set(rows.map((row) => row.name));
  return columns.filter((column) => allowed.has(column));
}
async function upsertPg(remote, table, columns, rows, remoteColumns) {
  if (columns.length === 0)
    return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0];
  const setClause = updateColumns.length > 0 ? updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ") : `${quoteIdent(fallbackKey)} = EXCLUDED.${quoteIdent(fallbackKey)}`;
  for (const row of rows) {
    await remote.run(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`, ...columns.map((column) => coerceForPg(row[column], remoteColumns.get(column))));
  }
  return rows.length;
}
function upsertSqlite(db, table, columns, rows) {
  if (columns.length === 0)
    return 0;
  const primaryKeys = PRIMARY_KEYS[table];
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0];
  const setClause = updateColumns.length > 0 ? updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(", ") : `${quoteIdent(fallbackKey)} = excluded.${quoteIdent(fallbackKey)}`;
  const statement = db.query(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`);
  const insert = db.transaction((batch) => {
    for (const row of batch)
      statement.run(...columns.map((column) => coerceForSqlite(row[column])));
  });
  insert(rows);
  return rows.length;
}
function recordSyncMeta(db, direction, results) {
  ensureSyncMetaTable(db);
  const now = new Date().toISOString();
  const statement = db.query(`
    INSERT INTO _knowledge_sync_meta (table_name, last_synced_at, direction)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, direction) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `);
  for (const result of results) {
    if (result.errors.length > 0)
      continue;
    statement.run(result.table, now, direction);
  }
}
function ensureSyncMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _knowledge_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}
function tableExists2(db, table) {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}
function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}
function coerceForPg(value, dataType) {
  if (value === undefined || value === null)
    return null;
  if (dataType === "boolean") {
    if (typeof value === "boolean")
      return value;
    if (typeof value === "number")
      return value !== 0;
    if (typeof value === "string")
      return value === "1" || value.toLowerCase() === "true";
  }
  if (value instanceof Date)
    return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return value;
  if (typeof value === "object")
    return JSON.stringify(value);
  return value;
}
function coerceForSqlite(value) {
  if (value === undefined || value === null)
    return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return value;
  if (value instanceof Date)
    return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return value;
  if (typeof value === "object")
    return JSON.stringify(value);
  return String(value);
}
export {
  storageSync,
  storagePush,
  storagePull,
  runStorageMigrations,
  resolveTables,
  parseStorageTables,
  getSyncMetaAll,
  getStorageStatus,
  getStoragePg,
  getStorageMode,
  getStorageDatabaseUrl,
  getStorageDatabaseEnvName,
  getStorageDatabaseEnv,
  STORAGE_TABLES,
  STORAGE_MODE_ENV,
  STORAGE_DATABASE_ENV,
  PgAdapterAsync,
  PG_MIGRATIONS,
  KNOWLEDGE_STORAGE_TABLES,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_ENV
};
