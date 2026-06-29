import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { getHomeDir, migrateLegacyDirectory } from "../lib/paths.js";

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

export function resolveDbPath(): string {
  if (process.env["HASNA_TESTERS_DB_PATH"]) return process.env["HASNA_TESTERS_DB_PATH"];
  if (process.env["TESTERS_DB_PATH"]) return process.env["TESTERS_DB_PATH"];

  const home = getHomeDir();
  const newDir = join(home, ".hasna", "testers");
  const legacyDir = join(home, ".testers");
  const newPath = join(newDir, "testers.db");

  if (!existsSync(newPath) && existsSync(legacyDir)) {
    migrateLegacyDirectory(legacyDir, newDir);
  }

  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });
  return newPath;
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

  // Migration 12: Scan issues table for page health monitoring
  `
  CREATE TABLE IF NOT EXISTS scan_issues (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    page_url TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    todo_task_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scan_issues_fingerprint ON scan_issues(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_scan_issues_status ON scan_issues(status);
  CREATE INDEX IF NOT EXISTS idx_scan_issues_type ON scan_issues(type);
  CREATE INDEX IF NOT EXISTS idx_scan_issues_project ON scan_issues(project_id);
  `,

  // Migration 13: API checks and results tables
  `
CREATE TABLE IF NOT EXISTS api_checks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'GET' CHECK(method IN ('GET','POST','PUT','PATCH','DELETE','HEAD')),
  url TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  body TEXT,
  expected_status INTEGER NOT NULL DEFAULT 200,
  expected_body_contains TEXT,
  expected_response_time_ms INTEGER,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_check_results (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES api_checks(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('passed','failed','error')),
  status_code INTEGER,
  response_time_ms INTEGER,
  response_body TEXT,
  response_headers TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  assertions_passed TEXT NOT NULL DEFAULT '[]',
  assertions_failed TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_checks_project ON api_checks(project_id);
CREATE INDEX IF NOT EXISTS idx_api_checks_enabled ON api_checks(enabled);
CREATE INDEX IF NOT EXISTS idx_api_check_results_check ON api_check_results(check_id);
CREATE INDEX IF NOT EXISTS idx_api_check_results_run ON api_check_results(run_id);
CREATE INDEX IF NOT EXISTS idx_api_check_results_status ON api_check_results(status);
  `,

  // Migration 14: Project base_url, port, and settings fields
  `
ALTER TABLE projects ADD COLUMN base_url TEXT;
ALTER TABLE projects ADD COLUMN port INTEGER;
ALTER TABLE projects ADD COLUMN settings TEXT DEFAULT '{}';
  `,

  // Migration 15: Personas table
  `
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL DEFAULT '[]',
  goals TEXT NOT NULL DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_personas_project ON personas(project_id);
CREATE INDEX IF NOT EXISTS idx_personas_enabled ON personas(enabled);
  `,

  // Migration 16: Add persona_id to scenarios
  `
ALTER TABLE scenarios ADD COLUMN persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL;
  `,

  // Migration 17: Add persona_id and persona_name to results
  `
ALTER TABLE results ADD COLUMN persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL;
ALTER TABLE results ADD COLUMN persona_name TEXT;
  `,

  // Migration 18: Add scenario type (browser | eval | api | pipeline)
  `
ALTER TABLE scenarios ADD COLUMN scenario_type TEXT NOT NULL DEFAULT 'browser' CHECK(scenario_type IN ('browser','eval','api','pipeline'));
  `,

  // Migration 19: Flakiness tracking on runs
  `
ALTER TABLE runs ADD COLUMN samples INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN flakiness_threshold REAL NOT NULL DEFAULT 0.95;
  `,

  // Migration 20: metadata column for api_check_results (stores llmProfile, piiDetections, etc.)
  `
ALTER TABLE api_check_results ADD COLUMN metadata TEXT DEFAULT '{}';
  `,

  // Migration 21: Golden answer tracking for hallucination guardrail monitoring
  `
CREATE TABLE IF NOT EXISTS golden_answers (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  golden_answer TEXT NOT NULL,
  constraints TEXT NOT NULL DEFAULT '[]',
  endpoint TEXT NOT NULL,
  judge_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS golden_check_results (
  id TEXT PRIMARY KEY,
  golden_id TEXT NOT NULL REFERENCES golden_answers(id) ON DELETE CASCADE,
  response TEXT NOT NULL,
  similarity_score REAL,
  passed INTEGER NOT NULL DEFAULT 0,
  drift_detected INTEGER NOT NULL DEFAULT 0,
  judge_model TEXT,
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_golden_project ON golden_answers(project_id);
CREATE INDEX IF NOT EXISTS idx_golden_enabled ON golden_answers(enabled);
CREATE INDEX IF NOT EXISTS idx_golden_results_golden ON golden_check_results(golden_id);
  `,

  // Migration 22: Structured failure analysis on results
  `
ALTER TABLE results ADD COLUMN failure_analysis TEXT;
  `,

  // Migration 23: Persona detail fields — behaviors, expertise_level, demographics, pain_points
  `
ALTER TABLE personas ADD COLUMN behaviors TEXT DEFAULT '[]';
ALTER TABLE personas ADD COLUMN expertise_level TEXT DEFAULT 'intermediate';
ALTER TABLE personas ADD COLUMN demographics TEXT DEFAULT '{}';
ALTER TABLE personas ADD COLUMN pain_points TEXT DEFAULT '[]';
  `,

  // Migration 24: Session result cache — track last passing run per scenario
  `
ALTER TABLE scenarios ADD COLUMN last_passed_at TEXT;
ALTER TABLE scenarios ADD COLUMN last_passed_url TEXT;
  `,

  // Migration 25: Auth credentials on personas for multi-user session pool
  `
ALTER TABLE personas ADD COLUMN auth_email TEXT;
ALTER TABLE personas ADD COLUMN auth_password TEXT;
ALTER TABLE personas ADD COLUMN auth_login_path TEXT DEFAULT '/login';
ALTER TABLE personas ADD COLUMN auth_cookies TEXT;
ALTER TABLE scenarios ADD COLUMN required_role TEXT;
  `,
  // Migration: feedback table
  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 26: HAR capture path on results
  `
ALTER TABLE results ADD COLUMN har_path TEXT;
  `,

  // Migration 27: Scenario parameters and persona auth extensions
  `
ALTER TABLE scenarios ADD COLUMN parameters TEXT;
  `,
  `
ALTER TABLE personas ADD COLUMN auth_strategy TEXT DEFAULT 'form-login';
ALTER TABLE personas ADD COLUMN auth_headers TEXT;
ALTER TABLE personas ADD COLUMN auth_script TEXT;
  `,

  // Migration 28: Step-level results for detailed run tracking
  `
CREATE TABLE IF NOT EXISTS step_results (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('passed','failed','error','running','skipped')),
  tool_name TEXT,
  tool_input TEXT,
  tool_result TEXT,
  thinking TEXT,
  error TEXT,
  duration_ms INTEGER,
  screenshot_id TEXT REFERENCES screenshots(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
  `,

  // Migration 29: PR metadata on runs for GitHub integration
  `
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
ALTER TABLE runs ADD COLUMN pr_title TEXT;
ALTER TABLE runs ADD COLUMN pr_branch TEXT;
ALTER TABLE runs ADD COLUMN pr_base_branch TEXT;
ALTER TABLE runs ADD COLUMN pr_commit_sha TEXT;
ALTER TABLE runs ADD COLUMN pr_url TEXT;
ALTER TABLE runs ADD COLUMN gh_app_installation_id TEXT;
  `,
  // Migration 30: Sessions table for Chrome extension recording data
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    tab_id INTEGER NOT NULL,
    url TEXT,
    title TEXT,
    entries TEXT NOT NULL DEFAULT '[]',
    entry_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    console_count INTEGER NOT NULL DEFAULT 0,
    nav_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'exported' CHECK(status IN ('live','saved','exported')),
    start_time TEXT NOT NULL,
    end_time TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_tab ON sessions(tab_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
  `,

  // Migration 31: Saved testing workflows for reusable app QA plans
  `
CREATE TABLE IF NOT EXISTS testing_workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scenario_filter TEXT NOT NULL DEFAULT '{}',
  persona_ids TEXT NOT NULL DEFAULT '[]',
  goal TEXT,
  execution TEXT NOT NULL DEFAULT '{"target":"local"}',
  settings TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_testing_workflows_project ON testing_workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_testing_workflows_enabled ON testing_workflows(enabled);
  `,

  // Migration 34: App-agnostic execution model
  `
CREATE TABLE IF NOT EXISTS execution_subjects (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK(kind IN ('web_app','api','cli','repo','service','dataset','custom')),
  name TEXT NOT NULL,
  uri TEXT,
  external_ref TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_specs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES execution_subjects(id) ON DELETE SET NULL,
  legacy_scenario_id TEXT UNIQUE REFERENCES scenarios(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK(kind IN ('browser','api','eval','pipeline','agentic','manual','custom')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  objective TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  assertions TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  config TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_goals (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES execution_subjects(id) ON DELETE SET NULL,
  spec_id TEXT REFERENCES test_specs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  success_criteria TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','satisfied','failed','cancelled')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loop_runs (
  id TEXT PRIMARY KEY,
  goal_id TEXT REFERENCES test_goals(id) ON DELETE SET NULL,
  spec_id TEXT REFERENCES test_specs(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES execution_subjects(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled','exhausted')),
  iteration INTEGER NOT NULL DEFAULT 0,
  max_iterations INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  result_summary TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS run_attempts (
  id TEXT PRIMARY KEY,
  loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  spec_id TEXT REFERENCES test_specs(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES execution_subjects(id) ON DELETE SET NULL,
  legacy_result_id TEXT UNIQUE REFERENCES results(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','passed','failed','error','skipped','cancelled','flaky')),
  executor TEXT NOT NULL DEFAULT 'manual',
  model TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  summary TEXT,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES run_attempts(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('debug','info','warn','error')),
  type TEXT NOT NULL,
  message TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(attempt_id, sequence)
);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES run_attempts(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE SET NULL,
  legacy_screenshot_id TEXT REFERENCES screenshots(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'file' CHECK(kind IN ('screenshot','har','log','trace','video','json','text','file','report','custom')),
  name TEXT NOT NULL,
  uri TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_execution_subjects_project ON execution_subjects(project_id);
CREATE INDEX IF NOT EXISTS idx_execution_subjects_kind ON execution_subjects(kind);
CREATE INDEX IF NOT EXISTS idx_test_specs_project ON test_specs(project_id);
CREATE INDEX IF NOT EXISTS idx_test_specs_subject ON test_specs(subject_id);
CREATE INDEX IF NOT EXISTS idx_test_specs_legacy_scenario ON test_specs(legacy_scenario_id);
CREATE INDEX IF NOT EXISTS idx_test_goals_status ON test_goals(status);
CREATE INDEX IF NOT EXISTS idx_test_goals_subject ON test_goals(subject_id);
CREATE INDEX IF NOT EXISTS idx_loop_runs_goal ON loop_runs(goal_id);
CREATE INDEX IF NOT EXISTS idx_loop_runs_status ON loop_runs(status);
CREATE INDEX IF NOT EXISTS idx_run_attempts_run ON run_attempts(run_id);
CREATE INDEX IF NOT EXISTS idx_run_attempts_spec ON run_attempts(spec_id);
CREATE INDEX IF NOT EXISTS idx_run_attempts_status ON run_attempts(status);
CREATE INDEX IF NOT EXISTS idx_run_attempts_legacy_result ON run_attempts(legacy_result_id);
CREATE INDEX IF NOT EXISTS idx_run_events_attempt ON run_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_attempt ON run_artifacts(attempt_id);
  `,

  // Migration 35: Guard execution attempt sequencing
  `
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_attempts_run_spec_attempt
  ON run_attempts(run_id, spec_id, attempt_number)
  WHERE run_id IS NOT NULL AND spec_id IS NOT NULL;
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

  db = new Database(dbPath, { create: true });
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
  database.exec("DELETE FROM run_artifacts");
  database.exec("DELETE FROM run_events");
  database.exec("DELETE FROM run_attempts");
  database.exec("DELETE FROM loop_runs");
  database.exec("DELETE FROM test_goals");
  database.exec("DELETE FROM test_specs");
  database.exec("DELETE FROM execution_subjects");
  database.exec("DELETE FROM screenshots");
  database.exec("DELETE FROM results");
  database.exec("DELETE FROM scenario_dependencies");
  database.exec("DELETE FROM flows");
  database.exec("DELETE FROM webhooks");
  database.exec("DELETE FROM auth_presets");
  database.exec("DELETE FROM environments");
  database.exec("DELETE FROM schedules");
  database.exec("DELETE FROM testing_workflows");
  database.exec("DELETE FROM api_check_results");
  database.exec("DELETE FROM api_checks");
  database.exec("DELETE FROM runs");
  database.exec("DELETE FROM personas");
  database.exec("DELETE FROM scenarios");
  database.exec("DELETE FROM agents");
  database.exec("DELETE FROM scan_issues");
  database.exec("DELETE FROM projects");
  database.exec("DELETE FROM sessions");
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
