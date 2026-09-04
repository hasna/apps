import { Database } from "bun:sqlite"
import { join } from "path"
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import { effectiveHome, getDataRoot } from "../lib/paths.js"

let _db: Database | null = null

export type PromptsActiveStorage = "local-sqlite"
export type PromptsRegistryState =
  | "local-only"
  | "remote-configured-local-fallback"
  | "remote-requested-local-fallback"

export interface PromptRegistryDiagnostics {
  active_storage: PromptsActiveStorage
  registry_state: PromptsRegistryState
  local: {
    db_path: string
    scope: "home" | "project" | "custom"
    storage: "SQLite"
  }
  remote: {
    requested: boolean
    configured: boolean
    postgres: {
      configured: boolean
      env: "PROMPTS_REGISTRY_POSTGRES_URL"
    }
    object_storage: {
      configured: boolean
      provider: "s3" | "none"
      bucket_configured: boolean
      bucket_env: "PROMPTS_REGISTRY_S3_BUCKET"
    }
    aws: {
      region_configured: boolean
      region_env: "PROMPTS_REGISTRY_AWS_REGION"
    }
  }
  sync: {
    strategy: "local-first"
    reads: "local SQLite"
    writes: "local SQLite"
    remote_mutation: false
    reason: string
  }
  warnings: string[]
}

export interface DbPathOptions {
  migrateLegacy?: boolean
}

/**
 * Retired selector variables (deployment modes were removed per the owner
 * directive 2026-07-29). Prompts selects its backend by URL/key presence only;
 * a leftover mode variable is a hard error, never a selector. The registry
 * configuration keys (PROMPTS_REGISTRY_*) are NOT retired — they feed the
 * presence-based diagnostics below.
 */
const RETIRED_PROMPTS_SELECTOR_KEYS = [
  "HASNA_PROMPTS_STORAGE_MODE",
  "PROMPTS_STORAGE_MODE",
  "HASNA_PROMPTS_MODE",
  "PROMPTS_MODE",
  "HASNA_PROMPTS_BACKEND",
  "PROMPTS_BACKEND",
  "HASNA_PROMPTS_LOCAL",
  "PROMPTS_LOCAL",
  "HASNA_PROMPTS_SELF_HOSTED",
  "PROMPTS_SELF_HOSTED",
  "HASNA_PROMPTS_CLOUD",
  "PROMPTS_CLOUD",
] as const

export function assertNoRetiredSelectors(env: NodeJS.ProcessEnv = process.env): void {
  const found = RETIRED_PROMPTS_SELECTOR_KEYS.filter((key) => (env[key] ?? "").trim() !== "")
  if (found.length === 0) return
  throw new Error(
    "HASNA_PROMPTS_STORAGE_MODE is retired and must be removed (deployment modes no longer exist; prompts selects its backend by URL/key). " +
      `Retired variable${found.length === 1 ? "" : "s"} still set: ${found.join(", ")}.`
  )
}

export function getPromptRegistryDiagnostics(): PromptRegistryDiagnostics {
  assertNoRetiredSelectors()
  const dbPath = getDbPath({ migrateLegacy: false })
  const remotePostgresConfigured = Boolean(process.env["PROMPTS_REGISTRY_POSTGRES_URL"])
  const bucketConfigured = Boolean(process.env["PROMPTS_REGISTRY_S3_BUCKET"])
  const regionConfigured = Boolean(process.env["PROMPTS_REGISTRY_AWS_REGION"])
  const remoteConfigured = remotePostgresConfigured || bucketConfigured || regionConfigured
  const registryState: PromptsRegistryState = remoteConfigured
    ? "remote-configured-local-fallback"
    : "local-only"

  const reason =
    registryState === "local-only"
      ? "No remote registry configuration is present, so reads and writes use the local SQLite store."
      : "Remote registry configuration is present, but this package has not been given a prompts-owned remote runtime, so reads and writes stay local."

  return {
    active_storage: "local-sqlite",
    registry_state: registryState,
    local: {
      db_path: dbPath,
      scope: resolveLocalScope(dbPath),
      storage: "SQLite",
    },
    remote: {
      requested: false,
      configured: remoteConfigured,
      postgres: {
        configured: remotePostgresConfigured,
        env: "PROMPTS_REGISTRY_POSTGRES_URL",
      },
      object_storage: {
        configured: bucketConfigured,
        provider: bucketConfigured ? "s3" : "none",
        bucket_configured: bucketConfigured,
        bucket_env: "PROMPTS_REGISTRY_S3_BUCKET",
      },
      aws: {
        region_configured: regionConfigured,
        region_env: "PROMPTS_REGISTRY_AWS_REGION",
      },
    },
    sync: {
      strategy: "local-first",
      reads: "local SQLite",
      writes: "local SQLite",
      remote_mutation: false,
      reason,
    },
    warnings: buildStorageWarnings(remoteConfigured, bucketConfigured, regionConfigured),
  }
}

