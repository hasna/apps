export const PG_MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    steps INTEGER NOT NULL DEFAULT 0,
    total_tokens_in INTEGER NOT NULL DEFAULT 0,
    total_tokens_out INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    tags TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS action_logs (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    step INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    action_data JSONB NOT NULL,
    reasoning TEXT,
    screenshot_path TEXT,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_action_logs_session ON action_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS task_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', task)) STORED;
  CREATE INDEX IF NOT EXISTS idx_sessions_fts ON sessions USING GIN(task_tsv);

  ALTER TABLE action_logs ADD COLUMN IF NOT EXISTS reasoning_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', COALESCE(reasoning, ''))) STORED;
  CREATE INDEX IF NOT EXISTS idx_action_logs_fts ON action_logs USING GIN(reasoning_tsv);

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    service TEXT NOT NULL DEFAULT 'computer',
    version TEXT,
    message TEXT NOT NULL,
    email TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
];
