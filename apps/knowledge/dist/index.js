// @bun
var __require = import.meta.require;

// src/knowledge-db.ts
import { Database } from "bun:sqlite";

// src/workspace.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");
var HASNA_XYZ_KNOWLEDGE_CANONICAL = {
  division: "xyz",
  app_type: "opensource",
  app: "knowledge",
  env: "prod",
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: "hasna-xyz-opensource-knowledge-prod",
    region: "us-east-1",
    profile: "hasna-xyz-infra",
    prefix: ".hasna/apps/knowledge",
    server_side_encryption: "AES256"
  },
  secrets: {
    env: "hasna/xyz/opensource/knowledge/prod/env",
    aws: "hasna/xyz/opensource/knowledge/prod/aws",
    s3: "hasna/xyz/opensource/knowledge/prod/s3",
    rds: null,
    future_rds: "hasna/xyz/opensource/knowledge/prod/rds"
  },
  source_owner: "open-files",
  evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md"
};
function canonicalHasnaXyzKnowledgeStorage() {
  return {
    type: "s3",
    artifacts_root: "artifacts",
    s3: {
      bucket: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.prefix,
      region: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.region,
      profile: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.server_side_encryption
    }
  };
}
function globalKnowledgeHome() {
  return join(homedir(), ".hasna", "apps", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
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
var CURRENT_SCHEMA_VERSION = 6;
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
      sync_conflicts: count(db, "knowledge_sync_conflicts")
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
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
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
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id)`
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
  "knowledge_sync_conflicts"
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
  knowledge_sync_conflicts: ["id"]
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
  const remote = await getStoragePg();
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
    await remote.close();
  }
}
async function storagePull(options = {}) {
  const remote = await getStoragePg();
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
    if (!tableExists(db, table))
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
    if (!tableExists(db, table))
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
function tableExists(db, table) {
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
// src/artifact-store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname2, join as join2, relative, sep } from "path";
function normalizeArtifactKey(key) {
  const raw = key.replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/")) {
    throw new Error(`Invalid artifact key: ${key}`);
  }
  const segments = raw.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid artifact key: ${key}`);
  }
  return segments.join("/");
}
function assertInside(root, target) {
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Artifact path escapes root: ${target}`);
  }
}

class LocalArtifactStore {
  root;
  type = "local";
  canRead = true;
  canWrite = true;
  constructor(root) {
    this.root = root;
    mkdirSync2(root, { recursive: true });
  }
  async put(entry) {
    const key = normalizeArtifactKey(entry.key);
    const path = join2(this.root, key);
    assertInside(this.root, path);
    mkdirSync2(dirname2(path), { recursive: true });
    writeFileSync2(path, entry.body);
    return { key, uri: `file://${path}` };
  }
  async getText(key) {
    const normalizedKey = normalizeArtifactKey(key);
    const path = join2(this.root, normalizedKey);
    assertInside(this.root, path);
    return readFileSync2(path, "utf8");
  }
  async exists(key) {
    const normalizedKey = normalizeArtifactKey(key);
    const path = join2(this.root, normalizedKey);
    assertInside(this.root, path);
    return existsSync2(path);
  }
}

class S3ArtifactStore {
  options;
  type = "s3";
  canRead = true;
  canWrite = true;
  client;
  constructor(options) {
    this.options = options;
    this.client = options.client;
  }
  async getClient() {
    if (this.client)
      return this.client;
    const [{ S3Client }, { fromIni }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/credential-providers")
    ]);
    this.client = new S3Client({
      region: this.options.region,
      credentials: this.options.profile ? fromIni({ profile: this.options.profile }) : undefined,
      maxAttempts: this.options.max_attempts
    });
    return this.client;
  }
  objectKey(key) {
    const normalizedKey = normalizeArtifactKey(key);
    const prefix = this.options.prefix ? normalizeArtifactKey(this.options.prefix) : "";
    return prefix ? `${prefix}/${normalizedKey}` : normalizedKey;
  }
  async put(entry) {
    const [{ PutObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      this.getClient()
    ]);
    const key = this.objectKey(entry.key);
    await client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: entry.body,
      ContentType: entry.content_type,
      Metadata: entry.metadata,
      ServerSideEncryption: this.options.server_side_encryption,
      SSEKMSKeyId: this.options.kms_key_id
    }));
    return { key, uri: `s3://${this.options.bucket}/${key}` };
  }
  async getText(key) {
    const [{ GetObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      this.getClient()
    ]);
    const objectKey = this.objectKey(key);
    const response = await client.send(new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey
    }));
    if (!response.Body)
      return "";
    return await response.Body.transformToString();
  }
  async exists(key) {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      this.getClient()
    ]);
    const objectKey = this.objectKey(key);
    try {
      await client.send(new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey
      }));
      return true;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "NotFound" || name === "NoSuchKey" || name === "NotFoundError")
        return false;
      throw error;
    }
  }
}
function createArtifactStore(config, workspace) {
  if (config.storage.type === "s3") {
    if (!config.storage.s3?.bucket)
      throw new Error("S3 artifact storage requires storage.s3.bucket");
    return new S3ArtifactStore({
      bucket: config.storage.s3.bucket,
      prefix: config.storage.s3.prefix,
      region: config.storage.s3.region,
      profile: config.storage.s3.profile,
      max_attempts: config.storage.s3.max_attempts,
      server_side_encryption: config.storage.s3.server_side_encryption,
      kms_key_id: config.storage.s3.kms_key_id
    });
  }
  return new LocalArtifactStore(workspace.artifactsDir);
}

// src/service.ts
import { spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync8 } from "fs";
import { join as join5, resolve as resolve4 } from "path";

// src/auth.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, unlinkSync, writeFileSync as writeFileSync3 } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname3, join as join3 } from "path";
var DEFAULT_KNOWLEDGE_API_URL = "https://knowledge.hasna.xyz";
function normalizeKnowledgeApiOrigin(apiUrl) {
  const url = new URL(apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Knowledge API URL must use http or https.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api" || pathname === "/api/v1") {
    url.pathname = "/";
  } else if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname.slice(0, -"/api/v1".length) || "/";
  } else if (pathname.endsWith("/api")) {
    url.pathname = pathname.slice(0, -"/api".length) || "/";
  }
  return url.toString().replace(/\/+$/, "");
}
function knowledgeAuthPath(env = process.env) {
  if (env.HASNA_KNOWLEDGE_AUTH_PATH)
    return env.HASNA_KNOWLEDGE_AUTH_PATH;
  const root = env.HASNA_KNOWLEDGE_AUTH_DIR ?? join3(homedir2(), ".hasna", "knowledge");
  return join3(root, "auth.json");
}
function resolveKnowledgeApiUrl(config, env = process.env) {
  return normalizeKnowledgeApiOrigin(env.KNOWLEDGE_API_URL ?? config?.hosted?.api_url ?? DEFAULT_KNOWLEDGE_API_URL);
}
function getKnowledgeAuth(env = process.env) {
  try {
    const path = knowledgeAuthPath(env);
    if (!existsSync3(path))
      return null;
    const parsed = JSON.parse(readFileSync3(path, "utf8"));
    return typeof parsed.api_key === "string" && parsed.api_key.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
function saveKnowledgeAuth(auth, env = process.env) {
  const path = knowledgeAuthPath(env);
  const stored = {
    ...auth,
    api_url: auth.api_url ? normalizeKnowledgeApiOrigin(auth.api_url) : undefined,
    created_at: auth.created_at ?? new Date().toISOString()
  };
  mkdirSync3(dirname3(path), { recursive: true, mode: 448 });
  writeFileSync3(path, `${JSON.stringify(stored, null, 2)}
`, { mode: 384 });
  return stored;
}
function clearKnowledgeAuth(env = process.env) {
  try {
    unlinkSync(knowledgeAuthPath(env));
    return true;
  } catch {
    return false;
  }
}
function getKnowledgeApiKey(env = process.env) {
  if (env.KNOWLEDGE_API_KEY)
    return { apiKey: env.KNOWLEDGE_API_KEY, source: "env" };
  if (env.HASNA_KNOWLEDGE_API_KEY)
    return { apiKey: env.HASNA_KNOWLEDGE_API_KEY, source: "env" };
  const auth = getKnowledgeAuth(env);
  return auth?.api_key ? { apiKey: auth.api_key, source: "file" } : { apiKey: null, source: "none" };
}
function knowledgeAuthStatus(config, env = process.env) {
  const auth = getKnowledgeAuth(env);
  const key = getKnowledgeApiKey(env);
  const apiUrl = env.KNOWLEDGE_API_URL ? resolveKnowledgeApiUrl(config, env) : auth?.api_url ? normalizeKnowledgeApiOrigin(auth.api_url) : resolveKnowledgeApiUrl(config, env);
  return {
    authenticated: Boolean(key.apiKey),
    source: key.source,
    api_url: apiUrl,
    auth_path: knowledgeAuthPath(env),
    email: key.source === "file" ? auth?.email ?? null : null,
    org_id: key.source === "file" ? auth?.org_id ?? null : null,
    org_slug: key.source === "file" ? auth?.org_slug ?? null : null,
    user_id: key.source === "file" ? auth?.user_id ?? null : null,
    api_key_present: Boolean(key.apiKey)
  };
}

// src/agent.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/providers.ts
import { randomUUID } from "crypto";
var DEFAULT_PROVIDER_SETTINGS = {
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
};
var PROVIDER_CAPABILITIES = {
  openai: {
    text_generation: true,
    structured_output: true,
    tool_usage: true,
    tool_streaming: true,
    image_input: true,
    native_web_search: true,
    reasoning: true,
    embeddings: true
  },
  anthropic: {
    text_generation: true,
    structured_output: true,
    tool_usage: true,
    tool_streaming: true,
    image_input: true,
    native_web_search: false,
    reasoning: true,
    embeddings: false
  },
  deepseek: {
    text_generation: true,
    structured_output: true,
    tool_usage: true,
    tool_streaming: true,
    image_input: false,
    native_web_search: false,
    reasoning: true,
    embeddings: false
  }
};
var BUILTIN_ALIASES = {
  default: "openai:gpt-5.2",
  fast: "openai:gpt-5-mini",
  reasoning: "anthropic:claude-opus-4-6",
  sonnet: "anthropic:claude-sonnet-4-6",
  deepseek: "deepseek:deepseek-chat",
  "deepseek-reasoning": "deepseek:deepseek-reasoner"
};
function providerConfig(config) {
  return config?.providers ?? {};
}
function providerSettings(config, provider) {
  const configured = providerConfig(config)[provider] ?? {};
  return {
    ...DEFAULT_PROVIDER_SETTINGS[provider],
    ...configured
  };
}
function modelAliases(config) {
  const configured = providerConfig(config);
  return {
    ...BUILTIN_ALIASES,
    ...configured.default_model ? { default: configured.default_model } : {},
    ...configured.aliases ?? {}
  };
}
function parseModelRef(modelRef) {
  const [provider, ...rest] = modelRef.split(":");
  const model = rest.join(":");
  if (provider !== "openai" && provider !== "anthropic" && provider !== "deepseek") {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  if (!model)
    throw new Error(`Invalid model ref: ${modelRef}. Expected provider:model.`);
  return { provider, model };
}
function resolveModelRef(aliasOrRef, config) {
  const aliases = modelAliases(config);
  return aliases[aliasOrRef] ?? aliasOrRef;
}
function listModelRegistry(config) {
  const aliases = modelAliases(config);
  return Object.entries(aliases).map(([alias, modelRef]) => {
    const parsed = parseModelRef(modelRef);
    return {
      alias,
      model_ref: modelRef,
      provider: parsed.provider,
      model: parsed.model,
      default: alias === "default",
      capabilities: PROVIDER_CAPABILITIES[parsed.provider]
    };
  });
}
function providerCredentialStatus(config, env = process.env) {
  return Object.keys(DEFAULT_PROVIDER_SETTINGS).map((provider) => {
    const settings = providerSettings(config, provider);
    const configured = Boolean(env[settings.api_key_env]);
    return {
      provider,
      api_key_env: settings.api_key_env,
      configured,
      source: configured ? "env" : "missing",
      base_url: settings.base_url ?? null,
      default_model: settings.default_model
    };
  });
}
function providerStatus(config, env = process.env) {
  return {
    default_model: resolveModelRef("default", config),
    providers: providerCredentialStatus(config, env),
    models: listModelRegistry(config)
  };
}
function assertProviderCredentials(provider, config, env = process.env) {
  const status = providerCredentialStatus(config, env).find((entry) => entry.provider === provider);
  if (!status)
    throw new Error(`Unsupported AI provider: ${provider}`);
  if (!status.configured)
    throw new Error(`Missing ${status.api_key_env} for ${provider}. Set the env var to use this provider.`);
  return status;
}
async function defaultFactory(provider) {
  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI;
  }
  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic;
  }
  const { createDeepSeek } = await import("@ai-sdk/deepseek");
  return createDeepSeek;
}
async function createAiSdkProviderRegistry(options = {}) {
  const { createProviderRegistry } = await import("ai");
  const env = options.env ?? process.env;
  const providers = {};
  for (const provider of Object.keys(DEFAULT_PROVIDER_SETTINGS)) {
    const settings = providerSettings(options.config, provider);
    const apiKey = env[settings.api_key_env];
    if (!apiKey)
      continue;
    const factory = options.factories?.[provider] ?? await defaultFactory(provider);
    providers[provider] = factory({ apiKey, baseURL: settings.base_url });
  }
  return createProviderRegistry(providers);
}
async function languageModelFor(aliasOrRef, options = {}) {
  const modelRef = resolveModelRef(aliasOrRef, options.config);
  const parsed = parseModelRef(modelRef);
  assertProviderCredentials(parsed.provider, options.config, options.env);
  const registry = await createAiSdkProviderRegistry(options);
  return registry.languageModel(modelRef);
}
function usageNumber(usage, keys) {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value))
      return value;
  }
  return 0;
}
function normalizeAiSdkUsage(input) {
  const usage = input.usage ?? {};
  return {
    provider: input.provider,
    model: input.model,
    input_tokens: usageNumber(usage, ["inputTokens", "promptTokens", "input_tokens", "prompt_tokens"]),
    output_tokens: usageNumber(usage, ["outputTokens", "completionTokens", "output_tokens", "completion_tokens"]),
    cost_usd: input.costUsd ?? 0,
    metadata: {
      usage,
      provider_metadata: input.providerMetadata ?? {}
    }
  };
}
function recordProviderUsage(db, input) {
  const id = `usage_${randomUUID()}`;
  db.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    input.run_id ?? null,
    input.provider,
    input.model,
    input.input_tokens,
    input.output_tokens,
    input.cost_usd,
    JSON.stringify(input.metadata),
    input.created_at ?? new Date().toISOString()
  ]);
  return id;
}

// src/retrieval.ts
import { createHash as createHash2 } from "crypto";

// src/provenance.ts
function isStaleStatus(status) {
  return ["deleted", "stale", "invalidated", "reindex_required"].includes((status ?? "").toLowerCase());
}
function sourceProvenance(input) {
  const status = input.status ?? null;
  return {
    source_owner: "open-files",
    source_ref: input.source_ref ?? null,
    source_uri: input.source_uri ?? null,
    source_kind: input.source_kind ?? null,
    source_revision_id: input.source_revision_id ?? null,
    revision: input.revision ?? null,
    hash: input.hash ?? null,
    chunk_id: input.chunk_id ?? null,
    start_offset: input.start_offset ?? null,
    end_offset: input.end_offset ?? null,
    status,
    read_only: true,
    citation_required: true,
    resolver: input.resolver ?? null,
    stale: isStaleStatus(status)
  };
}
function generatedArtifactProvenance(input) {
  return {
    source_owner: "open-files",
    generated_from: input.generated_from,
    artifact_key: input.artifact_key,
    source_refs: input.source_refs ?? [],
    read_only_sources: true,
    citation_required: input.citation_required ?? true,
    raw_source_bytes_stored_in_open_knowledge: false
  };
}
function withProvenance(metadata, provenance) {
  return {
    ...metadata,
    provenance
  };
}

