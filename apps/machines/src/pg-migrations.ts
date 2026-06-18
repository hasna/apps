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
    daemon_version TEXT,
    agent_mode TEXT,
    platform TEXT,
    os_version TEXT,
    os_build TEXT,
    arch TEXT,
    uptime_seconds INTEGER,
    tool_versions_json TEXT,
    tailscale_json TEXT,
    storage_sync_status TEXT,
    storage_sync_last_error TEXT,
    doctor_summary_json TEXT,
    private_metadata INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (machine_id, pid)
  );

  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS daemon_version TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS agent_mode TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS platform TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS os_version TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS os_build TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS arch TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS uptime_seconds INTEGER;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tool_versions_json TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tailscale_json TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS storage_sync_status TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS storage_sync_last_error TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS doctor_summary_json TEXT;
  ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS private_metadata INTEGER NOT NULL DEFAULT 0;

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