export function getDbPath(options: DbPathOptions = {}): string {
  const migrateLegacy = options.migrateLegacy ?? true

  // Support env var overrides
  const envPath = process.env["HASNA_PROMPTS_DB_PATH"] ?? process.env["PROMPTS_DB_PATH"]
  if (envPath) return envPath

  // Walk up looking for .prompts/prompts.db (project-local scope)
  if (process.env["PROMPTS_DB_SCOPE"] === "project") {
    let dir = process.cwd()
    while (true) {
      const candidate = join(dir, ".prompts", "prompts.db")
      if (existsSync(join(dir, ".git"))) {
        return candidate
      }
      const parent = join(dir, "..")
      if (parent === dir) break
      dir = parent
    }
  }

  // Global: the effective data root's prompts.db (with backward compat from
  // ~/.prompts/). The data root resolves through the @hasna/paths resolver
  // with gated legacy adoption — see src/lib/paths.ts.
  const newDir = getDataRoot()
  const oldDir = join(effectiveHome(), ".prompts")

  // Auto-migrate from old location without overwriting newer target files.
  if (migrateLegacy && existsSync(oldDir)) {
    try {
      mergeDirectoryContents(oldDir, newDir)
    } catch {
      // Fall through to create new dir
    }
  }

  return join(newDir, "prompts.db")
}

function resolveLocalScope(dbPath: string): PromptRegistryDiagnostics["local"]["scope"] {
  if (process.env["HASNA_PROMPTS_DB_PATH"] || process.env["PROMPTS_DB_PATH"]) return "custom"
  if (dbPath.includes(`${join(".prompts", "prompts.db")}`)) return "project"
  return "home"
}

function buildStorageWarnings(
  remoteConfigured: boolean,
  bucketConfigured: boolean,
  regionConfigured: boolean
): string[] {
  const warnings: string[] = []
  if (remoteConfigured) {
    warnings.push("Remote registry configuration is detected but this package will not perform remote reads, writes, migrations, or AWS mutations.")
  }
  if (bucketConfigured && !regionConfigured) {
    warnings.push("An S3 bucket is configured without a registry AWS region.")
  }
  return warnings
}

function mergeDirectoryContents(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry)
    const targetPath = join(targetDir, entry)
    const sourceStat = statSync(sourcePath)
    if (sourceStat.isDirectory()) {
      mergeDirectoryContents(sourcePath, targetPath)
    } else if (!existsSync(targetPath)) {
      copyFileSync(sourcePath, targetPath)
    }
  }
}

