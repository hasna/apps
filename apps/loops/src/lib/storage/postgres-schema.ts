import { createHash } from "node:crypto";
import type { StorageMigration } from "./contract.js";

export const POSTGRES_MIGRATION_LEDGER_TABLE = "open_loops_schema_migrations";

export function checksumStorageSql(sql: string): string {
  const normalized = sql.trim().replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function migration(id: string, sql: string): StorageMigration {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumStorageSql(sql) });
}

export const POSTGRES_STORAGE_MIGRATIONS = Object.freeze([
  migration(
    "0001_core_runtime",
    `
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
    `,
  ),
  migration(
    "0002_workflows_goals",
    `
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
    `,
  ),
  migration(
    "0003_remote_runners_and_audit",
    `
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
    `,
  ),
  // Additive per-route --max-active scope (mirrors sqlite migration
  // 0008_work_item_route_scope). MUST be its own migration: postgres migrations
  // are checksummed against the ledger, so editing an already-applied
  // migration's SQL (e.g. folding the column into 0002_workflows_goals) makes
  // every existing database fail `migrate` with a checksum mismatch.
  migration(
    "0004_work_item_route_scope",
    `
ALTER TABLE workflow_work_items ADD COLUMN IF NOT EXISTS route_scope TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_scope ON workflow_work_items(route_scope, status);
    `,
  ),
]);
