import { SqliteAdapter as Database } from "@hasna/cloud"
import { join } from "path"
import { existsSync, mkdirSync, cpSync } from "fs"

let _db: Database | null = null

export function getDbPath(): string {
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

  // Global: ~/.hasna/prompts/prompts.db (with backward compat from ~/.prompts/)
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~"
  const newDir = join(home, ".hasna", "prompts")
  const oldDir = join(home, ".prompts")

  // Auto-migrate from old location if new dir doesn't exist yet
  if (!existsSync(newDir) && existsSync(oldDir)) {
    try {
      mkdirSync(join(home, ".hasna"), { recursive: true })
      cpSync(oldDir, newDir, { recursive: true })
    } catch {
      // Fall through to create new dir
    }
  }

  return join(newDir, "prompts.db")
}

export function getDatabase(): Database {
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
