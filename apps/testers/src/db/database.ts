import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

let db: Database | null = null;

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

function shortUuid(): string {
  return uuid().slice(0, 8);
}

function resolveDbPath(): string {
  const envPath = process.env["TESTERS_DB_PATH"];
  if (envPath) return envPath;
  const dir = join(homedir(), ".testers");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "testers.db");
}

const MIGRATIONS: string[] = [
  // Migration 1: Core tables
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    role TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL UNIQUE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
    model TEXT,
    timeout_ms INTEGER,
    target_path TEXT,
    requires_auth INTEGER NOT NULL DEFAULT 0,
    auth_config TEXT,
    metadata TEXT DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','passed','failed','cancelled')),
    url TEXT NOT NULL,
    model TEXT NOT NULL,
    headed INTEGER NOT NULL DEFAULT 0,
    parallel INTEGER NOT NULL DEFAULT 1,
    total INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    metadata TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'skipped' CHECK(status IN ('passed','failed','error','skipped')),
    reasoning TEXT,
    error TEXT,
    steps_completed INTEGER NOT NULL DEFAULT 0,
    steps_total INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost_cents REAL NOT NULL DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    action TEXT NOT NULL,
    file_path TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 2: Indexes
  `
  CREATE INDEX IF NOT EXISTS idx_scenarios_project ON scenarios(project_id);
  CREATE INDEX IF NOT EXISTS idx_scenarios_priority ON scenarios(priority);
  CREATE INDEX IF NOT EXISTS idx_scenarios_short_id ON scenarios(short_id);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
  CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
  CREATE INDEX IF NOT EXISTS idx_results_scenario ON results(scenario_id);
  CREATE INDEX IF NOT EXISTS idx_results_status ON results(status);
  CREATE INDEX IF NOT EXISTS idx_screenshots_result ON screenshots(result_id);
  `,

  // Migration 3: Scenario counter for short IDs
  `
  ALTER TABLE projects ADD COLUMN scenario_prefix TEXT DEFAULT 'TST';
  ALTER TABLE projects ADD COLUMN scenario_counter INTEGER DEFAULT 0;
  `,

  // Migration 4: Schedules table for recurring test jobs
  `
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    url TEXT NOT NULL,
    scenario_filter TEXT NOT NULL DEFAULT '{}',
    model TEXT,
    headed INTEGER NOT NULL DEFAULT 0,
    parallel INTEGER NOT NULL DEFAULT 1,
    timeout_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_schedules_project ON schedules(project_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
  CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
  `,

  // Migration 5: Enhanced screenshots with description, page_url, thumbnail
  `
  ALTER TABLE screenshots ADD COLUMN description TEXT;
  ALTER TABLE screenshots ADD COLUMN page_url TEXT;
  ALTER TABLE screenshots ADD COLUMN thumbnail_path TEXT;
  `,

  // Migration 6: Auth presets table
  `
  CREATE TABLE IF NOT EXISTS auth_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    login_path TEXT DEFAULT '/login',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 7: Webhooks table
  `
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["failed"]',
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);
  `,

  // Migration 8: Scenario dependencies + flows
  `
  CREATE TABLE IF NOT EXISTS scenario_dependencies (
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    PRIMARY KEY (scenario_id, depends_on),
    CHECK (scenario_id != depends_on)
  );

  CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    scenario_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_deps_scenario ON scenario_dependencies(scenario_id);
  CREATE INDEX IF NOT EXISTS idx_deps_depends ON scenario_dependencies(depends_on);
  CREATE INDEX IF NOT EXISTS idx_flows_project ON flows(project_id);
  `,

  // Migration 9: Structured assertions for scenarios
  `
  ALTER TABLE scenarios ADD COLUMN assertions TEXT DEFAULT '[]';
  `,

  // Migration 10: Environments table for multi-environment support
  `
  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    auth_preset_name TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    is_default INTEGER NOT NULL DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 11: Baseline flag for visual regression
  `
  ALTER TABLE runs ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0;
  `,
];

function applyMigrations(database: Database): void {
  const applied = database
    .query("SELECT id FROM _migrations ORDER BY id")
    .all() as { id: number }[];
  const appliedIds = new Set(applied.map((r) => r.id));

  for (let i = 0; i < MIGRATIONS.length; i++) {
    const migrationId = i + 1;
    if (appliedIds.has(migrationId)) continue;

    const migration = MIGRATIONS[i]!;
    database.exec(migration);
    database
      .query("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
      .run(migrationId, now());
  }
}

export function getDatabase(): Database {
  if (db) return db;

  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (dbPath !== ":memory:" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  // Ensure _migrations table exists before applying migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  applyMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabase(): void {
  closeDatabase();
  const database = getDatabase();
  database.exec("DELETE FROM screenshots");
  database.exec("DELETE FROM results");
  database.exec("DELETE FROM scenario_dependencies");
  database.exec("DELETE FROM flows");
  database.exec("DELETE FROM webhooks");
  database.exec("DELETE FROM auth_presets");
  database.exec("DELETE FROM environments");
  database.exec("DELETE FROM schedules");
  database.exec("DELETE FROM runs");
  database.exec("DELETE FROM scenarios");
  database.exec("DELETE FROM agents");
  database.exec("DELETE FROM projects");
}

export function resolvePartialId(
  table: string,
  partialId: string
): string | null {
  const database = getDatabase();
  const rows = database
    .query(`SELECT id FROM ${table} WHERE id LIKE ? || '%'`)
    .all(partialId) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  return null;
}

export { now, uuid, shortUuid };
