/**
 * PostgreSQL migrations for open-economy cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Cost centers — local-first attribution groups for loops, apps, repos, services, and teams
  `CREATE TABLE IF NOT EXISTS cost_centers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    repo_path TEXT,
    labels_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Requests table — individual API calls
  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    session_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_create_tokens INTEGER DEFAULT 0,
    cache_create_5m_tokens INTEGER DEFAULT 0,
    cache_create_1h_tokens INTEGER DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    timestamp TEXT NOT NULL,
    source_request_id TEXT,
    machine_id TEXT DEFAULT '',
    cost_center_id TEXT,
    account_key TEXT DEFAULT '',
    account_tool TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    account_email TEXT DEFAULT '',
    account_source TEXT DEFAULT ''
  )`,

  // Sessions table — aggregated session-level data
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    project_path TEXT DEFAULT '',
    project_name TEXT DEFAULT '',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    total_cost_usd REAL DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    machine_id TEXT DEFAULT '',
    cost_center_id TEXT,
    account_key TEXT DEFAULT '',
    account_tool TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    account_email TEXT DEFAULT '',
    account_source TEXT DEFAULT ''
  )`,

  // Projects table
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,

  // Budgets table
  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    project_path TEXT,
    agent TEXT,
    cost_center_id TEXT,
    period TEXT NOT NULL,
    limit_usd REAL NOT NULL,
    alert_at_percent INTEGER DEFAULT 80,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS loop_attributions (
    id TEXT PRIMARY KEY,
    request_id TEXT DEFAULT '',
    session_id TEXT DEFAULT '',
    loop_id TEXT DEFAULT '',
    loop_name TEXT DEFAULT '',
    loop_run_id TEXT DEFAULT '',
    goal_id TEXT DEFAULT '',
    goal_run_id TEXT DEFAULT '',
    workflow_run_id TEXT DEFAULT '',
    workflow_step_id TEXT DEFAULT '',
    thread_id TEXT DEFAULT '',
    account_key TEXT DEFAULT '',
    account_tool TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    provider TEXT DEFAULT '',
    model TEXT DEFAULT '',
    phase TEXT DEFAULT '',
    status TEXT DEFAULT '',
    loop_status TEXT DEFAULT '',
    schedule_json TEXT DEFAULT '{}',
    scheduled_for TEXT DEFAULT '',
    started_at TEXT DEFAULT '',
    finished_at TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    attempt INTEGER DEFAULT 0,
    tokens INTEGER DEFAULT 0,
    api_equivalent_usd REAL NOT NULL DEFAULT 0,
    subscription_included_usd REAL NOT NULL DEFAULT 0,
    billable_usd REAL NOT NULL DEFAULT 0,
    failure_retry_usd REAL NOT NULL DEFAULT 0,
    cost_basis TEXT DEFAULT 'estimated',
    machine_id TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Goals table
  `CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL,
    project_path TEXT,
    agent TEXT,
    limit_usd REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Ingest state tracker
  `CREATE TABLE IF NOT EXISTS ingest_state (
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (source, key)
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_agent ON requests(agent)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_machine ON requests(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_centers_kind ON cost_centers(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_loop ON loop_attributions(loop_id, loop_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_provider ON loop_attributions(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_account ON loop_attributions(account_key)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_model ON loop_attributions(model)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_machine ON loop_attributions(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_updated ON loop_attributions(updated_at)`,

  // Model pricing table
  `CREATE TABLE IF NOT EXISTS model_pricing (
    model TEXT PRIMARY KEY,
    input_per_1m REAL NOT NULL DEFAULT 0,
    output_per_1m REAL NOT NULL DEFAULT 0,
    cache_read_per_1m REAL NOT NULL DEFAULT 0,
    cache_write_per_1m REAL NOT NULL DEFAULT 0,
    cache_write_1h_per_1m REAL NOT NULL DEFAULT 0,
    cache_storage_per_1m_hour REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,

  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS cache_create_5m_tokens INTEGER DEFAULT 0`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS cache_create_1h_tokens INTEGER DEFAULT 0`,
  `ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS cache_write_1h_per_1m REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE model_pricing ADD COLUMN IF NOT EXISTS cache_storage_per_1m_hour REAL NOT NULL DEFAULT 0`,

  // Feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS billing_daily (
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    description TEXT DEFAULT '',
    cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, provider, description)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_billing_date ON billing_daily(date)`,
  `CREATE INDEX IF NOT EXISTS idx_billing_provider ON billing_daily(provider)`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    agent TEXT,
    provider TEXT NOT NULL,
    plan TEXT NOT NULL,
    monthly_fee_usd REAL NOT NULL DEFAULT 0,
    included_usage_usd REAL NOT NULL DEFAULT 0,
    billing_cycle_start TEXT,
    reset_policy TEXT DEFAULT 'monthly',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS usage_snapshots (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    date TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    unit TEXT DEFAULT '',
    machine_id TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS savings_daily (
    date TEXT NOT NULL,
    agent TEXT DEFAULT '',
    api_equivalent_usd REAL NOT NULL DEFAULT 0,
    subscription_fee_usd REAL NOT NULL DEFAULT 0,
    included_consumed_usd REAL NOT NULL DEFAULT 0,
    on_demand_usd REAL NOT NULL DEFAULT 0,
    saved_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, agent)
  )`,

  `CREATE TABLE IF NOT EXISTS machines (
    machine_id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    last_seen_at TEXT,
    last_push_at TEXT,
    last_pull_at TEXT,
    economy_version TEXT,
    updated_at TEXT NOT NULL
  )`,

  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS cost_basis TEXT DEFAULT 'estimated'`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS attribution_tag TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS account_key TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS account_tool TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS account_name TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS account_email TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS account_source TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS synced_at TEXT DEFAULT ''`,
  `ALTER TABLE requests ADD COLUMN IF NOT EXISTS cost_center_id TEXT`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_tag TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_key TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_tool TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_name TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_email TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_source TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS synced_at TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cost_center_id TEXT`,
  `ALTER TABLE budgets ADD COLUMN IF NOT EXISTS cost_center_id TEXT`,
  `ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,

  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS request_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS loop_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS loop_name TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS loop_run_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS goal_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS goal_run_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS workflow_run_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS workflow_step_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS thread_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS account_key TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS account_tool TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS account_name TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS model TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS loop_status TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS schedule_json TEXT DEFAULT '{}'`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS scheduled_for TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS started_at TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS finished_at TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS duration_ms INTEGER DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS attempt INTEGER DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS tokens INTEGER DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS api_equivalent_usd REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS subscription_included_usd REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS billable_usd REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS failure_retry_usd REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS cost_basis TEXT DEFAULT 'estimated'`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS machine_id TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT ''`,
  `ALTER TABLE loop_attributions ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,

  `CREATE INDEX IF NOT EXISTS idx_usage_agent_date ON usage_snapshots(agent, date)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_date ON savings_daily(date)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_account ON requests(account_key)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_key)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_cost_center ON requests(cost_center_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_cost_center ON sessions(cost_center_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budgets_cost_center ON budgets(cost_center_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_loop ON loop_attributions(loop_id, loop_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_provider ON loop_attributions(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_account ON loop_attributions(account_key)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_model ON loop_attributions(model)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_machine ON loop_attributions(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_attr_updated ON loop_attributions(updated_at)`,
];
