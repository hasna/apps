import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const LOCK_EXPIRY_MINUTES = 30;

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestTodosDb(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".todos", "todos.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getDbPath(): string {
  // 1. Environment variable override
  if (process.env["TODOS_DB_PATH"]) {
    return process.env["TODOS_DB_PATH"];
  }

  // 2. Per-project: .todos/todos.db in cwd or any parent (incl. repo root)
  const cwd = process.cwd();
  const nearest = findNearestTodosDb(cwd);
  if (nearest) return nearest;

  // 3. Explicit project scope (force repo root)
  if (process.env["TODOS_DB_SCOPE"] === "project") {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return join(gitRoot, ".todos", "todos.db");
    }
  }

  // 4. Default: ~/.todos/todos.db
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".todos", "todos.db");
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const MIGRATIONS = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    agent_id TEXT,
    assigned_to TEXT,
    session_id TEXT,
    working_dir TEXT,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    locked_by TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id != depends_on)
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    session_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    working_dir TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
  CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO _migrations (id) VALUES (1);
  `,
  // Migration 2: Add task_list_id to projects
  `
  ALTER TABLE projects ADD COLUMN task_list_id TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (2);
  `,
  // Migration 3: Task tags join table for exact tag filtering
  `
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (task_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (3);
  `,
  // Migration 4: Plans table and plan_id on tasks
  `
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
  CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  ALTER TABLE tasks ADD COLUMN plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (4);
  `,
  // Migration 5: Agents and task lists
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

  CREATE TABLE IF NOT EXISTS task_lists (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id);
  CREATE INDEX IF NOT EXISTS idx_task_lists_slug ON task_lists(slug);

  ALTER TABLE tasks ADD COLUMN task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON tasks(task_list_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (5);
  `,
];

let _db: Database | null = null;

export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath || getDbPath();
  ensureDir(path);

  _db = new Database(path, { create: true });

  // Enable WAL mode for concurrent access
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");
  _db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  runMigrations(_db);
  backfillTaskTags(_db);

  return _db;
}

function runMigrations(db: Database): void {
  // Check current migration level
  try {
    const result = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number | null } | null;
    const currentLevel = result?.max_id ?? 0;

    for (let i = currentLevel; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]!);
    }
  } catch {
    // _migrations table doesn't exist yet, run all migrations
    for (const migration of MIGRATIONS) {
      db.exec(migration);
    }
  }

  // Run table-existence-based migrations for DBs that may have
  // old SaaS migration IDs (5,6,7) but lack the new open-source tables
  ensureTableMigrations(db);
}

function ensureTableMigrations(db: Database): void {
  // Migration 5 (agents + task_lists) may be skipped on DBs that had
  // old SaaS migrations with the same IDs. Check by table existence.
  try {
    const hasAgents = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
    if (!hasAgents) {
      db.exec(MIGRATIONS[4]!); // Migration 5 is at index 4
    }
  } catch {
    // ignore
  }
}

function backfillTaskTags(db: Database): void {
  try {
    const count = db.query("SELECT COUNT(*) as count FROM task_tags").get() as { count: number } | null;
    if (count && count.count > 0) return;
  } catch {
    return;
  }

  try {
    const rows = db.query("SELECT id, tags FROM tasks WHERE tags IS NOT NULL AND tags != '[]'").all() as { id: string; tags: string | null }[];
    if (rows.length === 0) return;

    const insert = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
    for (const row of rows) {
      if (!row.tags) continue;
      let tags: string[] = [];
      try {
        tags = JSON.parse(row.tags) as string[];
      } catch {
        continue;
      }
      for (const tag of tags) {
        if (tag) insert.run(row.id, tag);
      }
    }
  } catch {
    // Best-effort backfill only
  }
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDatabase(): void {
  _db = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function isLockExpired(lockedAt: string | null): boolean {
  if (!lockedAt) return true;
  const lockTime = new Date(lockedAt).getTime();
  const expiryMs = LOCK_EXPIRY_MINUTES * 60 * 1000;
  return Date.now() - lockTime > expiryMs;
}

export function lockExpiryCutoff(nowMs = Date.now()): string {
  const expiryMs = LOCK_EXPIRY_MINUTES * 60 * 1000;
  return new Date(nowMs - expiryMs).toISOString();
}

export function clearExpiredLocks(db: Database): void {
  const cutoff = lockExpiryCutoff();
  db.run("UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE locked_at IS NOT NULL AND locked_at < ?", [cutoff]);
}

export function resolvePartialId(db: Database, table: string, partialId: string): string | null {
  if (partialId.length >= 36) {
    // Full UUID
    const row = db.query(`SELECT id FROM ${table} WHERE id = ?`).get(partialId) as { id: string } | null;
    return row?.id ?? null;
  }

  // Partial match (prefix)
  const rows = db.query(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${partialId}%`) as { id: string }[];
  if (rows.length === 1) {
    return rows[0]!.id;
  }
  if (rows.length > 1) {
    // Ambiguous - return null
    return null;
  }
  return null;
}
