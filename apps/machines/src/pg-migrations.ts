/**
 * PostgreSQL migrations for open-machines remote storage.
 *
 * Equivalent of the SQLite runtime schema in db.ts, translated for PostgreSQL.
 */
export const PG_MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS agent_heartbeats (
    machine_id TEXT NOT NULL,
    pid INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (machine_id, pid)
  );

  CREATE TABLE IF NOT EXISTS setup_runs (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    status TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    status TEXT NOT NULL,
    actions_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  `,
];