export function getDatabase(): Database {
  assertNoRetiredSelectors()
  if (_db) return _db
  const dbPath = getDbPath()
  if (dbPath !== ":memory:") {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"))
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const db = new Database(dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA foreign_keys = ON")

  runMigrations(db)
  _db = db
  return db
}

export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// For tests — reset singleton
export function resetDatabase(): void {
  _db = null
}

function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    (db.query("SELECT name FROM _migrations").all() as Array<{ name: string }>).map((r) => r.name)
  )

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: "001_initial",
      sql: `
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO collections (id, name, description, created_at)
        VALUES ('default', 'default', 'Default collection', datetime('now'));

        CREATE TABLE IF NOT EXISTS prompts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          description TEXT,
          collection TEXT NOT NULL DEFAULT 'default' REFERENCES collections(name) ON UPDATE CASCADE,
          tags TEXT NOT NULL DEFAULT '[]',
          variables TEXT NOT NULL DEFAULT '[]',
          is_template INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'manual',
          version INTEGER NOT NULL DEFAULT 1,
          use_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS prompt_versions (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          version INTEGER NOT NULL,
          changed_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_prompts_collection ON prompts(collection);
        CREATE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source);
        CREATE INDEX IF NOT EXISTS idx_prompts_is_template ON prompts(is_template);
        CREATE INDEX IF NOT EXISTS idx_prompts_use_count ON prompts(use_count DESC);
        CREATE INDEX IF NOT EXISTS idx_prompts_last_used ON prompts(last_used_at DESC);
        CREATE INDEX IF NOT EXISTS idx_versions_prompt_id ON prompt_versions(prompt_id);
      `,
    },
    {
      name: "003_pinned",
      sql: `ALTER TABLE prompts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
    },
    {
      name: "004_projects",
      sql: `
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ALTER TABLE prompts ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_prompts_project_id ON prompts(project_id);
      `,
    },
    {
      name: "005_chaining",
      sql: `ALTER TABLE prompts ADD COLUMN next_prompt TEXT;`,
    },
    {
      name: "006_expiry",
      sql: `ALTER TABLE prompts ADD COLUMN expires_at TEXT;`,
    },
    {
      name: "007_usage_log",
      sql: `
        CREATE TABLE IF NOT EXISTS usage_log (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          used_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_usage_log_prompt_id ON usage_log(prompt_id);
        CREATE INDEX IF NOT EXISTS idx_usage_log_used_at ON usage_log(used_at);
      `,
    },
    {
      name: "008_schedules",
      sql: `
        CREATE TABLE IF NOT EXISTS prompt_schedules (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          prompt_slug TEXT NOT NULL,
          cron TEXT NOT NULL,
          vars TEXT NOT NULL DEFAULT '{}',
          agent_id TEXT,
          last_run_at TEXT,
          next_run_at TEXT NOT NULL,
          run_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_schedules_next_run ON prompt_schedules(next_run_at);
        CREATE INDEX IF NOT EXISTS idx_prompt_schedules_prompt_id ON prompt_schedules(prompt_id);
      `,
    },
    {
      name: "009_agents_focus",
      sql: `ALTER TABLE agents ADD COLUMN active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;`,
    },
    {
      name: "002_fts5",
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
          name,
          slug,
          title,
          body,
          description,
          tags,
          content='prompts',
          content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS prompts_fts_insert AFTER INSERT ON prompts BEGIN
          INSERT INTO prompts_fts(rowid, name, slug, title, body, description, tags)
          VALUES (new.rowid, new.name, new.slug, new.title, new.body, COALESCE(new.description,''), new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS prompts_fts_update AFTER UPDATE ON prompts BEGIN
          INSERT INTO prompts_fts(prompts_fts, rowid, name, slug, title, body, description, tags)
          VALUES ('delete', old.rowid, old.name, old.slug, old.title, old.body, COALESCE(old.description,''), old.tags);
          INSERT INTO prompts_fts(rowid, name, slug, title, body, description, tags)
          VALUES (new.rowid, new.name, new.slug, new.title, new.body, COALESCE(new.description,''), new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS prompts_fts_delete AFTER DELETE ON prompts BEGIN
          INSERT INTO prompts_fts(prompts_fts, rowid, name, slug, title, body, description, tags)
          VALUES ('delete', old.rowid, old.name, old.slug, old.title, old.body, COALESCE(old.description,''), old.tags);
        END;
      `,
    },
    {
      name: "009_feedback",
      sql: `CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), message TEXT NOT NULL, email TEXT, category TEXT DEFAULT 'general', version TEXT, machine_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`,
    },
    {
      name: "010_prompt_variables",
      sql: `
        CREATE TABLE IF NOT EXISTS prompt_variables (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'string',
          required INTEGER NOT NULL DEFAULT 1,
          default_value TEXT,
          description TEXT,
          validation TEXT,
          render_format TEXT NOT NULL DEFAULT 'json',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(prompt_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_variables_prompt_id ON prompt_variables(prompt_id);
      `,
    },
    {
      name: "011_prompt_labels",
      sql: `
        CREATE TABLE IF NOT EXISTS prompt_labels (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(prompt_id, key, value)
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_labels_key_value ON prompt_labels(key, value);
        CREATE INDEX IF NOT EXISTS idx_prompt_labels_prompt_id ON prompt_labels(prompt_id);
      `,
    },
    {
      name: "012_prompt_dependencies",
      sql: `
        CREATE TABLE IF NOT EXISTS prompt_dependencies (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          dependency_prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          dependency_slug TEXT NOT NULL,
          relation TEXT NOT NULL CHECK(relation IN ('parent','partial')),
          slot TEXT,
          pinned_version INTEGER,
          ordering INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_dependencies_prompt_id ON prompt_dependencies(prompt_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_dependencies_unique
          ON prompt_dependencies(prompt_id, dependency_prompt_id, relation, COALESCE(slot, ''));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_dependencies_one_parent
          ON prompt_dependencies(prompt_id) WHERE relation = 'parent';
      `,
    },
    {
      name: "013_render_receipts",
      sql: `
        CREATE TABLE IF NOT EXISTS render_receipts (
          id TEXT PRIMARY KEY,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          prompt_version INTEGER NOT NULL,
          resolved_sources TEXT NOT NULL DEFAULT '[]',
          render_hash TEXT NOT NULL,
          missing_vars TEXT NOT NULL DEFAULT '[]',
          used_defaults TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_render_receipts_prompt_id ON render_receipts(prompt_id);
      `,
    },
    {
      name: "014_dispatch_runs",
      sql: `
        CREATE TABLE IF NOT EXISTS dispatch_runs (
          id TEXT PRIMARY KEY,
          runtime TEXT NOT NULL,
          target TEXT,
          status TEXT NOT NULL,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          prompt_slug TEXT NOT NULL,
          prompt_version INTEGER NOT NULL,
          render_hash TEXT NOT NULL,
          vars_hash TEXT,
          resolved_references TEXT NOT NULL DEFAULT '[]',
          output_pointer TEXT,
          output_hash TEXT,
          output_bytes INTEGER NOT NULL DEFAULT 0,
          exit_code INTEGER,
          error_code TEXT,
          notes TEXT,
          started_at TEXT,
          finished_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_dispatch_runs_status ON dispatch_runs(status);
        CREATE INDEX IF NOT EXISTS idx_dispatch_runs_prompt ON dispatch_runs(prompt_id);
        CREATE INDEX IF NOT EXISTS idx_dispatch_runs_created ON dispatch_runs(created_at);
      `,
    },
  ]

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue
    db.exec(migration.sql)
    db.run("INSERT INTO _migrations (name) VALUES (?)", [migration.name])
  }
}

