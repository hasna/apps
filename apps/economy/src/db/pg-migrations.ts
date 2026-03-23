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
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    timestamp TEXT NOT NULL,
    source_request_id TEXT
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
    request_count INTEGER DEFAULT 0
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
  `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`,

  // Model pricing table
  `CREATE TABLE IF NOT EXISTS model_pricing (
    model TEXT PRIMARY KEY,
    input_per_1m REAL NOT NULL DEFAULT 0,
    output_per_1m REAL NOT NULL DEFAULT 0,
    cache_read_per_1m REAL NOT NULL DEFAULT 0,
    cache_write_per_1m REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,

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
];
