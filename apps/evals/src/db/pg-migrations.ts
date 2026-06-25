/**
 * PostgreSQL migrations for open-evals remote storage sync.
 */

export const PG_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    dataset TEXT NOT NULL,
    stats TEXT NOT NULL,
    adapter TEXT,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS baselines (
    name TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS runs_created_at ON runs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS runs_dataset ON runs(dataset)`,
];