// src/embeddings.ts
import { createHash } from "crypto";
var DEFAULT_EMBEDDING_MODEL_REF = "openai:text-embedding-3-small";
var DEFAULT_EMBEDDING_DIMENSIONS = 1536;
function embeddingConfig(config) {
  return config?.embeddings ?? {};
}
function stableId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function parseJsonObject(value) {
  if (!value)
    return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function metadataString(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0)
      return value;
  }
  return null;
}
function metadataNumber(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value))
      return value;
  }
  return null;
}
function vectorNorm(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
function cosineSimilarity(a, b, bNorm = vectorNorm(b)) {
  const aNorm = vectorNorm(a);
  if (aNorm === 0 || bNorm === 0)
    return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0;i < length; i += 1)
    dot += a[i] * b[i];
  return dot / (aNorm * bNorm);
}
function deterministicVector(text, dimensions) {
  const bytes = createHash("sha256").update(text).digest();
  return Array.from({ length: dimensions }, (_, index) => {
    const value = bytes[index % bytes.length] / 255;
    return Number((value * 2 - 1).toFixed(6));
  });
}
async function openAiEmbeddingModel(model, config, env = process.env) {
  assertProviderCredentials("openai", config, env);
  const settings = providerSettings(config, "openai");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const openai = createOpenAI({
    apiKey: env[settings.api_key_env],
    baseURL: settings.base_url
  });
  if (openai.embeddingModel)
    return openai.embeddingModel(model);
  if (openai.textEmbedding)
    return openai.textEmbedding(model);
  if (openai.textEmbeddingModel)
    return openai.textEmbeddingModel(model);
  throw new Error("OpenAI provider does not expose an embedding model factory.");
}
function resolveEmbeddingModelRef(modelRef, config) {
  if (!modelRef || modelRef === "default" || modelRef === "embedding") {
    return embeddingConfig(config).default_model ?? DEFAULT_EMBEDDING_MODEL_REF;
  }
  return modelRef;
}
async function embedTexts(texts, options = {}) {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  if (parsed.provider !== "openai") {
    throw new Error(`Embedding provider ${parsed.provider} is not supported yet. Use openai:text-embedding-3-small.`);
  }
  const dimensions = options.dimensions ?? embeddingConfig(options.config).dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  if (options.fake) {
    return {
      provider: parsed.provider,
      model: parsed.model,
      dimensions,
      vectors: texts.map((text) => deterministicVector(text, dimensions)),
      usage: { input_tokens: texts.reduce((sum, text) => sum + Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.25)), 0) }
    };
  }
  const { embedMany } = await import("ai");
  const model = await openAiEmbeddingModel(parsed.model, options.config, options.env);
  const result = await embedMany({
    model,
    values: texts,
    maxParallelCalls: options.maxParallelCalls ?? embeddingConfig(options.config).max_parallel_calls,
    providerOptions: {
      openai: {
        dimensions
      }
    }
  });
  const vectors = result.embeddings;
  return {
    provider: parsed.provider,
    model: parsed.model,
    dimensions: vectors[0]?.length ?? dimensions,
    vectors,
    usage: { input_tokens: result.usage?.tokens ?? 0 }
  };
}
function selectCandidateChunks(db, options) {
  const baseQuery = `SELECT
       c.id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind
     FROM chunks c
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN vector_index_entries v
       ON v.chunk_id = c.id AND v.provider = ? AND v.model = ?
     WHERE v.id IS NULL`;
  const suffix = `
     ORDER BY c.created_at ASC, c.ordinal ASC
     LIMIT ?`;
  if (options.sourceRevisionId) {
    return db.query(`${baseQuery} AND c.source_revision_id = ?${suffix}`).all(options.provider, options.model, options.sourceRevisionId, options.limit);
  }
  return db.query(`${baseQuery}${suffix}`).all(options.provider, options.model, options.limit);
}
function provenanceForChunk(row) {
  const metadata = parseJsonObject(row.metadata_json);
  const existing = metadata.provenance;
  if (existing && typeof existing === "object" && !Array.isArray(existing))
    return existing;
  return sourceProvenance({
    source_ref: metadataString(metadata, ["source_ref"]),
    source_uri: row.source_uri ?? metadataString(metadata, ["source_uri"]),
    source_kind: row.source_kind ?? metadataString(metadata, ["source_kind"]),
    source_revision_id: row.source_revision_id,
    revision: row.revision ?? metadataString(metadata, ["revision"]),
    hash: row.hash ?? metadataString(metadata, ["hash"]),
    chunk_id: row.id,
    start_offset: row.start_offset ?? metadataNumber(metadata, ["start_offset"]),
    end_offset: row.end_offset ?? metadataNumber(metadata, ["end_offset"]),
    status: metadataString(metadata, ["status"]),
    resolver: "open-files-read-only"
  });
}
function upsertVectors(db, rows, embedding, now) {
  const insertEmbedding = db.prepare(`
    INSERT INTO chunk_embeddings (id, chunk_id, provider, model, dimensions, vector_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      created_at = excluded.created_at
  `);
  const insertVector = db.prepare(`
    INSERT INTO vector_index_entries (
      id, chunk_id, source_revision_id, provider, model, dimensions, vector_json, vector_norm,
      source_uri, source_ref, revision, hash, start_offset, end_offset, token_count, status,
      metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
      source_revision_id = excluded.source_revision_id,
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      vector_norm = excluded.vector_norm,
      source_uri = excluded.source_uri,
      source_ref = excluded.source_ref,
      revision = excluded.revision,
      hash = excluded.hash,
      start_offset = excluded.start_offset,
      end_offset = excluded.end_offset,
      token_count = excluded.token_count,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    for (let index = 0;index < rows.length; index += 1) {
      const row = rows[index];
      const vector = embedding.vectors[index];
      if (!vector)
        continue;
      const metadata = parseJsonObject(row.metadata_json);
      const provenance = provenanceForChunk(row);
      const sourceRef = provenance.source_ref ?? metadataString(metadata, ["source_ref"]);
      const sourceUri = provenance.source_uri ?? row.source_uri ?? metadataString(metadata, ["source_uri"]);
      const revision = provenance.revision ?? row.revision ?? metadataString(metadata, ["revision"]);
      const hash = provenance.hash ?? row.hash ?? metadataString(metadata, ["hash"]);
      const status = provenance.status ?? metadataString(metadata, ["status"]) ?? "active";
      const vectorJson = JSON.stringify(vector);
      insertEmbedding.run(stableId("emb", `${row.id}\x00${embedding.provider}\x00${embedding.model}`), row.id, embedding.provider, embedding.model, embedding.dimensions, vectorJson, now);
      insertVector.run(stableId("vec", `${row.id}\x00${embedding.provider}\x00${embedding.model}`), row.id, row.source_revision_id, embedding.provider, embedding.model, embedding.dimensions, vectorJson, vectorNorm(vector), sourceUri, sourceRef, revision, hash, provenance.start_offset, provenance.end_offset, row.token_count, status, JSON.stringify({
        ...metadata,
        provenance,
        embedded_at: now
      }), now, now);
    }
  });
  write();
  return rows.length;
}
async function indexKnowledgeEmbeddings(options) {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  if (parsed.provider !== "openai")
    throw new Error(`Embedding provider ${parsed.provider} is not supported yet.`);
  const now = (options.now ?? new Date).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  migrateKnowledgeDb(options.dbPath);
  const readDb = openKnowledgeDb(options.dbPath);
  let rows;
  try {
    rows = selectCandidateChunks(readDb, {
      provider: parsed.provider,
      model: parsed.model,
      limit,
      sourceRevisionId: options.sourceRevisionId
    });
  } finally {
    readDb.close();
  }
  if (rows.length === 0) {
    return {
      provider: parsed.provider,
      model: parsed.model,
      dimensions: options.dimensions ?? embeddingConfig(options.config).dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
      chunks_seen: 0,
      chunks_embedded: 0,
      embeddings_upserted: 0,
      vector_entries_upserted: 0,
      usage: { input_tokens: 0 }
    };
  }
  const embedding = await embedTexts(rows.map((row) => row.text), options);
  const writeDb = openKnowledgeDb(options.dbPath);
  try {
    const upserted = upsertVectors(writeDb, rows, embedding, now);
    return {
      provider: embedding.provider,
      model: embedding.model,
      dimensions: embedding.dimensions,
      chunks_seen: rows.length,
      chunks_embedded: rows.length,
      embeddings_upserted: upserted,
      vector_entries_upserted: upserted,
      usage: embedding.usage
    };
  } finally {
    writeDb.close();
  }
}
function embeddingIndexStatus(dbPath) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const totalEmbeddings = db.query("SELECT COUNT(*) AS n FROM chunk_embeddings").get()?.n ?? 0;
    const totalVectorEntries = db.query("SELECT COUNT(*) AS n FROM vector_index_entries").get()?.n ?? 0;
    const indexes = db.query(`SELECT provider, model, dimensions, COUNT(*) AS entries, MAX(updated_at) AS updated_at
       FROM vector_index_entries
       GROUP BY provider, model, dimensions
       ORDER BY provider, model`).all();
    return {
      total_embeddings: totalEmbeddings,
      total_vector_entries: totalVectorEntries,
      indexes
    };
  } finally {
    db.close();
  }
}
async function searchVectorIndex(options) {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const embedded = await embedTexts([options.query], options);
  const queryVector = embedded.vectors[0] ?? [];
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const rows = db.query(`SELECT
         v.chunk_id,
         c.text,
         v.vector_json,
         v.vector_norm,
         v.source_uri,
         v.source_ref,
         v.revision,
         v.hash,
         v.metadata_json
       FROM vector_index_entries v
       JOIN chunks c ON c.id = v.chunk_id
       WHERE v.provider = ? AND v.model = ? AND v.status = 'active'`).all(parsed.provider, parsed.model);
    const scored = rows.map((row) => {
      const vector = JSON.parse(row.vector_json);
      const metadata = parseJsonObject(row.metadata_json);
      const provenance = metadata.provenance && typeof metadata.provenance === "object" && !Array.isArray(metadata.provenance) ? metadata.provenance : null;
      return {
        chunk_id: row.chunk_id,
        score: cosineSimilarity(queryVector, vector, row.vector_norm),
        text: row.text,
        source_uri: row.source_uri,
        source_ref: row.source_ref,
        revision: row.revision,
        hash: row.hash,
        provenance
      };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
    return {
      provider: parsed.provider,
      model: parsed.model,
      dimensions: embedded.dimensions,
      query: options.query,
      results: scored
    };
  } finally {
    db.close();
  }
}

// src/search.ts
function parseJsonObject2(value) {
  if (!value)
    return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function metadataString2(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0)
      return value;
  }
  return null;
}
function metadataNumber2(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value))
      return value;
  }
  return null;
}
function unique(values) {
  return Array.from(new Set(values));
}
function queryTerms(query) {
  const terms = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return unique(terms.filter((term) => term.length > 0)).slice(0, 16);
}
function ftsQueryForTerms(terms) {
  if (terms.length === 0)
    return null;
  return terms.map((term) => `${term}*`).join(" OR ");
}
function escapeLikeTerm(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
function likeParams(terms, fieldsPerTerm) {
  return terms.flatMap((term) => Array.from({ length: fieldsPerTerm }, () => `%${escapeLikeTerm(term)}%`));
}
function scoreFromRank(rank, index) {
  const rankScore = Number.isFinite(rank) ? 1 / (1 + Math.abs(rank)) : 0;
  const orderScore = 1 / (1 + index);
  return roundScore(Math.max(rankScore, orderScore));
}
function catalogScore(haystack, terms) {
  if (terms.length === 0)
    return 0;
  const matched = terms.filter((term) => haystack.includes(term)).length;
  if (matched === 0)
    return 0;
  return roundScore(Math.min(0.85, 0.35 + matched / terms.length * 0.5));
}
function semanticScore(score) {
  return roundScore(Math.max(0, Math.min(1, (score + 1) / 2)));
}
function roundScore(score) {
  return Number(score.toFixed(6));
}
function combinedScore(scores, citation) {
  const keyword = scores.keyword ?? 0;
  const semantic = scores.semantic ?? 0;
  const catalog = scores.catalog ?? 0;
  const citationBoost = citation?.chunk_id ? 0.05 : 0;
  return roundScore(Math.min(1, keyword * 0.55 + semantic * 0.4 + catalog * 0.35 + citationBoost));
}
function existingProvenance(metadata) {
  const provenance = metadata.provenance;
  return provenance && typeof provenance === "object" && !Array.isArray(provenance) ? provenance : null;
}
function provenanceForChunk2(row) {
  const metadata = parseJsonObject2(row.chunk_metadata_json);
  const existing = existingProvenance(metadata);
  if (existing)
    return existing;
  if (!row.source_revision_id && !row.source_uri)
    return null;
  return sourceProvenance({
    source_ref: metadataString2(metadata, ["source_ref"]),
    source_uri: row.source_uri ?? metadataString2(metadata, ["source_uri"]),
    source_kind: row.source_kind ?? metadataString2(metadata, ["source_kind"]),
    source_revision_id: row.source_revision_id,
    revision: row.revision ?? metadataString2(metadata, ["revision"]),
    hash: row.hash ?? metadataString2(metadata, ["hash"]),
    chunk_id: row.chunk_id,
    start_offset: row.start_offset ?? metadataNumber2(metadata, ["start_offset"]),
    end_offset: row.end_offset ?? metadataNumber2(metadata, ["end_offset"]),
    status: metadataString2(metadata, ["status"]),
    resolver: "open-files-read-only"
  });
}
function selectFtsChunks(db, ftsQuery, limit) {
  if (!ftsQuery)
    return [];
  return db.query(`SELECT
       chunks_fts.chunk_id,
       c.kind AS chunk_kind,
       c.wiki_page_id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json AS chunk_metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind,
       s.title AS source_title,
       wp.path AS wiki_path,
       wp.title AS wiki_title,
       wp.artifact_uri AS wiki_artifact_uri,
       wp.content_hash AS wiki_content_hash,
       wp.status AS wiki_status,
       wp.metadata_json AS wiki_metadata_json,
       bm25(chunks_fts) AS rank
     FROM chunks_fts
     JOIN chunks c ON c.id = chunks_fts.chunk_id
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN wiki_pages wp ON wp.id = c.wiki_page_id
     WHERE chunks_fts MATCH ?
     ORDER BY rank ASC
     LIMIT ?`).all(ftsQuery, limit);
}
function catalogWhere(fields, terms) {
  if (terms.length === 0)
    return "1 = 0";
  const clauses = terms.map(() => `(${fields.map((field) => `lower(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`);
  return clauses.join(" OR ");
}
function selectWikiPages(db, terms, limit) {
  const fields = ["path", "title", "artifact_uri", "metadata_json"];
  return db.query(`SELECT id, path, title, artifact_uri, content_hash, status, metadata_json
     FROM wiki_pages
     WHERE status = 'active' AND (${catalogWhere(fields, terms)})
     ORDER BY updated_at DESC
     LIMIT ?`).all(...likeParams(terms, fields.length), limit);
}
function selectKnowledgeIndexes(db, terms, limit) {
  const fields = ["kind", "name", "shard_key", "artifact_uri", "metadata_json"];
  return db.query(`SELECT id, kind, name, artifact_uri, shard_key, metadata_json
     FROM knowledge_indexes
     WHERE ${catalogWhere(fields, terms)}
     ORDER BY updated_at DESC
     LIMIT ?`).all(...likeParams(terms, fields.length), limit);
}
function chunkResult(row, keywordScore) {
  const metadata = parseJsonObject2(row.chunk_metadata_json);
  const provenance = provenanceForChunk2(row);
  const sourceRef = metadataString2(metadata, ["source_ref"]);
  const sourceUri = row.source_uri ?? metadataString2(metadata, ["source_uri"]);
  const isWiki = Boolean(row.wiki_page_id);
  const result = {
    kind: isWiki ? "wiki_chunk" : "source_chunk",
    id: row.chunk_id,
    title: isWiki ? row.wiki_title : row.source_title,
    text: row.text,
    score: 0,
    scores: { keyword: keywordScore },
    source: sourceUri || sourceRef ? {
      uri: sourceUri,
      ref: sourceRef,
      kind: row.source_kind ?? metadataString2(metadata, ["source_kind"]),
      revision: row.revision ?? metadataString2(metadata, ["revision"]),
      hash: row.hash ?? metadataString2(metadata, ["hash"])
    } : null,
    citation: {
      chunk_id: row.chunk_id,
      start_offset: row.start_offset,
      end_offset: row.end_offset
    },
    artifact: isWiki ? {
      uri: row.wiki_artifact_uri,
      path: row.wiki_path,
      hash: row.wiki_content_hash,
      shard_key: row.wiki_path
    } : null,
    provenance,
    reasons: ["keyword_match"]
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}
function wikiPageResult(row, terms) {
  const metadata = parseJsonObject2(row.metadata_json);
  const score = catalogScore(`${row.path} ${row.title} ${row.artifact_uri ?? ""} ${row.metadata_json}`.toLowerCase(), terms);
  const result = {
    kind: "wiki_page",
    id: row.id,
    title: row.title,
    text: null,
    score: 0,
    scores: { catalog: score },
    source: null,
    citation: null,
    artifact: {
      uri: row.artifact_uri,
      path: row.path,
      hash: row.content_hash,
      shard_key: row.path
    },
    provenance: existingProvenance(metadata),
    reasons: ["wiki_catalog_match"]
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}
function indexResult(row, terms) {
  const metadata = parseJsonObject2(row.metadata_json);
  const score = catalogScore(`${row.kind} ${row.name} ${row.shard_key ?? ""} ${row.artifact_uri ?? ""} ${row.metadata_json}`.toLowerCase(), terms);
  const result = {
    kind: "knowledge_index",
    id: row.id,
    title: row.name,
    text: null,
    score: 0,
    scores: { catalog: score },
    source: null,
    citation: null,
    artifact: {
      uri: row.artifact_uri,
      path: metadataString2(metadata, ["artifact_key"]),
      hash: metadataString2(metadata, ["content_hash"]),
      shard_key: row.shard_key
    },
    provenance: existingProvenance(metadata),
    reasons: ["index_catalog_match"]
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}
function mergeResult(results, entry) {
  const key = `${entry.kind}:${entry.id}`;
  const existing = results.get(key);
  if (!existing) {
    results.set(key, entry);
    return;
  }
  existing.scores = {
    keyword: Math.max(existing.scores.keyword ?? 0, entry.scores.keyword ?? 0) || undefined,
    semantic: Math.max(existing.scores.semantic ?? 0, entry.scores.semantic ?? 0) || undefined,
    catalog: Math.max(existing.scores.catalog ?? 0, entry.scores.catalog ?? 0) || undefined
  };
  existing.reasons = unique([...existing.reasons, ...entry.reasons]);
  existing.text = existing.text ?? entry.text;
  existing.title = existing.title ?? entry.title;
  existing.source = existing.source ?? entry.source;
  existing.citation = existing.citation ?? entry.citation;
  existing.artifact = existing.artifact ?? entry.artifact;
  existing.provenance = existing.provenance ?? entry.provenance;
  existing.score = combinedScore(existing.scores, existing.citation);
}
function sortResults(results) {
  const kindOrder = {
    source_chunk: 0,
    wiki_chunk: 1,
    wiki_page: 2,
    knowledge_index: 3
  };
  return results.sort((a, b) => {
    if (b.score !== a.score)
      return b.score - a.score;
    return kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id);
  });
}
async function hybridSearch(options) {
  const query = options.query.trim();
  if (!query)
    throw new Error("Search query is required.");
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const terms = queryTerms(query);
  const ftsQuery = ftsQueryForTerms(terms);
  const semanticEnabled = options.semantic === true || options.fake === true || Boolean(options.modelRef);
  const warnings = [];
  let semanticProvider = null;
  let semanticModel = null;
  let semanticDimensions = null;
  let keywordCount = 0;
  let catalogCount = 0;
  let semanticCount = 0;
  const merged = new Map;
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const ftsRows = selectFtsChunks(db, ftsQuery, Math.max(limit * 3, 20));
    keywordCount = ftsRows.length;
    ftsRows.forEach((row, index) => mergeResult(merged, chunkResult(row, scoreFromRank(row.rank, index))));
    const wikiRows = selectWikiPages(db, terms, Math.max(limit, 10));
    const indexRows = selectKnowledgeIndexes(db, terms, Math.max(limit, 10));
    catalogCount = wikiRows.length + indexRows.length;
    wikiRows.forEach((row) => mergeResult(merged, wikiPageResult(row, terms)));
    indexRows.forEach((row) => mergeResult(merged, indexResult(row, terms)));
  } finally {
    db.close();
  }
  if (semanticEnabled) {
    try {
      const semantic = await searchVectorIndex({
        dbPath: options.dbPath,
        query,
        limit: Math.max(limit * 3, 20),
        config: options.config,
        env: options.env,
        modelRef: options.modelRef,
        dimensions: options.dimensions,
        fake: options.fake,
        batchSize: options.batchSize,
        maxParallelCalls: options.maxParallelCalls
      });
      semanticProvider = semantic.provider;
      semanticModel = semantic.model;
      semanticDimensions = semantic.dimensions;
      semanticCount = semantic.results.length;
      for (const row of semantic.results) {
        const result = {
          kind: "source_chunk",
          id: row.chunk_id,
          title: null,
          text: row.text,
          score: 0,
          scores: { semantic: semanticScore(row.score) },
          source: {
            uri: row.source_uri,
            ref: row.source_ref,
            kind: row.provenance?.source_kind ?? null,
            revision: row.revision,
            hash: row.hash
          },
          citation: {
            chunk_id: row.chunk_id,
            start_offset: row.provenance?.start_offset ?? null,
            end_offset: row.provenance?.end_offset ?? null
          },
          artifact: null,
          provenance: row.provenance,
          reasons: ["semantic_match"]
        };
        result.score = combinedScore(result.scores, result.citation);
        mergeResult(merged, result);
      }
    } catch (error) {
      warnings.push(`semantic_search_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const results = sortResults(Array.from(merged.values())).slice(0, limit);
  return {
    query,
    limit,
    mode: {
      keyword: true,
      catalog: true,
      semantic: semanticEnabled
    },
    semantic_provider: semanticProvider,
    semantic_model: semanticModel,
    semantic_dimensions: semanticDimensions,
    counts: {
      keyword_results: keywordCount,
      catalog_results: catalogCount,
      semantic_results: semanticCount,
      merged_results: results.length
    },
    warnings,
    results
  };
}

// src/retrieval.ts
function stableId2(prefix, value) {
  return `${prefix}_${createHash2("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function normalizeQuery(query) {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
function queryTerms2(query) {
  return Array.from(new Set(normalizeQuery(query).match(/[\p{L}\p{N}_]+/gu) ?? [])).slice(0, 16);
}
function textForResult(result) {
  return [result.title, result.text].filter(Boolean).join(" ").toLowerCase();
}
function exactScore(result, terms) {
  if (terms.length === 0)
    return 0;
  const text = textForResult(result);
  const matched = terms.filter((term) => text.includes(term)).length;
  return Number((matched / terms.length).toFixed(6));
}
function hasReadOnlyProvenance(provenance) {
  if (!provenance)
    return true;
  if ("read_only" in provenance)
    return provenance.read_only === true;
  if ("read_only_sources" in provenance)
    return provenance.read_only_sources === true;
  return true;
}
function isStale(provenance) {
  if (!provenance)
    return false;
  if ("stale" in provenance && provenance.stale)
    return true;
  if ("status" in provenance)
    return isStaleStatus(provenance.status);
  return false;
}
function freshnessScore(result) {
  if (isStale(result.provenance))
    return 0;
  if (result.source?.hash || result.source?.revision)
    return 1;
  if (result.artifact?.hash)
    return 0.85;
  if (result.provenance && "source_refs" in result.provenance && result.provenance.source_refs.length > 0)
    return 0.75;
  return 0.55;
}
function citationScore(result) {
  if (result.citation?.chunk_id && (result.source?.uri || result.artifact?.uri))
    return 1;
  if (result.provenance && "citation_required" in result.provenance && result.provenance.citation_required)
    return 0.75;
  if (result.artifact?.uri)
    return 0.65;
  return 0.35;
}
function authorityScore(result) {
  if (result.kind === "wiki_chunk")
    return 0.85;
  if (result.kind === "source_chunk")
    return 0.8;
  if (result.kind === "wiki_page")
    return 0.65;
  return 0.55;
}
function rerank(result, terms) {
  const scores = {
    base_score: result.score,
    exact_score: exactScore(result, terms),
    citation_score: citationScore(result),
    freshness_score: freshnessScore(result),
    authority_score: authorityScore(result)
  };
  const final = Math.min(1, scores.base_score * 0.65 + scores.exact_score * 0.1 + scores.citation_score * 0.1 + scores.freshness_score * 0.1 + scores.authority_score * 0.05);
  const reasons = new Set(result.reasons);
  if (scores.exact_score > 0.5)
    reasons.add("exact_term");
  if (scores.citation_score >= 0.75)
    reasons.add("cited_source");
  if (scores.freshness_score >= 0.85)
    reasons.add("fresh_source");
  return {
    ...result,
    score: Number(final.toFixed(6)),
    reasons: Array.from(reasons),
    rerank: {
      ...scores,
      final_score: Number(final.toFixed(6))
    }
  };
}
function quoteFor(result, maxChars) {
  const source = result.text ?? result.title;
  if (!source)
    return null;
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}
function citationFor(result) {
  const id = stableId2("cite", `${result.kind}\x00${result.id}\x00${result.source?.uri ?? ""}\x00${result.artifact?.uri ?? ""}`);
  return {
    id,
    result_id: result.id,
    kind: result.kind,
    source_uri: result.source?.uri ?? null,
    source_ref: result.source?.ref ?? null,
    artifact_uri: result.artifact?.uri ?? null,
    artifact_path: result.artifact?.path ?? null,
    revision: result.source?.revision ?? null,
    hash: result.source?.hash ?? result.artifact?.hash ?? null,
    chunk_id: result.citation?.chunk_id ?? null,
    start_offset: result.citation?.start_offset ?? null,
    end_offset: result.citation?.end_offset ?? null,
    quote: quoteFor(result, 500),
    provenance: result.provenance
  };
}
function excerptFor(result, citation, contextChars) {
  const text = quoteFor(result, contextChars);
  if (!text)
    return null;
  return {
    id: stableId2("excerpt", `${result.kind}\x00${result.id}`),
    result_id: result.id,
    citation_id: citation.id,
    kind: result.kind,
    text,
    score: result.score
  };
}
function placeholders(values) {
  return values.map(() => "?").join(", ");
}
function loadGraphEvidence(dbPath, results) {
  const chunkIds = results.map((result) => result.citation?.chunk_id).filter((id) => Boolean(id));
  const wikiPageIds = results.filter((result) => result.kind === "wiki_page").map((result) => result.id);
  const citations = [];
  const backlinks = [];
  if (chunkIds.length === 0 && wikiPageIds.length === 0)
    return { citations, backlinks };
  const db = openKnowledgeDb(dbPath);
  try {
    if (chunkIds.length > 0) {
      citations.push(...db.query(`SELECT id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset
         FROM citations
         WHERE chunk_id IN (${placeholders(chunkIds)})
         ORDER BY created_at DESC
         LIMIT 50`).all(...chunkIds));
    }
    if (wikiPageIds.length > 0) {
      citations.push(...db.query(`SELECT id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset
         FROM citations
         WHERE wiki_page_id IN (${placeholders(wikiPageIds)})
         ORDER BY created_at DESC
         LIMIT 50`).all(...wikiPageIds));
      backlinks.push(...db.query(`SELECT from_page_id, to_page_id, label
         FROM wiki_backlinks
         WHERE from_page_id IN (${placeholders(wikiPageIds)}) OR to_page_id IN (${placeholders(wikiPageIds)})
         LIMIT 50`).all(...wikiPageIds, ...wikiPageIds));
    }
  } finally {
    db.close();
  }
  return { citations, backlinks };
}
async function retrieveKnowledgeContext(options) {
  const contextChars = Math.max(200, Math.min(options.contextChars ?? 1200, 4000));
  const search = await hybridSearch(options);
  const terms = queryTerms2(search.query);
  const warnings = [...search.warnings];
  const permissionNotes = new Set;
  const freshnessNotes = new Set;
  const filtered = search.results.filter((result) => {
    if (!hasReadOnlyProvenance(result.provenance)) {
      warnings.push(`permission_filtered: ${result.kind}:${result.id}`);
      permissionNotes.add("Dropped a result because provenance was not read-only.");
      return false;
    }
    if (isStale(result.provenance)) {
      warnings.push(`stale_filtered: ${result.kind}:${result.id}`);
      freshnessNotes.add("Dropped a stale result whose source status requires reindexing.");
      return false;
    }
    return true;
  });
  const results = filtered.map((result) => rerank(result, terms)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, search.limit);
  const citations = results.map(citationFor);
  const excerpts = results.map((result, index) => excerptFor(result, citations[index], contextChars)).filter((entry) => Boolean(entry));
  for (const result of results) {
    if (result.provenance && "read_only" in result.provenance && result.provenance.read_only) {
      permissionNotes.add("All source-backed excerpts are read-only and citation-required.");
    }
    if (result.rerank.freshness_score >= 0.85) {
      freshnessNotes.add("Fresh source revision/hash or artifact hash is present for top context.");
    }
  }
  return {
    query: search.query,
    normalized_query: normalizeQuery(search.query),
    created_at: new Date().toISOString(),
    mode: search.mode,
    warnings,
    search_counts: search.counts,
    results,
    citations,
    excerpts,
    graph: loadGraphEvidence(options.dbPath, results),
    notes: {
      permissions: Array.from(permissionNotes),
      freshness: Array.from(freshnessNotes)
    }
  };
}

// src/agent.ts
function estimateTokens(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}
function citationLabel(index) {
  return `C${index + 1}`;
}
function localAnswer(prompt, context) {
  if (context.excerpts.length === 0) {
    return `No indexed knowledge matched the prompt: ${prompt}`;
  }
  const lines = [
    `Found ${context.excerpts.length} relevant knowledge excerpt(s) for: ${prompt}`,
    "",
    ...context.excerpts.slice(0, 5).map((excerpt, index) => {
      const citation = context.citations.find((entry) => entry.id === excerpt.citation_id);
      const ref = citation?.source_ref ?? citation?.source_uri ?? citation?.artifact_path ?? citation?.artifact_uri ?? "unknown source";
      return `[${citationLabel(index)}] ${excerpt.text} (${ref})`;
    })
  ];
  return lines.join(`
`);
}
function promptForModel(prompt, context) {
  const citations = context.citations.map((citation, index) => ({
    id: citationLabel(index),
    source_ref: citation.source_ref,
    source_uri: citation.source_uri,
    artifact_path: citation.artifact_path,
    revision: citation.revision,
    hash: citation.hash,
    quote: citation.quote
  }));
  const excerpts = context.excerpts.map((excerpt, index) => ({
    id: citationLabel(index),
    kind: excerpt.kind,
    text: excerpt.text,
    score: excerpt.score
  }));
  return [
    `Prompt: ${prompt}`,
    "",
    "Use only the provided context. Cite claims with citation ids like [C1]. If context is insufficient, say what is missing.",
    "",
    `Context excerpts:
${JSON.stringify(excerpts, null, 2)}`,
    "",
    `Citations:
${JSON.stringify(citations, null, 2)}`
  ].join(`
`);
}
function proposedUpdates(prompt, context) {
  if (context.citations.length === 0)
    return [];
  return [{
    kind: "answer_note",
    title: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
    citations: context.citations.map((citation) => citation.id),
    requires_approval: true
  }];
}
function insertRun(dbPath, input) {
  const db = openKnowledgeDb(dbPath);
  try {
    db.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      input.runId,
      "knowledge-prompt",
      input.prompt,
      input.status,
      input.provider,
      input.model,
      JSON.stringify(input.metadata),
      input.now,
      input.now
    ]);
  } finally {
    db.close();
  }
}
function addRunEvent(dbPath, input) {
  const db = openKnowledgeDb(dbPath);
  try {
    db.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
      `evt_${randomUUID2()}`,
      input.runId,
      input.level,
      input.event,
      JSON.stringify(input.metadata),
      input.now
    ]);
  } finally {
    db.close();
  }
}
function updateRun(dbPath, input) {
  const db = openKnowledgeDb(dbPath);
  try {
    db.run(`UPDATE runs
       SET status = ?, provider = ?, model = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`, [
      input.status,
      input.provider,
      input.model,
      JSON.stringify(input.metadata),
      input.now,
      input.runId
    ]);
  } finally {
    db.close();
  }
}
function recordUsage(dbPath, runId, usage, provider, model, now, metadata = {}) {
  const db = openKnowledgeDb(dbPath);
  try {
    recordProviderUsage(db, {
      run_id: runId,
      provider,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: usage.cost_usd,
      metadata,
      created_at: now
    });
  } finally {
    db.close();
  }
}
async function runKnowledgePrompt(options) {
  const prompt = options.prompt.trim();
  if (!prompt)
    throw new Error("Knowledge prompt is required.");
  const now = (options.now ?? new Date).toISOString();
  const runId = `run_${randomUUID2()}`;
  const modelRef = resolveModelRef(options.modelRef ?? "default", options.config);
  const parsed = parseModelRef(modelRef);
  migrateKnowledgeDb(options.dbPath);
  insertRun(options.dbPath, {
    runId,
    prompt,
    status: options.generate ? "running" : "dry_run",
    provider: options.generate ? parsed.provider : "local",
    model: options.generate ? parsed.model : "context-draft",
    metadata: {
      semantic: options.semantic === true || options.fake === true || Boolean(options.modelRef),
      approve_write: options.approveWrite === true,
      generated: options.generate === true
    },
    now
  });
  const { prompt: _prompt, generate: _generate, approveWrite: _approveWrite, now: _now, ...retrievalOptions } = options;
  const context = await retrieveKnowledgeContext({
    ...retrievalOptions,
    query: prompt
  });
  addRunEvent(options.dbPath, {
    runId,
    level: "info",
    event: "context_retrieved",
    metadata: {
      results: context.results.length,
      citations: context.citations.length,
      warnings: context.warnings
    },
    now
  });
  let answer = localAnswer(prompt, context);
  let generated = false;
  let provider = "local";
  let model = "context-draft";
  let usage = {
    input_tokens: estimateTokens(prompt) + context.excerpts.reduce((sum, excerpt) => sum + estimateTokens(excerpt.text), 0),
    output_tokens: estimateTokens(answer),
    cost_usd: 0
  };
  const warnings = [...context.warnings];
  if (options.generate) {
    try {
      if (options.fake) {
        generated = true;
        provider = parsed.provider;
        model = parsed.model;
        answer = `Fake generated answer for: ${prompt}

${answer}`;
      } else {
        const { generateText } = await import("ai");
        const languageModel = await languageModelFor(modelRef, {
          config: options.config,
          env: options.env
        });
        const result = await generateText({
          model: languageModel,
          system: "You answer company knowledge-base prompts using only provided context and citation ids.",
          prompt: promptForModel(prompt, context)
        });
        generated = true;
        provider = parsed.provider;
        model = parsed.model;
        answer = result.text;
        const normalized = normalizeAiSdkUsage({
          provider,
          model,
          usage: result.usage,
          providerMetadata: result.providerMetadata
        });
        usage = {
          input_tokens: normalized.input_tokens,
          output_tokens: normalized.output_tokens,
          cost_usd: normalized.cost_usd
        };
      }
    } catch (error) {
      addRunEvent(options.dbPath, {
        runId,
        level: "error",
        event: "answer_generation_failed",
        metadata: { message: error instanceof Error ? error.message : String(error) },
        now
      });
      updateRun(options.dbPath, {
        runId,
        status: "failed",
        provider: parsed.provider,
        model: parsed.model,
        metadata: {
          generated: false,
          error: error instanceof Error ? error.message : String(error)
        },
        now
      });
      throw error;
    }
  }
  const updates = proposedUpdates(prompt, context);
  const writePolicy = {
    approved: options.approveWrite === true,
    durable_writes_performed: false,
    reason: options.approveWrite ? "Approval flag recorded; durable wiki writing is deferred to the wiki compile task." : "Dry-run mode: proposed wiki updates require approval before durable writes."
  };
  addRunEvent(options.dbPath, {
    runId,
    level: "info",
    event: generated ? "answer_generated" : "answer_drafted",
    metadata: {
      provider,
      model,
      proposed_updates: updates.length,
      durable_writes_performed: false
    },
    now
  });
  recordUsage(options.dbPath, runId, usage, provider, model, now, {
    generated,
    citations: context.citations.length
  });
  updateRun(options.dbPath, {
    runId,
    status: generated ? "completed" : "dry_run",
    provider,
    model,
    metadata: {
      generated,
      citations: context.citations.length,
      proposed_updates: updates.length,
      approve_write: options.approveWrite === true
    },
    now
  });
  return {
    run_id: runId,
    prompt,
    generated,
    provider,
    model,
    answer,
    context,
    citations: context.citations,
    proposed_wiki_updates: updates,
    write_policy: writePolicy,
    usage,
    warnings
  };
}

// src/outbox-consume.ts
import { createHash as createHash4, randomUUID as randomUUID4 } from "crypto";
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "fs";
import { basename } from "path";

// src/source-ref.ts
function assertNonEmpty(value, message) {
  if (!value)
    throw new Error(message);
  return value;
}
function parseOpenFilesRef(uri) {
  const withoutScheme = uri.slice("open-files://".length);
  const parts = withoutScheme.split("/").filter(Boolean);
  const entity = parts[0];
  if (entity !== "file" && entity !== "source") {
    throw new Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");
  }
  const id = assertNonEmpty(parts[1], "Invalid open-files ref. Missing id.");
  if (entity === "file") {
    if (parts.length === 2)
      return { kind: "open-files", uri, entity, id };
    if (parts[2] === "revision" && parts[3] && parts.length === 4) {
      return { kind: "open-files", uri, entity, id, revision_id: decodeURIComponent(parts[3]) };
    }
    throw new Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.");
  }
  const pathIndex = parts.indexOf("path");
  const path = pathIndex >= 0 ? decodeURIComponent(parts.slice(pathIndex + 1).join("/")) : undefined;
  return { kind: "open-files", uri, entity, id, path };
}
function parseS3Ref(uri) {
  const parsed = new URL(uri);
  const bucket = assertNonEmpty(parsed.hostname, "Invalid s3 ref. Missing bucket.");
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!key)
    throw new Error("Invalid s3 ref. Missing object key.");
  return { kind: "s3", uri, bucket, key };
}
function parseFileRef(uri) {
  const parsed = new URL(uri);
  return { kind: "file", uri, path: decodeURIComponent(parsed.pathname) };
}
function parseWebRef(uri) {
  const parsed = new URL(uri);
  return { kind: "web", uri, url: parsed.toString() };
}
function parseSourceRef(uri) {
  if (uri.startsWith("open-files://"))
    return parseOpenFilesRef(uri);
  if (uri.startsWith("s3://"))
    return parseS3Ref(uri);
  if (uri.startsWith("file://"))
    return parseFileRef(uri);
  if (uri.startsWith("https://") || uri.startsWith("http://"))
    return parseWebRef(uri);
  throw new Error(`Unsupported source ref scheme: ${uri}`);
}
function catalogSourceUriForRef(uri, parsed = parseSourceRef(uri)) {
  if (parsed.kind === "open-files" && parsed.entity === "file" && parsed.revision_id) {
    return uri.replace(/\/revision\/[^/]+$/, "");
  }
  return uri;
}
function revisionIdForSourceRef(uri) {
  const parsed = parseSourceRef(uri);
  return parsed.kind === "open-files" && parsed.entity === "file" ? parsed.revision_id ?? null : null;
}
function isSupportedSourceRef(uri) {
  try {
    parseSourceRef(uri);
    return true;
  } catch {
    return false;
  }
}

// src/safety.ts
import { createHash as createHash3, randomUUID as randomUUID3 } from "crypto";
import { relative as relative2, resolve as resolve2, sep as sep2 } from "path";
function envEnabled(name) {
  const value = process.env[name];
  return value === "1" || value === "true" || value === "yes";
}
function resolveSafetyPolicy(config, workspace) {
  const extended = config;
  const configuredBuckets = new Set(extended.safety?.network?.allowed_s3_buckets ?? []);
  if (config.storage.type === "s3" && config.storage.s3?.bucket)
    configuredBuckets.add(config.storage.s3.bucket);
  if (process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS) {
    for (const bucket of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      configuredBuckets.add(bucket);
    }
  }
  return {
    mode: config.mode,
    allowWriteRoots: [
      workspace.home,
      workspace.artifactsDir,
      workspace.cacheDir,
      workspace.exportsDir,
      workspace.indexesDir,
      workspace.logsDir,
      workspace.runsDir,
      workspace.schemasDir,
      workspace.wikiDir
    ].map((entry) => resolve2(entry)),
    readOnlySourceAccess: true,
    network: {
      webSearchEnabled: extended.safety?.network?.web_search_enabled ?? envEnabled("HASNA_KNOWLEDGE_WEB_SEARCH"),
      s3ReadsEnabled: extended.safety?.network?.s3_reads_enabled ?? envEnabled("HASNA_KNOWLEDGE_ALLOW_S3_READS"),
      allowedS3Buckets: [...configuredBuckets].sort()
    },
    redaction: {
      enabled: extended.safety?.redaction?.enabled ?? true
    },
    approvals: {
      generatedWritesRequireApproval: extended.safety?.approvals?.generated_writes_require_approval ?? true
    }
  };
}
function isInside(root, target) {
  const rel = relative2(root, target);
  return rel === "" || !rel.startsWith("..") && rel !== ".." && !rel.startsWith(`..${sep2}`);
}
function assertWriteAllowed(targetPath, policy) {
  const resolved = resolve2(targetPath);
  if (!policy.allowWriteRoots.some((root) => isInside(root, resolved))) {
    throw new Error(`Safety policy denied write outside .hasna/apps/knowledge: ${targetPath}`);
  }
}
function assertS3ReadAllowed(uri, policy) {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  if (!policy.network.s3ReadsEnabled) {
    throw new Error("Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.");
  }
  if (!policy.network.allowedS3Buckets.includes(bucket)) {
    throw new Error(`Safety policy denied S3 bucket "${bucket}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`);
  }
}
function assertWebSearchAllowed(policy) {
  if (!policy.network.webSearchEnabled) {
    throw new Error("Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.");
  }
}
var REDACTION_PATTERNS = [
  { type: "private_key_block", severity: "high", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED:private_key_block]" },
  { type: "secret_assignment", severity: "high", regex: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi, replacement: "[REDACTED:secret_assignment]" },
  { type: "openai_api_key", severity: "high", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED:openai_api_key]" },
  { type: "anthropic_api_key", severity: "high", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED:anthropic_api_key]" },
  { type: "aws_access_key_id", severity: "high", regex: /\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED:aws_access_key_id]" }
];
function redactSecrets(text, policy) {
  if (policy && !policy.redaction.enabled)
    return { text, findings: [] };
  let output = text;
  const findings = [];
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern.regex, (match, ...args) => {
      const offset = typeof args.at(-2) === "number" ? args.at(-2) : output.indexOf(match);
      findings.push({
        type: pattern.type,
        severity: pattern.severity,
        start: Math.max(0, offset),
        end: Math.max(0, offset + match.length)
      });
      return pattern.replacement;
    });
  }
  return { text: output, findings };
}
function auditId(input) {
  return `audit_${createHash3("sha256").update(`${input.event_type}\x00${input.action}\x00${input.target_uri ?? ""}\x00${input.created_at ?? ""}\x00${JSON.stringify(input.metadata ?? {})}\x00${randomUUID3()}`).digest("hex").slice(0, 24)}`;
}
function recordAuditEvent(db, input) {
  const createdAt = input.created_at ?? new Date().toISOString();
  const id = auditId({ ...input, created_at: createdAt });
  db.run(`INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    id,
    input.event_type,
    input.action,
    input.target_uri ?? null,
    input.decision,
    JSON.stringify(input.metadata ?? {}),
    createdAt
  ]);
  return id;
}
function recordRedactionFindings(db, input) {
  const createdAt = input.created_at ?? new Date().toISOString();
  for (const finding of input.findings) {
    db.run(`INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      `redact_${randomUUID3()}`,
      input.source_uri ?? null,
      input.run_id ?? null,
      finding.severity,
      finding.type,
      JSON.stringify({ ...input.metadata ?? {}, start: finding.start, end: finding.end }),
      createdAt
    ]);
  }
  return input.findings.length;
}

// src/outbox-consume.ts
function stableId3(prefix, value) {
  return `${prefix}_${createHash4("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function buildSourceRef(event) {
  const explicit = asString(event.source_ref) ?? asString(event.source_uri) ?? asString(event.uri);
  if (explicit)
    return explicit;
  const fileId = asString(event.file_id);
  if (fileId) {
    const revision = asString(event.revision_id) ?? asString(event.revision);
    const fileRef = `open-files://file/${encodeURIComponent(fileId)}`;
    return revision ? `${fileRef}/revision/${encodeURIComponent(revision)}` : fileRef;
  }
  const sourceId = asString(event.source_id);
  const path = asString(event.path);
  if (sourceId && path) {
    return `open-files://source/${encodeURIComponent(sourceId)}/path/${encodeURIComponent(path)}`;
  }
  throw new Error("Outbox event is missing source_ref, file_id, or source_id/path.");
}
function baseSourceUri(sourceRef, parsed) {
  if (parsed.kind === "open-files" && parsed.entity === "file" && parsed.revision_id) {
    return sourceRef.replace(/\/revision\/[^/]+$/, "");
  }
  return sourceRef;
}
function hashFromEvent(event) {
  return asString(event.hash) ?? asString(event.checksum) ?? asString(event.sha256) ?? null;
}
function revisionFromEvent(event, parsed, hash) {
  return asString(event.revision_id) ?? asString(event.revision) ?? asString(event.version_id) ?? (parsed.kind === "open-files" ? parsed.revision_id : undefined) ?? hash ?? null;
}
function previousRevisionFromEvent(event) {
  return asString(event.previous_revision_id) ?? asString(event.previous_revision) ?? asString(event.previous_version_id) ?? null;
}
function eventType(event) {
  return (asString(event.event_type) ?? asString(event.event) ?? asString(event.type) ?? asString(event.action) ?? asString(event.change_type) ?? "changed").toLowerCase();
}
function titleFromEvent(event) {
  const path = asString(event.path);
  return asString(event.title) ?? asString(event.name) ?? (path ? basename(path) : null);
}
function normalizeEvent(event, now) {
  const sourceRef = buildSourceRef(event);
  const parsed = parseSourceRef(sourceRef);
  const hash = hashFromEvent(event);
  return {
    raw: event,
    eventType: eventType(event),
    sourceRef,
    sourceUri: baseSourceUri(sourceRef, parsed),
    kind: parsed.kind,
    title: titleFromEvent(event),
    revision: revisionFromEvent(event, parsed, hash),
    previousRevision: previousRevisionFromEvent(event),
    hash,
    status: asString(event.status)?.toLowerCase() ?? null,
    updatedAt: asString(event.updated_at) ?? now,
    acl: event.permissions ?? event.acl ?? undefined
  };
}
function parseOutboxText(text) {
  const trimmed = text.trim();
  if (!trimmed)
    return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed))
      throw new Error("Outbox array parse failed.");
    return parsed.map((entry) => {
      const event = asObject(entry);
      if (!event)
        throw new Error("Outbox array entries must be objects.");
      return event;
    });
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const object = asObject(parsed);
      if (!object)
        throw new Error("Outbox object parse failed.");
      if (Array.isArray(object.events)) {
        return object.events.map((entry) => {
          const event = asObject(entry);
          if (!event)
            throw new Error("Outbox events entries must be objects.");
          return event;
        });
      }
      if ("source_ref" in object || "source_uri" in object || "file_id" in object)
        return [object];
    } catch (error) {
      const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length <= 1)
        throw error;
      return lines.map((line) => {
        const event = asObject(JSON.parse(line));
        if (!event)
          throw new Error("Outbox JSONL entries must be objects.");
        return event;
      });
    }
  }
  return trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
    const event = asObject(JSON.parse(line));
    if (!event)
      throw new Error("Outbox JSONL entries must be objects.");
    return event;
  });
}
async function readS3Text(uri, config, safetyPolicy) {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!bucket || !key)
    throw new Error(`Invalid S3 outbox URI: ${uri}`);
  if (safetyPolicy)
    assertS3ReadAllowed(uri, safetyPolicy);
  const [{ S3Client, GetObjectCommand }, { fromIni }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/credential-providers")
  ]);
  const s3Config = config?.storage.type === "s3" && config.storage.s3?.bucket === bucket ? config.storage.s3 : undefined;
  const client = new S3Client({
    region: s3Config?.region,
    credentials: s3Config?.profile ? fromIni({ profile: s3Config.profile }) : undefined,
    maxAttempts: s3Config?.max_attempts
  });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body)
    return "";
  return await response.Body.transformToString();
}
async function readOutboxInput(input, config, safetyPolicy) {
  if (input.startsWith("s3://"))
    return readS3Text(input, config, safetyPolicy);
  if (!existsSync4(input))
    throw new Error(`Outbox not found: ${input}`);
  return readFileSync4(input, "utf8");
}
function mergeJson(existing, patch) {
  let base = {};
  if (existing) {
    try {
      base = asObject(JSON.parse(existing)) ?? {};
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}
function ensureSource(db, event, now) {
  const id = stableId3("src", event.sourceUri);
  db.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`, [
    id,
    event.sourceUri,
    event.kind,
    event.title,
    JSON.stringify({ source_ref: event.sourceRef, source_uri: event.sourceUri, status: event.status, last_outbox_event: event.eventType }),
    JSON.stringify(event.acl ?? {}),
    now,
    event.updatedAt
  ]);
  const row = db.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(event.sourceUri);
  if (!row)
    throw new Error(`Failed to upsert source for outbox event: ${event.sourceUri}`);
  const patch = {
    source_ref: event.sourceRef,
    source_uri: event.sourceUri,
    last_outbox_event: event.eventType,
    last_outbox_at: event.updatedAt
  };
  if (event.status)
    patch.status = event.status;
  if (asString(event.raw.path))
    patch.path = event.raw.path;
  db.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?", [
    mergeJson(row.metadata_json, patch),
    event.acl === undefined ? null : JSON.stringify(event.acl),
    event.acl === undefined ? null : JSON.stringify(event.acl),
    event.updatedAt,
    row.id
  ]);
  return row.id;
}
function ensureRevision(db, sourceId, event, now) {
  if (!event.revision)
    return null;
  const id = stableId3("rev", `${sourceId}\x00${event.revision}`);
  const metadata = {
    source_ref: event.sourceRef,
    source_uri: event.sourceUri,
    status: event.status,
    last_outbox_event: event.eventType,
    reindex_required: true
  };
  db.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`, [id, sourceId, event.revision, event.hash, asString(event.raw.extracted_text_ref) ?? null, JSON.stringify(metadata), now]);
  const row = db.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(sourceId, event.revision);
  return row?.id ?? null;
}
function revisionIdsForEvent(db, sourceId, event) {
  if (event.previousRevision) {
    const previous = db.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(sourceId, event.previousRevision).map((row) => row.id);
    if (previous.length > 0)
      return previous;
  }
  if (event.revision) {
    return db.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(sourceId, event.revision).map((row) => row.id);
  }
  if (event.hash) {
    return db.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(sourceId, event.hash).map((row) => row.id);
  }
  return db.query("SELECT id FROM source_revisions WHERE source_id = ?").all(sourceId).map((row) => row.id);
}
function invalidateRevision(db, revisionId) {
  const chunks = db.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(revisionId);
  let embeddingsDeleted = 0;
  let vectorEntriesDeleted = 0;
  for (const chunk of chunks) {
    const row = db.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(chunk.id);
    embeddingsDeleted += row?.n ?? 0;
    const vectorRow = db.query("SELECT COUNT(*) AS n FROM vector_index_entries WHERE chunk_id = ?").get(chunk.id);
    vectorEntriesDeleted += vectorRow?.n ?? 0;
    db.run("DELETE FROM vector_index_entries WHERE chunk_id = ?", [chunk.id]);
    db.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?", [chunk.id]);
    db.run("DELETE FROM chunks_fts WHERE chunk_id = ?", [chunk.id]);
  }
  db.run("DELETE FROM chunks WHERE source_revision_id = ?", [revisionId]);
  const revision = db.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(revisionId);
  db.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?", [mergeJson(revision?.metadata_json, { reindex_required: true, invalidated_at: new Date().toISOString() }), revisionId]);
  return { chunksDeleted: chunks.length, embeddingsDeleted, vectorEntriesDeleted };
}
function isDeleteEvent(eventType2, status) {
  return status === "deleted" || ["delete", "deleted", "remove", "removed"].includes(eventType2);
}
function isMoveEvent(eventType2) {
  return ["move", "moved", "rename", "renamed", "path_changed", "canonical_key_changed"].includes(eventType2);
}
function isPermissionEvent(eventType2) {
  return ["permission", "permissions", "permission_changed", "acl_changed", "acl_revoked"].includes(eventType2);
}
async function consumeOpenFilesOutbox(options) {
  const now = (options.now ?? new Date).toISOString();
  if (options.safetyPolicy)
    assertWriteAllowed(options.dbPath, options.safetyPolicy);
  migrateKnowledgeDb(options.dbPath);
  const text = await readOutboxInput(options.input, options.config, options.safetyPolicy);
  const events = parseOutboxText(text);
  const db = openKnowledgeDb(options.dbPath);
  const runId = `run_${randomUUID4()}`;
  try {
    return db.transaction(() => {
      db.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        runId,
        "open-files-outbox",
        options.input,
        "completed",
        "local",
        "open-files-outbox",
        JSON.stringify({ path: options.input, events: events.length }),
        now,
        now
      ]);
      const sourcesTouched = new Set;
      const revisionsTouched = new Set;
      let chunksDeleted = 0;
      let embeddingsDeleted = 0;
      let vectorEntriesDeleted = 0;
      let staleRevisions = 0;
      let deletedSources = 0;
      let movedSources = 0;
      let permissionUpdates = 0;
      recordAuditEvent(db, {
        event_type: "source_read",
        action: options.input.startsWith("s3://") ? "s3_outbox_read" : "local_outbox_read",
        target_uri: options.input,
        decision: "allow",
        metadata: { events: events.length, read_only: true },
        created_at: now
      });
      events.forEach((raw, index) => {
        const event = normalizeEvent(raw, now);
        const sourceId = ensureSource(db, event, now);
        sourcesTouched.add(sourceId);
        const createdRevisionId = ensureRevision(db, sourceId, event, now);
        if (createdRevisionId)
          revisionsTouched.add(createdRevisionId);
        const affectedRevisionIds = revisionIdsForEvent(db, sourceId, event);
        for (const revisionId of affectedRevisionIds) {
          revisionsTouched.add(revisionId);
          const invalidation = invalidateRevision(db, revisionId);
          chunksDeleted += invalidation.chunksDeleted;
          embeddingsDeleted += invalidation.embeddingsDeleted;
          vectorEntriesDeleted += invalidation.vectorEntriesDeleted;
          staleRevisions += 1;
        }
        if (isDeleteEvent(event.eventType, event.status))
          deletedSources += 1;
        if (isMoveEvent(event.eventType))
          movedSources += 1;
        if (isPermissionEvent(event.eventType) || event.acl !== undefined)
          permissionUpdates += 1;
        db.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`, [
          stableId3("evt", `${runId}\x00${index}\x00${event.sourceRef}\x00${event.eventType}`),
          runId,
          "info",
          event.eventType,
          JSON.stringify({
            source_ref: event.sourceRef,
            source_uri: event.sourceUri,
            revision: event.revision,
            hash: event.hash,
            status: event.status,
            affected_revisions: affectedRevisionIds.length
          }),
          event.updatedAt
        ]);
      });
      db.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`, [
        stableId3("usage", runId),
        runId,
        "local",
        "open-files-outbox",
        JSON.stringify({ note: "No model provider used for outbox invalidation." }),
        now
      ]);
      recordAuditEvent(db, {
        event_type: "write",
        action: "knowledge_outbox_invalidation",
        target_uri: options.dbPath,
        decision: "allow",
        metadata: {
          run_id: runId,
          events: events.length,
          sources: sourcesTouched.size,
          revisions: revisionsTouched.size,
          chunks_deleted: chunksDeleted,
          embeddings_deleted: embeddingsDeleted,
          vector_entries_deleted: vectorEntriesDeleted
        },
        created_at: now
      });
      return {
        path: options.input,
        db_path: options.dbPath,
        run_id: runId,
        events_seen: events.length,
        sources_touched: sourcesTouched.size,
        revisions_touched: revisionsTouched.size,
        chunks_deleted: chunksDeleted,
        embeddings_deleted: embeddingsDeleted,
        vector_entries_deleted: vectorEntriesDeleted,
        stale_revisions: staleRevisions,
        deleted_sources: deletedSources,
        moved_sources: movedSources,
        permission_updates: permissionUpdates
      };
    })();
  } finally {
    db.close();
  }
}

