/**
 * PostgreSQL migrations for open-economy cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
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
    period TEXT NOT NULL,
    limit_usd REAL NOT NULL,
    alert_at_percent INTEGER DEFAULT 80,
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

  // Widen token/count/duration columns from INT4 to BIGINT. SQLite INTEGER is
  // 64-bit, so local rows routinely exceed Postgres' int4 max (2,147,483,647) —
  // e.g. a session's cumulative cache-read tokens. Without this, ingesting those
  // rows fails with "value ... is out of range for type integer".
  `ALTER TABLE requests ALTER COLUMN input_tokens TYPE BIGINT`,
  `ALTER TABLE requests ALTER COLUMN output_tokens TYPE BIGINT`,
  `ALTER TABLE requests ALTER COLUMN cache_read_tokens TYPE BIGINT`,
  `ALTER TABLE requests ALTER COLUMN cache_create_tokens TYPE BIGINT`,
  `ALTER TABLE requests ALTER COLUMN cache_create_5m_tokens TYPE BIGINT`,
  `ALTER TABLE requests ALTER COLUMN cache_create_1h_tokens TYPE BIGINT`,
  `ALTER TABLE requests ALTER COLUMN duration_ms TYPE BIGINT`,
  `ALTER TABLE sessions ALTER COLUMN total_tokens TYPE BIGINT`,
  `ALTER TABLE sessions ALTER COLUMN request_count TYPE BIGINT`,

  // Widen money columns from REAL (float4) to DOUBLE PRECISION (float8). SQLite
  // stores REAL as 8-byte doubles, so single-precision cloud columns lose
  // precision on write and — worse — Postgres SUM(real) uses a float4 accumulator
  // that drifts materially over hundreds of thousands of rows (fleet spend was
  // off by ~$79 on ~$694k). Money must be float8 end to end.
  `ALTER TABLE requests ALTER COLUMN cost_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE sessions ALTER COLUMN total_cost_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE budgets ALTER COLUMN limit_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE goals ALTER COLUMN limit_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE model_pricing ALTER COLUMN input_per_1m TYPE DOUBLE PRECISION`,
  `ALTER TABLE model_pricing ALTER COLUMN output_per_1m TYPE DOUBLE PRECISION`,
  `ALTER TABLE model_pricing ALTER COLUMN cache_read_per_1m TYPE DOUBLE PRECISION`,
  `ALTER TABLE model_pricing ALTER COLUMN cache_write_per_1m TYPE DOUBLE PRECISION`,
  `ALTER TABLE model_pricing ALTER COLUMN cache_write_1h_per_1m TYPE DOUBLE PRECISION`,
  `ALTER TABLE model_pricing ALTER COLUMN cache_storage_per_1m_hour TYPE DOUBLE PRECISION`,
  `ALTER TABLE billing_daily ALTER COLUMN cost_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE subscriptions ALTER COLUMN monthly_fee_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE subscriptions ALTER COLUMN included_usage_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE usage_snapshots ALTER COLUMN value TYPE DOUBLE PRECISION`,
  `ALTER TABLE savings_daily ALTER COLUMN api_equivalent_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE savings_daily ALTER COLUMN subscription_fee_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE savings_daily ALTER COLUMN included_consumed_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE savings_daily ALTER COLUMN on_demand_usd TYPE DOUBLE PRECISION`,
  `ALTER TABLE savings_daily ALTER COLUMN saved_usd TYPE DOUBLE PRECISION`,
];