export function resolveProject(db: Database, idOrSlug: string): string | null {
  // 1. Exact ID
  const byId = db.query("SELECT id FROM projects WHERE id = ?").get(idOrSlug) as { id: string } | null
  if (byId) return byId.id

  // 2. Exact slug
  const bySlug = db.query("SELECT id FROM projects WHERE slug = ?").get(idOrSlug) as { id: string } | null
  if (bySlug) return bySlug.id

  // 3. Exact name (case-insensitive)
  const byName = db.query("SELECT id FROM projects WHERE lower(name) = ?").get(idOrSlug.toLowerCase()) as { id: string } | null
  if (byName) return byName.id

  // 4. Partial ID prefix
  const byPrefix = db
    .query("SELECT id FROM projects WHERE id LIKE ? LIMIT 2")
    .all(`${idOrSlug}%`) as Array<{ id: string }>
  if (byPrefix.length === 1 && byPrefix[0]) return byPrefix[0].id

  // 5. Slug prefix
  const bySlugPrefix = db
    .query("SELECT id FROM projects WHERE slug LIKE ? LIMIT 2")
    .all(`${idOrSlug}%`) as Array<{ id: string }>
  if (bySlugPrefix.length === 1 && bySlugPrefix[0]) return bySlugPrefix[0].id

  return null
}

export function hasFts(db: Database): boolean {
  return (
    db
      .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
      .get() !== null
  )
}

export function resolvePrompt(db: Database, idOrSlug: string): string | null {
  // 1. Exact ID
  const byId = db.query("SELECT id FROM prompts WHERE id = ?").get(idOrSlug) as { id: string } | null
  if (byId) return byId.id

  // 2. Exact slug
  const bySlug = db.query("SELECT id FROM prompts WHERE slug = ?").get(idOrSlug) as { id: string } | null
  if (bySlug) return bySlug.id

  // 3. Partial ID prefix (PRMT-001 → PRMT-00001)
  const byPrefix = db
    .query("SELECT id FROM prompts WHERE id LIKE ? LIMIT 2")
    .all(`${idOrSlug}%`) as Array<{ id: string }>
  if (byPrefix.length === 1 && byPrefix[0]) return byPrefix[0].id

  // 4. Slug prefix match (e.g. "ts-review" → "typescript-code-review")
  const bySlugPrefix = db
    .query("SELECT id FROM prompts WHERE slug LIKE ? LIMIT 2")
    .all(`${idOrSlug}%`) as Array<{ id: string }>
  if (bySlugPrefix.length === 1 && bySlugPrefix[0]) return bySlugPrefix[0].id

  // 5. Slug substring match
  const bySlugSub = db
    .query("SELECT id FROM prompts WHERE slug LIKE ? LIMIT 2")
    .all(`%${idOrSlug}%`) as Array<{ id: string }>
  if (bySlugSub.length === 1 && bySlugSub[0]) return bySlugSub[0].id

  // 6. Title substring match (case-insensitive)
  const byTitle = db
    .query("SELECT id FROM prompts WHERE lower(title) LIKE ? LIMIT 2")
    .all(`%${idOrSlug.toLowerCase()}%`) as Array<{ id: string }>
  if (byTitle.length === 1 && byTitle[0]) return byTitle[0].id

  return null
}