// src/manifest-ingest.ts
import { createHash as createHash5 } from "crypto";
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "fs";
import { basename as basename2 } from "path";
function stableId4(prefix, value) {
  return `${prefix}_${createHash5("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function asObject2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function asString2(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function buildSourceRefFromItem(item) {
  const explicit = asString2(item.source_ref) ?? asString2(item.source_uri) ?? asString2(item.uri);
  if (explicit)
    return explicit;
  const fileId = asString2(item.file_id);
  if (fileId) {
    const revision = asString2(item.revision_id) ?? asString2(item.revision);
    const fileRef = `open-files://file/${encodeURIComponent(fileId)}`;
    return revision ? `${fileRef}/revision/${encodeURIComponent(revision)}` : fileRef;
  }
  const sourceId = asString2(item.source_id);
  const path = asString2(item.path);
  if (sourceId && path) {
    return `open-files://source/${encodeURIComponent(sourceId)}/path/${encodeURIComponent(path)}`;
  }
  throw new Error("Manifest item is missing source_ref, file_id, or source_id/path.");
}
function baseSourceUri2(sourceRef, parsed) {
  if (parsed.kind === "open-files" && parsed.entity === "file" && parsed.revision_id) {
    return sourceRef.replace(/\/revision\/[^/]+$/, "");
  }
  return sourceRef;
}
function textFromItem(item) {
  const direct = asString2(item.extracted_text) ?? asString2(item.text) ?? asString2(item.content_text) ?? asString2(item.markdown);
  if (direct !== undefined)
    return direct;
  const content = item.content;
  return typeof content === "string" ? content : null;
}
function extractedTextUriFromItem(item) {
  const direct = asString2(item.extracted_text_ref) ?? asString2(item.extracted_text_uri) ?? asString2(item.text_ref);
  if (direct)
    return direct;
  const content = asObject2(item.content);
  return asString2(content?.extracted_text_ref) ?? asString2(content?.extracted_text_uri) ?? null;
}
function titleFromItem(item) {
  const path = asString2(item.path);
  return asString2(item.title) ?? asString2(item.name) ?? (path ? basename2(path) : null);
}
function hashFromItem(item) {
  return asString2(item.hash) ?? asString2(item.checksum) ?? asString2(item.sha256) ?? null;
}
function revisionFromItem(item, parsed, hash) {
  const revision = asString2(item.revision_id) ?? asString2(item.revision) ?? asString2(item.version_id) ?? (parsed.kind === "open-files" ? parsed.revision_id : undefined) ?? hash ?? asString2(item.updated_at);
  return revision ?? "current";
}
function metadataFromItem(item, normalized) {
  const metadata = {};
  for (const [key, value] of Object.entries(item)) {
    if (["text", "content", "content_text", "extracted_text", "markdown"].includes(key))
      continue;
    metadata[key] = value;
  }
  metadata.source_ref = normalized.sourceRef;
  metadata.source_uri = normalized.sourceUri;
  metadata.status = normalized.status;
  return metadata;
}
function normalizeManifestItem(item, now) {
  const sourceRef = buildSourceRefFromItem(item);
  const parsed = parseSourceRef(sourceRef);
  const sourceUri = baseSourceUri2(sourceRef, parsed);
  const hash = hashFromItem(item);
  const status = asString2(item.status) ?? "active";
  return {
    raw: item,
    sourceRef,
    sourceUri,
    kind: parsed.kind,
    title: titleFromItem(item),
    revision: revisionFromItem(item, parsed, hash),
    hash,
    extractedTextUri: extractedTextUriFromItem(item),
    text: textFromItem(item),
    metadata: metadataFromItem(item, { sourceRef, sourceUri, status }),
    acl: item.permissions ?? item.acl ?? {},
    status,
    updatedAt: asString2(item.updated_at) ?? now
  };
}
function parseManifestText(text) {
  const trimmed = text.trim();
  if (!trimmed)
    return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed))
      throw new Error("Manifest array parse failed.");
    return parsed.map((entry) => {
      const item = asObject2(entry);
      if (!item)
        throw new Error("Manifest array entries must be objects.");
      return item;
    });
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const object = asObject2(parsed);
      if (!object)
        throw new Error("Manifest object parse failed.");
      if (Array.isArray(object.items)) {
        return object.items.map((entry) => {
          const item = asObject2(entry);
          if (!item)
            throw new Error("Manifest items entries must be objects.");
          return item;
        });
      }
      if ("source_ref" in object || "source_uri" in object || "file_id" in object)
        return [object];
    } catch (error) {
      const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length <= 1)
        throw error;
      return lines.map((line) => {
        const item = asObject2(JSON.parse(line));
        if (!item)
          throw new Error("Manifest JSONL entries must be objects.");
        return item;
      });
    }
  }
  return trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
    const item = asObject2(JSON.parse(line));
    if (!item)
      throw new Error("Manifest JSONL entries must be objects.");
    return item;
  });
}
async function readS3Text2(uri, config, safetyPolicy) {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!bucket || !key)
    throw new Error(`Invalid S3 manifest URI: ${uri}`);
  if (safetyPolicy)
    assertS3ReadAllowed(uri, safetyPolicy);
  const [{ S3Client, GetObjectCommand }, { fromIni }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/credential-providers")
  ]);
  const s3Config = config?.storage.type === "s3" && config.storage.s3?.bucket === bucket ? config.storage.s3 : undefined;
  const client = new S3Client({
    region: s3Config?.region,
    credentials: s3Config?.profile ? fromIni({ profile: s3Config.profile }) : undefined,
    maxAttempts: s3Config?.max_attempts
  });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body)
    return "";
  return await response.Body.transformToString();
}
async function readManifestInput(input, config, safetyPolicy) {
  if (input.startsWith("s3://"))
    return readS3Text2(input, config, safetyPolicy);
  if (!existsSync5(input))
    throw new Error(`Manifest not found: ${input}`);
  return readFileSync5(input, "utf8");
}
function chunkText(text, maxChars, overlapChars) {
  const normalized = text.replace(/\r\n/g, `
`);
  if (!normalized.trim())
    return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + maxChars);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf(`

`, hardEnd);
      const sentenceBreak = normalized.lastIndexOf(". ", hardEnd);
      const candidate = Math.max(paragraphBreak, sentenceBreak);
      if (candidate > start + Math.floor(maxChars * 0.5))
        end = candidate + (candidate === paragraphBreak ? 2 : 1);
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push({
        ordinal: chunks.length,
        text: chunk,
        startOffset: start,
        endOffset: end
      });
    }
    if (end >= normalized.length)
      break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}
function estimateTokenCount(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}
function deleteChunksForRevision(db, sourceRevisionId) {
  const rows = db.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(sourceRevisionId);
  for (const row of rows) {
    db.run("DELETE FROM chunks_fts WHERE chunk_id = ?", [row.id]);
  }
  db.run("DELETE FROM chunks WHERE source_revision_id = ?", [sourceRevisionId]);
  return rows.length;
}
function upsertSource(db, item, now) {
  const sourceId = stableId4("src", item.sourceUri);
  db.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`, [
    sourceId,
    item.sourceUri,
    item.kind,
    item.title,
    JSON.stringify(item.metadata),
    JSON.stringify(item.acl ?? {}),
    now,
    item.updatedAt
  ]);
  const row = db.query("SELECT id FROM sources WHERE uri = ?").get(item.sourceUri);
  if (!row)
    throw new Error(`Failed to upsert source: ${item.sourceUri}`);
  return row.id;
}
function upsertRevision(db, sourceId, item, now) {
  const revisionId = stableId4("rev", `${sourceId}\x00${item.revision}`);
  db.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`, [
    revisionId,
    sourceId,
    item.revision,
    item.hash,
    item.extractedTextUri,
    JSON.stringify(item.metadata),
    now
  ]);
  const row = db.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(sourceId, item.revision);
  if (!row)
    throw new Error(`Failed to upsert source revision: ${item.sourceRef}`);
  return row.id;
}
function insertChunks(db, sourceRevisionId, item, now, maxChars, overlapChars, safetyPolicy) {
  if (!item.text || item.status.toLowerCase() === "deleted")
    return { chunksInserted: 0, redactions: 0 };
  const redacted = redactSecrets(item.text, safetyPolicy);
  if (redacted.findings.length > 0) {
    recordRedactionFindings(db, {
      source_uri: item.sourceUri,
      findings: redacted.findings,
      metadata: { source_ref: item.sourceRef, revision: item.revision },
      created_at: now
    });
    recordAuditEvent(db, {
      event_type: "redaction",
      action: "source_text_redact",
      target_uri: item.sourceUri,
      decision: "redacted",
      metadata: { findings: redacted.findings.length, source_ref: item.sourceRef, revision: item.revision },
      created_at: now
    });
  }
  const chunks = chunkText(redacted.text, maxChars, overlapChars);
  for (const chunk of chunks) {
    const chunkId = stableId4("chk", `${sourceRevisionId}\x00${chunk.ordinal}\x00${chunk.text}`);
    const provenance = sourceProvenance({
      source_ref: item.sourceRef,
      source_uri: item.sourceUri,
      source_kind: item.kind,
      source_revision_id: sourceRevisionId,
      revision: item.revision,
      hash: item.hash,
      chunk_id: chunkId,
      start_offset: chunk.startOffset,
      end_offset: chunk.endOffset,
      status: item.status,
      resolver: "open-files-read-only"
    });
    const metadata = withProvenance({
      source_ref: item.sourceRef,
      source_uri: item.sourceUri,
      source_kind: item.kind,
      source_revision_id: sourceRevisionId,
      revision: item.revision,
      hash: item.hash,
      status: item.status,
      path: asString2(item.raw.path) ?? null,
      mime: asString2(item.raw.mime) ?? asString2(item.raw.content_type) ?? null,
      size: asNumber(item.raw.size) ?? null
    }, provenance);
    db.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      chunkId,
      sourceRevisionId,
      "source",
      chunk.ordinal,
      chunk.text,
      estimateTokenCount(chunk.text),
      chunk.startOffset,
      chunk.endOffset,
      JSON.stringify(metadata),
      now
    ]);
    db.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)", [chunkId, chunk.text, item.title ?? "", item.sourceUri]);
  }
  return { chunksInserted: chunks.length, redactions: redacted.findings.length };
}
async function ingestOpenFilesManifest(options) {
  const now = options.now ?? new Date;
  if (options.safetyPolicy)
    assertWriteAllowed(options.dbPath, options.safetyPolicy);
  migrateKnowledgeDb(options.dbPath);
  const text = await readManifestInput(options.input, options.config, options.safetyPolicy);
  const items = parseManifestText(text);
  return ingestOpenFilesManifestItems({
    dbPath: options.dbPath,
    items,
    sourceLabel: options.input,
    safetyPolicy: options.safetyPolicy,
    now,
    maxChunkChars: options.maxChunkChars,
    chunkOverlapChars: options.chunkOverlapChars
  });
}
async function ingestOpenFilesManifestItems(options) {
  const now = (options.now ?? new Date).toISOString();
  const maxChunkChars = options.maxChunkChars ?? 4000;
  const chunkOverlapChars = options.chunkOverlapChars ?? 200;
  if (maxChunkChars < 500)
    throw new Error("maxChunkChars must be at least 500.");
  if (chunkOverlapChars < 0 || chunkOverlapChars >= maxChunkChars)
    throw new Error("chunkOverlapChars must be less than maxChunkChars.");
  if (options.safetyPolicy)
    assertWriteAllowed(options.dbPath, options.safetyPolicy);
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const result = db.transaction(() => {
      const seenSources = new Set;
      const seenRevisions = new Set;
      let chunksInserted = 0;
      let chunksDeleted = 0;
      let redactions = 0;
      let skipped = 0;
      recordAuditEvent(db, {
        event_type: "source_read",
        action: options.readAction ?? (options.sourceLabel.startsWith("s3://") ? "s3_manifest_read" : "local_manifest_read"),
        target_uri: options.sourceLabel,
        decision: "allow",
        metadata: { items: options.items.length, read_only: true },
        created_at: now
      });
      for (const raw of options.items) {
        const item = normalizeManifestItem(raw, now);
        const sourceId = upsertSource(db, item, now);
        const revisionId = upsertRevision(db, sourceId, item, now);
        seenSources.add(sourceId);
        seenRevisions.add(revisionId);
        if (item.text || item.status.toLowerCase() === "deleted") {
          chunksDeleted += deleteChunksForRevision(db, revisionId);
        }
        const inserted = insertChunks(db, revisionId, item, now, maxChunkChars, chunkOverlapChars, options.safetyPolicy);
        chunksInserted += inserted.chunksInserted;
        redactions += inserted.redactions;
      }
      recordAuditEvent(db, {
        event_type: "write",
        action: "knowledge_manifest_ingest",
        target_uri: options.dbPath,
        decision: "allow",
        metadata: { items: options.items.length, sources: seenSources.size, revisions: seenRevisions.size, chunks_inserted: chunksInserted, redactions },
        created_at: now
      });
      return {
        path: options.sourceLabel,
        db_path: options.dbPath,
        items_seen: options.items.length,
        sources_upserted: seenSources.size,
        revisions_upserted: seenRevisions.size,
        chunks_inserted: chunksInserted,
        chunks_deleted: chunksDeleted,
        redactions,
        skipped
      };
    })();
    return result;
  } finally {
    db.close();
  }
}

