-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0001_core_runtime"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:99cab06c75144cbcd3076ea42132fe511fe0f8c89d1c96bdcc4abef7c026ef32)

CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  archived_from_status TEXT,
  schedule_json JSONB NOT NULL,
  target_json JSONB NOT NULL,
  goal_json JSONB,
  machine_json JSONB,
  next_run_at TIMESTAMPTZ,
  retry_scheduled_for TIMESTAMPTZ,
  catch_up TEXT NOT NULL,
  catch_up_limit INTEGER NOT NULL,
  overlap TEXT NOT NULL,
  max_attempts INTEGER NOT NULL,
  retry_delay_ms INTEGER NOT NULL,
  lease_ms INTEGER NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loops_status_next ON loops(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_loops_name ON loops(name);

CREATE TABLE IF NOT EXISTS loop_runs (
  id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  loop_name TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  claimed_by TEXT,
  claim_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  pid INTEGER,
  pgid INTEGER,
  process_started_at TIMESTAMPTZ,
  exit_code INTEGER,
  duration_ms INTEGER,
  stdout TEXT,
  stderr TEXT,
  error TEXT,
  goal_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(loop_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_runs_loop ON loop_runs(loop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_status ON loop_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_status_lease ON loop_runs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_runs_scheduled ON loop_runs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_runs_claim_token ON loop_runs(claim_token) WHERE claim_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS daemon_lease (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
