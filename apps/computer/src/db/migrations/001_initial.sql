-- PostgreSQL migration: 001_initial
-- Creates the storage sync schema for @hasna/computer.

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

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  actor TEXT,
  transport TEXT NOT NULL,
  capability TEXT NOT NULL,
  action_type TEXT,
  action_data JSONB,
  decision TEXT NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_transport ON audit_events(transport);
CREATE INDEX IF NOT EXISTS idx_audit_events_capability ON audit_events(capability);
CREATE INDEX IF NOT EXISTS idx_audit_events_decision ON audit_events(decision);

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

CREATE TABLE IF NOT EXISTS runtime_goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  definition_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  goal_id TEXT REFERENCES runtime_goals(id) ON DELETE SET NULL,
  workflow_id TEXT REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_on_approval', 'paused', 'cancelling', 'cancelled', 'failed', 'completed', 'max_steps_exceeded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_on_approval', 'paused', 'cancelling', 'cancelled', 'failed', 'completed', 'max_steps_exceeded')),
  action_json JSONB,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  data_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS resource_leases (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  holder TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'released', 'expired')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_resource_leases_active
  ON resource_leases(resource_type, resource_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_leases_one_active
  ON resource_leases(resource_type, resource_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  capability TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK(phase IN ('planner', 'executor', 'verifier', 'provider_native')),
  provider TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_run ON model_usage(run_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_session ON model_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_phase ON model_usage(phase);
