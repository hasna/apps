import { createHash } from "node:crypto";
import type { StorageMigration } from "./contract.js";

export const POSTGRES_MIGRATION_LEDGER_TABLE = "open_loops_schema_migrations";
export const POSTGRES_MIGRATION_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(1330466384, 1280262987)";

export function checksumStorageSql(sql: string): string {
  const normalized = sql.trim().replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function migration(id: string, sql: string): StorageMigration {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumStorageSql(sql) });
}

export const POSTGRES_TENANT_BOOTSTRAP_ROLES_SQL = `
DO $bootstrap_roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'open_loops_owner', 'open_loops_migrator',
    'open_loops_runtime', 'open_loops_authenticator'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
    ELSIF EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname=role_name AND rolcanlogin
    ) THEN
      RAISE EXCEPTION 'reserved OpenLoops database role % is LOGIN; detach or replace that credential with provider authority before tenant enforcement',
        role_name;
    ELSIF EXISTS (
      SELECT 1 FROM pg_roles
       WHERE rolname=role_name
         AND (NOT rolinherit OR rolsuper OR rolcreatedb OR
              rolcreaterole OR rolreplication OR rolbypassrls)
    ) THEN
      EXECUTE format(
        'ALTER ROLE %I INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
  END LOOP;
END
$bootstrap_roles$;
`.trim();

export const POSTGRES_TENANT_CLUSTER_ROLE_EXCLUSIVITY_SQL = `
DO $cluster_role_exclusivity$
DECLARE cross_database_dependency RECORD;
BEGIN
  SELECT role.rolname AS role_name,
         COALESCE(database.datname, dependency.dbid::text) AS database_name
    INTO cross_database_dependency
    FROM pg_shdepend dependency
    JOIN pg_roles role
      ON role.oid=dependency.refobjid
     AND dependency.refclassid='pg_authid'::regclass
    LEFT JOIN pg_database database ON database.oid=dependency.dbid
   WHERE role.rolname IN (
     'open_loops_owner', 'open_loops_migrator',
     'open_loops_runtime', 'open_loops_authenticator'
   )
     AND dependency.dbid NOT IN (
       0,
       (SELECT oid FROM pg_database WHERE datname=current_database())
     )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'reserved OpenLoops role % has a dependency in database %; use a dedicated cluster or remove the cross-database dependency before tenant enforcement',
      cross_database_dependency.role_name,
      cross_database_dependency.database_name;
  END IF;

  SELECT role.rolname AS role_name, database.datname AS database_name
    INTO cross_database_dependency
    FROM pg_database database
    JOIN pg_roles role ON role.oid=database.datdba
   WHERE role.rolname IN (
     'open_loops_owner', 'open_loops_migrator',
     'open_loops_runtime', 'open_loops_authenticator'
   )
     AND database.datname<>current_database()
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'reserved OpenLoops role % owns database %; role names must be exclusive to the dedicated OpenLoops cluster',
      cross_database_dependency.role_name,
      cross_database_dependency.database_name;
  END IF;
END
$cluster_role_exclusivity$;
`.trim();

export const POSTGRES_TENANT_BOOTSTRAP_MEMBERSHIPS_SQL = `
DO $bootstrap_memberships$
DECLARE bootstrap_name NAME := session_user;
DECLARE bootstrap_superuser BOOLEAN;
DECLARE relevant_membership_count BIGINT;
DECLARE safe_privileged_role_count BIGINT;
BEGIN
  IF bootstrap_name IN (
    'open_loops_owner', 'open_loops_migrator',
    'open_loops_runtime', 'open_loops_authenticator'
  ) THEN
    RAISE EXCEPTION 'tenant enforcement bootstrap login must be distinct from OpenLoops database roles';
  END IF;
  SELECT rolsuper INTO bootstrap_superuser FROM pg_roles WHERE rolname=bootstrap_name;

  -- PostgreSQL 16 grants CREATEROLE creators membership in newly created roles,
  -- but createrole_self_grant defaults to empty: ADMIN can be true while
  -- INHERIT and SET are false. Only a superuser can revoke the implicit row,
  -- whose grantor is PostgreSQL's bootstrap superuser. A non-superuser runner
  -- must therefore receive exact memberships during provider bootstrap.
  IF bootstrap_superuser THEN
    EXECUTE format(
      'REVOKE open_loops_owner, open_loops_migrator, open_loops_runtime, open_loops_authenticator FROM %I',
      bootstrap_name
    );
    EXECUTE format(
      'GRANT open_loops_owner, open_loops_migrator TO %I WITH ADMIN FALSE, INHERIT TRUE, SET TRUE',
      bootstrap_name
    );
  END IF;

  SELECT count(*),
         count(DISTINCT granted.rolname) FILTER (
           WHERE granted.rolname IN ('open_loops_owner', 'open_loops_migrator')
             AND NOT membership.admin_option
             AND membership.inherit_option
             AND membership.set_option
         )
    INTO relevant_membership_count, safe_privileged_role_count
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_roles member ON member.oid=membership.member
   WHERE member.rolname=bootstrap_name
     AND granted.rolname IN (
       'open_loops_owner', 'open_loops_migrator',
       'open_loops_runtime', 'open_loops_authenticator'
     );

  IF NOT bootstrap_superuser AND (
    pg_has_role(bootstrap_name, 'open_loops_runtime', 'MEMBER') OR
    pg_has_role(bootstrap_name, 'open_loops_authenticator', 'MEMBER') OR
    relevant_membership_count <> 2 OR safe_privileged_role_count <> 2
  ) THEN
    RAISE EXCEPTION 'non-superuser tenant enforcement requires pre-provisioned owner/migrator memberships with ADMIN FALSE, INHERIT TRUE, SET TRUE and no runtime/authenticator membership';
  END IF;
  IF NOT bootstrap_superuser AND EXISTS (
    SELECT 1
     FROM pg_roles service_login
     WHERE service_login.rolcanlogin
       AND NOT service_login.rolsuper
       AND service_login.rolname<>bootstrap_name
       AND (
         pg_has_role(service_login.oid, 'open_loops_runtime', 'MEMBER') OR
         pg_has_role(service_login.oid, 'open_loops_authenticator', 'MEMBER')
       )
  ) THEN
    RAISE EXCEPTION 'non-superuser tenant enforcement must run before runtime/authenticator service login memberships are provisioned';
  END IF;
  IF bootstrap_superuser AND (
    relevant_membership_count <> 2 OR safe_privileged_role_count <> 2
  ) THEN
    RAISE EXCEPTION 'tenant enforcement did not normalize bootstrap role memberships';
  END IF;
END
$bootstrap_memberships$;
`.trim();

