/**
 * PostgreSQL migrations for open-brains cloud sync.
 *
 * Equivalent to the SQLite schema in schema.ts + index.ts, translated for PostgreSQL.
 * Timestamps are stored as BIGINT (Unix epoch milliseconds) to match SQLite integer columns.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 0: fine_tuned_models table
  `CREATE TABLE IF NOT EXISTS fine_tuned_models (
    id TEXT PRIMARY KEY,
    base_model TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    fine_tune_job_id TEXT,
    display_name TEXT,
    description TEXT,
    collection TEXT,
    tags TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,

  // Migration 1: training_jobs table
  `CREATE TABLE IF NOT EXISTS training_jobs (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES fine_tuned_models(id),
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT,
    metrics TEXT,
    error TEXT
  )`,

  // Migration 2: training_datasets table
  `CREATE TABLE IF NOT EXISTS training_datasets (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    file_path TEXT NOT NULL,
    example_count INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    used_in_job_id TEXT REFERENCES training_jobs(id)
  )`,

  // Migration 3: feedback table (matches @hasna/cloud ensureFeedbackTable schema)
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    service TEXT NOT NULL DEFAULT 'brains',
    version TEXT DEFAULT '',
    message TEXT NOT NULL,
    email TEXT DEFAULT '',
    machine_id TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
