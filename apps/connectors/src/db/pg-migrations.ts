/**
 * PostgreSQL migrations for open-connectors remote storage sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: agents table
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    session_id TEXT,
    role TEXT NOT NULL DEFAULT 'agent',
    project_id TEXT,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // Migration 2: resource_locks table
  `CREATE TABLE IF NOT EXISTS resource_locks (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('connector', 'agent', 'profile', 'token')),
    resource_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    lock_type TEXT NOT NULL DEFAULT 'exclusive' CHECK(lock_type IN ('advisory', 'exclusive')),
    locked_at TEXT NOT NULL DEFAULT (NOW()::text),
    expires_at TEXT NOT NULL
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_locks_exclusive
    ON resource_locks(resource_type, resource_id)
    WHERE lock_type = 'exclusive'`,

  `CREATE INDEX IF NOT EXISTS idx_resource_locks_agent ON resource_locks(agent_id)`,

  `CREATE INDEX IF NOT EXISTS idx_resource_locks_expires ON resource_locks(expires_at)`,

  // Migration 3: connector_rate_usage table
  `CREATE TABLE IF NOT EXISTS connector_rate_usage (
    agent_id TEXT NOT NULL,
    connector TEXT NOT NULL,
    window_start TEXT NOT NULL,
    call_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (agent_id, connector, window_start)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_rate_usage_window ON connector_rate_usage(connector, window_start)`,

  // Migration 4: connector_jobs — scheduled connector runs
  `CREATE TABLE IF NOT EXISTS connector_jobs (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    connector TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]',
    cron TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    strip BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    last_run_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_jobs_enabled ON connector_jobs(enabled)`,

  // Migration 5: connector_job_runs — output history per job
  `CREATE TABLE IF NOT EXISTS connector_job_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES connector_jobs(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    exit_code INTEGER,
    raw_output TEXT,
    stripped_output TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_job_runs_job ON connector_job_runs(job_id, started_at DESC)`,

  // Migration 6: connector_workflows — sequential pipelines
  `CREATE TABLE IF NOT EXISTS connector_workflows (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL
  )`,

  // Migration 7: connector_usage — track connector usage for hot ranking
  `CREATE TABLE IF NOT EXISTS connector_usage (
    id TEXT PRIMARY KEY,
    connector TEXT NOT NULL,
    action TEXT NOT NULL,
    agent_id TEXT,
    timestamp TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_usage_connector ON connector_usage(connector, timestamp DESC)`,

  // Migration 8: connector_promotions — manual hot connector promotion
  `CREATE TABLE IF NOT EXISTS connector_promotions (
    connector TEXT UNIQUE NOT NULL,
    promoted_at TEXT NOT NULL
  )`,

  // Migration 9: feedback table
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
