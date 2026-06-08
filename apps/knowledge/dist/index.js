// @bun
var __require = import.meta.require;

// src/artifact-store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative, sep } from "path";
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
    mkdirSync(root, { recursive: true });
  }
  async put(entry) {
    const key = normalizeArtifactKey(entry.key);
    const path = join(this.root, key);
    assertInside(this.root, path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.body);
    return { key, uri: `file://${path}` };
  }
  async getText(key) {
    const normalizedKey = normalizeArtifactKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return readFileSync(path, "utf8");
  }
  async exists(key) {
    const normalizedKey = normalizeArtifactKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return existsSync(path);
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

// src/auth.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { homedir } from "os";
import { dirname as dirname2, join as join2 } from "path";
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
  const root = env.HASNA_KNOWLEDGE_AUTH_DIR ?? join2(homedir(), ".hasna", "knowledge");
  return join2(root, "auth.json");
}
function resolveKnowledgeApiUrl(config, env = process.env) {
  return normalizeKnowledgeApiOrigin(env.KNOWLEDGE_API_URL ?? config?.hosted?.api_url ?? DEFAULT_KNOWLEDGE_API_URL);
}
function getKnowledgeAuth(env = process.env) {
  try {
    const path = knowledgeAuthPath(env);
    if (!existsSync2(path))
      return null;
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
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
  mkdirSync2(dirname2(path), { recursive: true, mode: 448 });
  writeFileSync2(path, `${JSON.stringify(stored, null, 2)}
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

// src/knowledge-db.ts
import { Database } from "bun:sqlite";

// src/workspace.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname3, join as join3, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join3(".hasna", "apps", "knowledge");
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
  return join3(homedir2(), ".hasna", "apps", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function workspaceForHome(home) {
  return {
    home,
    configPath: join3(home, "config.json"),
    jsonStorePath: join3(home, "db.json"),
    knowledgeDbPath: join3(home, "knowledge.db"),
    artifactsDir: join3(home, "artifacts"),
    cacheDir: join3(home, "cache"),
    exportsDir: join3(home, "exports"),
    indexesDir: join3(home, "indexes"),
    logsDir: join3(home, "logs"),
    runsDir: join3(home, "runs"),
    schemasDir: join3(home, "schemas"),
    wikiDir: join3(home, "wiki")
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
  mkdirSync3(workspace.home, { recursive: true });
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
    mkdirSync3(dir, { recursive: true });
  }
  if (!existsSync3(workspace.configPath)) {
    writeFileSync3(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
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
  mkdirSync3(dirname3(path), { recursive: true });
}
function readKnowledgeConfig(path) {
  const raw = readFileSync3(path, "utf8");
  return JSON.parse(raw);
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  writeFileSync3(path, `${JSON.stringify(config, null, 2)}
`);
}

// src/knowledge-db.ts
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
      reindex_queue: count(db, "reindex_queue")
    };
  } finally {
    db.close();
  }
}

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
function eventType(event) {
  return (asString(event.event) ?? asString(event.type) ?? asString(event.action) ?? asString(event.change_type) ?? "changed").toLowerCase();
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
  return ["move", "moved", "rename", "renamed", "path_changed"].includes(eventType2);
}
function isPermissionEvent(eventType2) {
  return ["permission", "permissions", "permission_changed", "acl_changed"].includes(eventType2);
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
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asString3(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function sourceFromRecord(value) {
  const record = asRecord(value);
  const url = asString3(record.url) ?? asString3(record.uri) ?? asString3(record.sourceUrl);
  if (!url)
    return null;
  return {
    url,
    title: asString3(record.title) ?? asString3(record.name),
    snippet: asString3(record.snippet) ?? asString3(record.text) ?? asString3(record.description),
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
  const record = asRecord(value);
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

// src/wiki-compiler.ts
import { createHash as createHash10, randomUUID as randomUUID8 } from "crypto";

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

// src/wiki-compiler.ts
function stableId6(prefix, value) {
  return `${prefix}_${createHash10("sha256").update(value).digest("hex").slice(0, 20)}`;
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
      stableId6("cit", `${pageId}\x00${citation.source_uri}\x00${citation.chunk_id ?? randomUUID8()}`),
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
import { createHash as createHash11 } from "crypto";
function todayParts2(now) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return { year, month, day };
}
function stableId7(prefix, value) {
  return `${prefix}_${createHash11("sha256").update(value).digest("hex").slice(0, 20)}`;
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
  searchVectorIndex,
  saveKnowledgeAuth,
  runProviderWebSearch,
  runKnowledgePrompt,
  revisionIdForSourceRef,
  retrieveKnowledgeContext,
  resolveStorageContract,
  resolveScopedWorkspace,
  resolveOpenFilesSource,
  resolveModelRef,
  resolveKnowledgeApiUrl,
  resolveEmbeddingModelRef,
  reindexHealth,
  refreshEmbeddingIndex,
  readKnowledgeConfig,
  providerStatus,
  providerSettings,
  providerCredentialStatus,
  projectKnowledgeHome,
  parseSourceRef,
  parseModelRef,
  normalizeRemoteKnowledgeRunContract,
  normalizeKnowledgeApiOrigin,
  normalizeArtifactKey,
  modelAliases,
  listModelRegistry,
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
  getKnowledgeAuth,
  getKnowledgeApiKey,
  fileAnswerToWiki,
  ensureKnowledgeWorkspace,
  enqueueMissingEmbeddings,
  embeddingIndexStatus,
  embedTexts,
  defaultKnowledgeConfig,
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
  S3ArtifactStore,
  RemoteKnowledgeClient,
  REMOTE_KNOWLEDGE_CONTRACT_VERSION,
  LocalArtifactStore,
  KnowledgeService,
  HASNA_XYZ_KNOWLEDGE_CANONICAL,
  HASNA_KNOWLEDGE_APP_PATH,
  DEFAULT_KNOWLEDGE_API_URL,
  DEFAULT_EMBEDDING_MODEL_REF,
  DEFAULT_EMBEDDING_DIMENSIONS
};
