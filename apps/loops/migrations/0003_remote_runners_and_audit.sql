-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0003_remote_runners_and_audit"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:9f0816668315c08aefeda1afebb58ad74e803d6dd1bca580e0697f602486c520)

CREATE TABLE IF NOT EXISTS runner_machines (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  labels_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runner_machines_status_seen ON runner_machines(status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS runner_leases (
  id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL REFERENCES runner_machines(id) ON DELETE CASCADE,
  loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE CASCADE,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL,
  status TEXT NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (loop_run_id IS NOT NULL OR workflow_run_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_leases_active_loop_run ON runner_leases(loop_run_id) WHERE loop_run_id IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_leases_active_workflow_run ON runner_leases(workflow_run_id) WHERE workflow_run_id IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_runner_leases_runner_status ON runner_leases(runner_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_runner_leases_claim_token ON runner_leases(claim_token);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_subject ON audit_events(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action, created_at DESC);
