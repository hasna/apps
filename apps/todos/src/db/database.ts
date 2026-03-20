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
  // Migration 6: Task prefixes and short IDs
  `
  ALTER TABLE projects ADD COLUMN task_prefix TEXT;
  ALTER TABLE projects ADD COLUMN task_counter INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE tasks ADD COLUMN short_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id) WHERE short_id IS NOT NULL;

  INSERT OR IGNORE INTO _migrations (id) VALUES (6);
  `,
  // Migration 7: Add due_at column to tasks
  `
  ALTER TABLE tasks ADD COLUMN due_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
  INSERT OR IGNORE INTO _migrations (id) VALUES (7);
  `,
  // Migration 8: Add role column to agents
  `
  ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'agent';
  INSERT OR IGNORE INTO _migrations (id) VALUES (8);
  `,
  // Migration 9: Add task_list_id and agent_id to plans
  `
  ALTER TABLE plans ADD COLUMN task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
  ALTER TABLE plans ADD COLUMN agent_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_plans_task_list ON plans(task_list_id);
  CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (9);
  `,
  // Migration 10: Audit log, webhooks, task templates, estimated time, approval workflow, agent permissions
  `
  CREATE TABLE IF NOT EXISTS task_history (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    agent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(agent_id);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title_pattern TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium',
    tags TEXT DEFAULT '[]',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER;
  ALTER TABLE tasks ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN approved_by TEXT;
  ALTER TABLE tasks ADD COLUMN approved_at TEXT;

  ALTER TABLE agents ADD COLUMN permissions TEXT DEFAULT '["*"]';

  INSERT OR IGNORE INTO _migrations (id) VALUES (10);
  `,
  // Migration 11: Org chart — agent hierarchy
  `
  ALTER TABLE agents ADD COLUMN reports_to TEXT;
  ALTER TABLE agents ADD COLUMN title TEXT;
  ALTER TABLE agents ADD COLUMN level TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (11);
  `,
  // Migration 12: Orgs
  `
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE agents ADD COLUMN org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;
  ALTER TABLE projects ADD COLUMN org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (12);
  `,
  // Migration 13: Recurrence fields
  `
  ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;
  ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule ON tasks(recurrence_rule) WHERE recurrence_rule IS NOT NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (13);
  `,
  // Migration 14: Progress tracking on comments
  `
  ALTER TABLE task_comments ADD COLUMN type TEXT DEFAULT 'comment' CHECK(type IN ('comment', 'progress', 'note'));
  ALTER TABLE task_comments ADD COLUMN progress_pct INTEGER CHECK(progress_pct IS NULL OR (progress_pct >= 0 AND progress_pct <= 100));
  INSERT OR IGNORE INTO _migrations (id) VALUES (14);
  `,
  // Migration 15: FTS5 full-text search index
  `
  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    task_id UNINDEXED,
    title,
    description,
    tags,
    tokenize='unicode61 remove_diacritics 2'
  );

  INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
  SELECT t.rowid, t.id, t.title, COALESCE(t.description, ''),
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = t.id), '')
  FROM tasks t;

  CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    VALUES (new.rowid, new.id, new.title, COALESCE(new.description, ''), '');
  END;

  CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE OF title, description ON tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.rowid;
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    SELECT new.rowid, new.id, new.title, COALESCE(new.description, ''),
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = new.id), '');
  END;

  CREATE TRIGGER IF NOT EXISTS task_tags_fts_ai AFTER INSERT ON task_tags BEGIN
    DELETE FROM tasks_fts WHERE rowid = (SELECT rowid FROM tasks WHERE id = new.task_id);
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    SELECT t.rowid, t.id, t.title, COALESCE(t.description, ''),
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = t.id), '')
    FROM tasks t WHERE t.id = new.task_id;
  END;

  CREATE TRIGGER IF NOT EXISTS task_tags_fts_ad AFTER DELETE ON task_tags BEGIN
    DELETE FROM tasks_fts WHERE rowid = (SELECT rowid FROM tasks WHERE id = old.task_id);
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    SELECT t.rowid, t.id, t.title, COALESCE(t.description, ''),
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = t.id), '')
    FROM tasks t WHERE t.id = old.task_id;
  END;

  INSERT OR IGNORE INTO _migrations (id) VALUES (15);
  `,
  // Migration 16: Task spawning — completing a task auto-creates next task from a template
  `
  ALTER TABLE tasks ADD COLUMN spawns_template_id TEXT REFERENCES task_templates(id) ON DELETE SET NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (16);
  `,
  // Migration 17: Agent session binding — prevents name squatting across sessions
  `
  ALTER TABLE agents ADD COLUMN session_id TEXT;
  ALTER TABLE agents ADD COLUMN working_dir TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (17);
  `,
  // Migration 18: Confidence scores on task completion
  `
  ALTER TABLE tasks ADD COLUMN confidence REAL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (18);
  `,
  // Migration 19: Task provenance — reason and spawned_from_session
  `
  ALTER TABLE tasks ADD COLUMN reason TEXT;
  ALTER TABLE tasks ADD COLUMN spawned_from_session TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (19);
  `,
  // Migration 20: Handoffs table for agent session handoffs
  `
  CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    completed TEXT,
    in_progress TEXT,
    blockers TEXT,
    next_steps TEXT,
    created_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO _migrations (id) VALUES (20);
  `,
  // Migration 21: Task checklists — ordered sub-steps per task
  `
  CREATE TABLE IF NOT EXISTS task_checklists (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (21);
  `,
  // Migration 22: Project sources — named data sources (S3, GDrive, local, etc.) per project
  `
  CREATE TABLE IF NOT EXISTS project_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT NOT NULL,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_sources_type ON project_sources(type);
  INSERT OR IGNORE INTO _migrations (id) VALUES (22);
  `,
  // Migration 23: Agent project session locking
  `
  ALTER TABLE agents ADD COLUMN active_project_id TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (23);
  `,
  // Migration 24: Resource locks table for multi-agent coordination
  `
  CREATE TABLE IF NOT EXISTS resource_locks (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    lock_type TEXT NOT NULL DEFAULT 'advisory',
    locked_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(resource_type, resource_id, lock_type)
  );
  CREATE INDEX IF NOT EXISTS idx_resource_locks_type_id ON resource_locks(resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_resource_locks_agent ON resource_locks(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (24);
  `,
  // Migration 25: Task files — track which files are associated with each task
  `
  CREATE TABLE IF NOT EXISTS task_files (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    agent_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_files_path ON task_files(path);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_files_task_path ON task_files(task_id, path);
  INSERT OR IGNORE INTO _migrations (id) VALUES (25);
  `,
  // Migration 26: Task provenance — who assigned this task and from which project
  `
  ALTER TABLE tasks ADD COLUMN assigned_by TEXT;
  ALTER TABLE tasks ADD COLUMN assigned_from_project TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by);
  INSERT OR IGNORE INTO _migrations (id) VALUES (26);
  `,
  // Migration 27: Semantic task relationships
  `
  CREATE TABLE IF NOT EXISTS task_relationships (
    id TEXT PRIMARY KEY,
    source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN ('related_to', 'conflicts_with', 'similar_to', 'duplicates', 'supersedes', 'modifies_same_file')),
    metadata TEXT DEFAULT '{}',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (source_task_id != target_task_id)
  );
  CREATE INDEX IF NOT EXISTS idx_task_rel_source ON task_relationships(source_task_id);
  CREATE INDEX IF NOT EXISTS idx_task_rel_target ON task_relationships(target_task_id);
  CREATE INDEX IF NOT EXISTS idx_task_rel_type ON task_relationships(relationship_type);
  INSERT OR IGNORE INTO _migrations (id) VALUES (27);
  `,
  // Migration 28: Knowledge graph edges table
  `
  CREATE TABLE IF NOT EXISTS kg_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, source_type, target_id, target_type, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_kg_source ON kg_edges(source_id, source_type);
  CREATE INDEX IF NOT EXISTS idx_kg_target ON kg_edges(target_id, target_type);
  CREATE INDEX IF NOT EXISTS idx_kg_relation ON kg_edges(relation_type);
  INSERT OR IGNORE INTO _migrations (id) VALUES (28);
  `,
  // Migration 29: Agent capabilities for capability-based task routing
  `
  ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT '[]';
  INSERT OR IGNORE INTO _migrations (id) VALUES (29);
  `,
  // Migration 30: Agent soft delete — status column (active/archived)
  `
  ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived'));
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  INSERT OR IGNORE INTO _migrations (id) VALUES (30);
  `,
  // Migration 31: Per-project agent roles — override/extend global agent roles per project
  `
  CREATE TABLE IF NOT EXISTS project_agent_roles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    is_lead INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, agent_id, role)
  );
  CREATE INDEX IF NOT EXISTS idx_project_agent_roles_project ON project_agent_roles(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_agent_roles_agent ON project_agent_roles(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (31);
  `,
  // Migration 32: Task commits — link git commit SHAs to tasks
  `
  CREATE TABLE IF NOT EXISTS task_commits (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    sha TEXT NOT NULL,
    message TEXT,
    author TEXT,
    files_changed TEXT,
    committed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(task_id, sha)
  );
  CREATE INDEX IF NOT EXISTS idx_task_commits_task ON task_commits(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_commits_sha ON task_commits(sha);
  INSERT OR IGNORE INTO _migrations (id) VALUES (32);
  `,
  // Migration 33: File locks — first-class exclusive locks on file paths
  `
  CREATE TABLE IF NOT EXISTS file_locks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_file_locks_path ON file_locks(path);
  CREATE INDEX IF NOT EXISTS idx_file_locks_agent ON file_locks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at);
  INSERT OR IGNORE INTO _migrations (id) VALUES (33);
  `,
  // Migration 34: Add started_at to tasks for duration tracking
  `
  ALTER TABLE tasks ADD COLUMN started_at TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (34);
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
      try {
        db.exec(MIGRATIONS[i]!);
      } catch {
        // Migration partially failed (e.g. ALTER TABLE on existing column).
        // ensureSchema below will fix any missing pieces.
      }
    }
  } catch {
    // _migrations table doesn't exist yet, run all migrations
    for (const migration of MIGRATIONS) {
      try {
        db.exec(migration);
      } catch {
        // Same — partial failure handled by ensureSchema
      }
    }
  }

  // Ensure ALL schema elements exist regardless of migration history.
  // This is the safety net: if any migration partially failed, or if the
  // user upgraded from a very old version, this fills in all gaps.
  // It's idempotent — safe to run on every startup.
  ensureSchema(db);
}

function ensureSchema(db: Database): void {
  // Helper: add a column if it doesn't exist (no-op if it does)
  const ensureColumn = (table: string, column: string, type: string) => {
    try { db.query(`SELECT ${column} FROM ${table} LIMIT 0`).get(); }
    catch { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch {} }
  };

  // Helper: create a table if it doesn't exist
  const ensureTable = (name: string, sql: string) => {
    try {
      const exists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (!exists) db.exec(sql);
    } catch {}
  };

  // Helper: create an index if it doesn't exist
  const ensureIndex = (sql: string) => {
    try { db.exec(sql); } catch {}
  };

  // ── Tables ──
  ensureTable("orgs", `
    CREATE TABLE orgs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("agents", `
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      role TEXT DEFAULT 'agent', permissions TEXT DEFAULT '["*"]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_lists", `
    CREATE TABLE task_lists (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, slug)
    )`);

  ensureTable("plans", `
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      task_list_id TEXT, agent_id TEXT,
      name TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_tags", `
    CREATE TABLE task_tags (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag TEXT NOT NULL, PRIMARY KEY (task_id, tag)
    )`);

  ensureTable("task_history", `
    CREATE TABLE task_history (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      action TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("webhooks", `
    CREATE TABLE webhooks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
      secret TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_templates", `
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, title_pattern TEXT NOT NULL,
      description TEXT, priority TEXT DEFAULT 'medium', tags TEXT DEFAULT '[]',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_checklists", `
    CREATE TABLE task_checklists (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("project_sources", `
    CREATE TABLE project_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      uri TEXT NOT NULL,
      description TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_relationships", `
    CREATE TABLE task_relationships (
      id TEXT PRIMARY KEY,
      source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (source_task_id != target_task_id)
    )`);

  ensureTable("kg_edges", `
    CREATE TABLE kg_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_id, source_type, target_id, target_type, relation_type)
    )`);

  // ── Columns (ALTER TABLE is not idempotent in SQLite, so check first) ──

  // Projects
  ensureColumn("projects", "task_list_id", "TEXT");
  ensureColumn("projects", "task_prefix", "TEXT");
  ensureColumn("projects", "task_counter", "INTEGER NOT NULL DEFAULT 0");

  // Tasks
  ensureColumn("tasks", "plan_id", "TEXT REFERENCES plans(id) ON DELETE SET NULL");
  ensureColumn("tasks", "task_list_id", "TEXT REFERENCES task_lists(id) ON DELETE SET NULL");
  ensureColumn("tasks", "short_id", "TEXT");
  ensureColumn("tasks", "due_at", "TEXT");
  ensureColumn("tasks", "estimated_minutes", "INTEGER");
  ensureColumn("tasks", "requires_approval", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("tasks", "approved_by", "TEXT");
  ensureColumn("tasks", "approved_at", "TEXT");
  ensureColumn("tasks", "recurrence_rule", "TEXT");
  ensureColumn("tasks", "recurrence_parent_id", "TEXT REFERENCES tasks(id) ON DELETE SET NULL");
  ensureColumn("tasks", "confidence", "REAL");
  ensureColumn("tasks", "reason", "TEXT");
  ensureColumn("tasks", "spawned_from_session", "TEXT");
  ensureColumn("tasks", "assigned_by", "TEXT");
  ensureColumn("tasks", "assigned_from_project", "TEXT");
  ensureColumn("tasks", "started_at", "TEXT");

  // Agents
  ensureColumn("agents", "role", "TEXT DEFAULT 'agent'");
  ensureColumn("agents", "permissions", 'TEXT DEFAULT \'["*"]\'');
  ensureColumn("agents", "reports_to", "TEXT");
  ensureColumn("agents", "title", "TEXT");
  ensureColumn("agents", "level", "TEXT");
  ensureColumn("agents", "org_id", "TEXT");
  ensureColumn("agents", "capabilities", "TEXT DEFAULT '[]'");

  // Projects
  ensureColumn("projects", "org_id", "TEXT");

  // Plans
  ensureColumn("plans", "task_list_id", "TEXT");
  ensureColumn("plans", "agent_id", "TEXT");

  // Comments
  ensureColumn("task_comments", "type", "TEXT DEFAULT 'comment'");
  ensureColumn("task_comments", "progress_pct", "INTEGER");

  // ── Indexes ──
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON tasks(task_list_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at)");
  ensureIndex("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id) WHERE short_id IS NOT NULL");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_lists_slug ON task_lists(slug)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_task_list ON plans(task_list_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule ON tasks(recurrence_rule) WHERE recurrence_rule IS NOT NULL");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_sources_type ON project_sources(type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by)");

  // Task relationships indexes
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_rel_source ON task_relationships(source_task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_rel_target ON task_relationships(target_task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_rel_type ON task_relationships(relationship_type)");

  // Knowledge graph indexes
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_kg_source ON kg_edges(source_id, source_type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_kg_target ON kg_edges(target_id, target_type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_kg_relation ON kg_edges(relation_type)");
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

  // Partial match (prefix) on id column
  const rows = db.query(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${partialId}%`) as { id: string }[];
  if (rows.length === 1) {
    return rows[0]!.id;
  }
  if (rows.length > 1) {
    // Ambiguous - return null
    return null;
  }

  // For tasks table, also try matching on short_id (e.g. "OPE-00006")
  if (table === "tasks") {
    const shortIdRows = db.query("SELECT id FROM tasks WHERE short_id = ?").all(partialId) as { id: string }[];
    if (shortIdRows.length === 1) {
      return shortIdRows[0]!.id;
    }
  }

  return null;
}