export const POSTGRES_TENANT_PRIVILEGED_MEMBERSHIPS_SQL = `
DO $privileged_role_membership_acl$
DECLARE unsafe_membership RECORD;
BEGIN
  SELECT granted.rolname AS granted_role, member.rolname AS member_role
    INTO unsafe_membership
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_roles member ON member.oid=membership.member
   WHERE (granted.rolname IN ('open_loops_owner', 'open_loops_migrator')
      OR member.rolname IN (
        'open_loops_owner', 'open_loops_migrator',
        'open_loops_runtime', 'open_loops_authenticator'
      ))
     AND NOT (
       granted.rolname IN ('open_loops_owner', 'open_loops_migrator')
       AND member.rolname=session_user
       AND NOT membership.admin_option
       AND membership.inherit_option
       AND membership.set_option
     )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'unsafe privileged role membership % to %; remove it with the original grantor or provider authority before tenant enforcement',
      unsafe_membership.granted_role,
      unsafe_membership.member_role;
  END IF;
END
$privileged_role_membership_acl$;
`.trim();

export const POSTGRES_TENANT_SERVICE_ROLE_MEMBERSHIPS_SQL = `
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
`.trim();

export const POSTGRES_TENANT_UNSAFE_SERVICE_MEMBERSHIPS_SQL = `
DO $unsafe_service_members$
DECLARE unsafe_member RECORD;
BEGIN
  FOR unsafe_member IN
  SELECT granted.rolname AS granted_role, member.rolname AS member_role,
         member.rolcanlogin AS member_can_login
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
    IF unsafe_member.member_can_login THEN
      RAISE EXCEPTION 'unsafe service login membership for % in %; normalize it with provider authority before tenant enforcement',
        unsafe_member.member_role,
        unsafe_member.granted_role;
    END IF;
    EXECUTE format('REVOKE %I FROM %I', unsafe_member.granted_role, unsafe_member.member_role);
  END LOOP;
END
$unsafe_service_members$;
`.trim();

