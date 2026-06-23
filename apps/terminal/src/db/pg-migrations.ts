/**
 * PostgreSQL migrations for open-terminal remote storage.
 *
 * Equivalent to the SQLite schema in sessions-db.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: sessions table
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at BIGINT NOT NULL,
    ended_at BIGINT,
    cwd TEXT NOT NULL,
    provider TEXT,
    model TEXT
  )`,

  // Migration 2: interactions table
  `CREATE TABLE IF NOT EXISTS interactions (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    nl TEXT NOT NULL,
    command TEXT,
    output TEXT,
    exit_code INTEGER,
    tokens_used INTEGER DEFAULT 0,
    tokens_saved INTEGER DEFAULT 0,
    duration_ms INTEGER,
    model TEXT,
    cached BOOLEAN DEFAULT FALSE,
    created_at BIGINT NOT NULL
  )`,

  // Migration 3: indexes on interactions and sessions
  `CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`,

  // Migration 4: corrections table
  `CREATE TABLE IF NOT EXISTS corrections (
    id SERIAL PRIMARY KEY,
    prompt TEXT NOT NULL,
    failed_command TEXT NOT NULL,
    error_output TEXT,
    corrected_command TEXT NOT NULL,
    worked BOOLEAN DEFAULT TRUE,
    error_type TEXT,
    created_at BIGINT NOT NULL
  )`,

  // Migration 5: outputs table
  `CREATE TABLE IF NOT EXISTS outputs (
    id SERIAL PRIMARY KEY,
    session_id TEXT,
    command TEXT NOT NULL,
    raw_output_path TEXT,
    compressed_summary TEXT,
    tokens_raw INTEGER DEFAULT 0,
    tokens_compressed INTEGER DEFAULT 0,
    provider TEXT,
    model TEXT,
    created_at BIGINT NOT NULL
  )`,

  // Migration 6: index on corrections
  `CREATE INDEX IF NOT EXISTS idx_corrections_prompt ON corrections(prompt)`,

  // Migration 7: feedback table
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