// src/machines.ts
import { spawnSync } from "child_process";
import { hostname, platform, userInfo } from "os";
function asString3(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asBooleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}
function normalizePlatform(value = platform()) {
  const normalized = value.toLowerCase();
  if (normalized === "darwin" || normalized === "macos")
    return "macos";
  if (normalized === "win32" || normalized === "windows")
    return "windows";
  if (normalized === "linux")
    return "linux";
  return value;
}
function defaultRunner(command) {
  const result = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    env: process.env
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1
  };
}
async function runCommand(runner, command) {
  return await runner(command);
}
async function hasCommand(command, runner) {
  const result = await runCommand(runner, `command -v ${command} >/dev/null 2>&1`);
  return result.exitCode === 0;
}
function parseTailscaleStatus(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object")
      return null;
    return parsed;
  } catch {
    return null;
  }
}
function peerKey(peer) {
  if (!peer)
    return null;
  return peer.HostName ?? peer.DNSName?.split(".")[0] ?? null;
}
async function loadTailscalePeers(runner, warnings) {
  const peers = new Map;
  if (!await hasCommand("tailscale", runner)) {
    warnings.push("tailscale_not_available");
    return { peers, selfKey: null };
  }
  const result = await runCommand(runner, "tailscale status --json");
  if (result.exitCode !== 0) {
    warnings.push(`tailscale_status_failed:${result.stderr.trim() || result.exitCode}`);
    return { peers, selfKey: null };
  }
  const status = parseTailscaleStatus(result.stdout);
  if (!status) {
    warnings.push("tailscale_status_invalid_json");
    return { peers, selfKey: null };
  }
  const addPeer = (peer) => {
    const key = peerKey(peer);
    if (key && peer)
      peers.set(key, peer);
  };
  addPeer(status.Self);
  for (const peer of Object.values(status.Peer ?? {}))
    addPeer(peer);
  return { peers, selfKey: peerKey(status.Self) };
}
function localMachineId(fallback) {
  return process.env.HASNA_MACHINE_ID ?? process.env.OPEN_MACHINES_MACHINE_ID ?? process.env.MACHINE_ID ?? fallback ?? hostname();
}
function buildLocalEntry(input) {
  const local = input.machineId === input.localMachineId || input.machineId === hostname();
  const dnsName = input.peer?.DNSName?.replace(/\.$/, "") ?? null;
  const tailscaleTarget = dnsName ?? input.peer?.TailscaleIPs?.[0] ?? null;
  const hints = [];
  if (local)
    hints.push({ kind: "local", target: "localhost", reachable: true });
  if (tailscaleTarget)
    hints.push({ kind: "tailscale", target: tailscaleTarget, reachable: input.peer?.Online ?? null });
  const selectedRoute = hints.find((hint) => hint.kind === "local") ?? hints.find((hint) => hint.kind === "tailscale") ?? null;
  return {
    machine_id: input.machineId,
    hostname: input.peer?.HostName ?? (local ? hostname() : input.machineId),
    local,
    platform: input.peer?.OS ? normalizePlatform(input.peer.OS) : local ? normalizePlatform() : null,
    os: input.peer?.OS ?? (local ? platform() : null),
    user: local ? userInfo().username : null,
    workspace_path: null,
    manifest_declared: false,
    heartbeat_status: "unknown",
    last_heartbeat_at: null,
    tailscale: {
      dns_name: dnsName,
      ips: input.peer?.TailscaleIPs ?? [],
      online: input.peer?.Online ?? null,
      active: input.peer?.Active ?? null,
      last_seen: input.peer?.LastSeen ?? null
    },
    ssh: {
      address: null,
      route: selectedRoute?.kind === "local" ? "local" : selectedRoute?.kind === "tailscale" ? "tailscale" : "unknown",
      command_target: selectedRoute?.target ?? null
    },
    route_hints: hints,
    tags: [],
    metadata: {},
    source: "local"
  };
}
function normalizeRouteHints(value) {
  if (!Array.isArray(value))
    return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    const kind = asString3(record.kind) ?? "unknown";
    const routeKind = kind === "local" || kind === "lan" || kind === "tailscale" || kind === "ssh" ? kind : "unknown";
    return {
      kind: routeKind,
      target: asString3(record.target) ?? "",
      reachable: asBooleanOrNull(record.reachable)
    };
  }).filter((entry) => entry.target.length > 0);
}
function normalizeOpenMachinesEntry(entry, localMachineId2) {
  const machineId = asString3(entry.machine_id) ?? asString3(entry.hostname) ?? "unknown";
  const tailscale = asRecord(entry.tailscale);
  const ssh = asRecord(entry.ssh);
  const heartbeatStatus = asString3(entry.heartbeat_status);
  const route = asString3(ssh.route);
  return {
    machine_id: machineId,
    hostname: asString3(entry.hostname),
    local: machineId === localMachineId2,
    platform: asString3(entry.platform),
    os: asString3(entry.os),
    user: asString3(entry.user),
    workspace_path: asString3(entry.workspace_path),
    manifest_declared: entry.manifest_declared === true,
    heartbeat_status: heartbeatStatus === "online" || heartbeatStatus === "offline" ? heartbeatStatus : "unknown",
    last_heartbeat_at: asString3(entry.last_heartbeat_at),
    tailscale: {
      dns_name: asString3(tailscale.dns_name),
      ips: asStringArray(tailscale.ips),
      online: asBooleanOrNull(tailscale.online),
      active: asBooleanOrNull(tailscale.active),
      last_seen: asString3(tailscale.last_seen)
    },
    ssh: {
      address: asString3(ssh.address),
      route: route === "local" || route === "lan" || route === "tailscale" ? route : "unknown",
      command_target: asString3(ssh.command_target)
    },
    route_hints: normalizeRouteHints(entry.route_hints),
    tags: asStringArray(entry.tags),
    metadata: asRecord(entry.metadata),
    source: "open-machines"
  };
}
function topologyMessage(source, count2) {
  return `${count2} machine${count2 === 1 ? "" : "s"} discovered via ${source}`;
}
function optionalModuleError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find module '@hasna/machines'") || message.includes("Cannot find module '@hasna/machines/consumer'") ? "module_not_found" : message;
}
function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function machinesCliCommand(args) {
  return ["machines", ...args].map(shellQuote).join(" ");
}
function preflightTargetIsLocal(machineId) {
  return machineId === "local" || machineId === "localhost" || machineId === hostname() || machineId === process.env.HASNA_MACHINE_ID || machineId === process.env.OPEN_MACHINES_MACHINE_ID || machineId === process.env.MACHINE_ID;
}
function defaultPreflightRunner(machineId, command) {
  const local = preflightTargetIsLocal(machineId);
  const shellCommand = local ? command : `ssh ${shellQuote(machineId)} ${shellQuote(command)}`;
  const result = spawnSync("bash", ["-c", shellCommand], {
    encoding: "utf8",
    env: process.env
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
    source: local ? "local" : "ssh"
  };
}
async function runPreflightCommand(runner, machineId, command) {
  return await runner(machineId, command);
}
function preflightStatus(required, ok) {
  if (ok)
    return "ok";
  return required === false ? "warn" : "fail";
}
function preflightId(value) {
  return value.replace(/[^a-zA-Z0-9_.@/-]+/g, "-").replace(/^-+|-+$/g, "");
}
function packageCommand(name) {
  if (name === "@hasna/knowledge")
    return "knowledge";
  if (name === "@hasna/machines")
    return "machines";
  return name.split("/").pop() ?? name;
}
function firstLine(value) {
  return value.trim().split(/\r?\n/).find(Boolean) ?? "";
}
function extractVersion(value) {
  const match = value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match?.[0] ?? null;
}
function parseKeyValue(stdout) {
  const result = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0)
      continue;
    result[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return result;
}
function makePreflightCheck(input) {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    target: input.target,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
    detail: input.detail,
    source: input.source
  };
}
async function inspectPreflightCommand(machineId, spec, runner) {
  const script = [
    `cmd=${shellQuote(spec.command)}`,
    'path="$(command -v "$cmd" 2>/dev/null || true)"',
    'printf "path=%s\\n" "$path"',
    `if [ -n "$path" ]; then version="$("$cmd" ${spec.versionArgs ?? "--version"} 2>/dev/null || true)"; printf "version=%s\\n" "$version"; fi`
  ].join("; ");
  const result = await runPreflightCommand(runner, machineId, script);
  const parsed = parseKeyValue(result.stdout);
  return {
    path: parsed.path || null,
    version: parsed.version ? firstLine(parsed.version) : null,
    stderr: result.stderr,
    source: result.source ?? (preflightTargetIsLocal(machineId) ? "local" : "ssh")
  };
}
function jsonFieldCommand(field) {
  const regex = field === "name" ? String.raw`s/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p` : String.raw`s/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p`;
  return [
    `if command -v bun >/dev/null 2>&1; then bun -e "const p=JSON.parse(await Bun.file(process.argv[1]).text()); console.log(p.${field} ?? '')" "$pkg" 2>/dev/null`,
    `elif command -v node >/dev/null 2>&1; then node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.${field} || '')" "$pkg" 2>/dev/null`,
    `else sed -n '${regex}' "$pkg" | head -n 1`,
    "fi"
  ].join("; ");
}
async function inspectPreflightWorkspace(machineId, spec, runner) {
  const script = [
    `path=${shellQuote(spec.path)}`,
    'printf "exists=%s\\n" "$(test -d "$path" && printf yes || printf no)"',
    'pkg="$path/package.json"',
    'printf "package_json=%s\\n" "$(test -f "$pkg" && printf yes || printf no)"',
    `if [ -f "$pkg" ]; then printf "package_name=%s\\n" "$(${jsonFieldCommand("name")})"; printf "version=%s\\n" "$(${jsonFieldCommand("version")})"; fi`
  ].join("; ");
  const result = await runPreflightCommand(runner, machineId, script);
  const parsed = parseKeyValue(result.stdout);
  return {
    exists: parsed.exists === "yes",
    packageJson: parsed.package_json === "yes",
    packageName: parsed.package_name || null,
    version: parsed.version || null,
    stderr: result.stderr,
    source: result.source ?? (preflightTargetIsLocal(machineId) ? "local" : "ssh")
  };
}
async function fallbackCommandChecks(machineId, spec, runner) {
  const inspection = await inspectPreflightCommand(machineId, spec, runner);
  const found = Boolean(inspection.path);
  const checks = [
    makePreflightCheck({
      id: `command:${preflightId(spec.command)}:path`,
      kind: "command",
      status: preflightStatus(spec.required, found),
      target: spec.command,
      expected: "available",
      actual: inspection.path ?? "missing",
      detail: found ? `found at ${inspection.path}` : inspection.stderr || "command missing",
      source: inspection.source
    })
  ];
  if (spec.expectedVersion) {
    const actualVersion = extractVersion(inspection.version ?? "");
    checks.push(makePreflightCheck({
      id: `command:${preflightId(spec.command)}:version`,
      kind: "command",
      status: actualVersion === spec.expectedVersion ? "ok" : preflightStatus(spec.required, false),
      target: spec.command,
      expected: spec.expectedVersion,
      actual: actualVersion ?? inspection.version ?? "missing",
      detail: actualVersion ? `version output: ${inspection.version}` : "version unavailable",
      source: inspection.source
    }));
  }
  return checks;
}
async function fallbackPackageChecks(machineId, spec, runner) {
  const command = spec.command ?? packageCommand(spec.name);
  const inspection = await inspectPreflightCommand(machineId, { command, expectedVersion: spec.expectedVersion, required: spec.required }, runner);
  const found = Boolean(inspection.path);
  const checks = [
    makePreflightCheck({
      id: `package:${preflightId(spec.name)}:command`,
      kind: "package",
      status: preflightStatus(spec.required, found),
      target: spec.name,
      expected: command,
      actual: inspection.path ?? "missing",
      detail: found ? `${command} found at ${inspection.path}` : `${command} command missing`,
      source: inspection.source
    })
  ];
  if (spec.expectedVersion) {
    const actualVersion = extractVersion(inspection.version ?? "");
    checks.push(makePreflightCheck({
      id: `package:${preflightId(spec.name)}:version`,
      kind: "package",
      status: actualVersion === spec.expectedVersion ? "ok" : preflightStatus(spec.required, false),
      target: spec.name,
      expected: spec.expectedVersion,
      actual: actualVersion ?? inspection.version ?? "missing",
      detail: actualVersion ? `version output: ${inspection.version}` : "version unavailable",
      source: inspection.source
    }));
  }
  return checks;
}
async function fallbackWorkspaceChecks(machineId, spec, runner) {
  const inspection = await inspectPreflightWorkspace(machineId, spec, runner);
  const target = spec.label ?? spec.path;
  const checks = [
    makePreflightCheck({
      id: `workspace:${preflightId(target)}:path`,
      kind: "workspace",
      status: preflightStatus(spec.required, inspection.exists),
      target,
      expected: spec.path,
      actual: inspection.exists ? "exists" : "missing",
      detail: inspection.exists ? `workspace exists at ${spec.path}` : inspection.stderr || `workspace missing at ${spec.path}`,
      source: inspection.source
    })
  ];
  if (spec.expectedPackageName) {
    checks.push(makePreflightCheck({
      id: `workspace:${preflightId(target)}:package-name`,
      kind: "workspace",
      status: inspection.packageName === spec.expectedPackageName ? "ok" : preflightStatus(spec.required, false),
      target,
      expected: spec.expectedPackageName,
      actual: inspection.packageName ?? (inspection.packageJson ? "missing-name" : "missing-package-json"),
      detail: inspection.packageJson ? "package.json inspected" : "package.json missing",
      source: inspection.source
    }));
  }
  if (spec.expectedVersion) {
    checks.push(makePreflightCheck({
      id: `workspace:${preflightId(target)}:version`,
      kind: "workspace",
      status: inspection.version === spec.expectedVersion ? "ok" : preflightStatus(spec.required, false),
      target,
      expected: spec.expectedVersion,
      actual: inspection.version ?? (inspection.packageJson ? "missing-version" : "missing-package-json"),
      detail: inspection.packageJson ? "package.json inspected" : "package.json missing",
      source: inspection.source
    }));
  }
  return checks;
}
function withKnowledgeContext(topology, options) {
  return {
    ...topology,
    knowledge: {
      scope: options.knowledge?.scope ?? "global",
      app_path: HASNA_KNOWLEDGE_APP_PATH,
      workspace_home: options.knowledge?.workspace_home ?? null
    },
    message: topologyMessage(topology.source, topology.machines.length)
  };
}
async function loadOpenMachinesModule() {
  try {
    const specifier = "@hasna/machines/consumer";
    return await import(specifier);
  } catch (error) {
    if (optionalModuleError(error) !== "module_not_found")
      throw error;
    const specifier = "@hasna/machines";
    return await import(specifier);
  }
}
function normalizeOpenMachinesTopology(value, options) {
  const raw = asRecord(value);
  const machines = Array.isArray(raw.machines) ? raw.machines : null;
  const localMachine = asString3(raw.local_machine_id);
  if (!machines || !localMachine)
    return null;
  const topology = {
    ok: true,
    source: "open-machines",
    generated_at: asString3(raw.generated_at) ?? (options.now ?? new Date).toISOString(),
    local_machine_id: localMachine,
    local_hostname: asString3(raw.local_hostname) ?? hostname(),
    current_platform: asString3(raw.current_platform) ?? normalizePlatform(),
    machines: machines.map((machine) => normalizeOpenMachinesEntry(machine, localMachine)),
    warnings: asStringArray(raw.warnings),
    adapter: {
      package: "@hasna/machines",
      available: true,
      error: null
    }
  };
  return withKnowledgeContext(topology, options);
}
function normalizeRouteKind(value) {
  return value === "local" || value === "lan" || value === "tailscale" || value === "ssh" || value === "unknown" ? value : null;
}
function normalizeOpenMachinesRoute(value) {
  const raw = asRecord(value);
  const target = asString3(raw.target) ?? asString3(raw.command_target);
  if (raw.ok !== true || !target)
    return null;
  const evidence = typeof raw.evidence === "object" && raw.evidence !== null ? raw.evidence : null;
  const selectedHint = typeof evidence?.selected_hint === "object" && evidence.selected_hint !== null ? evidence.selected_hint : null;
  return {
    target,
    route: normalizeRouteKind(raw.route),
    targetKind: normalizeRouteKind(selectedHint?.kind) ?? normalizeRouteKind(raw.source) ?? normalizeRouteKind(raw.route),
    confidence: asString3(raw.confidence),
    source: "open-machines",
    evidence,
    warnings: asStringArray(raw.warnings)
  };
}
async function discoverOpenMachinesCliTopology(options) {
  const runner = options.runner ?? defaultRunner;
  if (!await hasCommand("machines", runner))
    return null;
  const args = ["topology", "--json"];
  if (options.includeTailscale === false)
    args.push("--no-tailscale");
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0)
    return null;
  return normalizeOpenMachinesTopology(parseJson(result.stdout), options);
}
async function discoverLocalTopology(options, adapterError) {
  const warnings = [];
  if (adapterError)
    warnings.push(`open_machines_unavailable:${adapterError}`);
  const runner = options.runner ?? defaultRunner;
  const tailscale = options.includeTailscale === false ? { peers: new Map, selfKey: null } : await loadTailscalePeers(runner, warnings);
  const localId = localMachineId(tailscale.selfKey);
  const machineIds = new Set([localId, ...tailscale.peers.keys()]);
  const machines = [...machineIds].sort().map((machineId) => buildLocalEntry({
    machineId,
    localMachineId: localId,
    peer: tailscale.peers.get(machineId)
  }));
  return withKnowledgeContext({
    ok: true,
    source: "local",
    generated_at: (options.now ?? new Date).toISOString(),
    local_machine_id: localId,
    local_hostname: hostname(),
    current_platform: normalizePlatform(),
    machines,
    warnings,
    adapter: {
      package: "@hasna/machines",
      available: false,
      error: adapterError
    }
  }, options);
}
async function discoverKnowledgeMachineTopology(options = {}) {
  try {
    const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
    const mod = await loader();
    if (mod?.discoverMachineTopology) {
      const topology = mod.discoverMachineTopology({
        includeTailscale: options.includeTailscale,
        runner: options.runner,
        now: options.now
      });
      const normalized = normalizeOpenMachinesTopology(topology, options);
      if (normalized)
        return normalized;
      return await discoverOpenMachinesCliTopology(options) ?? await discoverLocalTopology(options, "invalid_topology_shape");
    }
    return await discoverOpenMachinesCliTopology(options) ?? await discoverLocalTopology(options, "missing_discoverMachineTopology");
  } catch (error) {
    return await discoverOpenMachinesCliTopology(options) ?? await discoverLocalTopology(options, optionalModuleError(error));
  }
}
async function resolveOpenMachinesCliRoute(options) {
  const runner = options.runner ?? defaultRunner;
  if (!await hasCommand("machines", runner))
    return null;
  const args = ["route", "--machine", options.machineId, "--json"];
  if (options.includeTailscale === false)
    args.push("--no-tailscale");
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0)
    return null;
  return normalizeOpenMachinesRoute(parseJson(result.stdout));
}
function rawMachineRoute(machineId) {
  return {
    target: machineId,
    route: null,
    targetKind: null,
    confidence: null,
    source: "raw",
    evidence: null,
    warnings: []
  };
}
async function resolveKnowledgeMachineRoute(options) {
  try {
    const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
    const mod = await loader();
    if (mod?.resolveMachineRoute) {
      const normalized = normalizeOpenMachinesRoute(mod.resolveMachineRoute(options.machineId, {
        includeTailscale: options.includeTailscale,
        runner: options.runner,
        now: options.now
      }));
      if (normalized)
        return normalized;
      return await resolveOpenMachinesCliRoute(options) ?? rawMachineRoute(options.machineId);
    }
    return await resolveOpenMachinesCliRoute(options) ?? rawMachineRoute(options.machineId);
  } catch (error) {
    return await resolveOpenMachinesCliRoute(options) ?? {
      ...rawMachineRoute(options.machineId),
      warnings: [optionalModuleError(error)]
    };
  }
}
function withPreflightKnowledgeContext(report, options) {
  return {
    ...report,
    knowledge: {
      scope: options.knowledge?.scope ?? "global",
      app_path: HASNA_KNOWLEDGE_APP_PATH,
      workspace_home: options.knowledge?.workspace_home ?? null
    },
    message: report.ok ? `Machine ${report.machine_id} passed knowledge preflight` : `Machine ${report.machine_id} failed knowledge preflight: ${report.summary.fail} failing check(s)`
  };
}
function normalizeOpenMachinesPreflight(value, options) {
  const raw = asRecord(value);
  const checksRaw = Array.isArray(raw.checks) ? raw.checks : null;
  const machineId = asString3(raw.machine_id) ?? asString3(raw.machineId);
  if (!checksRaw || !machineId)
    return null;
  const checks = checksRaw.map((entry) => {
    const record = asRecord(entry);
    const status = asString3(record.status);
    const kind = asString3(record.kind);
    const source = asString3(record.source);
    return makePreflightCheck({
      id: asString3(record.id) ?? "unknown",
      kind: kind === "command" || kind === "package" || kind === "workspace" ? kind : "command",
      status: status === "ok" || status === "warn" || status === "fail" ? status : "fail",
      target: asString3(record.target) ?? "unknown",
      expected: asString3(record.expected),
      actual: asString3(record.actual),
      detail: asString3(record.detail) ?? "",
      source: source === "local" || source === "ssh" || source === "open-machines" ? source : "open-machines"
    });
  });
  const summary = {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };
  return withPreflightKnowledgeContext({
    ok: summary.fail === 0,
    source: "open-machines",
    machine_id: machineId,
    generated_at: asString3(raw.generated_at) ?? (options.now ?? new Date).toISOString(),
    checks,
    summary,
    adapter: {
      package: "@hasna/machines",
      available: true,
      error: null
    }
  }, options);
}
function machinesCliPreflightRunner(options) {
  if (!options.runner)
    return defaultRunner;
  return async (command) => {
    const result = await options.runner?.("local", command);
    return {
      stdout: result?.stdout ?? "",
      stderr: result?.stderr ?? "",
      exitCode: result?.exitCode ?? 1
    };
  };
}
function machinesCliPackageSpec(spec) {
  return [spec.name, spec.command, spec.expectedVersion].filter((value) => Boolean(value)).join(":");
}
function machinesCliWorkspaceSpec(spec) {
  const suffix = [spec.expectedPackageName, spec.expectedVersion].filter((value) => Boolean(value)).join(":");
  const path = suffix ? `${spec.path}:${suffix}` : spec.path;
  return spec.label ? `${spec.label}=${path}` : path;
}
async function preflightOpenMachinesCli(options) {
  const runner = machinesCliPreflightRunner(options);
  if (!await hasCommand("machines", runner))
    return null;
  const args = [
    "compatibility",
    "--json",
    "--machine",
    options.machineId ?? "local"
  ];
  for (const spec of options.commands ?? []) {
    args.push("--command", spec.expectedVersion ? `${spec.command}:${spec.expectedVersion}` : spec.command);
  }
  for (const spec of options.packages ?? [])
    args.push("--package", machinesCliPackageSpec(spec));
  for (const spec of options.workspaces ?? [])
    args.push("--workspace", machinesCliWorkspaceSpec(spec));
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0)
    return null;
  return normalizeOpenMachinesPreflight(parseJson(result.stdout), options);
}
async function fallbackPreflight(options, adapterError) {
  const machineId = options.machineId ?? hostname();
  const runner = options.runner ?? defaultPreflightRunner;
  const commands = options.commands ?? [{ command: "bun", required: true }, { command: "knowledge", required: true }];
  const packages = options.packages ?? [{ name: "@hasna/knowledge", command: "knowledge", required: true }];
  const workspaces = options.workspaces ?? [];
  const checks = [];
  for (const spec of commands)
    checks.push(...await fallbackCommandChecks(machineId, spec, runner));
  for (const spec of packages)
    checks.push(...await fallbackPackageChecks(machineId, spec, runner));
  for (const spec of workspaces)
    checks.push(...await fallbackWorkspaceChecks(machineId, spec, runner));
  if (adapterError) {
    checks.push(makePreflightCheck({
      id: "adapter:@hasna/machines",
      kind: "package",
      status: "warn",
      target: "@hasna/machines",
      expected: "optional",
      actual: adapterError,
      detail: "Using knowledge local/ssh compatibility fallback",
      source: preflightTargetIsLocal(machineId) ? "local" : "ssh"
    }));
  }
  const summary = {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };
  return withPreflightKnowledgeContext({
    ok: summary.fail === 0,
    source: "local",
    machine_id: machineId,
    generated_at: (options.now ?? new Date).toISOString(),
    checks,
    summary,
    adapter: {
      package: "@hasna/machines",
      available: false,
      error: adapterError
    }
  }, options);
}
async function preflightKnowledgeMachine(options = {}) {
  try {
    const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
    const mod = await loader();
    if (mod?.checkMachineCompatibility) {
      const report = mod.checkMachineCompatibility({
        machineId: options.machineId,
        commands: options.commands,
        packages: options.packages,
        workspaces: options.workspaces,
        runner: options.runner,
        now: options.now
      });
      const normalized = normalizeOpenMachinesPreflight(report, options);
      if (normalized)
        return normalized;
      return await preflightOpenMachinesCli(options) ?? await fallbackPreflight(options, "invalid_compatibility_shape");
    }
    return await preflightOpenMachinesCli(options) ?? await fallbackPreflight(options, "missing_checkMachineCompatibility");
  } catch (error) {
    return await preflightOpenMachinesCli(options) ?? await fallbackPreflight(options, optionalModuleError(error));
  }
}

// src/source-ingest.ts
import { createHash as createHash6 } from "crypto";
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "fs";
import { basename as basename3 } from "path";