export const POSTGRES_TENANT_SERVICE_MEMBER_CLEANUP_SQL = `
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
    IF service_member.member_oid IN (
      (SELECT oid FROM pg_roles WHERE rolname=session_user),
      (SELECT datdba FROM pg_database WHERE datname=current_database()),
      (SELECT nspowner FROM pg_namespace WHERE nspname='public')
    ) THEN
      RAISE EXCEPTION 'provider/bootstrap login % must never be processed as a service login',
        service_member.member_role;
    END IF;
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
`.trim();

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
    "0011_workflow_run_provenance",
    `
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_definition_hash TEXT;
    `,
  ),
  migration(
    "0012_loop_labels",
    `
ALTER TABLE loops ADD COLUMN IF NOT EXISTS labels_json JSONB NOT NULL DEFAULT '[]'::jsonb;
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
${POSTGRES_TENANT_BOOTSTRAP_ROLES_SQL}

${POSTGRES_TENANT_CLUSTER_ROLE_EXCLUSIVITY_SQL}

${POSTGRES_TENANT_BOOTSTRAP_MEMBERSHIPS_SQL}

${POSTGRES_TENANT_SERVICE_ROLE_MEMBERSHIPS_SQL}

${POSTGRES_TENANT_PRIVILEGED_MEMBERSHIPS_SQL}

${POSTGRES_TENANT_UNSAFE_SERVICE_MEMBERSHIPS_SQL}

${POSTGRES_TENANT_SERVICE_MEMBER_CLEANUP_SQL}

DO $service_role_acl$
DECLARE namespace RECORD;
DECLARE database_grantee RECORD;
DECLARE object_grantee RECORD;
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
    SELECT oid, nspname
      FROM pg_namespace
     WHERE nspname NOT IN ('pg_catalog', 'information_schema')
       AND nspname NOT LIKE 'pg_toast%'
       AND nspname NOT LIKE 'pg_temp_%'
  LOOP
    FOR object_grantee IN
      SELECT class.relkind, class.relname,
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE format('%I', grantee.rolname) END AS grantee_sql
        FROM pg_class class
        CROSS JOIN LATERAL aclexplode(class.relacl) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
       WHERE class.relnamespace = namespace.oid
         AND class.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
         AND (acl.grantee = 0 OR grantee.oid IS NOT NULL)
    LOOP
      IF object_grantee.relkind = 'S' THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM %s',
          namespace.nspname,
          object_grantee.relname,
          object_grantee.grantee_sql
        );
      ELSE
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %s',
          namespace.nspname,
          object_grantee.relname,
          object_grantee.grantee_sql
        );
      END IF;
    END LOOP;
    FOR object_grantee IN
      SELECT proc.oid::regprocedure AS function_signature,
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE format('%I', grantee.rolname) END AS grantee_sql
        FROM pg_proc proc
        CROSS JOIN LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
       WHERE proc.pronamespace = namespace.oid
         AND (acl.grantee = 0 OR grantee.oid IS NOT NULL)
    LOOP
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s',
        object_grantee.function_signature,
        object_grantee.grantee_sql
      );
    END LOOP;
    FOR object_grantee IN
      SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE format('%I', grantee.rolname) END AS grantee_sql
        FROM pg_namespace ns
        CROSS JOIN LATERAL aclexplode(ns.nspacl) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
       WHERE ns.oid = namespace.oid
         AND (acl.grantee = 0 OR grantee.oid IS NOT NULL)
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %s', namespace.nspname, object_grantee.grantee_sql);
    END LOOP;
  END LOOP;
END
$service_role_acl$;

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

DO $service_role_cross_memberships$
DECLARE membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
      FROM pg_auth_members relation
      JOIN pg_roles granted ON granted.oid=relation.roleid
      JOIN pg_roles member ON member.oid=relation.member
     WHERE (member.rolname='open_loops_runtime' AND
            granted.rolname IN ('open_loops_owner', 'open_loops_migrator', 'open_loops_authenticator'))
        OR (member.rolname='open_loops_authenticator' AND
            granted.rolname IN ('open_loops_owner', 'open_loops_migrator', 'open_loops_runtime'))
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
$service_role_cross_memberships$;
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
GRANT EXECUTE ON FUNCTION public.open_loops_current_tenant_id() TO open_loops_owner;
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
ALTER TABLE workflow_invocations ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id) ON DELETE SET NULL (workflow_id);
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

ALTER TABLE loop_runs ADD FOREIGN KEY (tenant_id, goal_run_id) REFERENCES goal_runs(tenant_id, id) ON DELETE SET NULL (goal_run_id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, invocation_id) REFERENCES workflow_invocations(tenant_id, id) ON DELETE SET NULL (invocation_id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, work_item_id) REFERENCES workflow_work_items(tenant_id, id) ON DELETE SET NULL (work_item_id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, goal_run_id) REFERENCES goal_runs(tenant_id, id) ON DELETE SET NULL (goal_run_id);
ALTER TABLE workflow_step_runs ADD FOREIGN KEY (tenant_id, goal_run_id) REFERENCES goal_runs(tenant_id, id) ON DELETE SET NULL (goal_run_id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE SET NULL (loop_id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id) ON DELETE SET NULL (loop_run_id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id) ON DELETE SET NULL (workflow_id);
ALTER TABLE goals ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE SET NULL (workflow_run_id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE SET NULL (loop_id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id) ON DELETE SET NULL (loop_run_id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id) ON DELETE SET NULL (workflow_id);
ALTER TABLE goal_runs ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE SET NULL (workflow_run_id);

CREATE UNIQUE INDEX idx_workflows_name_active ON workflow_specs(tenant_id, name) WHERE status = 'active';
CREATE UNIQUE INDEX idx_workflow_runs_idempotency ON workflow_runs(tenant_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_workflow_invocations_dedupe ON workflow_invocations(tenant_id, source_kind, source_dedupe_key) WHERE source_dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX idx_runner_leases_active_loop_run ON runner_leases(tenant_id, loop_run_id) WHERE loop_run_id IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX idx_runner_leases_active_workflow_run ON runner_leases(tenant_id, workflow_run_id) WHERE workflow_run_id IS NOT NULL AND status = 'active';

DO $rls_policy_reset$
DECLARE policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(ARRAY[
         'tenants', 'tenant_memberships', 'tenant_membership_roles', 'api_keys',
         'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
         'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
         'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
         'audit_events', 'run_receipts'
       ])
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  END LOOP;
END
$rls_policy_reset$;

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

GRANT SELECT, UPDATE, REFERENCES ON tenants TO open_loops_owner;
SET ROLE open_loops_owner;
DO $tenant_foreign_keys_owner$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
    'audit_events', 'run_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', table_name, table_name || '_tenant_id_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
      table_name,
      table_name || '_tenant_id_fkey'
    );
  END LOOP;
END
$tenant_foreign_keys_owner$;
RESET ROLE;

GRANT SELECT, INSERT, UPDATE, DELETE ON loops, loop_runs, daemon_lease, workflow_specs, workflow_runs, workflow_invocations,
  workflow_work_items, workflow_step_runs, workflow_events, goals, goal_plan_nodes, goal_runs,
  runner_machines, runner_leases, run_receipts TO open_loops_runtime;
GRANT SELECT, UPDATE, REFERENCES ON tenants TO open_loops_runtime;
GRANT SELECT ON open_loops_schema_migrations TO open_loops_runtime;

CREATE OR REPLACE FUNCTION public.open_loops_reject_runtime_tenant_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF pg_has_role(current_user, 'open_loops_runtime', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role cannot update tenants' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.open_loops_reject_runtime_tenant_update() OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.open_loops_reject_runtime_tenant_update() FROM PUBLIC, open_loops_runtime, open_loops_authenticator;
DROP TRIGGER IF EXISTS open_loops_reject_runtime_tenant_update ON tenants;
CREATE TRIGGER open_loops_reject_runtime_tenant_update
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.open_loops_reject_runtime_tenant_update();

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

DO $auth_function_acl$
DECLARE function_acl RECORD;
BEGIN
  FOR function_acl IN
    SELECT proc.oid::regprocedure AS function_signature,
           CASE WHEN proc.oid = 'public.open_loops_current_tenant_id()'::regprocedure
             THEN (SELECT oid FROM pg_roles WHERE rolname = 'open_loops_runtime')
             ELSE (SELECT oid FROM pg_roles WHERE rolname = 'open_loops_authenticator')
           END AS allowed_grantee,
           acl.grantee,
           CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE format('%I', grantee.rolname) END AS grantee_sql
      FROM pg_proc proc
      CROSS JOIN LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE proc.oid = ANY(ARRAY[
       'public.open_loops_current_tenant_id()'::regprocedure,
       'public.open_loops_authenticate_key(text,text)'::regprocedure,
       'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'::regprocedure
     ])
       AND (acl.grantee = 0 OR grantee.oid IS NOT NULL)
       AND acl.grantee <> CASE WHEN proc.oid = 'public.open_loops_current_tenant_id()'::regprocedure
         THEN (SELECT oid FROM pg_roles WHERE rolname = 'open_loops_runtime')
         ELSE (SELECT oid FROM pg_roles WHERE rolname = 'open_loops_authenticator')
       END
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s', function_acl.function_signature, function_acl.grantee_sql);
  END LOOP;
END
$auth_function_acl$;

REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;

${POSTGRES_TENANT_PRIVILEGED_MEMBERSHIPS_SQL}

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
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members auth_membership
      JOIN pg_roles granted ON granted.oid = auth_membership.roleid
      JOIN pg_roles member ON member.oid = auth_membership.member
     WHERE (granted.rolname IN ('open_loops_owner', 'open_loops_migrator')
        OR member.rolname IN ('open_loops_owner', 'open_loops_migrator', 'open_loops_runtime', 'open_loops_authenticator'))
       AND NOT (
         granted.rolname IN ('open_loops_owner', 'open_loops_migrator')
         AND member.rolname = session_user
         AND NOT auth_membership.admin_option
         AND auth_membership.inherit_option
         AND auth_membership.set_option
       )
  ) THEN
    RAISE EXCEPTION 'tenant enforcement left privileged role memberships unsafe';
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
      FROM unnest(ARRAY[
        'tenants', 'tenant_memberships', 'tenant_membership_roles', 'api_keys',
        'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
        'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
        'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
        'audit_events', 'run_receipts'
      ]) AS protected_table(name)
      JOIN pg_class class ON class.oid = format('public.%I', protected_table.name)::regclass
     WHERE pg_get_userbyid(class.relowner) <> 'open_loops_owner'
        OR NOT class.relrowsecurity
        OR NOT class.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'tenant enforcement did not secure protected table ownership and RLS flags';
  END IF;
  IF EXISTS (
    WITH protected(table_name, discriminator) AS (
      VALUES
        ('tenants', 'id'),
        ('tenant_memberships', 'tenant_id'),
        ('tenant_membership_roles', 'tenant_id'),
        ('api_keys', 'tenant_id'),
        ('loops', 'tenant_id'),
        ('loop_runs', 'tenant_id'),
        ('daemon_lease', 'tenant_id'),
        ('workflow_specs', 'tenant_id'),
        ('workflow_runs', 'tenant_id'),
        ('workflow_invocations', 'tenant_id'),
        ('workflow_work_items', 'tenant_id'),
        ('workflow_step_runs', 'tenant_id'),
        ('workflow_events', 'tenant_id'),
        ('goals', 'tenant_id'),
        ('goal_plan_nodes', 'tenant_id'),
        ('goal_runs', 'tenant_id'),
        ('runner_machines', 'tenant_id'),
        ('runner_leases', 'tenant_id'),
        ('audit_events', 'tenant_id'),
        ('run_receipts', 'tenant_id')
    ),
    expected(table_name, policy_name, command, roles, qualifier, check_expr) AS (
      SELECT table_name, 'tenant_isolation', '*', ARRAY['public'], discriminator, discriminator FROM protected
      UNION ALL VALUES
        ('tenants', 'auth_definer_tenant_lookup', '*', ARRAY['open_loops_owner'], 'true', NULL),
        ('tenant_memberships', 'auth_definer_membership_lookup', '*', ARRAY['open_loops_owner'], 'true', NULL),
        ('tenant_membership_roles', 'auth_definer_membership_roles_lookup', '*', ARRAY['open_loops_owner'], 'true', NULL),
        ('api_keys', 'auth_definer_key_lookup', '*', ARRAY['open_loops_owner'], 'true', NULL),
        ('audit_events', 'auth_definer_audit_insert', 'a', ARRAY['open_loops_owner'], NULL, 'true')
    ),
    actual AS (
      SELECT class.relname AS table_name,
             policy.polname AS policy_name,
             policy.polcmd::text AS command,
             policy.polpermissive AS permissive,
             ARRAY(
               SELECT CASE WHEN role_oid = 0 THEN 'public' ELSE role.rolname::text END
                 FROM unnest(policy.polroles) role_oid
                 LEFT JOIN pg_roles role ON role.oid = role_oid
                ORDER BY 1
             ) AS roles,
             COALESCE(regexp_replace(pg_get_expr(policy.polqual, policy.polrelid), '\\s+', ' ', 'g'), '') AS qualifier,
             COALESCE(regexp_replace(pg_get_expr(policy.polwithcheck, policy.polrelid), '\\s+', ' ', 'g'), '') AS check_expr
        FROM pg_policy policy
        JOIN pg_class class ON class.oid = policy.polrelid
        JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname IN (SELECT table_name FROM protected)
    ),
    missing_or_bad AS (
      SELECT expected.*
        FROM expected
        LEFT JOIN actual
          ON actual.table_name = expected.table_name
         AND actual.policy_name = expected.policy_name
       WHERE actual.policy_name IS NULL
          OR NOT actual.permissive
          OR actual.command <> expected.command
          OR actual.roles <> expected.roles
          OR NOT CASE expected.qualifier
            WHEN 'tenant_id' THEN actual.qualifier = ANY(ARRAY[
              '(tenant_id = open_loops_current_tenant_id())',
              '(tenant_id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'id' THEN actual.qualifier = ANY(ARRAY[
              '(id = open_loops_current_tenant_id())',
              '(id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'true' THEN actual.qualifier = 'true'
            ELSE actual.qualifier = ''
          END
          OR NOT CASE expected.check_expr
            WHEN 'tenant_id' THEN actual.check_expr = ANY(ARRAY[
              '(tenant_id = open_loops_current_tenant_id())',
              '(tenant_id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'id' THEN actual.check_expr = ANY(ARRAY[
              '(id = open_loops_current_tenant_id())',
              '(id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'true' THEN actual.check_expr = 'true'
            ELSE actual.check_expr = ''
          END
    ),
    unexpected AS (
      SELECT actual.*
        FROM actual
        LEFT JOIN expected
          ON expected.table_name = actual.table_name
         AND expected.policy_name = actual.policy_name
       WHERE expected.policy_name IS NULL
    )
    SELECT 1 FROM missing_or_bad
    UNION ALL
    SELECT 1 FROM unexpected
  ) THEN
    RAISE EXCEPTION 'tenant enforcement did not install the exact protected-table RLS policy inventory';
  END IF;
  IF EXISTS (
    WITH runtime_tables(table_name) AS (
      VALUES
        ('loops'), ('loop_runs'), ('daemon_lease'), ('workflow_specs'), ('workflow_runs'),
        ('workflow_invocations'), ('workflow_work_items'), ('workflow_step_runs'), ('workflow_events'),
        ('goals'), ('goal_plan_nodes'), ('goal_runs'), ('runner_machines'), ('runner_leases'), ('run_receipts')
    ),
    protected_tables(table_name) AS (
      VALUES
        ('tenants'), ('tenant_memberships'), ('tenant_membership_roles'), ('api_keys'), ('audit_events'),
        ('loops'), ('loop_runs'), ('daemon_lease'), ('workflow_specs'), ('workflow_runs'),
        ('workflow_invocations'), ('workflow_work_items'), ('workflow_step_runs'), ('workflow_events'),
        ('goals'), ('goal_plan_nodes'), ('goal_runs'), ('runner_machines'), ('runner_leases'), ('run_receipts')
    )
    SELECT 1
      FROM protected_tables protected
      JOIN pg_class class ON class.oid = format('public.%I', protected.table_name)::regclass
      CROSS JOIN LATERAL aclexplode(class.relacl) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE acl.privilege_type IS NOT NULL
       AND NOT (
         protected.table_name IN (SELECT table_name FROM runtime_tables)
         AND COALESCE(grantee.rolname = 'open_loops_runtime', false)
         AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
         AND NOT acl.is_grantable
       )
       AND NOT (
         protected.table_name = 'tenants'
         AND COALESCE(grantee.rolname = 'open_loops_runtime', false)
         AND acl.privilege_type IN ('SELECT', 'UPDATE', 'REFERENCES')
         AND NOT acl.is_grantable
       )
       AND NOT COALESCE(grantee.rolname = 'open_loops_owner', false)
  ) THEN
    RAISE EXCEPTION 'tenant enforcement left unexpected protected table grants';
  END IF;
  IF NOT has_column_privilege('open_loops_runtime', 'public.tenants', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'tenant enforcement did not grant runtime tenant key lock privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger trigger
      JOIN pg_proc proc ON proc.oid = trigger.tgfoid
     WHERE trigger.tgrelid = 'public.tenants'::regclass
       AND trigger.tgname = 'open_loops_reject_runtime_tenant_update'
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled = 'O'
       AND proc.oid = 'public.open_loops_reject_runtime_tenant_update()'::regprocedure
       AND pg_get_userbyid(proc.proowner) = 'open_loops_owner'
       AND NOT proc.prosecdef
       AND COALESCE(proc.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']
       AND proc.prosrc ILIKE '%pg_has_role%open_loops_runtime%USAGE%'
  ) THEN
    RAISE EXCEPTION 'tenant enforcement did not install runtime tenant update guard';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      JOIN pg_attribute attribute ON attribute.attrelid = class.oid
      CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE namespace.nspname = 'public'
       AND class.relname = ANY(ARRAY[
         'tenants', 'tenant_memberships', 'tenant_membership_roles', 'api_keys',
         'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
         'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
         'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
         'audit_events', 'run_receipts'
       ])
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.privilege_type IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'tenant enforcement left unexpected protected column grants';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc proc
      CROSS JOIN LATERAL aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE proc.oid = ANY(ARRAY[
       'public.open_loops_current_tenant_id()'::regprocedure,
       'public.open_loops_authenticate_key(text,text)'::regprocedure,
       'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'::regprocedure
     ])
       AND acl.privilege_type = 'EXECUTE'
       AND NOT (
         proc.oid = 'public.open_loops_current_tenant_id()'::regprocedure
         AND grantee.rolname = 'open_loops_runtime'
         AND NOT acl.is_grantable
       )
       AND NOT (
         proc.oid = ANY(ARRAY[
           'public.open_loops_authenticate_key(text,text)'::regprocedure,
           'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'::regprocedure
         ])
         AND grantee.rolname = 'open_loops_authenticator'
         AND NOT acl.is_grantable
       )
  ) THEN
    RAISE EXCEPTION 'tenant enforcement left unexpected authentication function grants';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc function
      JOIN pg_namespace namespace ON namespace.oid=function.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(function.proacl, acldefault('f', function.proowner))) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND namespace.nspname NOT LIKE 'pg_toast%'
       AND namespace.nspname NOT LIKE 'pg_temp_%'
       AND acl.privilege_type = 'EXECUTE'
       AND NOT acl.is_grantable
       AND acl.grantee <> function.proowner
       AND NOT (
         namespace.nspname='public'
         AND function.oid = 'public.open_loops_current_tenant_id()'::regprocedure
         AND COALESCE(grantee.rolname IN ('open_loops_owner', 'open_loops_runtime'), false)
       )
       AND NOT (
         namespace.nspname='public'
         AND function.oid = ANY(ARRAY[
           'public.open_loops_authenticate_key(text,text)'::regprocedure,
           'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'::regprocedure
         ])
         AND COALESCE(grantee.rolname IN ('open_loops_owner', 'open_loops_authenticator'), false)
       )
  ) THEN
    RAISE EXCEPTION 'tenant enforcement left unexpected function privileges outside the OpenLoops auth surface';
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
  migration(
    "0013_loop_mutation_contract",
    `
GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner;
SET ROLE open_loops_owner;

CREATE TABLE loop_mutation_operations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  binding_json JSONB NOT NULL,
  admission_json JSONB NOT NULL,
  terminal_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, operation_id, step_id)
);
CREATE INDEX idx_loop_mutation_target
  ON loop_mutation_operations(tenant_id, target_id, created_at DESC);

