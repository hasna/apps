// Cloud-mode (Amendment A1 PURE REMOTE) schema for the machines control-plane
// registry service. These migrations run against the shared RDS `machines`
// database via the vendored storage kit's MigrationLedger (sha256-checksummed,
// drift/downgrade-guarded). The migration runner connects as the OWNER role;
// the long-running serve process connects as the APP role (DML only).

import { defineMigration, type Migration } from "../generated/storage-kit/migrations.js";

/**
 * Ordered migrations for the machines cloud database.
 *
 * IMPORTANT: once a migration has been applied, its SQL is frozen — the ledger
 * rejects any checksum change. Add new migrations rather than editing applied
 * ones.
 */
export const MACHINES_MIGRATIONS: readonly Migration[] = [
  defineMigration(
    "machines_0001_registry",
    `CREATE TABLE IF NOT EXISTS machines (
       id            TEXT PRIMARY KEY,
       friendly_name TEXT,
       platform      TEXT,
       arch          TEXT,
       status        TEXT NOT NULL DEFAULT 'unknown',
       labels        JSONB NOT NULL DEFAULT '{}'::jsonb,
       metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
     );
     CREATE INDEX IF NOT EXISTS machines_status_idx ON machines (status);
     CREATE INDEX IF NOT EXISTS machines_updated_at_idx ON machines (updated_at DESC);`,
  ),
  defineMigration(
    "machines_0002_agent_heartbeats",
    `CREATE TABLE IF NOT EXISTS agent_heartbeats (
       machine_id             TEXT NOT NULL,
       pid                    INTEGER NOT NULL,
       status                 TEXT NOT NULL,
       updated_at             TIMESTAMPTZ NOT NULL,
       daemon_version         TEXT,
       agent_mode             TEXT,
       platform               TEXT,
       os_version             TEXT,
       os_build               TEXT,
       arch                   TEXT,
       uptime_seconds         INTEGER,
       tool_versions_json     TEXT,
       tailscale_json         TEXT,
       storage_sync_status    TEXT,
       storage_sync_last_error TEXT,
       doctor_summary_json    TEXT,
       private_metadata       INTEGER NOT NULL DEFAULT 0,
       observed_at            TIMESTAMPTZ,
       PRIMARY KEY (machine_id, pid)
     );
     CREATE INDEX IF NOT EXISTS agent_heartbeats_machine_idx ON agent_heartbeats (machine_id);
     CREATE INDEX IF NOT EXISTS agent_heartbeats_updated_at_idx ON agent_heartbeats (updated_at DESC);`,
  ),
  defineMigration(
    "machines_0003_runs",
    `CREATE TABLE IF NOT EXISTS setup_runs (
       id         TEXT PRIMARY KEY,
       machine_id TEXT NOT NULL,
       status     TEXT NOT NULL,
       details_json TEXT NOT NULL DEFAULT '[]',
       created_at TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL
     );
     CREATE TABLE IF NOT EXISTS sync_runs (
       id         TEXT PRIMARY KEY,
       machine_id TEXT NOT NULL,
       status     TEXT NOT NULL,
       actions_json TEXT NOT NULL DEFAULT '[]',
       created_at TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL
     );`,
  ),
];
