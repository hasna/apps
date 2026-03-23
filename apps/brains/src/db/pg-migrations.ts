/**
 * PostgreSQL migrations for open-brains cloud sync.
 *
 * Equivalent to the SQLite schema in schema.ts + index.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: fine_tuned_models table
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // Migration 2: training_jobs table
  `CREATE TABLE IF NOT EXISTS training_jobs (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES fine_tuned_models(id),
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    metrics TEXT,
    error TEXT
  )`,

  // Migration 3: training_datasets table
  `CREATE TABLE IF NOT EXISTS training_datasets (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    file_path TEXT NOT NULL,
    example_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    used_in_job_id TEXT REFERENCES training_jobs(id)
  )`,

  // Migration 4: feedback table
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
