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
  migration(
    "0005_run_receipts",
    `
CREATE TABLE IF NOT EXISTS run_receipts (
  run_id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL,
  machine_json JSONB NOT NULL,
  repo TEXT NOT NULL,
  task_ids_json JSONB NOT NULL,
  knowledge_ids_json JSONB NOT NULL,
  digest_id TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  exit_code INTEGER,
  summary_json JSONB NOT NULL,
  evidence_paths_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_receipts_loop ON run_receipts(loop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_receipts_repo ON run_receipts(repo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_receipts_digest ON run_receipts(digest_id);
CREATE INDEX IF NOT EXISTS idx_run_receipts_status ON run_receipts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_receipts_task_ids ON run_receipts USING GIN (task_ids_json);
CREATE INDEX IF NOT EXISTS idx_run_receipts_knowledge_ids ON run_receipts USING GIN (knowledge_ids_json);
    `,
  ),
  // Additive route reservation attribution (mirrors sqlite migration
  // 0010_work_item_machine_id). Released migrations remain immutable.
  migration(
    "0006_work_item_machine_id",
    `
ALTER TABLE workflow_work_items ADD COLUMN IF NOT EXISTS machine_id TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_machine ON workflow_work_items(machine_id, status);
    `,
  ),
  // Additive consecutive gate-death counter (mirrors sqlite migration
  // 0011_work_item_gate_deaths): bounds the retry-forever loop of a
  // deterministic pre-worker infrastructure fault whose attempts are refunded.
  migration(
    "0007_work_item_gate_deaths",
    `
ALTER TABLE workflow_work_items ADD COLUMN IF NOT EXISTS gate_deaths INTEGER NOT NULL DEFAULT 0;
    `,
  ),
  migration(
    "0008_tenant_prepare",
    `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'service', 'machine')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id)
);

CREATE TABLE tenant_roles (
  name TEXT PRIMARY KEY CHECK (name IN ('admin', 'operator', 'member', 'readonly', 'service', 'worker'))
);
INSERT INTO tenant_roles(name) VALUES ('admin'), ('operator'), ('member'), ('readonly'), ('service'), ('worker');

CREATE TABLE tenant_membership_roles (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES tenant_roles(name),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id, role),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships(tenant_id, principal_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
  kid TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  agent TEXT,
  scopes JSONB NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  last_used_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT;
ALTER TABLE api_keys ADD COLUMN principal_id TEXT;
ALTER TABLE api_keys ADD COLUMN token_kind TEXT;
ALTER TABLE api_keys ADD COLUMN disabled_at TIMESTAMPTZ;

ALTER TABLE loops ADD COLUMN tenant_id TEXT;
ALTER TABLE loop_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE daemon_lease ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_specs ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_invocations ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_work_items ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_step_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_events ADD COLUMN tenant_id TEXT;
ALTER TABLE goals ADD COLUMN tenant_id TEXT;
ALTER TABLE goal_plan_nodes ADD COLUMN tenant_id TEXT;
ALTER TABLE goal_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE runner_machines ADD COLUMN tenant_id TEXT;
ALTER TABLE runner_leases ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_events ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_events ADD COLUMN principal_id TEXT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;
ALTER TABLE audit_events ADD COLUMN operation_id TEXT;
ALTER TABLE audit_events ADD COLUMN decision TEXT;
ALTER TABLE audit_events ADD COLUMN deny_reason TEXT;
ALTER TABLE run_receipts ADD COLUMN tenant_id TEXT;

CREATE TABLE tenant_row_assignments (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (table_name, row_id),
  CHECK (table_name IN (
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
    'audit_events', 'run_receipts'
  ))
);

CREATE TABLE api_key_tenant_bindings (
  kid TEXT PRIMARY KEY REFERENCES api_keys(kid) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('api_key', 'service', 'machine')),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships(tenant_id, principal_id)
);

CREATE TABLE preauth_audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  deny_reason TEXT NOT NULL,
  metadata_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
    `,
  ),
  migration(
    "0009_tenant_backfill",
    `
DO $tenant_backfill$
DECLARE
  target_table TEXT;
  id_column TEXT;
  missing_count BIGINT;
  mapping_count BIGINT;
BEGIN
  FOR target_table, id_column IN
    SELECT * FROM (VALUES
      ('loops', 'id'), ('loop_runs', 'id'), ('daemon_lease', 'id'),
      ('workflow_specs', 'id'), ('workflow_runs', 'id'), ('workflow_invocations', 'id'),
      ('workflow_work_items', 'id'), ('workflow_step_runs', 'id'), ('workflow_events', 'id'),
      ('goals', 'id'), ('goal_plan_nodes', 'id'), ('goal_runs', 'id'),
      ('runner_machines', 'id'), ('runner_leases', 'id'), ('audit_events', 'id'),
      ('run_receipts', 'run_id')
    ) AS targets(table_name, row_id_column)
  LOOP
    EXECUTE format(
      'UPDATE %I target SET tenant_id = assignment.tenant_id FROM tenant_row_assignments assignment WHERE assignment.table_name = $1 AND assignment.row_id = target.%I',
      target_table, id_column
    ) USING target_table;
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', target_table) INTO missing_count;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'tenant backfill incomplete for %: % rows have no explicit assignment', target_table, missing_count;
    END IF;
    EXECUTE format('SELECT count(*) FROM tenant_row_assignments WHERE table_name = $1') INTO mapping_count USING target_table;
    EXECUTE format('SELECT count(*) FROM %I', target_table) INTO missing_count;
    IF mapping_count <> missing_count THEN
      RAISE EXCEPTION 'tenant assignment cardinality mismatch for %: mappings %, rows %', target_table, mapping_count, missing_count;
    END IF;
  END LOOP;

  UPDATE api_keys key
     SET tenant_id = binding.tenant_id,
         principal_id = binding.principal_id,
         token_kind = binding.token_kind
    FROM api_key_tenant_bindings binding
   WHERE binding.kid = key.kid;
  SELECT count(*) INTO missing_count
    FROM api_keys
   WHERE tenant_id IS NULL OR principal_id IS NULL OR token_kind IS NULL
      OR agent IS DISTINCT FROM principal_id;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'api key tenant backfill incomplete: % keys have no exact principal binding', missing_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM loop_runs child JOIN loops parent ON parent.id = child.loop_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_runs child JOIN workflow_specs parent ON parent.id = child.workflow_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_work_items child JOIN workflow_invocations parent ON parent.id = child.invocation_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_step_runs child JOIN workflow_runs parent ON parent.id = child.workflow_run_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_events child JOIN workflow_runs parent ON parent.id = child.workflow_run_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM goal_plan_nodes child JOIN goals parent ON parent.id = child.goal_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM goal_runs child JOIN goals parent ON parent.id = child.goal_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM runner_leases child JOIN runner_machines parent ON parent.id = child.runner_id WHERE child.tenant_id <> parent.tenant_id
  ) THEN
    RAISE EXCEPTION 'tenant backfill contains cross-tenant parent/child relationships';
  END IF;
END
$tenant_backfill$;
    `,
  ),
  migration(
    "0010_tenant_enforce",
    `
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_owner') THEN CREATE ROLE open_loops_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_migrator') THEN CREATE ROLE open_loops_migrator NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_runtime') THEN CREATE ROLE open_loops_runtime NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_authenticator') THEN CREATE ROLE open_loops_authenticator NOLOGIN NOBYPASSRLS; END IF;
END
$roles$;
ALTER ROLE open_loops_owner INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE open_loops_migrator INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE open_loops_runtime INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE open_loops_authenticator INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

DO $service_role_memberships$
DECLARE membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
      FROM pg_auth_members relation
      JOIN pg_roles granted ON granted.oid=relation.roleid
      JOIN pg_roles member ON member.oid=relation.member
     WHERE member.rolname IN ('open_loops_runtime', 'open_loops_authenticator')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
$service_role_memberships$;

DO $service_member_acl$
DECLARE service_member RECORD;
BEGIN
  FOR service_member IN
  SELECT DISTINCT member.oid AS member_oid, member.rolname AS member_role
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
   WHERE granted.rolname IN ('open_loops_runtime', 'open_loops_authenticator')
     AND member.rolcanlogin
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_shdepend dependency
       WHERE dependency.refclassid = 'pg_authid'::regclass
         AND dependency.refobjid = service_member.member_oid
         AND dependency.deptype = 'o'
         AND dependency.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
    ) THEN
      RAISE EXCEPTION 'service login % owns database objects; reassign or remove them before tenant enforcement',
        service_member.member_role;
    END IF;
    EXECUTE format('DROP OWNED BY %I', service_member.member_role);
  END LOOP;
END
$service_member_acl$;

DO $service_role_acl$
DECLARE namespace RECORD;
DECLARE database_grantee RECORD;
BEGIN
  FOR database_grantee IN
    SELECT DISTINCT grantee.rolname AS grantee_role
      FROM pg_database database
      CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
      JOIN pg_roles grantee ON grantee.oid=acl.grantee
     WHERE database.datname=current_database()
       AND acl.grantee<>database.datdba
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), database_grantee.grantee_role);
  END LOOP;
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC',
    current_database()
  );
  FOR namespace IN
    SELECT nspname
      FROM pg_namespace
     WHERE nspname NOT IN ('pg_catalog', 'information_schema')
       AND nspname NOT LIKE 'pg_toast%'
       AND nspname NOT LIKE 'pg_temp_%'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC, open_loops_runtime, open_loops_authenticator',
      namespace.nspname
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, open_loops_runtime, open_loops_authenticator',
      namespace.nspname
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, open_loops_runtime, open_loops_authenticator',
      namespace.nspname
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM open_loops_runtime, open_loops_authenticator',
      namespace.nspname
    );
    IF namespace.nspname <> 'public' THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM PUBLIC', namespace.nspname);
    END IF;
  END LOOP;
END
$service_role_acl$;

DO $unsafe_service_members$
DECLARE unsafe_member RECORD;
BEGIN
  FOR unsafe_member IN
  SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
   WHERE granted.rolname IN ('open_loops_runtime', 'open_loops_authenticator')
     AND (membership.admin_option OR NOT membership.inherit_option OR NOT membership.set_option OR
          NOT member.rolcanlogin OR NOT member.rolinherit OR
          member.rolsuper OR member.rolbypassrls OR member.rolcreatedb OR
          member.rolcreaterole OR member.rolreplication OR
          pg_has_role(member.oid, 'open_loops_owner', 'MEMBER') OR
          pg_has_role(member.oid, 'open_loops_migrator', 'MEMBER') OR
          EXISTS (
            SELECT 1 FROM pg_auth_members other_membership
             WHERE other_membership.member = member.oid
               AND other_membership.roleid <> granted.oid
          ) OR
          EXISTS (
            SELECT 1 FROM pg_auth_members downstream_membership
             WHERE downstream_membership.roleid = member.oid
          ) OR
          (granted.rolname = 'open_loops_runtime' AND
            pg_has_role(member.oid, 'open_loops_authenticator', 'MEMBER')) OR
          (granted.rolname = 'open_loops_authenticator' AND
            pg_has_role(member.oid, 'open_loops_runtime', 'MEMBER')))
  LOOP
    EXECUTE format('REVOKE %I FROM %I', unsafe_member.granted_role, unsafe_member.member_role);
  END LOOP;
END
$unsafe_service_members$;

DO $service_connect$
DECLARE service_member RECORD;
BEGIN
  FOR service_member IN
  SELECT DISTINCT member.rolname AS member_role
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
   WHERE granted.rolname IN ('open_loops_runtime', 'open_loops_authenticator')
     AND member.rolcanlogin
  LOOP
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), service_member.member_role);
  END LOOP;
END
$service_connect$;

REVOKE open_loops_owner, open_loops_migrator, open_loops_authenticator FROM open_loops_runtime;
REVOKE open_loops_owner, open_loops_migrator, open_loops_runtime FROM open_loops_authenticator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM open_loops_runtime, open_loops_authenticator;
GRANT USAGE ON SCHEMA public TO open_loops_runtime, open_loops_authenticator;
GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;

ALTER TABLE loop_runs DROP CONSTRAINT loop_runs_loop_id_fkey;
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_workflow_id_fkey;
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_loop_id_fkey;
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_loop_run_id_fkey;
ALTER TABLE workflow_work_items DROP CONSTRAINT workflow_work_items_invocation_id_fkey;
ALTER TABLE workflow_work_items DROP CONSTRAINT workflow_work_items_workflow_id_fkey;
ALTER TABLE workflow_work_items DROP CONSTRAINT workflow_work_items_loop_id_fkey;
ALTER TABLE workflow_work_items DROP CONSTRAINT workflow_work_items_workflow_run_id_fkey;
ALTER TABLE workflow_step_runs DROP CONSTRAINT workflow_step_runs_workflow_run_id_fkey;
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_workflow_run_id_fkey;
ALTER TABLE goal_plan_nodes DROP CONSTRAINT goal_plan_nodes_goal_id_fkey;
ALTER TABLE goal_runs DROP CONSTRAINT goal_runs_goal_id_fkey;
ALTER TABLE runner_leases DROP CONSTRAINT runner_leases_runner_id_fkey;
ALTER TABLE runner_leases DROP CONSTRAINT runner_leases_loop_run_id_fkey;
ALTER TABLE runner_leases DROP CONSTRAINT runner_leases_workflow_run_id_fkey;
ALTER TABLE runner_leases DROP CONSTRAINT runner_leases_check;

ALTER TABLE loops DROP CONSTRAINT loops_pkey;
ALTER TABLE loop_runs DROP CONSTRAINT loop_runs_pkey;
ALTER TABLE loop_runs DROP CONSTRAINT loop_runs_loop_id_scheduled_for_key;
ALTER TABLE daemon_lease DROP CONSTRAINT daemon_lease_pkey;
ALTER TABLE workflow_specs DROP CONSTRAINT workflow_specs_pkey;
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_pkey;
ALTER TABLE workflow_invocations DROP CONSTRAINT workflow_invocations_pkey;
ALTER TABLE workflow_work_items DROP CONSTRAINT workflow_work_items_pkey;
ALTER TABLE workflow_work_items DROP CONSTRAINT workflow_work_items_route_key_idempotency_key_key;
ALTER TABLE workflow_step_runs DROP CONSTRAINT workflow_step_runs_pkey;
ALTER TABLE workflow_step_runs DROP CONSTRAINT workflow_step_runs_workflow_run_id_step_id_key;
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_pkey;
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_workflow_run_id_sequence_key;
ALTER TABLE goals DROP CONSTRAINT goals_pkey;
ALTER TABLE goal_plan_nodes DROP CONSTRAINT goal_plan_nodes_pkey;
ALTER TABLE goal_plan_nodes DROP CONSTRAINT goal_plan_nodes_plan_id_key_key;
ALTER TABLE goal_runs DROP CONSTRAINT goal_runs_pkey;
ALTER TABLE runner_machines DROP CONSTRAINT runner_machines_pkey;
ALTER TABLE runner_leases DROP CONSTRAINT runner_leases_pkey;
ALTER TABLE run_receipts DROP CONSTRAINT run_receipts_pkey;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_pkey;

DROP INDEX idx_workflows_name_active;
DROP INDEX idx_workflow_runs_idempotency;
DROP INDEX idx_workflow_invocations_dedupe;
DROP INDEX idx_runner_leases_active_loop_run;
DROP INDEX idx_runner_leases_active_workflow_run;

CREATE OR REPLACE FUNCTION public.open_loops_current_tenant_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
RETURN NULLIF(pg_catalog.current_setting('open_loops.tenant_id', true), '');
ALTER FUNCTION public.open_loops_current_tenant_id() OWNER TO open_loops_owner;
DO $tenant_function_acl$
DECLARE grantee RECORD;
BEGIN
  FOR grantee IN
    SELECT rolname
      FROM pg_roles
     WHERE rolname NOT IN ('open_loops_owner', 'open_loops_runtime')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.open_loops_current_tenant_id() FROM %I',
      grantee.rolname
    );
  END LOOP;
END
$tenant_function_acl$;
REVOKE ALL ON FUNCTION public.open_loops_current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_loops_current_tenant_id() TO open_loops_runtime;

DO $tenant_defaults$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases', 'run_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT public.open_loops_current_tenant_id()', table_name);
  END LOOP;
END
$tenant_defaults$;

ALTER TABLE loops ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE loop_runs ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id), ADD UNIQUE (tenant_id, loop_id, scheduled_for);
ALTER TABLE daemon_lease ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE workflow_specs ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE workflow_runs ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE workflow_invocations ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE workflow_work_items ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id), ADD UNIQUE (tenant_id, route_key, idempotency_key);
ALTER TABLE workflow_step_runs ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id), ADD UNIQUE (tenant_id, workflow_run_id, step_id);
ALTER TABLE workflow_events ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id), ADD UNIQUE (tenant_id, workflow_run_id, sequence);
ALTER TABLE goals ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE goal_plan_nodes ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id), ADD UNIQUE (tenant_id, plan_id, key);
ALTER TABLE goal_runs ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE runner_machines ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE runner_leases ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE run_receipts ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, run_id);
ALTER TABLE audit_events ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE api_keys
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN principal_id SET NOT NULL,
  ALTER COLUMN token_kind SET NOT NULL,
  ADD FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships(tenant_id, principal_id),
  ADD CHECK (app = 'loops'),
  ADD CHECK (token_kind IN ('api_key', 'service', 'machine')),
  ADD CHECK (jsonb_typeof(scopes) = 'array');

DO $tenant_foreign_keys$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
    'audit_events', 'run_receipts'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
      table_name,
      table_name || '_tenant_id_fkey'
    );
  END LOOP;
END
$tenant_foreign_keys$;

ALTER TABLE loop_runs ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE SET NULL (loop_id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id) ON DELETE SET NULL (loop_run_id);
ALTER TABLE workflow_invocations ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id);
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, invocation_id) REFERENCES workflow_invocations(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id) ON DELETE SET NULL (workflow_id);
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE SET NULL (loop_id);
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE SET NULL (workflow_run_id);
ALTER TABLE workflow_step_runs ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE workflow_events ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE goal_plan_nodes ADD FOREIGN KEY (tenant_id, goal_id) REFERENCES goals(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, goal_id) REFERENCES goals(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE runner_leases ADD FOREIGN KEY (tenant_id, runner_id) REFERENCES runner_machines(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE runner_leases ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE runner_leases ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE runner_leases ADD CONSTRAINT runner_leases_exactly_one_run CHECK (num_nonnulls(loop_run_id, workflow_run_id) = 1);
ALTER TABLE run_receipts ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id);

ALTER TABLE loop_runs ADD FOREIGN KEY (tenant_id, goal_run_id) REFERENCES goal_runs(tenant_id, id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, invocation_id) REFERENCES workflow_invocations(tenant_id, id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, work_item_id) REFERENCES workflow_work_items(tenant_id, id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, goal_run_id) REFERENCES goal_runs(tenant_id, id);
ALTER TABLE workflow_step_runs ADD FOREIGN KEY (tenant_id, goal_run_id) REFERENCES goal_runs(tenant_id, id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id);

CREATE UNIQUE INDEX idx_workflows_name_active ON workflow_specs(tenant_id, name) WHERE status = 'active';
CREATE UNIQUE INDEX idx_workflow_runs_idempotency ON workflow_runs(tenant_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_workflow_invocations_dedupe ON workflow_invocations(tenant_id, source_kind, source_dedupe_key) WHERE source_dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX idx_runner_leases_active_loop_run ON runner_leases(tenant_id, loop_run_id) WHERE loop_run_id IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX idx_runner_leases_active_workflow_run ON runner_leases(tenant_id, workflow_run_id) WHERE workflow_run_id IS NOT NULL AND status = 'active';

DO $rls$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_memberships', 'tenant_membership_roles', 'api_keys',
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
    'audit_events', 'run_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = public.open_loops_current_tenant_id()) WITH CHECK (tenant_id = public.open_loops_current_tenant_id())', table_name);
  END LOOP;
END
$rls$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = public.open_loops_current_tenant_id())
  WITH CHECK (id = public.open_loops_current_tenant_id());
CREATE POLICY auth_definer_tenant_lookup ON tenants TO open_loops_owner USING (true);
CREATE POLICY auth_definer_membership_lookup ON tenant_memberships TO open_loops_owner USING (true);
CREATE POLICY auth_definer_membership_roles_lookup ON tenant_membership_roles TO open_loops_owner USING (true);
CREATE POLICY auth_definer_key_lookup ON api_keys TO open_loops_owner USING (true);
CREATE POLICY auth_definer_audit_insert ON audit_events
  FOR INSERT TO open_loops_owner WITH CHECK (true);

DO $owners$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'principals', 'tenant_memberships', 'tenant_roles', 'tenant_membership_roles',
    'api_keys', 'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
    'audit_events', 'run_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO open_loops_owner', table_name);
  END LOOP;
END
$owners$;
ALTER TABLE preauth_audit_events OWNER TO open_loops_owner;
ALTER TABLE open_loops_schema_migrations OWNER TO open_loops_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON loops, loop_runs, daemon_lease, workflow_specs, workflow_runs, workflow_invocations,
  workflow_work_items, workflow_step_runs, workflow_events, goals, goal_plan_nodes, goal_runs,
  runner_machines, runner_leases, run_receipts TO open_loops_runtime;
GRANT SELECT ON open_loops_schema_migrations TO open_loops_runtime;
ALTER TABLE audit_events
  ADD CHECK (decision IS NULL OR decision IN ('allow', 'deny')),
  ADD CHECK (operation_id IS NULL OR operation_id ~ '^[A-Za-z][A-Za-z0-9.]{1,127}$'),
  ADD CHECK (request_id IS NULL OR (length(request_id) BETWEEN 1 AND 128));

CREATE OR REPLACE FUNCTION public.open_loops_authenticate_key(p_kid TEXT, p_token_hash TEXT)
RETURNS TABLE (
  kid TEXT, app TEXT, agent TEXT, scopes JSONB, token_hash TEXT, issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, disabled_at TIMESTAMPTZ,
  tenant_id TEXT, tenant_status TEXT, principal_id TEXT, principal_status TEXT,
  membership_status TEXT, token_kind TEXT, roles TEXT[]
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT key.kid, key.app, key.agent, key.scopes, key.token_hash, key.issued_at,
         key.expires_at, key.revoked_at, key.disabled_at,
         key.tenant_id, tenant.status, key.principal_id, principal.status,
         membership.status, key.token_kind,
         COALESCE(array_agg(membership_role.role ORDER BY membership_role.role)
           FILTER (WHERE membership_role.role IS NOT NULL), ARRAY[]::TEXT[])
    FROM public.api_keys key
    JOIN public.tenants tenant ON tenant.id = key.tenant_id
    JOIN public.principals principal ON principal.id = key.principal_id
    JOIN public.tenant_memberships membership
      ON membership.tenant_id = key.tenant_id AND membership.principal_id = key.principal_id
    LEFT JOIN public.tenant_membership_roles membership_role
      ON membership_role.tenant_id = membership.tenant_id AND membership_role.principal_id = membership.principal_id
   WHERE key.kid = p_kid AND key.token_hash = p_token_hash
   GROUP BY key.kid, key.app, key.agent, key.scopes, key.token_hash, key.issued_at,
            key.expires_at, key.revoked_at, key.disabled_at, key.tenant_id, tenant.status,
            key.principal_id, principal.status, membership.status, key.token_kind;
$$;
ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT)
  FROM PUBLIC, open_loops_runtime, open_loops_authenticator;
GRANT EXECUTE ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) TO open_loops_authenticator;

CREATE OR REPLACE FUNCTION public.open_loops_append_auth_audit(
  p_id TEXT, p_kid TEXT, p_token_hash TEXT, p_request_id TEXT,
  p_operation_id TEXT, p_decision TEXT, p_deny_reason TEXT, p_metadata JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  bound_tenant_id TEXT;
  bound_principal_id TEXT;
BEGIN
  IF p_decision NOT IN ('allow', 'deny') THEN
    RAISE EXCEPTION 'invalid authentication audit decision';
  END IF;
  IF p_operation_id !~ '^[A-Za-z][A-Za-z0-9.]{1,127}$' THEN
    RAISE EXCEPTION 'invalid authentication audit operation';
  END IF;
  IF p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid authentication audit request id';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'invalid authentication audit metadata';
  END IF;
  IF p_decision = 'allow' AND p_deny_reason IS NOT NULL THEN
    RAISE EXCEPTION 'allow audit cannot include a deny reason';
  END IF;

  SELECT key.tenant_id, key.principal_id
    INTO bound_tenant_id, bound_principal_id
    FROM public.api_keys key
   WHERE key.kid = p_kid AND key.token_hash = p_token_hash;

  IF bound_tenant_id IS NULL THEN
    INSERT INTO public.preauth_audit_events(id, request_id, operation_id, deny_reason, metadata_json)
    VALUES (p_id, p_request_id, p_operation_id, COALESCE(p_deny_reason, 'unauthorized'), p_metadata);
  ELSE
    INSERT INTO public.audit_events(
      tenant_id, id, actor, action, subject_type, subject_id, metadata_json, created_at,
      principal_id, request_id, operation_id, decision, deny_reason
    ) VALUES (
      bound_tenant_id, p_id, bound_principal_id, 'auth.' || p_decision,
      'api_request', p_request_id, p_metadata, now(), bound_principal_id, p_request_id,
      p_operation_id, p_decision, p_deny_reason
    );
  END IF;
END
$$;
ALTER FUNCTION public.open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, open_loops_runtime, open_loops_authenticator;
GRANT EXECUTE ON FUNCTION public.open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO open_loops_authenticator;

REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;

DO $tenant_enforcement_postconditions$
DECLARE tenant_function REGPROCEDURE := 'public.open_loops_current_tenant_id()'::regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname IN ('open_loops_owner', 'open_loops_migrator', 'open_loops_runtime', 'open_loops_authenticator')
       AND (rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'tenant enforcement did not normalize OpenLoops database roles';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = tenant_function) <> 'open_loops_owner' THEN
    RAISE EXCEPTION 'tenant enforcement did not secure the tenant context function owner';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc proc,
           LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
     WHERE proc.oid = tenant_function
       AND acl.privilege_type = 'EXECUTE'
       AND acl.grantee NOT IN (
         (SELECT oid FROM pg_roles WHERE rolname='open_loops_owner'),
         (SELECT oid FROM pg_roles WHERE rolname='open_loops_runtime')
       )
  ) THEN
    RAISE EXCEPTION 'tenant enforcement left an unexpected tenant context function grant';
  END IF;
  IF NOT has_function_privilege('open_loops_runtime', tenant_function, 'EXECUTE') OR
     has_function_privilege('open_loops_authenticator', tenant_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'tenant enforcement tenant context function grants are incomplete';
  END IF;
  IF has_schema_privilege('open_loops_owner', 'public', 'CREATE') OR
     has_schema_privilege('open_loops_migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'tenant enforcement left bootstrap schema creation privileges enabled';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
     WHERE granted.rolname IN ('open_loops_runtime', 'open_loops_authenticator')
       AND member.rolcanlogin
       AND NOT EXISTS (
         SELECT 1
           FROM pg_database database
           CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
          WHERE database.datname = current_database()
            AND acl.grantee = member.oid
            AND acl.privilege_type = 'CONNECT'
       )
  ) THEN
    RAISE EXCEPTION 'tenant enforcement did not grant direct database CONNECT to every service login';
  END IF;
END
$tenant_enforcement_postconditions$;

DROP TABLE api_key_tenant_bindings;
DROP TABLE tenant_row_assignments;
    `,
  ),
]);
