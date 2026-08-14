-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0002_workflows_goals"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:cf9d74beafadaf97dcb26c3d584caa634265fb99978704417886c58d1f804b42)

CREATE TABLE IF NOT EXISTS workflow_specs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  goal_json JSONB,
  steps_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_status_name ON workflow_specs(status, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_name_active ON workflow_specs(name) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_specs(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,
  loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
  loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE SET NULL,
  invocation_id TEXT,
  work_item_id TEXT,
  scheduled_for TIMESTAMPTZ,
  idempotency_key TEXT,
  manifest_path TEXT,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  goal_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency ON workflow_runs(workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_created ON workflow_runs(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_loop_run ON workflow_runs(loop_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_invocation ON workflow_runs(invocation_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_work_item ON workflow_runs(work_item_id);

CREATE TABLE IF NOT EXISTS workflow_invocations (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  template_id TEXT,
  source_kind TEXT NOT NULL,
  source_id TEXT,
  source_dedupe_key TEXT,
  source_json JSONB NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT,
  subject_path TEXT,
  subject_url TEXT,
  subject_json JSONB NOT NULL,
  intent TEXT NOT NULL,
  scope_json JSONB,
  output_policy_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_invocations_source ON workflow_invocations(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_workflow_invocations_subject ON workflow_invocations(subject_kind, subject_id, subject_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_invocations_dedupe ON workflow_invocations(source_kind, source_dedupe_key) WHERE source_dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_work_items (
  id TEXT PRIMARY KEY,
  route_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES workflow_invocations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  project_key TEXT,
  project_group TEXT,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_attempt_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  workflow_id TEXT REFERENCES workflow_specs(id) ON DELETE SET NULL,
  loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  last_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(route_key, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_status_next ON workflow_work_items(status, next_attempt_at, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_project ON workflow_work_items(project_key, status);
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_group ON workflow_work_items(project_group, status);
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_invocation ON workflow_work_items(invocation_id);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  exit_code INTEGER,
  pid INTEGER,
  duration_ms INTEGER,
  stdout TEXT,
  stderr TEXT,
  error TEXT,
  account_profile TEXT,
  account_tool TEXT,
  goal_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(workflow_run_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run_sequence ON workflow_step_runs(workflow_run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_status ON workflow_step_runs(status);

CREATE TABLE IF NOT EXISTS workflow_events (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  step_id TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(workflow_run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_workflow_events_run_sequence ON workflow_events(workflow_run_id, sequence);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  token_budget INTEGER,
  tokens_used INTEGER NOT NULL,
  time_used_seconds INTEGER NOT NULL,
  auto_execute TEXT NOT NULL,
  max_tokens INTEGER,
  source_type TEXT,
  source_id TEXT,
  loop_id TEXT,
  loop_run_id TEXT,
  workflow_id TEXT,
  workflow_run_id TEXT,
  workflow_step_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_status_updated ON goals(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_loop_run ON goals(loop_run_id);
CREATE INDEX IF NOT EXISTS idx_goals_workflow_run ON goals(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_goals_source ON goals(source_type, source_id);

CREATE TABLE IF NOT EXISTS goal_plan_nodes (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  key TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  ready BOOLEAN NOT NULL,
  token_budget INTEGER,
  tokens_used INTEGER NOT NULL,
  time_used_seconds INTEGER NOT NULL,
  depends_on_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(plan_id, key)
);
CREATE INDEX IF NOT EXISTS idx_goal_plan_nodes_goal_sequence ON goal_plan_nodes(goal_id, sequence);
CREATE INDEX IF NOT EXISTS idx_goal_plan_nodes_status ON goal_plan_nodes(status);

CREATE TABLE IF NOT EXISTS goal_runs (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  loop_id TEXT,
  loop_run_id TEXT,
  workflow_id TEXT,
  workflow_run_id TEXT,
  workflow_step_id TEXT,
  turn INTEGER NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  node_key TEXT,
  tokens_used INTEGER NOT NULL,
  evidence_json JSONB,
  raw_response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_runs_goal_created ON goal_runs(goal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_goal_runs_loop_run ON goal_runs(loop_run_id);
CREATE INDEX IF NOT EXISTS idx_goal_runs_workflow_run ON goal_runs(workflow_run_id);
