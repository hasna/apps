/**
 * PostgreSQL migrations for open-economy remote storage.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
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
    account_key TEXT DEFAULT '',
    account_tool TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    account_email TEXT DEFAULT '',
    account_source TEXT DEFAULT ''
  )`,

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
    account_key TEXT DEFAULT '',
    account_tool TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    account_email TEXT DEFAULT '',
    account_source TEXT DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    project_path TEXT,
    agent TEXT,
    period TEXT NOT NULL,
    limit_usd REAL NOT NULL,
    alert_at_percent INTEGER DEFAULT 80,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL,
    project_path TEXT,
    agent TEXT,
    limit_usd REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ingest_state (
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (source, key)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_agent ON requests(agent)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_machine ON requests(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_id)`,

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
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_tag TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_key TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_tool TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_name TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_email TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_source TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS synced_at TEXT DEFAULT ''`,

  `CREATE INDEX IF NOT EXISTS idx_usage_agent_date ON usage_snapshots(agent, date)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_date ON savings_daily(date)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_account ON requests(account_key)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_key)`,
]