// src/source-resolver.ts
function parseJsonObject3(value) {
  if (!value)
    return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function metadataString3(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0)
      return value;
  }
  return null;
}
function metadataNumber3(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value))
      return value;
  }
  return null;
}
function assertPurposeAllowed(permissions, purpose) {
  const mode = permissions.mode;
  if (typeof mode === "string" && mode !== "read_only") {
    throw new Error(`Source resolver denied ${purpose}. Permission mode is ${mode}, expected read_only.`);
  }
  const denied = permissions.denied_purposes;
  if (Array.isArray(denied) && denied.includes(purpose)) {
    throw new Error(`Source resolver denied ${purpose}. Purpose is explicitly denied.`);
  }
  const allowed = permissions.allowed_purposes;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(purpose)) {
    throw new Error(`Source resolver denied ${purpose}. Allowed purposes: ${allowed.join(", ")}`);
  }
}
function sourceRevisionRef(sourceUri, revision, fallback) {
  if (!revision)
    return fallback;
  try {
    const parsed = parseSourceRef(sourceUri);
    if (parsed.kind === "open-files" && parsed.entity === "file") {
      return `${sourceUri}/revision/${encodeURIComponent(revision.revision)}`;
    }
  } catch {
    return fallback;
  }
  return fallback;
}
function selectSource(db, sourceUri, requestedRef) {
  return db.query(`SELECT id, uri, kind, title, metadata_json, acl_json, updated_at
     FROM sources
     WHERE uri = ? OR uri = ?
     ORDER BY CASE WHEN uri = ? THEN 0 ELSE 1 END
     LIMIT 1`).get(sourceUri, requestedRef, sourceUri) ?? null;
}
function selectRevision(db, sourceId, revisionId) {
  if (revisionId) {
    return db.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
       FROM source_revisions
       WHERE source_id = ? AND revision = ?
       LIMIT 1`).get(sourceId, revisionId) ?? null;
  }
  return db.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
     FROM source_revisions
     WHERE source_id = ?
     ORDER BY created_at DESC, revision DESC
     LIMIT 1`).get(sourceId) ?? null;
}
function countChunks(db, revisionId) {
  if (!revisionId)
    return 0;
  const row = db.query("SELECT COUNT(*) AS n FROM chunks WHERE source_revision_id = ?").get(revisionId);
  return row?.n ?? 0;
}
function selectChunks(db, revisionId, limit) {
  if (!revisionId || limit <= 0)
    return [];
  return db.query(`SELECT id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json
     FROM chunks
     WHERE source_revision_id = ?
     ORDER BY ordinal ASC
     LIMIT ?`).all(revisionId, limit);
}
async function resolveOpenFilesSource(options) {
  const purpose = options.purpose ?? "knowledge_answer";
  const limit = Math.max(0, Math.min(options.limit ?? 10, 100));
  const resolvedAt = (options.now ?? new Date).toISOString();
  const parsed = parseSourceRef(options.sourceRef);
  const sourceUri = catalogSourceUriForRef(options.sourceRef, parsed);
  const requestedRevision = revisionIdForSourceRef(options.sourceRef);
  if (options.safetyPolicy) {
    if (!options.safetyPolicy.readOnlySourceAccess)
      throw new Error("Safety policy denied source resolution.");
    assertWriteAllowed(options.dbPath, options.safetyPolicy);
  }
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    return db.transaction(() => {
      const source = selectSource(db, sourceUri, options.sourceRef);
      if (!source) {
        recordAuditEvent(db, {
          event_type: "source_read",
          action: "open_files_resolve_missing",
          target_uri: options.sourceRef,
          decision: "allow",
          metadata: { purpose, read_only: true, source_uri: sourceUri },
          created_at: resolvedAt
        });
        return {
          source_ref: options.sourceRef,
          source_uri: sourceUri,
          purpose,
          read_only: true,
          resolved: false,
          resolver: {
            name: "open-files-read-only",
            mode: "local_catalog",
            contract: "open-files-knowledge-source-v1"
          },
          source: null,
          revision: null,
          content: {
            mime: null,
            size: null,
            hash: null,
            text_available: false,
            chunks_total: 0,
            chunks_returned: 0,
            char_count_returned: 0,
            extracted_text_ref: null,
            bytes_available: false,
            bytes_exposed: false
          },
          chunks: [],
          citations: []
        };
      }
      const sourceMetadata = parseJsonObject3(source.metadata_json);
      const permissions = parseJsonObject3(source.acl_json);
      try {
        assertPurposeAllowed(permissions, purpose);
      } catch (error) {
        recordAuditEvent(db, {
          event_type: "source_read",
          action: "open_files_resolve",
          target_uri: options.sourceRef,
          decision: "deny",
          metadata: {
            purpose,
            read_only: true,
            source_uri: source.uri,
            error: error instanceof Error ? error.message : String(error)
          },
          created_at: resolvedAt
        });
        throw error;
      }
      const revision = selectRevision(db, source.id, requestedRevision);
      const revisionMetadata = parseJsonObject3(revision?.metadata_json);
      const totalChunks = countChunks(db, revision?.id ?? null);
      const rows = selectChunks(db, revision?.id ?? null, limit);
      const effectiveSourceRef = sourceRevisionRef(source.uri, revision, options.sourceRef);
      const chunks = rows.map((row) => {
        const metadata = parseJsonObject3(row.metadata_json);
        const evidence = {
          resolver: "open-files-read-only",
          mode: "local_catalog",
          purpose,
          read_only: true,
          source_ref: metadataString3(metadata, ["source_ref"]) ?? effectiveSourceRef,
          source_uri: source.uri,
          source_revision_id: revision?.id ?? null,
          revision: revision?.revision ?? null,
          hash: revision?.hash ?? metadataString3(metadata, ["hash"]),
          chunk_id: row.id,
          start_offset: row.start_offset,
          end_offset: row.end_offset,
          resolved_at: resolvedAt
        };
        const provenance = sourceProvenance({
          source_ref: evidence.source_ref,
          source_uri: evidence.source_uri,
          source_kind: source.kind,
          source_revision_id: evidence.source_revision_id,
          revision: evidence.revision,
          hash: evidence.hash,
          chunk_id: row.id,
          start_offset: row.start_offset,
          end_offset: row.end_offset,
          status: metadataString3(metadata, ["status"]),
          resolver: evidence.resolver
        });
        return {
          id: row.id,
          kind: row.kind,
          ordinal: row.ordinal,
          text: row.text,
          token_count: row.token_count,
          start_offset: row.start_offset,
          end_offset: row.end_offset,
          metadata,
          evidence,
          provenance
        };
      });
      const citations = chunks.map((chunk) => ({
        source_ref: chunk.evidence.source_ref,
        source_uri: source.uri,
        chunk_id: chunk.id,
        quote: chunk.text.slice(0, 500),
        start_offset: chunk.start_offset,
        end_offset: chunk.end_offset,
        evidence: chunk.evidence,
        provenance: chunk.provenance
      }));
      recordAuditEvent(db, {
        event_type: "source_read",
        action: "open_files_resolve",
        target_uri: options.sourceRef,
        decision: "allow",
        metadata: {
          purpose,
          read_only: true,
          source_uri: source.uri,
          revision: revision?.revision ?? null,
          chunks_returned: chunks.length,
          chunks_total: totalChunks
        },
        created_at: resolvedAt
      });
      const mime = metadataString3(sourceMetadata, ["mime", "content_type"]) ?? metadataString3(revisionMetadata, ["mime", "content_type"]);
      const size = metadataNumber3(sourceMetadata, ["size", "size_bytes"]) ?? metadataNumber3(revisionMetadata, ["size", "size_bytes"]);
      return {
        source_ref: effectiveSourceRef,
        source_uri: source.uri,
        purpose,
        read_only: true,
        resolved: true,
        resolver: {
          name: "open-files-read-only",
          mode: "local_catalog",
          contract: "open-files-knowledge-source-v1"
        },
        source: {
          id: source.id,
          uri: source.uri,
          kind: source.kind,
          title: source.title,
          metadata: sourceMetadata,
          permissions,
          updated_at: source.updated_at
        },
        revision: revision ? {
          id: revision.id,
          revision: revision.revision,
          hash: revision.hash,
          extracted_text_uri: revision.extracted_text_uri,
          metadata: revisionMetadata,
          created_at: revision.created_at,
          reindex_required: revisionMetadata.reindex_required === true
        } : null,
        content: {
          mime,
          size,
          hash: revision?.hash ?? metadataString3(sourceMetadata, ["hash", "checksum", "sha256"]),
          text_available: totalChunks > 0,
          chunks_total: totalChunks,
          chunks_returned: chunks.length,
          char_count_returned: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
          extracted_text_ref: revision?.extracted_text_uri ?? metadataString3(revisionMetadata, ["extracted_text_ref", "extracted_text_uri"]),
          bytes_available: false,
          bytes_exposed: false
        },
        chunks,
        citations
      };
    })();
  } finally {
    db.close();
  }
}

// src/source-ingest.ts
function sha256Text(text) {
  return `sha256:${createHash6("sha256").update(text).digest("hex")}`;
}
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+\n/g, `
`).replace(/\n\s+/g, `
`).replace(/[ \t]{2,}/g, " ").trim();
}
async function readS3Text3(uri, config, safetyPolicy) {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!bucket || !key)
    throw new Error(`Invalid S3 source URI: ${uri}`);
  if (safetyPolicy)
    assertS3ReadAllowed(uri, safetyPolicy);
  const [{ S3Client, GetObjectCommand }, { fromIni }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/credential-providers")
  ]);
  const s3Config = config?.storage.type === "s3" && config.storage.s3?.bucket === bucket ? config.storage.s3 : undefined;
  const client = new S3Client({
    region: s3Config?.region,
    credentials: s3Config?.profile ? fromIni({ profile: s3Config.profile }) : undefined,
    maxAttempts: s3Config?.max_attempts
  });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body)
    return "";
  return await response.Body.transformToString();
}
async function readWebText(uri, safetyPolicy) {
  if (safetyPolicy)
    assertWebSearchAllowed(safetyPolicy);
  const response = await fetch(uri, {
    headers: {
      accept: "text/markdown,text/plain,text/html,application/json;q=0.8,*/*;q=0.5",
      "user-agent": "@hasna/knowledge source-ingest"
    }
  });
  if (!response.ok)
    throw new Error(`Web source read failed ${response.status}: ${uri}`);
  const mime = response.headers.get("content-type");
  const body = await response.text();
  return { text: mime?.includes("html") ? stripHtml(body) : body, mime };
}
function titleForRef(parsed) {
  if (parsed.kind === "file")
    return basename3(parsed.path);
  if (parsed.kind === "s3")
    return basename3(parsed.key);
  if (parsed.kind === "web")
    return basename3(new URL(parsed.url).pathname) || parsed.url;
  return parsed.path ? basename3(parsed.path) : parsed.id;
}
async function readDirectSourceText(parsed, config, safetyPolicy) {
  if (parsed.kind === "file") {
    if (!existsSync6(parsed.path))
      throw new Error(`Source file not found: ${parsed.path}`);
    const text = readFileSync6(parsed.path, "utf8");
    return {
      text,
      contentSource: "file",
      title: titleForRef(parsed),
      mime: "text/plain",
      size: text.length,
      hash: sha256Text(text),
      revision: null,
      extractedTextRef: null,
      metadata: { path: parsed.path },
      permissions: { mode: "read_only" }
    };
  }
  if (parsed.kind === "s3") {
    const text = await readS3Text3(parsed.uri, config, safetyPolicy);
    return {
      text,
      contentSource: "s3",
      title: titleForRef(parsed),
      mime: "text/plain",
      size: text.length,
      hash: sha256Text(text),
      revision: null,
      extractedTextRef: null,
      metadata: { bucket: parsed.bucket, key: parsed.key },
      permissions: { mode: "read_only" }
    };
  }
  if (parsed.kind === "web") {
    const web = await readWebText(parsed.url, safetyPolicy);
    return {
      text: web.text,
      contentSource: "web",
      title: titleForRef(parsed),
      mime: web.mime,
      size: web.text.length,
      hash: sha256Text(web.text),
      revision: null,
      extractedTextRef: null,
      metadata: { url: parsed.url },
      permissions: { mode: "read_only" }
    };
  }
  throw new Error(`Direct source reading is not available for ${parsed.uri}`);
}
async function readTextRef(uri, config, safetyPolicy) {
  if (uri.startsWith("open-files://")) {
    throw new Error("Open-files extracted text refs require an open-files resolver API. Ingest an open-files manifest with extracted_text or an extracted_text_ref using file://, s3://, or https://.");
  }
  const parsed = parseSourceRef(uri);
  const direct = await readDirectSourceText(parsed, config, safetyPolicy);
  return { text: direct.text, contentSource: "extracted_text_ref" };
}
async function readOpenFilesSourceText(options) {
  const resolved = await resolveOpenFilesSource({
    dbPath: options.dbPath,
    sourceRef: options.sourceRef,
    purpose: options.purpose ?? "knowledge_index",
    limit: 100,
    safetyPolicy: options.safetyPolicy,
    now: options.now
  });
  if (!resolved.resolved) {
    throw new Error("Open-files source is not in the local knowledge catalog. Ingest an open-files manifest first or use the open-files resolver API.");
  }
  if (resolved.revision?.extracted_text_uri && !resolved.content.text_available) {
    const textRef = await readTextRef(resolved.revision.extracted_text_uri, options.config, options.safetyPolicy);
    return {
      text: textRef.text,
      contentSource: textRef.contentSource,
      title: resolved.source?.title ?? null,
      mime: resolved.content.mime,
      size: textRef.text.length,
      hash: resolved.revision.hash ?? sha256Text(textRef.text),
      revision: resolved.revision.revision,
      extractedTextRef: resolved.revision.extracted_text_uri,
      metadata: resolved.source?.metadata ?? {},
      permissions: resolved.source?.permissions ?? { mode: "read_only" }
    };
  }
  if (resolved.chunks.length === 0) {
    throw new Error("Open-files source has no extracted text chunks yet. Ingest an open-files manifest with extracted_text or extracted_text_ref first.");
  }
  const text = resolved.chunks.map((chunk) => chunk.text).join(`

`);
  return {
    text,
    contentSource: "catalog_chunks",
    title: resolved.source?.title ?? null,
    mime: resolved.content.mime,
    size: text.length,
    hash: resolved.revision?.hash ?? sha256Text(text),
    revision: resolved.revision?.revision ?? null,
    extractedTextRef: resolved.revision?.extracted_text_uri ?? null,
    metadata: resolved.source?.metadata ?? {},
    permissions: resolved.source?.permissions ?? { mode: "read_only" }
  };
}
function manifestItemForSource(sourceRef, parsed, resolved, purpose) {
  const hash = resolved.hash ?? sha256Text(resolved.text);
  const metadata = {
    ...resolved.metadata,
    source_ref: sourceRef,
    content_source: resolved.contentSource,
    read_only: true
  };
  const item = {
    source_ref: sourceRef,
    name: resolved.title ?? titleForRef(parsed),
    mime: resolved.mime ?? "text/plain",
    size: resolved.size ?? resolved.text.length,
    hash,
    revision: resolved.revision ?? hash,
    status: "active",
    updated_at: new Date().toISOString(),
    permissions: {
      mode: "read_only",
      allowed_purposes: [purpose],
      ...resolved.permissions
    },
    metadata,
    extracted_text_ref: resolved.extractedTextRef,
    extracted_text: resolved.text
  };
  if (parsed.kind === "open-files") {
    if (parsed.entity === "file")
      item.file_id = parsed.id;
    if (parsed.entity === "source") {
      item.source_id = parsed.id;
      item.path = parsed.path;
    }
  }
  if (parsed.kind === "file")
    item.path = parsed.path;
  if (parsed.kind === "s3")
    item.path = parsed.key;
  if (parsed.kind === "web")
    item.url = parsed.url;
  return item;
}
async function ingestSourceRef(options) {
  const purpose = options.purpose ?? "knowledge_index";
  const parsed = parseSourceRef(options.sourceRef);
  const resolved = parsed.kind === "open-files" ? await readOpenFilesSourceText(options) : await readDirectSourceText(parsed, options.config, options.safetyPolicy);
  const item = manifestItemForSource(options.sourceRef, parsed, resolved, purpose);
  const result = await ingestOpenFilesManifestItems({
    dbPath: options.dbPath,
    items: [item],
    sourceLabel: options.sourceRef,
    readAction: "source_ref_ingest_read",
    safetyPolicy: options.safetyPolicy,
    now: options.now
  });
  return {
    ...result,
    source_ref: options.sourceRef,
    content_source: resolved.contentSource,
    read_only: true,
    hash: String(item.hash)
  };
}

// src/reindex.ts
import { createHash as createHash7, randomUUID as randomUUID5 } from "crypto";
function stableId5(prefix, value) {
  return `${prefix}_${createHash7("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function queueCounts(dbPath) {
  const db = openKnowledgeDb(dbPath);
  try {
    const rows = db.query(`SELECT status, COUNT(*) AS n FROM reindex_queue GROUP BY status ORDER BY status`).all();
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  } finally {
    db.close();
  }
}
function missingEmbeddingRows(dbPath, options) {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  const db = openKnowledgeDb(dbPath);
  try {
    return db.query(`SELECT c.id AS chunk_id, c.source_revision_id, s.uri AS source_uri
       FROM chunks c
       LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
       LEFT JOIN sources s ON s.id = sr.source_id
       LEFT JOIN vector_index_entries v ON v.chunk_id = c.id AND v.provider = ? AND v.model = ?
       WHERE v.id IS NULL
       ORDER BY c.created_at ASC, c.ordinal ASC`).all(parsed.provider, parsed.model);
  } finally {
    db.close();
  }
}
function reindexHealth(options) {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const version = db.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version ?? 0;
    const chunks = db.query("SELECT COUNT(*) AS n FROM chunks").get()?.n ?? 0;
    const vectorEntries = db.query("SELECT COUNT(*) AS n FROM vector_index_entries").get()?.n ?? 0;
    const missing = missingEmbeddingRows(options.dbPath, options).length;
    const stale = db.query(`SELECT COUNT(*) AS n FROM source_revisions
       WHERE metadata_json LIKE '%"reindex_required":true%' OR metadata_json LIKE '%"status":"stale"%'`).get()?.n ?? 0;
    return {
      schema_version: version,
      chunks,
      vector_entries: vectorEntries,
      missing_embeddings: missing,
      queued: queueCounts(options.dbPath),
      stale_revisions: stale
    };
  } finally {
    db.close();
  }
}
function enqueueMissingEmbeddings(options) {
  migrateKnowledgeDb(options.dbPath);
  const now = (options.now ?? new Date).toISOString();
  const reason = options.reason ?? "missing_embedding";
  const rows = missingEmbeddingRows(options.dbPath, options);
  const db = openKnowledgeDb(options.dbPath);
  let enqueued = 0;
  let alreadyQueued = 0;
  try {
    const write = db.transaction(() => {
      for (const row of rows) {
        const id = stableId5("rq", `embedding\x00${row.chunk_id}\x00${reason}`);
        const before = db.query("SELECT id FROM reindex_queue WHERE kind = ? AND target_id = ? AND reason = ?").get("embedding", row.chunk_id, reason);
        if (before) {
          alreadyQueued += 1;
          continue;
        }
        db.run(`INSERT INTO reindex_queue (id, kind, target_id, source_uri, reason, status, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id,
          "embedding",
          row.chunk_id,
          row.source_uri,
          reason,
          "pending",
          JSON.stringify({ source_revision_id: row.source_revision_id }),
          now,
          now
        ]);
        enqueued += 1;
      }
    });
    write();
  } finally {
    db.close();
  }
  return { enqueued, already_queued: alreadyQueued, reason };
}
function clearEmbeddingIndex(dbPath) {
  const db = openKnowledgeDb(dbPath);
  try {
    const embeddings = db.query("SELECT COUNT(*) AS n FROM chunk_embeddings").get()?.n ?? 0;
    const vectorEntries = db.query("SELECT COUNT(*) AS n FROM vector_index_entries").get()?.n ?? 0;
    db.run("DELETE FROM vector_index_entries");
    db.run("DELETE FROM chunk_embeddings");
    return { embeddings, vectorEntries };
  } finally {
    db.close();
  }
}
function completeIndexedQueueItems(dbPath, options, now) {
  const modelRef = resolveEmbeddingModelRef(options.modelRef, options.config);
  const parsed = parseModelRef(modelRef);
  const db = openKnowledgeDb(dbPath);
  try {
    const result = db.run(`UPDATE reindex_queue
       SET status = ?, updated_at = ?
       WHERE kind = ?
         AND status = ?
         AND EXISTS (
           SELECT 1 FROM vector_index_entries v
           WHERE v.chunk_id = reindex_queue.target_id
             AND v.provider = ?
             AND v.model = ?
         )`, ["completed", now, "embedding", "pending", parsed.provider, parsed.model]);
    return result.changes;
  } finally {
    db.close();
  }
}
async function refreshEmbeddingIndex(options) {
  migrateKnowledgeDb(options.dbPath);
  const now = (options.now ?? new Date).toISOString();
  const runId = `run_${randomUUID5()}`;
  const deleted = options.full ? clearEmbeddingIndex(options.dbPath) : { embeddings: 0, vectorEntries: 0 };
  const queued = enqueueMissingEmbeddings({ ...options, reason: options.full ? "full_embedding_rebuild" : "missing_embedding" });
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      runId,
      "embedding-refresh",
      options.full ? "full" : "incremental",
      "running",
      "local",
      resolveEmbeddingModelRef(options.modelRef, options.config),
      JSON.stringify({ full: options.full === true, queued }),
      now,
      now
    ]);
  } finally {
    db.close();
  }
  const indexed = await indexKnowledgeEmbeddings({
    dbPath: options.dbPath,
    config: options.config,
    env: options.env,
    modelRef: options.modelRef,
    dimensions: options.dimensions,
    fake: options.fake,
    limit: options.limit,
    now: options.now
  });
  const completedQueueItems = completeIndexedQueueItems(options.dbPath, options, now);
  const doneDb = openKnowledgeDb(options.dbPath);
  try {
    doneDb.run(`UPDATE runs SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?`, [
      "completed",
      JSON.stringify({ full: options.full === true, queued, indexed, completed_queue_items: completedQueueItems }),
      now,
      runId
    ]);
    doneDb.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
      `evt_${randomUUID5()}`,
      runId,
      "info",
      "embedding_refresh_completed",
      JSON.stringify({ queued, indexed, completed_queue_items: completedQueueItems }),
      now
    ]);
  } finally {
    doneDb.close();
  }
  return {
    run_id: runId,
    full: options.full === true,
    deleted_embeddings: deleted.embeddings,
    deleted_vector_entries: deleted.vectorEntries,
    queued,
    indexed,
    completed_queue_items: completedQueueItems
  };
}

// src/remote-client.ts
var REMOTE_KNOWLEDGE_CONTRACT_VERSION = 1;
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function stringValue(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
function numberValue(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function arrayValue(record, key) {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}
function normalizeRemoteKnowledgeRunContract(payload, fallback) {
  const record = isRecord(payload) ? payload : {};
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    id: stringValue(record, "id") ?? fallback?.id,
    type: stringValue(record, "type") ?? fallback?.type,
    status: stringValue(record, "status") ?? fallback?.status,
    query: stringValue(record, "query") ?? fallback?.query,
    prompt: stringValue(record, "prompt") ?? fallback?.prompt,
    output_preview: Object.prototype.hasOwnProperty.call(record, "output_preview") ? record.output_preview : fallback?.output_preview,
    citations: arrayValue(record, "citations") ?? fallback?.citations,
    artifacts: arrayValue(record, "artifacts") ?? fallback?.artifacts,
    usage: isRecord(record.usage) ? record.usage : fallback?.usage,
    created_at: stringValue(record, "created_at") ?? fallback?.created_at,
    started_at: stringValue(record, "started_at") ?? fallback?.started_at,
    completed_at: stringValue(record, "completed_at") ?? fallback?.completed_at,
    duration_ms: numberValue(record, "duration_ms") ?? fallback?.duration_ms,
    error_code: stringValue(record, "error_code") ?? fallback?.error_code,
    error_message: stringValue(record, "error_message") ?? fallback?.error_message,
    error: stringValue(record, "error") ?? fallback?.error,
    details: Object.prototype.hasOwnProperty.call(record, "details") ? record.details : fallback?.details
  };
}
function knowledgeRegistryContract(input) {
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    service: "open-knowledge",
    mode: input.mode,
    capabilities: [
      "registry",
      "search",
      "ask",
      "build",
      "sync",
      "status",
      "logs",
      "artifacts",
      "open-files-source-refs",
      "s3-generated-artifacts"
    ],
    endpoints: {
      registry: "/api/v1/knowledge/registry",
      search: "/api/v1/knowledge/search",
      ask: "/api/v1/knowledge/ask",
      build: "/api/v1/knowledge/build",
      sync: "/api/v1/knowledge/sync",
      run_status: "/api/v1/knowledge/runs/{run_id}",
      run_logs: "/api/v1/knowledge/runs/{run_id}/logs",
      run_artifacts: "/api/v1/knowledge/runs/{run_id}/artifacts"
    },
    source_contract: {
      owner: "open-files",
      preferred_ref: "open-files",
      allowed_schemes: input.sourceSchemes,
      raw_source_bytes_stored_in_open_knowledge: false
    },
    artifact_contract: {
      storage_type: input.storageType,
      uri_prefix: input.artifactUriPrefix,
      generated_only: true
    }
  };
}

class RemoteKnowledgeClient {
  apiKey;
  apiUrl;
  constructor(apiKey, apiUrl) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }
  static fromConfig(config, env = process.env) {
    const key = getKnowledgeApiKey(env);
    if (!key.apiKey)
      return null;
    return new RemoteKnowledgeClient(key.apiKey, resolveKnowledgeApiUrl(config, env));
  }
  async request(path, options = {}) {
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  async registry() {
    const response = await this.request("/api/v1/knowledge/registry");
    return response.json();
  }
  async search(request) {
    const response = await this.request("/api/v1/knowledge/search", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "search", query: request.query });
  }
  async ask(request) {
    const response = await this.request("/api/v1/knowledge/ask", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "ask", prompt: request.prompt });
  }
  async build(request) {
    const response = await this.request("/api/v1/knowledge/build", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "build", prompt: request.prompt });
  }
  async sync(request = {}) {
    const response = await this.request("/api/v1/knowledge/sync", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "sync" });
  }
  async runStatus(runId) {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}`);
    if (!response.ok)
      return null;
    return normalizeRemoteKnowledgeRunContract(await response.json(), { id: runId, type: "status" });
  }
  async runLogs(runId) {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}/logs`);
    if (!response.ok)
      return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }
  async runArtifacts(runId) {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}/artifacts`);
    if (!response.ok)
      return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }
}

// src/web-search.ts
import { createHash as createHash8, randomUUID as randomUUID6 } from "crypto";
function stableHash(value) {
  return `sha256:${createHash8("sha256").update(value).digest("hex")}`;
}
function estimateTokens2(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}
function asRecord2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asString4(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function sourceFromRecord(value) {
  const record = asRecord2(value);
  const url = asString4(record.url) ?? asString4(record.uri) ?? asString4(record.sourceUrl);
  if (!url)
    return null;
  return {
    url,
    title: asString4(record.title) ?? asString4(record.name),
    snippet: asString4(record.snippet) ?? asString4(record.text) ?? asString4(record.description),
    provider_metadata: record
  };
}
function collectSources(value, output) {
  if (Array.isArray(value)) {
    for (const entry of value)
      collectSources(entry, output);
    return;
  }
  const source = sourceFromRecord(value);
  if (source)
    output.set(source.url, source);
  const record = asRecord2(value);
  for (const key of ["sources", "results", "citations", "annotations", "output"]) {
    if (record[key])
      collectSources(record[key], output);
  }
}
function fakeSources(query, limit) {
  return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({
    url: `https://example.com/knowledge-web-${index + 1}`,
    title: `Fake web source ${index + 1}`,
    snippet: `Deterministic web-search fixture for "${query}"`,
    provider_metadata: { fake: true, rank: index + 1 }
  }));
}
async function openAiWebSearch(input) {
  const { generateText } = await import("ai");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const settings = providerSettings(input.config, "openai");
  const openai = createOpenAI({
    apiKey: input.env[settings.api_key_env],
    baseURL: settings.base_url
  });
  const webSearch = openai.tools?.webSearch;
  if (!webSearch)
    throw new Error("OpenAI provider does not expose tools.webSearch.");
  return generateText({
    model: openai(input.model),
    prompt: input.query,
    tools: {
      web_search: webSearch({
        externalWebAccess: true,
        searchContextSize: "medium",
        ...input.domains.length > 0 ? { allowedDomains: input.domains } : {}
      })
    },
    toolChoice: { type: "tool", toolName: "web_search" }
  });
}
async function anthropicWebSearch(input) {
  const { generateText } = await import("ai");
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const settings = providerSettings(input.config, "anthropic");
  const anthropic = createAnthropic({
    apiKey: input.env[settings.api_key_env],
    baseURL: settings.base_url
  });
  const factory = anthropic.tools?.webSearch_20250305 ?? anthropic.tools?.webSearch;
  if (!factory)
    throw new Error("Anthropic provider does not expose a web search tool.");
  return generateText({
    model: anthropic(input.model),
    prompt: input.query,
    tools: {
      web_search: factory({
        maxUses: input.maxUses,
        ...input.domains.length > 0 ? { allowedDomains: input.domains } : {}
      })
    }
  });
}
async function fileWebSources(options, sources, now) {
  if (!options.fileResults || sources.length === 0)
    return 0;
  const items = sources.map((source) => {
    const text = [source.title, source.snippet, source.url].filter(Boolean).join(`
`);
    const hash = stableHash(text);
    return {
      source_ref: source.url,
      name: source.title ?? source.url,
      url: source.url,
      mime: "text/plain",
      hash,
      revision: hash,
      status: "active",
      updated_at: now,
      permissions: { mode: "read_only", allowed_purposes: ["knowledge_answer", "knowledge_index"] },
      metadata: {
        source_ref: source.url,
        content_source: "provider_web_search",
        provider_metadata: source.provider_metadata
      },
      extracted_text: text
    };
  });
  const result = await ingestOpenFilesManifestItems({
    dbPath: options.dbPath,
    items,
    sourceLabel: `web-search:${options.query}`,
    readAction: "provider_web_search_file_results",
    safetyPolicy: options.safetyPolicy,
    now: new Date(now)
  });
  return result.sources_upserted;
}
async function runProviderWebSearch(options) {
  const query = options.query.trim();
  if (!query)
    throw new Error("Web search query is required.");
  const env = options.env ?? process.env;
  const now = (options.now ?? new Date).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
  const maxUses = Math.max(1, Math.min(options.maxUses ?? 3, 10));
  const domains = options.domains ?? [];
  const modelRef = resolveModelRef(options.modelRef ?? (options.provider ? `${options.provider}:${providerSettings(options.config, options.provider).default_model}` : "default"), options.config);
  const parsed = parseModelRef(modelRef);
  const provider = options.provider ?? parsed.provider;
  const model = parsed.provider === provider ? parsed.model : providerSettings(options.config, provider).default_model;
  const runId = `run_${randomUUID6()}`;
  if (!options.fake && options.safetyPolicy)
    assertWebSearchAllowed(options.safetyPolicy);
  if (!options.fake && provider !== "openai" && provider !== "anthropic") {
    throw new Error(`Provider ${provider} does not expose native web search yet.`);
  }
  if (!options.fake)
    assertProviderCredentials(provider, options.config, env);
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      runId,
      "provider-web-search",
      query,
      "running",
      provider,
      model,
      JSON.stringify({ domains, max_uses: maxUses, fake: options.fake === true }),
      now,
      now
    ]);
    recordAuditEvent(db, {
      event_type: "source_read",
      action: options.fake ? "fake_provider_web_search" : "provider_web_search",
      target_uri: query,
      decision: "allow",
      metadata: { provider, model, domains, max_uses: maxUses },
      created_at: now
    });
  } finally {
    db.close();
  }
  let answer = "";
  let sources = [];
  let usage = { input_tokens: estimateTokens2(query), output_tokens: 0, cost_usd: 0 };
  const warnings = [];
  if (options.fake) {
    sources = fakeSources(query, limit);
    answer = `Fake web search answer for: ${query}`;
    usage.output_tokens = estimateTokens2(answer);
  } else {
    const result = provider === "openai" ? await openAiWebSearch({ query, model, config: options.config, env, maxUses, domains }) : await anthropicWebSearch({ query, model, config: options.config, env, maxUses, domains });
    answer = result.text;
    const collected = new Map;
    collectSources(result.sources, collected);
    collectSources(result.toolResults, collected);
    sources = Array.from(collected.values()).slice(0, limit);
    const normalized = normalizeAiSdkUsage({
      provider,
      model,
      usage: result.usage,
      providerMetadata: result.providerMetadata
    });
    usage = {
      input_tokens: normalized.input_tokens,
      output_tokens: normalized.output_tokens,
      cost_usd: normalized.cost_usd
    };
  }
  const filedSources = await fileWebSources(options, sources, now);
  const writeDb = openKnowledgeDb(options.dbPath);
  try {
    writeDb.run(`UPDATE runs SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?`, [
      "completed",
      JSON.stringify({ domains, max_uses: maxUses, sources: sources.length, filed_sources: filedSources, fake: options.fake === true }),
      now,
      runId
    ]);
    writeDb.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
      `evt_${randomUUID6()}`,
      runId,
      "info",
      "provider_web_search_completed",
      JSON.stringify({ sources: sources.length, filed_sources: filedSources }),
      now
    ]);
    recordProviderUsage(writeDb, {
      run_id: runId,
      provider,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: usage.cost_usd,
      metadata: { web_search: true, sources: sources.length, filed_sources: filedSources },
      created_at: now
    });
  } finally {
    writeDb.close();
  }
  if (sources.length === 0)
    warnings.push("no_web_sources_returned");
  return {
    run_id: runId,
    query,
    provider,
    model,
    answer,
    sources,
    filed_sources: filedSources,
    usage,
    warnings
  };
}

