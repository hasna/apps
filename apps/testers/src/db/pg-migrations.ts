/**
 * PostgreSQL migrations for open-testers cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: Core tables
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    role TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS scenarios (
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
    requires_auth BOOLEAN NOT NULL DEFAULT FALSE,
    auth_config TEXT,
    metadata TEXT DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','passed','failed','cancelled')),
    url TEXT NOT NULL,
    model TEXT NOT NULL,
    headed BOOLEAN NOT NULL DEFAULT FALSE,
    parallel INTEGER NOT NULL DEFAULT 1,
    total INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT NOW()::text,
    finished_at TEXT,
    metadata TEXT DEFAULT '{}'
  )`,

  `CREATE TABLE IF NOT EXISTS results (
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
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    action TEXT NOT NULL,
    file_path TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: Indexes
  `CREATE INDEX IF NOT EXISTS idx_scenarios_project ON scenarios(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_priority ON scenarios(priority)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_short_id ON scenarios(short_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_results_scenario ON results(scenario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_results_status ON results(status)`,
  `CREATE INDEX IF NOT EXISTS idx_screenshots_result ON screenshots(result_id)`,

  // Migration 3: Scenario counter for short IDs (columns added to projects)
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS scenario_prefix TEXT DEFAULT 'TST'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS scenario_counter INTEGER DEFAULT 0`,

  // Migration 4: Schedules table
  `CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    url TEXT NOT NULL,
    scenario_filter TEXT NOT NULL DEFAULT '{}',
    model TEXT,
    headed BOOLEAN NOT NULL DEFAULT FALSE,
    parallel INTEGER NOT NULL DEFAULT 1,
    timeout_ms INTEGER,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_schedules_project ON schedules(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at)`,

  // Migration 5: Enhanced screenshots
  `ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS page_url TEXT`,
  `ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS thumbnail_path TEXT`,

  // Migration 6: Auth presets table
  `CREATE TABLE IF NOT EXISTS auth_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    login_path TEXT DEFAULT '/login',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: Webhooks table
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["failed"]',
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active)`,

  // Migration 8: Scenario dependencies + flows
  `CREATE TABLE IF NOT EXISTS scenario_dependencies (
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    PRIMARY KEY (scenario_id, depends_on),
    CHECK (scenario_id != depends_on)
  )`,

  `CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    scenario_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_deps_scenario ON scenario_dependencies(scenario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deps_depends ON scenario_dependencies(depends_on)`,
  `CREATE INDEX IF NOT EXISTS idx_flows_project ON flows(project_id)`,

  // Migration 9: Structured assertions for scenarios
  `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS assertions TEXT DEFAULT '[]'`,

  // Migration 10: Environments table
  `CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    auth_preset_name TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 11: Baseline flag for visual regression
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT FALSE`,

  // Migration 12: Scan issues table
  `CREATE TABLE IF NOT EXISTS scan_issues (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    page_url TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL DEFAULT NOW()::text,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text,
    resolved_at TEXT,
    todo_task_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scan_issues_fingerprint ON scan_issues(fingerprint)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_issues_status ON scan_issues(status)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_issues_type ON scan_issues(type)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_issues_project ON scan_issues(project_id)`,

  // Migration 13: API checks and results tables
  `CREATE TABLE IF NOT EXISTS api_checks (
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
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS api_check_results (
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
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_api_checks_project ON api_checks(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_checks_enabled ON api_checks(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_api_check_results_check ON api_check_results(check_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_check_results_run ON api_check_results(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_check_results_status ON api_check_results(status)`,

  // Migration 14: Project base_url, port, and settings fields
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS base_url TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS port INTEGER`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings TEXT DEFAULT '{}'`,

  // Migration 15: Personas table
  `CREATE TABLE IF NOT EXISTS personas (
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
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_personas_project ON personas(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_personas_enabled ON personas(enabled)`,

  // Migration 16: Add persona_id to scenarios
  `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL`,

  // Migration 17: Add persona fields to results
  `ALTER TABLE results ADD COLUMN IF NOT EXISTS persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL`,
  `ALTER TABLE results ADD COLUMN IF NOT EXISTS persona_name TEXT`,

  // Migration 18: Scenario type
  `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS scenario_type TEXT NOT NULL DEFAULT 'browser' CHECK(scenario_type IN ('browser','eval','api','pipeline'))`,

  // Migration 19: Flakiness tracking on runs
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS samples INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS flakiness_threshold REAL NOT NULL DEFAULT 0.95`,

  // Migration 20: metadata column for api_check_results
  `ALTER TABLE api_check_results ADD COLUMN IF NOT EXISTS metadata TEXT DEFAULT '{}'`,

  // Migration 21: Golden answer tracking
  `CREATE TABLE IF NOT EXISTS golden_answers (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL UNIQUE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    golden_answer TEXT NOT NULL,
    constraints TEXT NOT NULL DEFAULT '[]',
    endpoint TEXT NOT NULL,
    judge_model TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS golden_check_results (
    id TEXT PRIMARY KEY,
    golden_id TEXT NOT NULL REFERENCES golden_answers(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    similarity_score REAL,
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    drift_detected BOOLEAN NOT NULL DEFAULT FALSE,
    judge_model TEXT,
    provider TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_golden_project ON golden_answers(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_golden_enabled ON golden_answers(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_golden_results_golden ON golden_check_results(golden_id)`,

  // Migration 22: Structured failure analysis on results
  `ALTER TABLE results ADD COLUMN IF NOT EXISTS failure_analysis TEXT`,

  // Migration 23: Persona detail fields
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS behaviors TEXT DEFAULT '[]'`,
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS expertise_level TEXT DEFAULT 'intermediate'`,
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS demographics TEXT DEFAULT '{}'`,
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS pain_points TEXT DEFAULT '[]'`,

  // Migration 24: Session result cache
  `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS last_passed_at TEXT`,
  `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS last_passed_url TEXT`,

  // Migration 25: Auth credentials on personas
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS auth_email TEXT`,
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS auth_password TEXT`,
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS auth_login_path TEXT DEFAULT '/login'`,
  `ALTER TABLE personas ADD COLUMN IF NOT EXISTS auth_cookies TEXT`,
  `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS required_role TEXT`,

  // Migration 26: Feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