CREATE TABLE loop_mutation_leases (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  target_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, target_id),
  UNIQUE (tenant_id, lease_id)
);

ALTER TABLE loop_mutation_operations OWNER TO open_loops_owner;
ALTER TABLE loop_mutation_leases OWNER TO open_loops_owner;
ALTER TABLE loop_mutation_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_mutation_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE loop_mutation_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_mutation_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loop_mutation_operations
  USING (tenant_id = open_loops_current_tenant_id())
  WITH CHECK (tenant_id = open_loops_current_tenant_id());
CREATE POLICY tenant_isolation ON loop_mutation_leases
  USING (tenant_id = open_loops_current_tenant_id())
  WITH CHECK (tenant_id = open_loops_current_tenant_id());
GRANT SELECT, INSERT ON loop_mutation_operations TO open_loops_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON loop_mutation_leases TO open_loops_runtime;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner;
GRANT USAGE ON SCHEMA public TO open_loops_owner;
    `,
  ),
  migration(
    "0014_loops_identity_aliases",
    `GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;

CREATE OR REPLACE VIEW public.loops_schema_migrations AS
SELECT id, checksum, applied_at
  FROM public.open_loops_schema_migrations;
ALTER VIEW public.loops_schema_migrations OWNER TO open_loops_migrator;
REVOKE ALL ON TABLE public.loops_schema_migrations
  FROM PUBLIC, open_loops_owner, open_loops_runtime, open_loops_authenticator;