// src/sync.ts
import { createHash as createHash10, randomUUID as randomUUID8 } from "crypto";
import { existsSync as existsSync7, readFileSync as readFileSync7 } from "fs";
import { fileURLToPath } from "url";
import { relative as relative3, resolve as resolve3, sep as sep3 } from "path";

// src/storage-contract.ts
import { createHash as createHash9, randomUUID as randomUUID7 } from "crypto";
var GENERATED_ARTIFACTS = [
  {
    kind: "schema",
    prefix: "schemas/",
    description: "Machine-readable agent schemas and source rules."
  },
  {
    kind: "index",
    prefix: "indexes/",
    description: "Small orientation indexes and future shard manifests."
  },
  {
    kind: "log",
    prefix: "logs/",
    description: "Append-only JSONL run and wiki-maintenance log partitions."
  },
  {
    kind: "run",
    prefix: "runs/",
    description: "Prompt/tool/cost ledgers and generated output records."
  },
  {
    kind: "wiki_page",
    prefix: "wiki/",
    description: "Generated cited Markdown pages, not raw source files."
  },
  {
    kind: "export",
    prefix: "exports/",
    description: "Portable exports and snapshots of derived knowledge state."
  }
];
function hashArtifactBody(body) {
  const bytes = typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
  return {
    hash: `sha256:${createHash9("sha256").update(bytes).digest("hex")}`,
    size_bytes: bytes.byteLength
  };
}
function artifactKindForKey(key) {
  const match = GENERATED_ARTIFACTS.find((entry) => key.startsWith(entry.prefix));
  return match?.kind ?? "artifact";
}
function resolveStorageContract(config, workspace, scope = "global") {
  const validation = validateStorageConfig(config, workspace);
  const s3 = config.storage.s3 ?? null;
  const prefix = s3?.prefix?.replace(/^\/+|\/+$/g, "") ?? "";
  const s3UriPrefix = s3 ? `s3://${s3.bucket}/${prefix ? `${prefix}/` : ""}` : "";
  const canonicalPrefix = HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.prefix.replace(/^\/+|\/+$/g, "");
  const canonicalS3UriPrefix = `s3://${HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.bucket}/${canonicalPrefix}/`;
  const canonicalActive = config.storage.type === "s3" && s3?.bucket === HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.bucket && (s3.region ?? null) === HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.region;
  return {
    scope,
    mode: config.mode,
    storage_type: config.storage.type,
    workspace_home: workspace.home,
    local_layout: {
      app_path: HASNA_KNOWLEDGE_APP_PATH,
      config_path: workspace.configPath,
      json_store_path: workspace.jsonStorePath,
      knowledge_db_path: workspace.knowledgeDbPath,
      directories: {
        artifacts: workspace.artifactsDir,
        cache: workspace.cacheDir,
        exports: workspace.exportsDir,
        indexes: workspace.indexesDir,
        logs: workspace.logsDir,
        runs: workspace.runsDir,
        schemas: workspace.schemasDir,
        wiki: workspace.wikiDir
      }
    },
    artifact_store: {
      type: config.storage.type,
      artifacts_root: config.storage.artifacts_root,
      uri_prefix: config.storage.type === "s3" ? s3UriPrefix : `file://${workspace.artifactsDir}/`,
      s3: s3 ? {
        bucket: s3.bucket,
        prefix,
        region: s3.region ?? null,
        profile: s3.profile ?? null,
        server_side_encryption: s3.server_side_encryption ?? null,
        kms_key_configured: Boolean(s3.kms_key_id)
      } : null
    },
    canonical_hasna_xyz: {
      division: HASNA_XYZ_KNOWLEDGE_CANONICAL.division,
      app_type: HASNA_XYZ_KNOWLEDGE_CANONICAL.app_type,
      app: HASNA_XYZ_KNOWLEDGE_CANONICAL.app,
      env: HASNA_XYZ_KNOWLEDGE_CANONICAL.env,
      active: canonicalActive,
      local_path: HASNA_XYZ_KNOWLEDGE_CANONICAL.local_path,
      s3: {
        bucket: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.bucket,
        region: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.region,
        profile: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.profile,
        prefix: canonicalPrefix,
        uri_prefix: canonicalS3UriPrefix,
        server_side_encryption: HASNA_XYZ_KNOWLEDGE_CANONICAL.s3.server_side_encryption
      },
      secrets: {
        env: HASNA_XYZ_KNOWLEDGE_CANONICAL.secrets.env,
        aws: HASNA_XYZ_KNOWLEDGE_CANONICAL.secrets.aws,
        s3: HASNA_XYZ_KNOWLEDGE_CANONICAL.secrets.s3,
        rds: HASNA_XYZ_KNOWLEDGE_CANONICAL.secrets.rds,
        future_rds: HASNA_XYZ_KNOWLEDGE_CANONICAL.secrets.future_rds
      },
      evidence_doc: HASNA_XYZ_KNOWLEDGE_CANONICAL.evidence_doc
    },
    hosted: {
      enabled: config.mode === "hosted",
      api_url: normalizeKnowledgeApiOrigin(config.hosted?.api_url ?? DEFAULT_KNOWLEDGE_API_URL),
      api_url_env: "KNOWLEDGE_API_URL",
      api_key_env: "KNOWLEDGE_API_KEY",
      auth_storage: "~/.hasna/knowledge/auth.json",
      remote_contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      requires_hosted_account_for_local_use: false
    },
    source_ownership: {
      owner: "open-files",
      preferred_ref: config.sources.preferred_ref,
      allowed_schemes: config.sources.allowed_schemes,
      raw_source_bytes_stored_in_open_knowledge: false,
      stores: [
        "source refs",
        "source revisions and hashes",
        "citation spans",
        "redacted extracted chunks",
        "embeddings",
        "generated wiki artifacts",
        "indexes",
        "run ledgers"
      ],
      does_not_store: [
        "raw open-files bytes",
        "S3 object credentials",
        "connector secrets",
        "hosted tenant ownership state"
      ]
    },
    generated_artifacts: GENERATED_ARTIFACTS,
    scalability: {
      catalog: "knowledge.db tracks sources, revisions, chunks, citations, indexes, runs, and storage_objects.",
      indexes: "Indexes are cataloged DB rows plus sharded artifacts, not one giant index.md.",
      logs: "Logs use dated JSONL partitions under logs/yyyy/mm/dd.jsonl.",
      markdown: "Markdown pages are the readable wiki layer over DB/object-store state."
    },
    warnings: validation.warnings
  };
}
function validateStorageConfig(config, workspace) {
  const errors = [];
  const warnings = [];
  if (!workspace.home.endsWith(HASNA_KNOWLEDGE_APP_PATH)) {
    warnings.push(`Workspace home does not end with ${HASNA_KNOWLEDGE_APP_PATH}: ${workspace.home}`);
  }
  if (config.storage.type === "s3") {
    if (!config.storage.s3?.bucket)
      errors.push("storage.s3.bucket is required when storage.type is s3.");
    if (!config.storage.s3?.prefix)
      warnings.push("storage.s3.prefix is empty; generated knowledge artifacts will be written at the bucket root.");
    if (config.mode === "local")
      warnings.push("storage.type is s3 while mode is local; this is valid for BYO S3, but hosted wrappers should set mode to hosted.");
  }
  if (config.storage.type === "local" && config.storage.s3) {
    warnings.push("storage.s3 is configured but ignored while storage.type is local.");
  }
  if (config.sources.preferred_ref !== "open-files") {
    warnings.push("sources.preferred_ref should stay open-files for durable company knowledge.");
  }
  if (!config.sources.allowed_schemes.includes("open-files")) {
    errors.push("sources.allowed_schemes must include open-files.");
  }
  if (config.mode === "hosted" && config.hosted?.api_url) {
    try {
      normalizeKnowledgeApiOrigin(config.hosted.api_url);
    } catch {
      errors.push("hosted.api_url must be an http(s) URL when mode is hosted.");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
function recordStorageObjects(db, objects, now = new Date) {
  const timestamp = now.toISOString();
  const statement = db.prepare(`
    INSERT INTO storage_objects (
      id, artifact_uri, kind, content_type, hash, size_bytes, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_uri) DO UPDATE SET
      kind = excluded.kind,
      content_type = excluded.content_type,
      hash = excluded.hash,
      size_bytes = excluded.size_bytes,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const insert = db.transaction((entries) => {
    for (const entry of entries) {
      statement.run(randomUUID7(), entry.uri, entry.kind, entry.content_type ?? null, entry.hash ?? null, entry.size_bytes ?? null, JSON.stringify({
        key: entry.key,
        ...entry.metadata ?? {}
      }), timestamp, timestamp);
    }
  });
  insert(objects);
}

// src/sync.ts
var KNOWLEDGE_SYNC_TABLES = [
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
  "knowledge_sync_conflicts"
];
var KNOWLEDGE_SYNC_PROTOCOL_VERSION = 1;
var KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION = 1;
var PRIMARY_KEYS2 = {
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
  knowledge_sync_conflicts: ["id"]
};
var TABLE_SYNC_EXCLUDES = new Set([
  "storage_objects",
  "knowledge_sync_changes"
]);
function nowIso(now = new Date) {
  return now.toISOString();
}
function makeSyncId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID8().slice(0, 8)}`;
}
function stableJson(value) {
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return `sha256:${createHash10("sha256").update(value).digest("hex")}`;
}
function count2(db, table) {
  const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}
function parseJson2(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function quoteIdent2(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}
function coerceForSqlite2(value) {
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
function filterExistingTables(db, tables) {
  return tables.filter((table) => tableExists2(db, table));
}
function tableExists2(db, table) {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}
function localColumns(db, table) {
  const rows = db.query(`PRAGMA table_info(${quoteIdent2(table)})`).all();
  return new Set(rows.map((row) => row.name));
}
function filterLocalColumns2(db, table, columns) {
  const allowed = localColumns(db, table);
  return columns.filter((column) => allowed.has(column));
}
function resolveSyncTables(tables) {
  if (!tables || tables.length === 0)
    return [...KNOWLEDGE_SYNC_TABLES];
  const allowed = new Set(KNOWLEDGE_SYNC_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0)
    throw new Error(`Unknown knowledge sync table(s): ${invalid.join(", ")}`);
  return requested;
}
function rowKey(table, row) {
  const primaryKeys = PRIMARY_KEYS2[table];
  return primaryKeys.map((key) => `${key}=${JSON.stringify(row[key] ?? null)}`).join("&");
}
function hashValue(value) {
  return sha256(stableJson(value));
}
function normalizeRowForHash(row, artifactUriToKey) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "artifact_uri" && typeof value === "string" && artifactUriToKey.has(value)) {
      normalized[key] = `artifact:${artifactUriToKey.get(value)}`;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}
function rowHash(row, artifactUriToKey = new Map) {
  return hashValue(normalizeRowForHash(row, artifactUriToKey));
}
function tableRows(db, table) {
  if (!tableExists2(db, table))
    return [];
  return db.query(`SELECT * FROM ${quoteIdent2(table)} ORDER BY rowid ASC`).all();
}
function upsertSqliteRows(db, table, rows) {
  if (rows.length === 0)
    return 0;
  const columns = filterLocalColumns2(db, table, Object.keys(rows[0]));
  if (columns.length === 0)
    return 0;
  const primaryKeys = PRIMARY_KEYS2[table];
  const columnList = columns.map(quoteIdent2).join(", ");
  const placeholders2 = columns.map(() => "?").join(", ");
  const keyList = primaryKeys.map(quoteIdent2).join(", ");
  const updateColumns = columns.filter((column) => !primaryKeys.includes(column));
  const fallbackKey = primaryKeys[0];
  const setClause = updateColumns.length > 0 ? updateColumns.map((column) => `${quoteIdent2(column)} = excluded.${quoteIdent2(column)}`).join(", ") : `${quoteIdent2(fallbackKey)} = excluded.${quoteIdent2(fallbackKey)}`;
  const statement = db.query(`INSERT INTO ${quoteIdent2(table)} (${columnList}) VALUES (${placeholders2})
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}`);
  const insert = db.transaction((batch) => {
    for (const row of batch)
      statement.run(...columns.map((column) => coerceForSqlite2(row[column])));
  });
  insert(rows);
  return rows.length;
}
function assertInside2(root, target) {
  const rel = relative3(root, target);
  return rel !== ".." && !rel.startsWith("..") && !rel.startsWith(`..${sep3}`);
}
function keyForArtifactRow(row, artifactsDir) {
  const metadata = parseJson2(row.metadata_json, {});
  if (typeof metadata.key === "string")
    return metadata.key;
  if (!row.artifact_uri.startsWith("file://"))
    return null;
  try {
    const path = fileURLToPath(row.artifact_uri);
    const root = resolve3(artifactsDir);
    const target = resolve3(path);
    if (!assertInside2(root, target))
      return null;
    const rel = relative3(root, target).replace(/\\/g, "/");
    return rel ? normalizeArtifactKey(rel) : null;
  } catch {
    return null;
  }
}
function artifactUriToKey(artifacts) {
  const map = new Map;
  for (const artifact of artifacts) {
    if (artifact.key)
      map.set(artifact.artifact_uri, artifact.key);
  }
  return map;
}
function artifactFingerprint(artifact) {
  return hashValue({
    key: artifact.key,
    kind: artifact.kind,
    hash: artifact.hash,
    size_bytes: artifact.size_bytes
  });
}
function artifactIdentity(artifact) {
  return artifact.key ?? artifact.artifact_uri;
}
function tableCounts(db) {
  return Object.fromEntries(KNOWLEDGE_SYNC_TABLES.map((table) => [table, tableExists2(db, table) ? count2(db, table) : 0]));
}
function artifactHashes(db) {
  return db.query(`SELECT artifact_uri, kind, hash, size_bytes
     FROM storage_objects
     ORDER BY artifact_uri ASC`).all();
}
function machineFromTopologyEntry(entry, now) {
  return {
    machine_id: entry.machine_id,
    hostname: entry.hostname,
    platform: entry.platform,
    user_label: entry.user,
    workspace_home: entry.workspace_path,
    tailscale_dns: entry.tailscale.dns_name,
    tailscale_ips_json: JSON.stringify(entry.tailscale.ips),
    ssh_target: entry.ssh.command_target,
    last_seen_at: entry.local || entry.tailscale.online === true || entry.heartbeat_status === "online" ? now : entry.last_heartbeat_at,
    capabilities_json: JSON.stringify({
      route_hints: entry.route_hints,
      heartbeat_status: entry.heartbeat_status,
      manifest_declared: entry.manifest_declared
    }),
    metadata_json: JSON.stringify({
      ...entry.metadata,
      source: entry.source,
      tags: entry.tags,
      tailscale: entry.tailscale,
      ssh: entry.ssh
    }),
    created_at: now,
    updated_at: now
  };
}
function upsertKnowledgeMachine(db, input) {
  db.query(`
    INSERT INTO knowledge_machines (
      machine_id, hostname, platform, user_label, workspace_home, tailscale_dns,
      tailscale_ips_json, ssh_target, last_seen_at, capabilities_json,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET
      hostname = excluded.hostname,
      platform = excluded.platform,
      user_label = excluded.user_label,
      workspace_home = excluded.workspace_home,
      tailscale_dns = excluded.tailscale_dns,
      tailscale_ips_json = excluded.tailscale_ips_json,
      ssh_target = excluded.ssh_target,
      last_seen_at = excluded.last_seen_at,
      capabilities_json = excluded.capabilities_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(input.machine_id, input.hostname, input.platform, input.user_label, input.workspace_home, input.tailscale_dns, input.tailscale_ips_json, input.ssh_target, input.last_seen_at, input.capabilities_json, input.metadata_json, input.created_at, input.updated_at);
}
function refreshMachineRegistryFromTopology(db, topology, now = nowIso()) {
  for (const entry of topology.machines)
    upsertKnowledgeMachine(db, machineFromTopologyEntry(entry, now));
  return topology.machines.length;
}
function listKnowledgeMachines(dbPath) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    return db.query("SELECT * FROM knowledge_machines ORDER BY machine_id ASC").all();
  } finally {
    db.close();
  }
}
function createKnowledgeSyncBundle(options) {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const warnings = [];
  try {
    const requestedTables = filterExistingTables(db, resolveSyncTables(options.tables));
    const tables = requestedTables.filter((table) => !TABLE_SYNC_EXCLUDES.has(table)).map((table) => ({
      table,
      primary_keys: PRIMARY_KEYS2[table],
      rows: tableRows(db, table)
    }));
    const artifactRows = db.query(`SELECT id, artifact_uri, kind, content_type, hash, size_bytes, metadata_json
       FROM storage_objects
       ORDER BY artifact_uri ASC`).all();
    const artifacts = artifactRows.map((row) => {
      const key = keyForArtifactRow(row, options.storage.local_layout.directories.artifacts);
      const artifact = { ...row, key };
      if (options.includeArtifactContent !== false && key && row.artifact_uri.startsWith("file://")) {
        try {
          const path = fileURLToPath(row.artifact_uri);
          if (existsSync7(path))
            artifact.content_base64 = readFileSync7(path).toString("base64");
          else
            warnings.push(`artifact_missing:${row.artifact_uri}`);
        } catch (error) {
          warnings.push(`artifact_read_failed:${row.artifact_uri}:${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (options.includeArtifactContent !== false && row.artifact_uri.startsWith("s3://")) {
        warnings.push(`artifact_content_not_embedded:${row.artifact_uri}`);
      }
      return artifact;
    });
    return {
      ok: true,
      format: "knowledge-sync-bundle",
      version: 1,
      protocol_version: KNOWLEDGE_SYNC_PROTOCOL_VERSION,
      min_protocol_version: KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
      generated_at: nowIso(options.now),
      source: {
        scope: options.scope,
        workspace_home: options.workspaceHome,
        sqlite_schema_version: getSchemaVersion(db),
        machine_id: options.machineId ?? null,
        artifact_root_uri: options.storage.artifact_store.uri_prefix
      },
      tables,
      artifacts,
      warnings,
      message: `${tables.reduce((sum, table) => sum + table.rows.length, 0)} row(s), ${artifacts.length} artifact(s) exported`
    };
  } finally {
    db.close();
  }
}
function validateSyncProtocol(input, label) {
  if (input.protocol_version !== KNOWLEDGE_SYNC_PROTOCOL_VERSION || input.min_protocol_version !== KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION) {
    throw new Error(`Unsupported ${label} protocol. Expected knowledge sync protocol v${KNOWLEDGE_SYNC_PROTOCOL_VERSION} with min v${KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION}.`);
  }
}
function validateBundle(bundle) {
  if (!bundle || bundle.format !== "knowledge-sync-bundle" || bundle.version !== 1) {
    throw new Error("Invalid knowledge sync bundle.");
  }
  validateSyncProtocol(bundle, "knowledge sync bundle");
}
function getBundleTable(bundle, table) {
  return bundle.tables.find((entry) => entry.table === table) ?? null;
}
function tableRowMap(table, rows) {
  return new Map(rows.map((row) => [rowKey(table, row), row]));
}
function bundleArtifactMap(bundle) {
  return new Map(bundle.artifacts.map((artifact) => [artifactIdentity(artifact), artifact]));
}
async function materializeArtifacts(options) {
  const targetArtifacts = bundleArtifactMap(options.targetBundle);
  const uriMap = new Map;
  const conflicts = [];
  const result = {
    source_artifacts: options.bundle.artifacts.length,
    target_artifacts: options.targetBundle.artifacts.length,
    copied: 0,
    skipped: 0,
    conflicts: 0,
    missing_content: 0
  };
  for (const artifact of options.bundle.artifacts) {
    const identity = artifactIdentity(artifact);
    const target = targetArtifacts.get(identity);
    if (target && artifactFingerprint(target) === artifactFingerprint(artifact)) {
      if (target.artifact_uri)
        uriMap.set(artifact.artifact_uri, target.artifact_uri);
      result.skipped += 1;
      continue;
    }
    if (target && artifactFingerprint(target) !== artifactFingerprint(artifact)) {
      result.conflicts += 1;
      conflicts.push({
        entityKind: "storage_object",
        entityId: identity,
        localMachineId: options.localMachineId,
        remoteMachineId: options.bundle.source.machine_id ?? "unknown",
        localHash: artifactFingerprint(target),
        remoteHash: artifactFingerprint(artifact),
        metadata: {
          direction: options.direction,
          target_artifact_uri: target.artifact_uri,
          source_artifact_uri: artifact.artifact_uri
        }
      });
      continue;
    }
    if (!artifact.content_base64 && artifact.artifact_uri.startsWith("file://")) {
      result.missing_content += 1;
      options.warnings.push(`artifact_content_missing:${artifact.artifact_uri}`);
      continue;
    }
    if (options.dryRun) {
      result.copied += 1;
      continue;
    }
    let nextUri = artifact.artifact_uri;
    if (artifact.key && artifact.content_base64) {
      const write = await options.targetStore.put({
        key: artifact.key,
        body: Buffer.from(artifact.content_base64, "base64"),
        content_type: artifact.content_type ?? undefined
      });
      nextUri = write.uri;
      uriMap.set(artifact.artifact_uri, nextUri);
    } else if (!artifact.artifact_uri.startsWith("s3://")) {
      options.warnings.push(`artifact_skipped_unsupported:${artifact.artifact_uri}`);
      continue;
    }
    const metadata = parseJson2(artifact.metadata_json, {});
    const object = {
      uri: nextUri,
      key: artifact.key ?? metadata.key ?? artifact.artifact_uri,
      kind: artifact.kind,
      content_type: artifact.content_type ?? undefined,
      hash: artifact.hash ?? undefined,
      size_bytes: artifact.size_bytes ?? undefined,
      metadata: {
        ...metadata,
        synced_from_artifact_uri: artifact.artifact_uri,
        synced_from_machine_id: options.bundle.source.machine_id ?? undefined
      }
    };
    recordStorageObjects(options.db, [object]);
    result.copied += 1;
  }
  return { result, uriMap, conflicts };
}
function transformImportedRow(row, artifactUriMap) {
  const next = { ...row };
  if (typeof next.artifact_uri === "string" && artifactUriMap.has(next.artifact_uri)) {
    next.artifact_uri = artifactUriMap.get(next.artifact_uri);
  }
  return next;
}
function insertSyncChange(db, input) {
  const now = nowIso();
  db.query(`
    INSERT INTO knowledge_sync_changes (
      id, origin_machine_id, updated_by_machine_id, entity_kind, entity_id,
      operation, base_hash, next_hash, source_ref, source_revision_id,
      artifact_uri, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeSyncId("syncchg"), input.sourceMachineId, input.localMachineId, input.entityKind, input.entityId, input.direction, null, input.nextHash, typeof input.row?.source_ref === "string" ? input.row.source_ref : typeof input.row?.source_uri === "string" ? input.row.source_uri : null, typeof input.row?.source_revision_id === "string" ? input.row.source_revision_id : null, typeof input.row?.artifact_uri === "string" ? input.row.artifact_uri : null, JSON.stringify({ source_machine_id: input.sourceMachineId }), now);
}
function insertConflict(db, input) {
  const now = nowIso();
  db.query(`
    INSERT INTO knowledge_sync_conflicts (
      id, entity_kind, entity_id, local_machine_id, remote_machine_id,
      local_hash, remote_hash, base_hash, status, resolution_strategy,
      proposed_patch_uri, approved_by, resolved_at, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeSyncId("syncconf"), input.entityKind, input.entityId, input.localMachineId, input.remoteMachineId, input.localHash ?? null, input.remoteHash ?? null, input.baseHash ?? null, input.status ?? "open", input.resolutionStrategy ?? null, input.proposedPatchUri ?? null, input.approvedBy ?? null, input.resolvedAt ?? null, JSON.stringify(input.metadata ?? {}), now);
}
async function applyKnowledgeSyncBundle(options) {
  validateBundle(options.bundle);
  migrateKnowledgeDb(options.targetDbPath);
  const db = openKnowledgeDb(options.targetDbPath);
  const warnings = [...options.bundle.warnings];
  const localMachineId2 = options.localMachineId ?? "local";
  try {
    const targetBundle = options.targetBundle ?? createKnowledgeSyncBundle({
      dbPath: options.targetDbPath,
      scope: options.targetScope,
      workspaceHome: options.targetWorkspaceHome,
      storage: options.targetStorage,
      machineId: localMachineId2,
      includeArtifactContent: false
    });
    const artifactResult = await materializeArtifacts({
      db,
      bundle: options.bundle,
      targetBundle,
      targetStorage: options.targetStorage,
      targetStore: options.targetStore,
      dryRun: options.dryRun === true,
      direction: options.direction,
      localMachineId: localMachineId2,
      warnings
    });
    const sourceArtifactUriToKey = artifactUriToKey(options.bundle.artifacts);
    const targetArtifactUriToKey = artifactUriToKey(targetBundle.artifacts);
    const tableResults = [];
    let conflictsCreated = 0;
    for (const sourceTable of options.bundle.tables) {
      if (sourceTable.table === "storage_objects" || TABLE_SYNC_EXCLUDES.has(sourceTable.table))
        continue;
      if (!tableExists2(db, sourceTable.table))
        continue;
      const targetTable = getBundleTable(targetBundle, sourceTable.table);
      const targetRows = tableRowMap(sourceTable.table, targetTable?.rows ?? []);
      const rowsToWrite = [];
      const result = {
        table: sourceTable.table,
        source_rows: sourceTable.rows.length,
        target_rows: targetTable?.rows.length ?? 0,
        inserted: 0,
        skipped: 0,
        conflicts: 0
      };
      for (const sourceRow of sourceTable.rows) {
        const key = rowKey(sourceTable.table, sourceRow);
        const targetRow = targetRows.get(key);
        const incomingHash = rowHash(sourceRow, sourceArtifactUriToKey);
        if (!targetRow) {
          result.inserted += 1;
          rowsToWrite.push(transformImportedRow(sourceRow, artifactResult.uriMap));
          continue;
        }
        const currentHash = rowHash(targetRow, targetArtifactUriToKey);
        if (currentHash === incomingHash) {
          result.skipped += 1;
          continue;
        }
        result.conflicts += 1;
        if (!options.dryRun) {
          insertConflict(db, {
            entityKind: sourceTable.table,
            entityId: key,
            localMachineId: localMachineId2,
            remoteMachineId: options.bundle.source.machine_id ?? "unknown",
            localHash: currentHash,
            remoteHash: incomingHash,
            metadata: {
              direction: options.direction,
              source_workspace_home: options.bundle.source.workspace_home,
              target_workspace_home: options.targetWorkspaceHome
            }
          });
          conflictsCreated += 1;
        }
      }
      if (!options.dryRun && rowsToWrite.length > 0) {
        const writtenRows = rowsToWrite.map((row) => transformImportedRow(row, artifactResult.uriMap));
        upsertSqliteRows(db, sourceTable.table, writtenRows);
        for (const row of writtenRows) {
          insertSyncChange(db, {
            direction: options.direction,
            sourceMachineId: options.bundle.source.machine_id ?? "unknown",
            localMachineId: localMachineId2,
            entityKind: sourceTable.table,
            entityId: rowKey(sourceTable.table, row),
            nextHash: rowHash(row, artifactUriToKey(options.bundle.artifacts)),
            row
          });
        }
      }
      tableResults.push(result);
    }
    for (const conflict of artifactResult.conflicts) {
      if (!options.dryRun) {
        insertConflict(db, conflict);
        conflictsCreated += 1;
      }
    }
    const inserted = tableResults.reduce((sum, table) => sum + table.inserted, 0);
    const conflicts = tableResults.reduce((sum, table) => sum + table.conflicts, 0) + artifactResult.result.conflicts;
    return {
      ok: conflicts === 0,
      protocol_version: KNOWLEDGE_SYNC_PROTOCOL_VERSION,
      min_protocol_version: KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
      dry_run: options.dryRun === true,
      direction: options.direction,
      source: options.bundle.source,
      target: {
        scope: options.targetScope,
        workspace_home: options.targetWorkspaceHome,
        sqlite_schema_version: getSchemaVersion(db),
        artifact_root_uri: options.targetStorage.artifact_store.uri_prefix
      },
      tables: tableResults,
      artifacts: artifactResult.result,
      conflicts_created: conflictsCreated,
      warnings,
      message: `${options.dryRun ? "Would import" : "Imported"} ${inserted} row(s), copied ${artifactResult.result.copied} artifact(s), ${conflicts} conflict(s)`
    };
  } finally {
    db.close();
  }
}
function createKnowledgeSyncSnapshot(options) {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const createdAt = nowIso(options.now);
  try {
    const machinesUpserted = options.topology ? refreshMachineRegistryFromTopology(db, options.topology, createdAt) : 0;
    const tables = tableCounts(db);
    const artifacts = artifactHashes(db);
    const machineId = options.machineId ?? options.topology?.local_machine_id ?? "unknown";
    const artifactRootUri = options.storage.artifact_store.uri_prefix;
    const contentHash = sha256(stableJson({
      machine_id: machineId,
      scope: options.scope,
      workspace_home: options.workspaceHome,
      sqlite_schema_version: getSchemaVersion(db),
      artifact_root_uri: artifactRootUri,
      tables,
      artifacts
    }));
    const row = {
      id: makeSyncId("syncsnap"),
      machine_id: machineId,
      scope: options.scope,
      workspace_home: options.workspaceHome,
      sqlite_schema_version: getSchemaVersion(db),
      artifact_root_uri: artifactRootUri,
      content_hash: contentHash,
      tables_json: JSON.stringify(tables),
      artifact_hashes_json: JSON.stringify(artifacts),
      created_at: createdAt
    };
    db.query(`
      INSERT INTO knowledge_sync_snapshots (
        id, machine_id, scope, workspace_home, sqlite_schema_version,
        artifact_root_uri, content_hash, tables_json, artifact_hashes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.machine_id, row.scope, row.workspace_home, row.sqlite_schema_version, row.artifact_root_uri, row.content_hash, row.tables_json, row.artifact_hashes_json, row.created_at);
    return {
      ok: true,
      snapshot: {
        ...row,
        tables,
        artifact_hashes: artifacts
      },
      machines_upserted: machinesUpserted,
      message: `Recorded sync snapshot ${row.id}`
    };
  } finally {
    db.close();
  }
}
function getKnowledgeSyncStatus(options) {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const machines = db.query("SELECT * FROM knowledge_machines ORDER BY machine_id ASC").all();
    const latest = db.query("SELECT * FROM knowledge_sync_snapshots ORDER BY created_at DESC LIMIT 1").get() ?? null;
    const conflictStatuses = db.query("SELECT status, COUNT(*) AS count FROM knowledge_sync_conflicts GROUP BY status ORDER BY status").all();
    const changeOps = db.query("SELECT operation, COUNT(*) AS count FROM knowledge_sync_changes GROUP BY operation ORDER BY operation").all();
    const totalConflicts = conflictStatuses.reduce((sum, row) => sum + row.count, 0);
    const openConflicts = conflictStatuses.filter((row) => row.status !== "resolved" && row.status !== "ignored").reduce((sum, row) => sum + row.count, 0);
    return {
      ok: true,
      scope: options.scope,
      workspace_home: options.workspaceHome,
      sqlite_schema_version: getSchemaVersion(db),
      local_machine_id: options.localMachineId ?? null,
      machines: {
        total: machines.length,
        rows: machines
      },
      snapshots: {
        total: count2(db, "knowledge_sync_snapshots"),
        latest
      },
      changes: {
        total: count2(db, "knowledge_sync_changes"),
        by_operation: changeOps
      },
      conflicts: {
        total: totalConflicts,
        by_status: conflictStatuses,
        open: openConflicts
      },
      table_counts: tableCounts(db),
      message: `${machines.length} machine(s), ${openConflicts} open sync conflict(s)`
    };
  } finally {
    db.close();
  }
}
function recordKnowledgeSyncConflict(dbPath, input) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const now = nowIso();
  const row = {
    id: makeSyncId("syncconf"),
    entity_kind: input.entityKind,
    entity_id: input.entityId,
    local_machine_id: input.localMachineId,
    remote_machine_id: input.remoteMachineId,
    local_hash: input.localHash ?? null,
    remote_hash: input.remoteHash ?? null,
    base_hash: input.baseHash ?? null,
    status: input.status ?? "open",
    resolution_strategy: input.resolutionStrategy ?? null,
    proposed_patch_uri: input.proposedPatchUri ?? null,
    approved_by: input.approvedBy ?? null,
    resolved_at: input.resolvedAt ?? null,
    metadata_json: JSON.stringify(input.metadata ?? {}),
    created_at: now
  };
  try {
    db.query(`
      INSERT INTO knowledge_sync_conflicts (
        id, entity_kind, entity_id, local_machine_id, remote_machine_id,
        local_hash, remote_hash, base_hash, status, resolution_strategy,
        proposed_patch_uri, approved_by, resolved_at, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.entity_kind, row.entity_id, row.local_machine_id, row.remote_machine_id, row.local_hash, row.remote_hash, row.base_hash, row.status, row.resolution_strategy, row.proposed_patch_uri, row.approved_by, row.resolved_at, row.metadata_json, row.created_at);
    return row;
  } finally {
    db.close();
  }
}
function hydrateConflict(row) {
  return {
    ...row,
    metadata: parseJson2(row.metadata_json, {})
  };
}
function getKnowledgeSyncConflict(dbPath, id) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const row = db.query("SELECT * FROM knowledge_sync_conflicts WHERE id = ?").get(id);
    return row ? hydrateConflict(row) : null;
  } finally {
    db.close();
  }
}
function listKnowledgeSyncConflicts(dbPath, options = {}) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  try {
    const rows = options.status ? db.query("SELECT * FROM knowledge_sync_conflicts WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(options.status, limit) : db.query("SELECT * FROM knowledge_sync_conflicts ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(hydrateConflict);
  } finally {
    db.close();
  }
}
function proposeKnowledgeSyncConflictResolution(dbPath, id) {
  const conflict = getKnowledgeSyncConflict(dbPath, id);
  if (!conflict)
    throw new Error(`Sync conflict not found: ${id}`);
  const proposedStrategy = conflict.entity_kind === "wiki_pages" ? "manual-merge" : "review-and-select";
  const summary = [
    `Conflict ${conflict.id} affects ${conflict.entity_kind}:${conflict.entity_id}.`,
    `Local machine ${conflict.local_machine_id} has ${conflict.local_hash ?? "unknown hash"}.`,
    `Remote machine ${conflict.remote_machine_id} has ${conflict.remote_hash ?? "unknown hash"}.`
  ].join(" ");
  const mergePrompt = [
    "Review this knowledge sync conflict before any durable write.",
    `Entity: ${conflict.entity_kind}:${conflict.entity_id}`,
    `Local machine/hash: ${conflict.local_machine_id} / ${conflict.local_hash ?? "unknown"}`,
    `Remote machine/hash: ${conflict.remote_machine_id} / ${conflict.remote_hash ?? "unknown"}`,
    `Base hash: ${conflict.base_hash ?? "unknown"}`,
    `Metadata: ${JSON.stringify(conflict.metadata)}`,
    "Return a concise merge recommendation with citations to the competing records. Do not write changes without approval."
  ].join(`
`);
  return {
    ok: true,
    conflict,
    requires_approval: true,
    proposed_strategy: proposedStrategy,
    summary,
    merge_prompt: mergePrompt,
    warnings: conflict.status === "resolved" ? ["conflict_already_resolved"] : [],
    message: `Prepared approval-gated merge proposal for ${conflict.id}`
  };
}
function resolveKnowledgeSyncConflict(dbPath, input) {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const now = nowIso();
  try {
    const existing = db.query("SELECT * FROM knowledge_sync_conflicts WHERE id = ?").get(input.id);
    if (!existing)
      throw new Error(`Sync conflict not found: ${input.id}`);
    db.query(`
      UPDATE knowledge_sync_conflicts
      SET status = 'resolved',
          resolution_strategy = ?,
          proposed_patch_uri = ?,
          approved_by = ?,
          resolved_at = ?
      WHERE id = ?
    `).run(input.strategy, input.proposedPatchUri ?? existing.proposed_patch_uri, input.approvedBy, now, input.id);
    const row = db.query("SELECT * FROM knowledge_sync_conflicts WHERE id = ?").get(input.id);
    if (!row)
      throw new Error(`Sync conflict not found after resolve: ${input.id}`);
    return hydrateConflict(row);
  } finally {
    db.close();
  }
}
function syncTablesFromSnapshot(snapshot) {
  return parseJson2(snapshot.tables_json, {});
}
function syncArtifactsFromSnapshot(snapshot) {
  return parseJson2(snapshot.artifact_hashes_json, []);
}

// src/wiki-compiler.ts
import { createHash as createHash11, randomUUID as randomUUID9 } from "crypto";
function stableId6(prefix, value) {
  return `${prefix}_${createHash11("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function slugify(value) {
  const slug = value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug || "knowledge-page";
}
function todayParts(now) {
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
    day: String(now.getUTCDate()).padStart(2, "0")
  };
}
function estimateTokenCount2(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}
function parseJsonObject4(value) {
  if (!value)
    return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function queryTerms3(query) {
  return Array.from(new Set((query ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])).slice(0, 12);
}
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
function selectSourceChunks(db, options) {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const sourceRefs = options.sourceRefs ?? [];
  const terms = queryTerms3(options.query);
  const where = ["c.kind = 'source'"];
  const params = [];
  if (sourceRefs.length > 0) {
    where.push(`(${sourceRefs.map(() => "(s.uri = ? OR c.metadata_json LIKE ?)").join(" OR ")})`);
    for (const ref of sourceRefs) {
      params.push(ref, `%${escapeLike(ref)}%`);
    }
  }
  if (terms.length > 0) {
    where.push(`(${terms.map(() => "lower(c.text) LIKE ? ESCAPE '\\'").join(" OR ")})`);
    for (const term of terms)
      params.push(`%${escapeLike(term)}%`);
  }
  params.push(limit);
  return db.query(`SELECT
       c.id AS chunk_id,
       c.text,
       c.start_offset,
       c.end_offset,
       c.metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.title AS source_title
     FROM chunks c
     JOIN source_revisions sr ON sr.id = c.source_revision_id
     JOIN sources s ON s.id = sr.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.created_at ASC, c.ordinal ASC
     LIMIT ?`).all(...params);
}
function excerpt(text, max = 420) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}...`;
}
function titleFor(options, rows) {
  if (options.title?.trim())
    return options.title.trim();
  if (options.query?.trim())
    return options.query.trim();
  return rows[0]?.source_title ?? "Compiled Knowledge";
}
function compileBody(title, rows, now) {
  const sourceLines = rows.map((row, index) => {
    const label = `S${index + 1}`;
    return `- [${label}] ${row.source_title ?? row.source_uri ?? "Source"} (${row.source_uri ?? "unknown"}, revision ${row.revision ?? "unknown"}, hash ${row.hash ?? "unknown"})`;
  });
  const noteLines = rows.map((row, index) => {
    const label = `S${index + 1}`;
    return [
      `## ${row.source_title ?? `Source ${index + 1}`}`,
      "",
      excerpt(row.text),
      "",
      `Citation: [${label}]`
    ].join(`
`);
  });
  return [
    `# ${title}`,
    "",
    `Generated at: ${now}`,
    "",
    "## Sources",
    "",
    ...sourceLines,
    "",
    ...noteLines,
    ""
  ].join(`
`);
}
async function writeArtifact(store, entry) {
  const written = await store.put(entry);
  return {
    key: written.key,
    uri: written.uri,
    kind: entry.key.startsWith("logs/") ? "log" : "wiki_page",
    content_type: entry.content_type,
    ...hashArtifactBody(entry.body),
    metadata: {
      ...entry.metadata ?? {}
    }
  };
}
async function appendLog(store, event, now) {
  const { year, month, day } = todayParts(now);
  const key = `logs/${year}/${month}/${day}.jsonl`;
  let existing = "";
  try {
    existing = await store.getText(key);
  } catch {
    existing = "";
  }
  return writeArtifact(store, {
    key,
    body: `${existing}${JSON.stringify(event)}
`,
    content_type: "application/x-ndjson"
  });
}
function upsertWikiPage(db, input) {
  db.run(`INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       title = excluded.title,
       artifact_uri = excluded.artifact_uri,
       content_hash = excluded.content_hash,
       status = excluded.status,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`, [
    input.pageId,
    input.path,
    input.title,
    input.artifactUri,
    input.contentHash,
    "active",
    JSON.stringify({
      artifact_key: input.path,
      provenance: input.provenance
    }),
    input.now,
    input.now
  ]);
  const existing = db.query("SELECT id FROM chunks WHERE wiki_page_id = ?").all(input.pageId);
  for (const row of existing)
    db.run("DELETE FROM chunks_fts WHERE chunk_id = ?", [row.id]);
  db.run("DELETE FROM chunks WHERE wiki_page_id = ?", [input.pageId]);
  const chunkId = stableId6("chk", `${input.pageId}\x00${input.contentHash}`);
  db.run(`INSERT INTO chunks (id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    chunkId,
    input.pageId,
    "wiki",
    0,
    input.body,
    estimateTokenCount2(input.body),
    0,
    input.body.length,
    JSON.stringify({
      artifact_key: input.path,
      artifact_uri: input.artifactUri,
      content_hash: input.contentHash,
      provenance: input.provenance
    }),
    input.now
  ]);
  db.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)", [
    chunkId,
    input.body,
    input.title,
    input.artifactUri
  ]);
}
function replacePageCitations(db, pageId, citations, now) {
  db.run("DELETE FROM citations WHERE wiki_page_id = ?", [pageId]);
  for (const citation of citations) {
    db.run(`INSERT INTO citations (id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      stableId6("cit", `${pageId}\x00${citation.source_uri}\x00${citation.chunk_id ?? randomUUID9()}`),
      pageId,
      citation.chunk_id,
      citation.source_uri,
      citation.quote,
      citation.start_offset,
      citation.end_offset,
      JSON.stringify(citation.metadata),
      now
    ]);
  }
  return citations.length;
}
function upsertIndex(db, input) {
  db.run(`INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, name, shard_key) DO UPDATE SET
       artifact_uri = excluded.artifact_uri,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`, [
    stableId6("idx", `wiki-topic\x00${input.path}`),
    "wiki_topic",
    input.title,
    input.artifactUri,
    input.path,
    JSON.stringify({
      artifact_key: input.path,
      content_hash: input.contentHash
    }),
    input.now,
    input.now
  ]);
  return 1;
}
function firstConcept(title) {
  return title.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/)?.[0] ?? "knowledge";
}
async function compileWikiPage(options) {
  const nowDate = options.now ?? new Date;
  const now = nowDate.toISOString();
  migrateKnowledgeDb(options.dbPath);
  const readDb = openKnowledgeDb(options.dbPath);
  let rows;
  try {
    rows = selectSourceChunks(readDb, options);
  } finally {
    readDb.close();
  }
  if (rows.length === 0)
    throw new Error("No source chunks matched wiki compile input.");
  const title = titleFor(options, rows);
  const slug = slugify(title);
  const path = `wiki/generated/${slug}.md`;
  const body = compileBody(title, rows, now);
  const sourceRefs = rows.map((row) => {
    const metadata = parseJsonObject4(row.metadata_json);
    return typeof metadata.source_ref === "string" ? metadata.source_ref : row.source_uri;
  }).filter((ref) => Boolean(ref));
  const provenance = generatedArtifactProvenance({
    generated_from: "wiki_compile",
    artifact_key: path,
    source_refs: sourceRefs
  });
  const pageArtifact = await writeArtifact(options.store, {
    key: path,
    body,
    content_type: "text/markdown",
    metadata: { generated_from: "wiki_compile" }
  });
  const pageId = stableId6("wiki", path);
  const citations = rows.map((row) => ({
    chunk_id: row.chunk_id,
    source_uri: row.source_uri ?? "unknown",
    quote: excerpt(row.text, 240),
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    metadata: {
      source_revision_id: row.source_revision_id,
      revision: row.revision,
      hash: row.hash,
      source_ref: parseJsonObject4(row.metadata_json).source_ref ?? row.source_uri
    }
  }));
  const concept = firstConcept(title);
  const conceptPath = `wiki/concepts/${slugify(concept)}.md`;
  const conceptBody = [`# ${concept}`, "", `Related page: [[${path}]]`, ""].join(`
`);
  const conceptProvenance = generatedArtifactProvenance({
    generated_from: "wiki_compile_concept",
    artifact_key: conceptPath,
    source_refs: sourceRefs
  });
  const conceptArtifact = await writeArtifact(options.store, {
    key: conceptPath,
    body: conceptBody,
    content_type: "text/markdown",
    metadata: { generated_from: "wiki_compile_concept" }
  });
  const conceptPageId = stableId6("wiki", conceptPath);
  const log = await appendLog(options.store, {
    ts: now,
    event: "wiki_compile_completed",
    page_key: path,
    source_refs: sourceRefs,
    chunks_seen: rows.length
  }, nowDate);
  const db = openKnowledgeDb(options.dbPath);
  try {
    recordStorageObjects(db, [pageArtifact, conceptArtifact, log], nowDate);
    upsertWikiPage(db, {
      pageId,
      path,
      title,
      artifactUri: pageArtifact.uri,
      contentHash: pageArtifact.hash ?? "",
      body,
      provenance,
      now
    });
    upsertWikiPage(db, {
      pageId: conceptPageId,
      path: conceptPath,
      title: concept,
      artifactUri: conceptArtifact.uri,
      contentHash: conceptArtifact.hash ?? "",
      body: conceptBody,
      provenance: conceptProvenance,
      now
    });
    db.run(`INSERT OR REPLACE INTO wiki_backlinks (from_page_id, to_page_id, label, created_at)
       VALUES (?, ?, ?, ?)`, [pageId, conceptPageId, "concept", now]);
    const citationsWritten = replacePageCitations(db, pageId, citations, now);
    const indexesUpdated = upsertIndex(db, {
      title,
      path,
      artifactUri: pageArtifact.uri,
      contentHash: pageArtifact.hash ?? "",
      now
    });
    return {
      page_id: pageId,
      path,
      artifact_uri: pageArtifact.uri,
      content_hash: pageArtifact.hash ?? "",
      chunks_seen: rows.length,
      citations_written: citationsWritten,
      concept_page_id: conceptPageId,
      indexes_updated: indexesUpdated,
      log_key: log.key,
      warnings: []
    };
  } finally {
    db.close();
  }
}
async function fileAnswerToWiki(options) {
  if (!options.approveWrite) {
    return {
      approved: false,
      durable_writes_performed: false,
      page_id: null,
      path: null,
      artifact_uri: null,
      citations_written: 0,
      log_key: null,
      message: "Dry-run: answer filing requires --approve-write."
    };
  }
  const nowDate = options.now ?? new Date;
  const now = nowDate.toISOString();
  const title = options.prompt.length > 80 ? `${options.prompt.slice(0, 77)}...` : options.prompt;
  const slug = slugify(title);
  const path = `wiki/answers/${slug}.md`;
  const citations = options.context.citations;
  const body = [
    `# ${title}`,
    "",
    options.answer,
    "",
    "## Citations",
    "",
    ...citations.map((citation, index) => `- [C${index + 1}] ${citation.source_ref ?? citation.source_uri ?? citation.artifact_path ?? citation.artifact_uri ?? "unknown"} ${citation.hash ? `(hash ${citation.hash})` : ""}`),
    ""
  ].join(`
`);
  const sourceRefs = citations.map((citation) => citation.source_ref ?? citation.source_uri).filter((ref) => Boolean(ref));
  const provenance = generatedArtifactProvenance({
    generated_from: "knowledge_answer",
    artifact_key: path,
    source_refs: sourceRefs
  });
  const artifact = await writeArtifact(options.store, {
    key: path,
    body,
    content_type: "text/markdown",
    metadata: { generated_from: "knowledge_answer" }
  });
  const log = await appendLog(options.store, {
    ts: now,
    event: "wiki_answer_filed",
    page_key: path,
    prompt: options.prompt,
    citations: citations.length
  }, nowDate);
  const pageId = stableId6("wiki", path);
  const db = openKnowledgeDb(options.dbPath);
  try {
    recordStorageObjects(db, [artifact, log], nowDate);
    upsertWikiPage(db, {
      pageId,
      path,
      title,
      artifactUri: artifact.uri,
      contentHash: artifact.hash ?? "",
      body,
      provenance,
      now
    });
    const written = replacePageCitations(db, pageId, citations.map((citation) => ({
      chunk_id: citation.chunk_id,
      source_uri: citation.source_uri ?? citation.artifact_uri ?? "unknown",
      quote: citation.quote,
      start_offset: citation.start_offset,
      end_offset: citation.end_offset,
      metadata: {
        source_ref: citation.source_ref,
        artifact_path: citation.artifact_path,
        revision: citation.revision,
        hash: citation.hash
      }
    })), now);
    upsertIndex(db, {
      title,
      path,
      artifactUri: artifact.uri,
      contentHash: artifact.hash ?? "",
      now
    });
    return {
      approved: true,
      durable_writes_performed: true,
      page_id: pageId,
      path,
      artifact_uri: artifact.uri,
      citations_written: written,
      log_key: log.key,
      message: `Filed answer to ${path}`
    };
  } finally {
    db.close();
  }
}
function addIssue(issues, issue) {
  issues.push(issue);
}
function lintWiki(options) {
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  const issues = [];
  try {
    const activePages = db.query("SELECT COUNT(*) AS n FROM wiki_pages WHERE status = 'active'").get()?.n ?? 0;
    const citationCount = db.query("SELECT COUNT(*) AS n FROM citations").get()?.n ?? 0;
    const backlinkCount = db.query("SELECT COUNT(*) AS n FROM wiki_backlinks").get()?.n ?? 0;
    const missingCitations = db.query(`SELECT wp.id, wp.path
       FROM wiki_pages wp
       LEFT JOIN citations c ON c.wiki_page_id = wp.id
       WHERE wp.status = 'active' AND wp.path LIKE 'wiki/generated/%'
       GROUP BY wp.id
       HAVING COUNT(c.id) = 0`).all();
    for (const page of missingCitations) {
      addIssue(issues, { type: "missing_citation", severity: "error", page_id: page.id, path: page.path, message: "Generated wiki page has no citations." });
    }
    const stale = db.query(`SELECT wp.id AS page_id, wp.path, c.source_uri, c.chunk_id
       FROM citations c
       JOIN wiki_pages wp ON wp.id = c.wiki_page_id
       LEFT JOIN chunks ch ON ch.id = c.chunk_id
       WHERE ch.metadata_json LIKE '%"stale":true%' OR ch.metadata_json LIKE '%"status":"stale"%' OR ch.metadata_json LIKE '%"status":"deleted"%'`).all();
    for (const row of stale) {
      addIssue(issues, { type: "stale_citation", severity: "warn", page_id: row.page_id, path: row.path, source_uri: row.source_uri, chunk_id: row.chunk_id ?? undefined, message: "Page cites a stale or deleted source chunk." });
    }
    const duplicates = db.query(`SELECT lower(title) AS title, COUNT(*) AS n
       FROM wiki_pages
       WHERE status = 'active'
       GROUP BY lower(title)
       HAVING COUNT(*) > 1`).all();
    for (const row of duplicates) {
      addIssue(issues, { type: "duplicate_page", severity: "warn", message: `Duplicate active wiki title: ${row.title} (${row.n} pages).` });
    }
    const orphans = db.query(`SELECT wp.id, wp.path
       FROM wiki_pages wp
       LEFT JOIN wiki_backlinks wb1 ON wb1.from_page_id = wp.id
       LEFT JOIN wiki_backlinks wb2 ON wb2.to_page_id = wp.id
       WHERE wp.status = 'active'
         AND wp.path NOT IN ('wiki/README.md')
       GROUP BY wp.id
       HAVING COUNT(wb1.to_page_id) = 0 AND COUNT(wb2.from_page_id) = 0`).all();
    for (const page of orphans) {
      addIssue(issues, { type: "orphan_page", severity: "info", page_id: page.id, path: page.path, message: "Wiki page has no backlinks." });
    }
    const unresolved = db.query(`SELECT wp.id AS page_id, wp.path, c.source_uri
       FROM citations c
       JOIN wiki_pages wp ON wp.id = c.wiki_page_id
       LEFT JOIN sources s ON s.uri = c.source_uri
       WHERE s.id IS NULL AND c.source_uri NOT LIKE 'file://%' AND c.source_uri NOT LIKE 's3://%' AND c.source_uri NOT LIKE 'https://%' AND c.source_uri NOT LIKE 'open-files://%'`).all();
    for (const row of unresolved) {
      addIssue(issues, { type: "unresolved_source_ref", severity: "error", page_id: row.page_id, path: row.path, source_uri: row.source_uri, message: "Citation source URI cannot be resolved to a known or allowed source ref." });
    }
    const contradictions = db.query(`SELECT id, path FROM wiki_pages WHERE lower(metadata_json) LIKE '%contradiction%'`).all();
    for (const page of contradictions) {
      addIssue(issues, { type: "contradiction_marker", severity: "warn", page_id: page.id, path: page.path, message: "Page metadata contains a contradiction marker." });
    }
    const newArticleCandidates = db.query(`SELECT c.id AS chunk_id, s.uri AS source_uri
       FROM chunks c
       JOIN source_revisions sr ON sr.id = c.source_revision_id
       JOIN sources s ON s.id = sr.source_id
       LEFT JOIN citations cit ON cit.chunk_id = c.id
       WHERE c.kind = 'source'
       GROUP BY c.id
       HAVING COUNT(cit.id) = 0
       LIMIT 25`).all();
    for (const row of newArticleCandidates) {
      addIssue(issues, { type: "new_article_candidate", severity: "info", chunk_id: row.chunk_id, source_uri: row.source_uri ?? undefined, message: "Source chunk is indexed but not cited by any wiki page yet." });
    }
    return {
      ok: issues.every((issue) => issue.severity !== "error"),
      issue_count: issues.length,
      issues,
      counts: {
        active_pages: activePages,
        citations: citationCount,
        backlinks: backlinkCount,
        new_article_candidates: newArticleCandidates.length
      }
    };
  } finally {
    db.close();
  }
}

// src/wiki-layout.ts
import { createHash as createHash12 } from "crypto";
function todayParts2(now) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return { year, month, day };
}
function stableId7(prefix, value) {
  return `${prefix}_${createHash12("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function estimateTokenCount3(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}
function agentSchemaTemplate() {
  return `# Knowledge Agent Schema v1

## Source Rules

- Treat open-files source references as the preferred source of truth.
- Do not copy raw source files into knowledge.
- Cite every durable fact with a source URI, revision/hash when available, and optional span.
- Mark uncertainty explicitly when sources disagree or are incomplete.

## Wiki Rules

- Write generated knowledge as Markdown pages under wiki/.
- Keep root indexes small; use topic, team, project, and machine-readable shards for scale.
- Preserve backlinks between related pages and decisions.
- Prefer updating existing pages over creating near-duplicates.

## Query Rules

- Search wiki pages first, then source chunks, then deeper read-only source refs.
- Use web search only when requested or when current external context is required.
- File useful answers back into the wiki only after approval or approved auto-write mode.

## Lint Rules

- Flag stale pages, missing citations, contradictions, orphan pages, duplicate pages, and unresolved source refs.
`;
}
function rootIndexTemplate() {
  return `# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`;
}
function wikiReadmeTemplate() {
  return `# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`;
}
async function initializeWikiLayout(store, now = new Date) {
  const { year, month, day } = todayParts2(now);
  const schemaKey = "schemas/v1.md";
  const rootIndexKey = "indexes/root.md";
  const wikiReadmeKey = "wiki/README.md";
  const logKey = `logs/${year}/${month}/${day}.jsonl`;
  const event = {
    ts: now.toISOString(),
    event: "wiki_layout_initialized",
    schema_key: schemaKey,
    root_index_key: rootIndexKey,
    wiki_readme_key: wikiReadmeKey
  };
  const entries = [
    { key: schemaKey, body: agentSchemaTemplate(), content_type: "text/markdown" },
    { key: rootIndexKey, body: rootIndexTemplate(), content_type: "text/markdown" },
    { key: wikiReadmeKey, body: wikiReadmeTemplate(), content_type: "text/markdown" },
    { key: logKey, body: `${JSON.stringify(event)}
`, content_type: "application/x-ndjson" }
  ];
  const artifacts = await Promise.all(entries.map(async (entry) => {
    const result = await store.put(entry);
    return {
      key: result.key,
      uri: result.uri,
      kind: artifactKindForKey(entry.key),
      content_type: entry.content_type,
      metadata: {
        provenance: generatedArtifactProvenance({
          generated_from: "wiki_layout_init",
          artifact_key: entry.key,
          citation_required: entry.key.startsWith("wiki/") || entry.key.startsWith("indexes/")
        })
      },
      ...hashArtifactBody(entry.body)
    };
  }));
  return {
    schema_key: schemaKey,
    root_index_key: rootIndexKey,
    wiki_readme_key: wikiReadmeKey,
    log_key: logKey,
    artifacts,
    written: [schemaKey, rootIndexKey, wikiReadmeKey, logKey]
  };
}
function provenanceFor(artifact) {
  const existing = artifact.metadata?.provenance;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing;
  }
  return generatedArtifactProvenance({
    generated_from: "wiki_layout_init",
    artifact_key: artifact.key
  });
}
function recordWikiChunk(db, pageId, title, artifact, body, now) {
  const provenance = provenanceFor(artifact);
  const chunkId = stableId7("chk", `${pageId}\x00${artifact.hash ?? artifact.uri}`);
  const existing = db.query("SELECT id FROM chunks WHERE wiki_page_id = ?").all(pageId);
  for (const row of existing)
    db.run("DELETE FROM chunks_fts WHERE chunk_id = ?", [row.id]);
  db.run("DELETE FROM chunks WHERE wiki_page_id = ?", [pageId]);
  db.run(`INSERT INTO chunks (id, wiki_page_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    chunkId,
    pageId,
    "wiki",
    0,
    body,
    estimateTokenCount3(body),
    0,
    body.length,
    JSON.stringify({
      artifact_key: artifact.key,
      artifact_uri: artifact.uri,
      content_hash: artifact.hash ?? null,
      provenance
    }),
    now
  ]);
  db.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)", [chunkId, body, title, artifact.uri]);
}
function recordWikiLayoutCatalog(db, artifacts, now = new Date) {
  const timestamp = now.toISOString();
  const rootIndex = artifacts.find((artifact) => artifact.key.endsWith("indexes/root.md"));
  const wikiReadme = artifacts.find((artifact) => artifact.key.endsWith("wiki/README.md"));
  if (rootIndex) {
    db.run(`INSERT INTO knowledge_indexes (id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, name, shard_key) DO UPDATE SET
         artifact_uri = excluded.artifact_uri,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`, [
      stableId7("idx", "root:indexes/root.md"),
      "root",
      "root",
      rootIndex.uri,
      "root",
      JSON.stringify({
        artifact_key: rootIndex.key,
        content_hash: rootIndex.hash ?? null,
        provenance: provenanceFor(rootIndex)
      }),
      timestamp,
      timestamp
    ]);
  }
  if (wikiReadme) {
    const wikiPageId = stableId7("wiki", "wiki/README.md");
    db.run(`INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         title = excluded.title,
         artifact_uri = excluded.artifact_uri,
         content_hash = excluded.content_hash,
         status = excluded.status,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`, [
      wikiPageId,
      "wiki/README.md",
      "Wiki",
      wikiReadme.uri,
      wikiReadme.hash ?? null,
      "active",
      JSON.stringify({
        artifact_key: wikiReadme.key,
        provenance: provenanceFor(wikiReadme)
      }),
      timestamp,
      timestamp
    ]);
    recordWikiChunk(db, wikiPageId, "Wiki", wikiReadme, wikiReadmeTemplate(), timestamp);
  }
}

// src/service.ts
function resolvePeerWorkspace(input) {
  const target = resolve4(input);
  if (existsSync8(join5(target, "knowledge.db")) || existsSync8(join5(target, "config.json"))) {
    return ensureKnowledgeWorkspace(target);
  }
  return ensureKnowledgeWorkspace(workspaceForHome(projectKnowledgeHome(target)).home);
}
function shellQuote2(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function remoteKnowledgeCommand(peerWorkspace, args) {
  return `cd ${shellQuote2(peerWorkspace)} && knowledge ${args.map(shellQuote2).join(" ")}`;
}
function runSshCommand(machine, command, input, resolved) {
  const result = spawnSync2("ssh", [resolved.target, command], {
    encoding: "utf8",
    env: process.env,
    input,
    maxBuffer: 64 * 1024 * 1024
  });
  if ((result.status ?? 1) !== 0) {
    const route = resolved.source === "open-machines" ? ` via ${resolved.route ?? "resolved"}:${resolved.target}` : "";
    throw new Error(`ssh ${machine}${route} failed: ${(result.stderr || result.stdout || String(result.status)).trim()}`);
  }
  return result.stdout || "";
}
function parseRemoteJson(machine, action, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const preview = raw.trim().slice(0, 240);
    throw new Error(`Remote knowledge ${action} on ${machine} did not return JSON. Install a compatible @hasna/knowledge CLI on the remote machine. Output: ${preview || String(error)}`);
  }
}
function assertRemoteSyncBundle(machine, value) {
  if (typeof value !== "object" || value === null || !("format" in value) || value.format !== "knowledge-sync-bundle") {
    throw new Error(`Remote knowledge sync export on ${machine} did not return a knowledge sync bundle. Install @hasna/knowledge 0.2.32 or newer on the remote machine.`);
  }
  if (value.protocol_version !== KNOWLEDGE_SYNC_PROTOCOL_VERSION || value.min_protocol_version !== KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION) {
    throw new Error(`Remote knowledge sync export on ${machine} uses an unsupported sync protocol. Install @hasna/knowledge 0.2.32 or newer on both machines.`);
  }
}
function assertRemoteSyncApplyResult(machine, value) {
  if (typeof value !== "object" || value === null || !("ok" in value) || !("target" in value) || !("tables" in value) || !("artifacts" in value) || !("conflicts_created" in value)) {
    throw new Error(`Remote knowledge sync import on ${machine} did not return a sync import result. Install @hasna/knowledge 0.2.32 or newer on the remote machine.`);
  }
  if (value.protocol_version !== KNOWLEDGE_SYNC_PROTOCOL_VERSION || value.min_protocol_version !== KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION) {
    throw new Error(`Remote knowledge sync import on ${machine} uses an unsupported sync protocol. Install @hasna/knowledge 0.2.32 or newer on both machines.`);
  }
}
function normalizeMode(value) {
  if (!value)
    return;
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "offline")
    return "local";
  if (normalized === "hosted" || normalized === "remote" || normalized === "knowledge.hasna.xyz")
    return "hosted";
  throw new Error("Invalid setup mode. Use hosted or local.");
}

class KnowledgeService {
  options;
  ensuredWorkspace;
  cachedConfig;
  constructor(options = {}) {
    this.options = options;
  }
  get scope() {
    return this.options.scope ?? "global";
  }
  get workspace() {
    return this.ensuredWorkspace ?? resolveScopedWorkspace(this.options.scope, this.options.cwd);
  }
  ensureWorkspace() {
    if (!this.ensuredWorkspace)
      this.ensuredWorkspace = ensureKnowledgeWorkspace(this.workspace.home);
    return this.ensuredWorkspace;
  }
  jsonStorePath() {
    return this.ensureWorkspace().jsonStorePath;
  }
  config() {
    if (!this.cachedConfig) {
      const workspace = this.ensureWorkspace();
      this.cachedConfig = readKnowledgeConfig(workspace.configPath);
    }
    return this.cachedConfig;
  }
  safetyPolicy() {
    return resolveSafetyPolicy(this.config(), this.ensureWorkspace());
  }
  artifactStore() {
    return createArtifactStore(this.config(), this.ensureWorkspace());
  }
  storageContract() {
    return resolveStorageContract(this.config(), this.ensureWorkspace(), this.scope);
  }
  validateStorage() {
    return validateStorageConfig(this.config(), this.ensureWorkspace());
  }
  setup(options = {}) {
    const workspace = this.ensureWorkspace();
    const current = this.config();
    const mode = normalizeMode(options.mode) ?? current.mode;
    const apiUrl = options.apiUrl ? normalizeKnowledgeApiOrigin(options.apiUrl) : current.hosted?.api_url ? normalizeKnowledgeApiOrigin(current.hosted.api_url) : null;
    const nextConfig = {
      ...current,
      mode,
      hosted: {
        ...current.hosted ?? {},
        ...apiUrl ? { api_url: apiUrl } : {}
      },
      storage: options.canonicalHasnaXyz ? canonicalHasnaXyzKnowledgeStorage() : current.storage
    };
    writeKnowledgeConfig(workspace.configPath, nextConfig);
    this.cachedConfig = nextConfig;
    const storage = resolveStorageContract(nextConfig, workspace, this.scope);
    return {
      ok: true,
      mode,
      api_url: nextConfig.hosted?.api_url ?? null,
      storage_type: nextConfig.storage.type,
      artifact_uri_prefix: storage.artifact_store.uri_prefix,
      canonical_hasna_xyz: storage.canonical_hasna_xyz,
      config_path: workspace.configPath,
      next: mode === "hosted" ? ["knowledge auth login --api-key <key>", "knowledge storage status --json", "knowledge remote contracts --json"] : ["knowledge search <query>", "knowledge <prompt>"],
      message: `Set knowledge mode to ${mode}`
    };
  }
  authStatus(env = process.env) {
    return knowledgeAuthStatus(this.config(), env);
  }
  saveAuth(input, env = process.env) {
    const apiUrl = input.apiUrl ?? this.config().hosted?.api_url;
    return saveKnowledgeAuth({
      api_key: input.apiKey,
      email: input.email,
      org_id: input.orgId,
      org_slug: input.orgSlug,
      user_id: input.userId,
      api_url: apiUrl
    }, env);
  }
  clearAuth(env = process.env) {
    return clearKnowledgeAuth(env);
  }
  remoteContract() {
    const storage = this.storageContract();
    return knowledgeRegistryContract({
      mode: this.config().mode,
      sourceSchemes: this.config().sources.allowed_schemes,
      storageType: storage.artifact_store.type,
      artifactUriPrefix: storage.artifact_store.uri_prefix
    });
  }
  remoteClient(env = process.env) {
    return RemoteKnowledgeClient.fromConfig(this.config(), env);
  }
  paths() {
    const workspace = this.ensureWorkspace();
    return {
      ok: true,
      scope: this.scope,
      home: workspace.home,
      config_path: workspace.configPath,
      json_store_path: workspace.jsonStorePath,
      knowledge_db_path: workspace.knowledgeDbPath,
      artifacts_dir: workspace.artifactsDir,
      indexes_dir: workspace.indexesDir,
      logs_dir: workspace.logsDir,
      runs_dir: workspace.runsDir,
      schemas_dir: workspace.schemasDir,
      wiki_dir: workspace.wikiDir,
      config: this.config(),
      message: workspace.home
    };
  }
  initDb() {
    return migrateKnowledgeDb(this.ensureWorkspace().knowledgeDbPath);
  }
  dbStats() {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return getKnowledgeDbStats(workspace.knowledgeDbPath);
  }
  async initWiki() {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    const result = await initializeWikiLayout(this.artifactStore());
    const db = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      recordStorageObjects(db, result.artifacts);
      recordWikiLayoutCatalog(db, result.artifacts);
    } finally {
      db.close();
    }
    return result;
  }
  async compileWiki(options = {}) {
    const workspace = this.ensureWorkspace();
    return compileWikiPage({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      store: this.artifactStore()
    });
  }
  async fileAnswer(options) {
    const workspace = this.ensureWorkspace();
    const context = await this.retrieveContext({
      query: options.prompt,
      limit: options.limit,
      semantic: options.semantic,
      modelRef: options.modelRef,
      dimensions: options.dimensions,
      fake: options.fake
    });
    return fileAnswerToWiki({
      dbPath: workspace.knowledgeDbPath,
      store: this.artifactStore(),
      prompt: options.prompt,
      answer: options.answer,
      context,
      approveWrite: options.approveWrite
    });
  }
  lintWiki() {
    const workspace = this.ensureWorkspace();
    return lintWiki({ dbPath: workspace.knowledgeDbPath });
  }
  async ingestManifest(input) {
    const workspace = this.ensureWorkspace();
    return ingestOpenFilesManifest({
      dbPath: workspace.knowledgeDbPath,
      input,
      config: this.config(),
      safetyPolicy: this.safetyPolicy()
    });
  }
  async ingestSource(sourceRef, purpose) {
    const workspace = this.ensureWorkspace();
    return ingestSourceRef({
      dbPath: workspace.knowledgeDbPath,
      sourceRef,
      purpose,
      config: this.config(),
      safetyPolicy: this.safetyPolicy()
    });
  }
  async resolveSource(sourceRef, options = {}) {
    const workspace = this.ensureWorkspace();
    return resolveOpenFilesSource({
      dbPath: workspace.knowledgeDbPath,
      sourceRef,
      purpose: options.purpose,
      limit: options.limit,
      safetyPolicy: this.safetyPolicy()
    });
  }
  async consumeOutbox(input) {
    const workspace = this.ensureWorkspace();
    return consumeOpenFilesOutbox({
      dbPath: workspace.knowledgeDbPath,
      input,
      config: this.config(),
      safetyPolicy: this.safetyPolicy()
    });
  }
  reindexHealth(options = {}) {
    const workspace = this.ensureWorkspace();
    return reindexHealth({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  enqueueReindex(options = {}) {
    const workspace = this.ensureWorkspace();
    return enqueueMissingEmbeddings({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  async refreshEmbeddings(options = {}) {
    const workspace = this.ensureWorkspace();
    return refreshEmbeddingIndex({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  providerStatus(env = process.env) {
    return providerStatus(this.config(), env);
  }
  modelRegistry() {
    return listModelRegistry(this.config());
  }
  embeddingStatus() {
    const workspace = this.ensureWorkspace();
    return embeddingIndexStatus(workspace.knowledgeDbPath);
  }
  async indexEmbeddings(options = {}) {
    const workspace = this.ensureWorkspace();
    return indexKnowledgeEmbeddings({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  async semanticSearch(options) {
    const workspace = this.ensureWorkspace();
    return searchVectorIndex({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  async search(options) {
    const workspace = this.ensureWorkspace();
    return hybridSearch({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  async retrieveContext(options) {
    const workspace = this.ensureWorkspace();
    return retrieveKnowledgeContext({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  async runPrompt(options) {
    const workspace = this.ensureWorkspace();
    return runKnowledgePrompt({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config()
    });
  }
  async webSearch(options) {
    const workspace = this.ensureWorkspace();
    return runProviderWebSearch({
      ...options,
      dbPath: workspace.knowledgeDbPath,
      config: this.config(),
      safetyPolicy: this.safetyPolicy()
    });
  }
  async machineTopology(options = {}) {
    const workspace = this.ensureWorkspace();
    return discoverKnowledgeMachineTopology({
      ...options,
      knowledge: {
        scope: this.scope,
        workspace_home: workspace.home
      }
    });
  }
  async machinePreflight(options = {}) {
    const workspace = this.ensureWorkspace();
    return preflightKnowledgeMachine({
      ...options,
      knowledge: {
        scope: this.scope,
        workspace_home: workspace.home
      }
    });
  }
  syncStatus() {
    const workspace = this.ensureWorkspace();
    return getKnowledgeSyncStatus({
      dbPath: workspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: workspace.home
    });
  }
  async createSyncSnapshot(options = {}) {
    const workspace = this.ensureWorkspace();
    const topology = await this.machineTopology({
      includeTailscale: options.includeTailscale !== false
    });
    return createKnowledgeSyncSnapshot({
      dbPath: workspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: workspace.home,
      storage: this.storageContract(),
      topology,
      machineId: options.machineId
    });
  }
  syncConflicts(options = {}) {
    const workspace = this.ensureWorkspace();
    return listKnowledgeSyncConflicts(workspace.knowledgeDbPath, options);
  }
  syncConflict(id) {
    const workspace = this.ensureWorkspace();
    const conflict = getKnowledgeSyncConflict(workspace.knowledgeDbPath, id);
    if (!conflict)
      throw new Error(`Sync conflict not found: ${id}`);
    return conflict;
  }
  proposeSyncConflictResolution(id) {
    const workspace = this.ensureWorkspace();
    return proposeKnowledgeSyncConflictResolution(workspace.knowledgeDbPath, id);
  }
  resolveSyncConflict(options) {
    const workspace = this.ensureWorkspace();
    const proposal = proposeKnowledgeSyncConflictResolution(workspace.knowledgeDbPath, options.id);
    if (options.approveWrite !== true || !options.approvedBy) {
      return {
        ok: false,
        approval_required: true,
        conflict: proposal.conflict,
        proposal,
        message: "Sync conflict resolution requires --approve-write and --approved-by <name>"
      };
    }
    const conflict = resolveKnowledgeSyncConflict(workspace.knowledgeDbPath, {
      id: options.id,
      strategy: options.strategy ?? proposal.proposed_strategy,
      approvedBy: options.approvedBy,
      proposedPatchUri: options.proposedPatchUri
    });
    const db = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      const auditEventId = recordAuditEvent(db, {
        event_type: "sync_conflict_resolution",
        action: "sync.conflict.resolve",
        target_uri: `knowledge-sync-conflict://${options.id}`,
        decision: "allow",
        metadata: {
          conflict_id: options.id,
          entity_kind: conflict.entity_kind,
          entity_id: conflict.entity_id,
          strategy: conflict.resolution_strategy,
          approved_by: conflict.approved_by,
          proposed_patch_uri: conflict.proposed_patch_uri
        }
      });
      return {
        ok: true,
        approval_required: false,
        conflict,
        audit_event_id: auditEventId,
        message: `Resolved sync conflict ${options.id}`
      };
    } finally {
      db.close();
    }
  }
  syncMachines() {
    const workspace = this.ensureWorkspace();
    return listKnowledgeMachines(workspace.knowledgeDbPath);
  }
  exportSyncBundle(options = {}) {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return createKnowledgeSyncBundle({
      dbPath: workspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: workspace.home,
      storage: this.storageContract(),
      machineId: options.machineId ?? null,
      tables: options.tables,
      includeArtifactContent: options.includeArtifactContent
    });
  }
  async importSyncBundle(options) {
    const workspace = this.ensureWorkspace();
    migrateKnowledgeDb(workspace.knowledgeDbPath);
    return applyKnowledgeSyncBundle({
      targetDbPath: workspace.knowledgeDbPath,
      targetScope: this.scope,
      targetWorkspaceHome: workspace.home,
      targetStorage: this.storageContract(),
      targetStore: this.artifactStore(),
      bundle: options.bundle,
      direction: options.direction ?? "import",
      dryRun: options.dryRun,
      localMachineId: options.machineId ?? null
    });
  }
  async syncRemotePeer(options) {
    const direction = options.direction ?? "both";
    const dryRun = options.dryRun === true;
    const tableArgs = options.tables?.length ? ["--tables", options.tables.join(",")] : [];
    const artifactArgs = options.includeArtifactContent === false ? ["--no-artifact-content"] : [];
    const scopeArgs = ["--scope", this.scope, "--json"];
    const resolvedMachine = await resolveKnowledgeMachineRoute({
      machineId: options.machine,
      includeTailscale: options.includeTailscale
    });
    const result = {
      ok: true,
      dry_run: dryRun,
      direction,
      transport: "ssh",
      machine: options.machine,
      resolved_machine: resolvedMachine.target,
      resolved_route: {
        source: resolvedMachine.source,
        target: resolvedMachine.target,
        route: resolvedMachine.route,
        target_kind: resolvedMachine.targetKind,
        confidence: resolvedMachine.confidence,
        evidence: resolvedMachine.evidence
      },
      peer_workspace: options.peerWorkspace,
      message: ""
    };
    if (direction === "pull" || direction === "both") {
      const remoteExport = remoteKnowledgeCommand(options.peerWorkspace, [
        "sync",
        "export",
        ...scopeArgs,
        ...tableArgs,
        ...artifactArgs
      ]);
      const raw = runSshCommand(options.machine, remoteExport, undefined, resolvedMachine);
      const bundle = parseRemoteJson(options.machine, "sync export", raw);
      assertRemoteSyncBundle(options.machine, bundle);
      result.pull = await this.importSyncBundle({
        bundle,
        dryRun,
        direction: "pull",
        machineId: options.machineId ?? null
      });
    }
    if (direction === "push" || direction === "both") {
      const bundle = this.exportSyncBundle({
        machineId: options.machineId ?? null,
        tables: options.tables,
        includeArtifactContent: options.includeArtifactContent
      });
      const remoteImport = remoteKnowledgeCommand(options.peerWorkspace, [
        "sync",
        "import",
        ...scopeArgs,
        ...dryRun ? ["--dry-run"] : []
      ]);
      const applyResult = parseRemoteJson(options.machine, "sync import", runSshCommand(options.machine, remoteImport, JSON.stringify(bundle), resolvedMachine));
      assertRemoteSyncApplyResult(options.machine, applyResult);
      result.push = applyResult;
    }
    result.ok = (result.pull?.ok ?? true) && (result.push?.ok ?? true);
    result.message = [
      result.pull ? `pull: ${result.pull.message}` : null,
      result.push ? `push: ${result.push.message}` : null
    ].filter(Boolean).join("; ");
    return result;
  }
  async syncPeer(options) {
    const direction = options.direction ?? "both";
    const localWorkspace = this.ensureWorkspace();
    migrateKnowledgeDb(localWorkspace.knowledgeDbPath);
    const peerWorkspace = resolvePeerWorkspace(options.peerWorkspace);
    migrateKnowledgeDb(peerWorkspace.knowledgeDbPath);
    const peerConfig = readKnowledgeConfig(peerWorkspace.configPath);
    const peerStorage = resolveStorageContract(peerConfig, peerWorkspace, this.scope);
    const peerStore = createArtifactStore(peerConfig, peerWorkspace);
    const localBundle = () => createKnowledgeSyncBundle({
      dbPath: localWorkspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: localWorkspace.home,
      storage: this.storageContract(),
      machineId: options.machineId ?? null,
      tables: options.tables,
      includeArtifactContent: options.includeArtifactContent
    });
    const peerBundle = () => createKnowledgeSyncBundle({
      dbPath: peerWorkspace.knowledgeDbPath,
      scope: this.scope,
      workspaceHome: peerWorkspace.home,
      storage: peerStorage,
      machineId: null,
      tables: options.tables,
      includeArtifactContent: options.includeArtifactContent
    });
    const result = {
      ok: true,
      dry_run: options.dryRun === true,
      direction,
      message: ""
    };
    if (direction === "pull" || direction === "both") {
      result.pull = await applyKnowledgeSyncBundle({
        targetDbPath: localWorkspace.knowledgeDbPath,
        targetScope: this.scope,
        targetWorkspaceHome: localWorkspace.home,
        targetStorage: this.storageContract(),
        targetStore: this.artifactStore(),
        bundle: peerBundle(),
        targetBundle: localBundle(),
        direction: "pull",
        dryRun: options.dryRun,
        localMachineId: options.machineId ?? null
      });
    }
    if (direction === "push" || direction === "both") {
      result.push = await applyKnowledgeSyncBundle({
        targetDbPath: peerWorkspace.knowledgeDbPath,
        targetScope: this.scope,
        targetWorkspaceHome: peerWorkspace.home,
        targetStorage: peerStorage,
        targetStore: peerStore,
        bundle: localBundle(),
        targetBundle: peerBundle(),
        direction: "push",
        dryRun: options.dryRun,
        localMachineId: options.machineId ?? null
      });
    }
    result.ok = (result.pull?.ok ?? true) && (result.push?.ok ?? true);
    result.message = [
      result.pull ? `pull: ${result.pull.message}` : null,
      result.push ? `push: ${result.push.message}` : null
    ].filter(Boolean).join("; ");
    return result;
  }
}
function createKnowledgeService(options = {}) {
  return new KnowledgeService(options);
}

// src/sdk.ts
function createKnowledgeClient(options = {}) {
  const service = createKnowledgeService(options);
  return {
    unstable_service: service,
    paths: () => service.paths(),
    setup: (input = {}) => service.setup(input),
    auth: {
      status: (env = process.env) => service.authStatus(env),
      login: (input, env = process.env) => service.saveAuth(input, env),
      logout: (env = process.env) => service.clearAuth(env)
    },
    remote: {
      contract: () => service.remoteContract(),
      client: (env = process.env) => service.remoteClient(env)
    },
    storage: {
      status: () => service.storageContract(),
      validate: () => service.validateStorage(),
      artifactStore: () => service.artifactStore()
    },
    sync: {
      status: () => service.syncStatus(),
      snapshot: (input = {}) => service.createSyncSnapshot(input),
      conflicts: (input = {}) => service.syncConflicts(input),
      conflict: (id) => service.syncConflict(id),
      proposeConflictResolution: (id) => service.proposeSyncConflictResolution(id),
      resolveConflict: (input) => service.resolveSyncConflict(input),
      machines: () => service.syncMachines(),
      exportBundle: (input = {}) => service.exportSyncBundle(input),
      importBundle: (input) => service.importSyncBundle(input),
      peer: (input) => service.syncPeer(input),
      remotePeer: (input) => service.syncRemotePeer(input)
    },
    db: {
      init: () => service.initDb(),
      stats: () => service.dbStats()
    },
    wiki: {
      init: () => service.initWiki(),
      compile: (input = {}) => service.compileWiki(input),
      fileAnswer: (input) => service.fileAnswer(input),
      lint: () => service.lintWiki()
    },
    ingest: {
      manifest: (input) => service.ingestManifest(input),
      source: (sourceRef, purpose) => service.ingestSource(sourceRef, purpose)
    },
    sources: {
      resolve: (sourceRef, input = {}) => service.resolveSource(sourceRef, input),
      consumeOutbox: (input) => service.consumeOutbox(input)
    },
    reindex: {
      health: (input = {}) => service.reindexHealth(input),
      enqueue: (input = {}) => service.enqueueReindex(input),
      refreshEmbeddings: (input = {}) => service.refreshEmbeddings(input)
    },
    providers: {
      status: (env = process.env) => service.providerStatus(env),
      models: () => service.modelRegistry()
    },
    embeddings: {
      status: () => service.embeddingStatus(),
      index: (input = {}) => service.indexEmbeddings(input),
      search: (input) => service.semanticSearch(input)
    },
    search: (input) => service.search(input),
    retrieveContext: (input) => service.retrieveContext(input),
    ask: (prompt, input = {}) => service.runPrompt({ ...input, prompt }),
    build: (prompt, input = {}) => service.runPrompt({ ...input, prompt }),
    web: {
      search: (input) => service.webSearch(input)
    }
  };
}
var createKnowledgeSdk = createKnowledgeClient;
export {
  writeKnowledgeConfig,
  workspaceForHome,
  validateStorageConfig,
  upsertKnowledgeMachine,
  syncTablesFromSnapshot,
  syncArtifactsFromSnapshot,
  storageSync,
  storagePush,
  storagePull,
  searchVectorIndex,
  saveKnowledgeAuth,
  runStorageMigrations,
  runProviderWebSearch,
  runKnowledgePrompt,
  revisionIdForSourceRef,
  retrieveKnowledgeContext,
  resolveTables,
  resolveStorageContract,
  resolveScopedWorkspace,
  resolveOpenFilesSource,
  resolveModelRef,
  resolveKnowledgeApiUrl,
  resolveEmbeddingModelRef,
  reindexHealth,
  refreshMachineRegistryFromTopology,
  refreshEmbeddingIndex,
  recordKnowledgeSyncConflict,
  readKnowledgeConfig,
  providerStatus,
  providerSettings,
  providerCredentialStatus,
  projectKnowledgeHome,
  preflightKnowledgeMachine,
  parseStorageTables,
  parseSourceRef,
  parseModelRef,
  normalizeRemoteKnowledgeRunContract,
  normalizeKnowledgeApiOrigin,
  normalizeArtifactKey,
  modelAliases,
  listModelRegistry,
  listKnowledgeSyncConflicts,
  listKnowledgeMachines,
  lintWiki,
  languageModelFor,
  knowledgeRegistryContract,
  knowledgeAuthStatus,
  knowledgeAuthPath,
  isSupportedSourceRef,
  ingestSourceRef,
  ingestOpenFilesManifestItems,
  ingestOpenFilesManifest,
  indexKnowledgeEmbeddings,
  hybridSearch,
  hashArtifactBody,
  globalKnowledgeHome,
  getSyncMetaAll,
  getStorageStatus,
  getStoragePg,
  getStorageMode,
  getStorageDatabaseUrl,
  getStorageDatabaseEnvName,
  getStorageDatabaseEnv,
  getKnowledgeSyncStatus,
  getKnowledgeAuth,
  getKnowledgeApiKey,
  fileAnswerToWiki,
  ensureKnowledgeWorkspace,
  enqueueMissingEmbeddings,
  embeddingIndexStatus,
  embedTexts,
  discoverKnowledgeMachineTopology,
  defaultKnowledgeConfig,
  createKnowledgeSyncSnapshot,
  createKnowledgeSyncBundle,
  createKnowledgeService,
  createKnowledgeSdk,
  createKnowledgeClient,
  createArtifactStore,
  createAiSdkProviderRegistry,
  consumeOpenFilesOutbox,
  compileWikiPage,
  clearKnowledgeAuth,
  catalogSourceUriForRef,
  canonicalHasnaXyzKnowledgeStorage,
  artifactKindForKey,
  applyKnowledgeSyncBundle,
  STORAGE_TABLES,
  STORAGE_MODE_ENV,
  STORAGE_DATABASE_ENV,
  S3ArtifactStore,
  RemoteKnowledgeClient,
  REMOTE_KNOWLEDGE_CONTRACT_VERSION,
  LocalArtifactStore,
  KnowledgeService,
  KNOWLEDGE_SYNC_TABLES,
  CURRENT_SCHEMA_VERSION as KNOWLEDGE_SYNC_SCHEMA_VERSION,
  KNOWLEDGE_SYNC_PROTOCOL_VERSION,
  KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION,
  KNOWLEDGE_STORAGE_TABLES,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_ENV,
  HASNA_XYZ_KNOWLEDGE_CANONICAL,
  HASNA_KNOWLEDGE_APP_PATH,
  DEFAULT_KNOWLEDGE_API_URL,
  DEFAULT_EMBEDDING_MODEL_REF,
  DEFAULT_EMBEDDING_DIMENSIONS
};