REVOKE ALL PRIVILEGES (id, checksum, applied_at)
  ON TABLE public.loops_schema_migrations
  FROM PUBLIC, open_loops_owner, open_loops_runtime, open_loops_authenticator;
GRANT SELECT ON TABLE public.loops_schema_migrations TO open_loops_runtime;
COMMENT ON VIEW public.loops_schema_migrations IS
  'Canonical Loops migration ledger view over the released open_loops_schema_migrations checksum authority.';

CREATE OR REPLACE FUNCTION public.loops_current_tenant_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE COST 100 SET search_path = pg_catalog
RETURN COALESCE(
  NULLIF(pg_catalog.current_setting('loops.tenant_id', true), ''),
  NULLIF(pg_catalog.current_setting('open_loops.tenant_id', true), '')
);
ALTER FUNCTION public.loops_current_tenant_id() OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_current_tenant_id()
  FROM PUBLIC, open_loops_authenticator;
GRANT EXECUTE ON FUNCTION public.loops_current_tenant_id()
  TO open_loops_owner, open_loops_runtime;
COMMENT ON FUNCTION public.loops_current_tenant_id() IS
  'Canonical tenant context reader; the open_loops.tenant_id fallback is removed after all supported clients write loops.tenant_id.';

CREATE OR REPLACE FUNCTION public.loops_reject_runtime_tenant_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER COST 100 SET search_path = pg_catalog
AS $$
BEGIN
  IF pg_has_role(current_user, 'open_loops_runtime', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role cannot update tenants' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.loops_reject_runtime_tenant_update() OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_reject_runtime_tenant_update()
  FROM PUBLIC, open_loops_runtime, open_loops_authenticator;
DROP TRIGGER IF EXISTS loops_reject_runtime_tenant_update ON tenants;
CREATE TRIGGER loops_reject_runtime_tenant_update
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.loops_reject_runtime_tenant_update();

CREATE OR REPLACE FUNCTION public.loops_authenticate_key(p_kid TEXT, p_token_hash TEXT)
RETURNS TABLE (
  kid TEXT, app TEXT, agent TEXT, scopes JSONB, token_hash TEXT, issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, disabled_at TIMESTAMPTZ,
  tenant_id TEXT, tenant_status TEXT, principal_id TEXT, principal_status TEXT,
  membership_status TEXT, token_kind TEXT, roles TEXT[]
)
LANGUAGE sql SECURITY DEFINER COST 100 ROWS 1000 SET search_path = pg_catalog
AS $$
  SELECT * FROM public.open_loops_authenticate_key(p_kid, p_token_hash);
$$;
ALTER FUNCTION public.loops_authenticate_key(TEXT, TEXT) OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_authenticate_key(TEXT, TEXT)
  FROM PUBLIC, open_loops_runtime;
GRANT EXECUTE ON FUNCTION public.loops_authenticate_key(TEXT, TEXT)
  TO open_loops_authenticator;

CREATE OR REPLACE FUNCTION public.loops_append_auth_audit(
  p_id TEXT, p_kid TEXT, p_token_hash TEXT, p_request_id TEXT,
  p_operation_id TEXT, p_decision TEXT, p_deny_reason TEXT, p_metadata JSONB
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER COST 100 SET search_path = pg_catalog
AS $$
  SELECT public.open_loops_append_auth_audit(
    p_id, p_kid, p_token_hash, p_request_id,
    p_operation_id, p_decision, p_deny_reason, p_metadata
  );
$$;
ALTER FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, open_loops_runtime;
GRANT EXECUTE ON FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO open_loops_authenticator;

DO $loops_identity_postconditions$
BEGIN
  IF EXISTS (
    (SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations
     EXCEPT
     SELECT id, checksum, applied_at FROM public.loops_schema_migrations)
    UNION ALL
    (SELECT id, checksum, applied_at FROM public.loops_schema_migrations
     EXCEPT
     SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations)
  ) THEN
    RAISE EXCEPTION 'canonical Loops migration ledger view diverged from released checksum authority';
  END IF;
  IF to_regprocedure('public.loops_current_tenant_id()') IS NULL
     OR to_regprocedure('public.loops_authenticate_key(text,text)') IS NULL
     OR to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'canonical Loops compatibility functions are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger trigger
      JOIN pg_proc proc ON proc.oid = trigger.tgfoid
     WHERE trigger.tgrelid = 'public.tenants'::regclass
       AND trigger.tgname = 'open_loops_reject_runtime_tenant_update'
       AND proc.oid = 'public.open_loops_reject_runtime_tenant_update()'::regprocedure
       AND NOT trigger.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger trigger
      JOIN pg_proc proc ON proc.oid = trigger.tgfoid
     WHERE trigger.tgrelid = 'public.tenants'::regclass
       AND trigger.tgname = 'loops_reject_runtime_tenant_update'
       AND proc.oid = 'public.loops_reject_runtime_tenant_update()'::regprocedure
       AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'legacy and canonical tenant update guards must coexist';
  END IF;
END
$loops_identity_postconditions$;

REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;`,
  ),
  // Additive run-count expiry ceiling (--expires-after-runs): the loop expires
  // after N consecutive successful runs, independent of the time-based
  // expires_at. Mirrors sqlite migration 0016_loop_expires_after_runs; an older
  // server binary ignores the column and keeps scheduling forever.
  migration(
    "0014_loop_expires_after_runs",
    `
ALTER TABLE loops ADD COLUMN IF NOT EXISTS expires_after_runs INTEGER;
    `,
  ),
  // O15-00624: run_receipts (tenant_id, loop_id) REFERENCES loops was added
  // without an ON DELETE action (migration 0010_tenant_enforce), so deleting a
  // loop that produced terminal receipts violates the FK and DELETE
  // /loops/<id> returns 500 on the hosted control plane. Express the intended
  // semantics — receipts are per-loop run artifacts and go with the loop,
  // mirroring loop_runs ON DELETE CASCADE. The deleteLoop storage path also
  // deletes the loop's receipts explicitly, so an existing database that has
  // not run this migration works the moment the new binary deploys.
  //
  // NOT VALID is deliberate: the constraint's referential predicate is
  // byte-identical to the one it replaces (which the FK trigger has enforced
  // on every write since 0010), so skipping the existing-rows scan is sound —
  // and a validating ADD would fail anyway: migration 0010's
  // $auth_function_acl$ revokes EXECUTE on open_loops_current_tenant_id from
  // every role except open_loops_runtime, so the ALTER's internal FK
  // validation (run as open_loops_owner under FORCE RLS) cannot evaluate the
  // tenant_isolation policy.
  migration(
    "0015_run_receipts_loop_cascade",
    `
GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
SET ROLE open_loops_owner;

ALTER TABLE run_receipts DROP CONSTRAINT run_receipts_tenant_id_loop_id_fkey;
ALTER TABLE run_receipts ADD CONSTRAINT run_receipts_tenant_id_loop_id_fkey
  FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE NOT VALID;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
    `,
  ),
  // Loop bundles (hasna/apps#1724). A loop is a row, and — once bundled — also
  // a directory of files, because a loop may carry scripts and a row cannot.
  // The row stays the runtime authority; `loop_revisions` is the append-only
  // ledger of what that row WAS at each published version, and the two new
  // `loops` columns point into it.
  //
  // Additive on every axis: both columns are nullable, the table starts empty,
  // and an older `loops-serve` binary that knows nothing about bundles keeps
  // scheduling unchanged. Rolling back is dropping an empty table.
  //
  // `bundle_name` exists rather than reusing `loops.name` because loop names
  // are NOT unique (idx_loops_name is a plain index, and `loops hygiene
  // duplicates` exists because duplicates do), while an object-store prefix and
  // a CLI argument must resolve to exactly one loop.
  migration(
    "0016_loop_revisions",
    `
GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner;
SET ROLE open_loops_owner;

ALTER TABLE loops ADD COLUMN IF NOT EXISTS bundle_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS loops_bundle_name_key
  ON loops(tenant_id, bundle_name) WHERE bundle_name IS NOT NULL;
ALTER TABLE loops ADD COLUMN IF NOT EXISTS bundle_pinned_version INTEGER;

-- Run provenance: which bundle version produced a run. Nullable, so every
-- receipt written before bundles existed keeps its exact digest.
ALTER TABLE run_receipts ADD COLUMN IF NOT EXISTS bundle_json JSONB;

CREATE TABLE loop_revisions (
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  loop_id          TEXT NOT NULL,
  version          INTEGER NOT NULL CHECK (version >= 1),
  bundle_name      TEXT NOT NULL,
  bundle_digest    TEXT NOT NULL CHECK (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  archive_sha256   TEXT NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_bytes    INTEGER NOT NULL CHECK (archive_bytes > 0),
  storage_kind     TEXT NOT NULL DEFAULT 'db' CHECK (storage_kind IN ('db','s3')),
  storage_key      TEXT,
  manifest_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  loop_json        JSONB NOT NULL,
  carries_prompt   BOOLEAN NOT NULL DEFAULT false,
  author           TEXT NOT NULL,
  source_station   TEXT,
  source_agent     TEXT,
  reason           TEXT,
  rolled_back_from INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, loop_id, version),
  FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT loop_revisions_s3_key CHECK (storage_kind <> 's3' OR storage_key IS NOT NULL)
);
CREATE INDEX loop_revisions_loop_created_idx
  ON loop_revisions(tenant_id, loop_id, version DESC);
CREATE INDEX loop_revisions_digest_idx
  ON loop_revisions(tenant_id, bundle_digest);
CREATE UNIQUE INDEX loop_revisions_name_version_key
  ON loop_revisions(tenant_id, bundle_name, version);

ALTER TABLE loop_revisions OWNER TO open_loops_owner;
ALTER TABLE loop_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loop_revisions
  USING (tenant_id = open_loops_current_tenant_id())
  WITH CHECK (tenant_id = open_loops_current_tenant_id());
-- Append-only at the PRIVILEGE level, not only by convention: the runtime role
-- gets INSERT and SELECT and is granted no UPDATE and no DELETE on this table,
-- so a rollback can only ever append a new revision. Rows leave exclusively
-- through the loop's own ON DELETE CASCADE.
GRANT SELECT, INSERT ON loop_revisions TO open_loops_runtime;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner;
GRANT USAGE ON SCHEMA public TO open_loops_owner;
    `,
  ),
  // The `IF EXISTS` repair that was briefly (and wrongly) folded back into
  // 0015 itself.
  //
  // 0015 shipped in @hasna/loops 0.6.3 and 0.6.5 and has been applied to the
  // hosted database, so its bytes — and therefore its ledger checksum — are
  // frozen forever: editing them makes `buildPlan()` throw
  // "checksum mismatch" on every database that already ran it, which takes out
  // `loops-serve migrate`, the readiness dryRun migrate and the boot-time
  // tenant-enforcement dryRun migrate all at once. A repair to a released
  // migration is a NEW migration; that is the whole reason the ledger is
  // keyed by id.
  //
  // What needs repairing: 0015 drops `run_receipts_tenant_id_loop_id_fkey` by
  // name, and that name is whatever Postgres auto-assigned to the UNNAMED
  // foreign key added by 0010_tenant_enforce. A database restored or rebuilt
  // by another route — a pg_dump of a hand-repaired schema, a logical restore —
  // can carry the same foreign key under a different name, and then 0015 left
  // the OLD key in place under its own name (its `ADD` succeeded, because the
  // canonical name was free) and the receipts of a deleted loop still violate
  // a non-CASCADE key.
  //
  // This migration is therefore name-agnostic and idempotent: it drops every
  // foreign key on run_receipts(tenant_id, loop_id) -> loops that is NOT
  // ON DELETE CASCADE, whatever it is called, and adds the canonical CASCADE
  // key only if no CASCADE key is there already. On a healthy database — one
  // where 0015 did exactly what it meant to — it finds a CASCADE key, drops
  // nothing and adds nothing.
  //
  // NOT VALID for the same reason 0015 used it: 0010's $auth_function_acl$
  // revokes EXECUTE on open_loops_current_tenant_id from every role but
  // open_loops_runtime, so a validating ADD cannot evaluate the
  // tenant_isolation policy under FORCE RLS.
  migration(
    "0017_run_receipts_loop_cascade_repair",
    `
GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
SET ROLE open_loops_owner;

DO $run_receipts_loop_cascade_repair$
DECLARE
  doomed TEXT;
  has_cascade BOOLEAN;
BEGIN
  FOR doomed IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
     WHERE con.contype = 'f'
       AND ns.nspname = current_schema()
       AND child.relname = 'run_receipts'
       AND parent.relname = 'loops'
       AND con.confdeltype <> 'c'
       AND con.conkey = (
         SELECT array_agg(att.attnum ORDER BY att.attname)
           FROM pg_attribute att
          WHERE att.attrelid = child.oid
            AND att.attname IN ('tenant_id', 'loop_id')
       )
  LOOP
    EXECUTE format('ALTER TABLE run_receipts DROP CONSTRAINT %I', doomed);
  END LOOP;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
     WHERE con.contype = 'f'
       AND ns.nspname = current_schema()
       AND child.relname = 'run_receipts'
       AND parent.relname = 'loops'
       AND con.confdeltype = 'c'
  ) INTO has_cascade;

  IF NOT has_cascade THEN
    ALTER TABLE run_receipts ADD CONSTRAINT run_receipts_tenant_id_loop_id_fkey
      FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$run_receipts_loop_cascade_repair$;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
    `,
  ),
]);
