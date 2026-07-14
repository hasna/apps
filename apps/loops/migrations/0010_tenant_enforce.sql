-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0010_tenant_enforce"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:e6f2a636203bd443b603eaad0edb6864811958a093cea465a9ed5b5e5632f16d)

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_owner') THEN CREATE ROLE open_loops_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_migrator') THEN CREATE ROLE open_loops_migrator NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_runtime') THEN CREATE ROLE open_loops_runtime NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_loops_authenticator') THEN CREATE ROLE open_loops_authenticator NOLOGIN NOBYPASSRLS; END IF;
END
$roles$;
GRANT open_loops_owner, open_loops_migrator, open_loops_authenticator TO CURRENT_USER;

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

CREATE OR REPLACE FUNCTION open_loops_current_tenant_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE
RETURN NULLIF(current_setting('open_loops.tenant_id', true), '');

DO $tenant_defaults$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases', 'run_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT open_loops_current_tenant_id()', table_name);
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
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id);
ALTER TABLE workflow_runs ADD FOREIGN KEY (tenant_id, loop_run_id) REFERENCES loop_runs(tenant_id, id);
ALTER TABLE workflow_invocations ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id);
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, invocation_id) REFERENCES workflow_invocations(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflow_specs(tenant_id, id);
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id);
ALTER TABLE workflow_work_items ADD FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id);
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

CREATE OR REPLACE FUNCTION open_loops_current_tenant_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE
RETURN NULLIF(current_setting('open_loops.tenant_id', true), '');

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
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = open_loops_current_tenant_id()) WITH CHECK (tenant_id = open_loops_current_tenant_id())', table_name);
  END LOOP;
END
$rls$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = open_loops_current_tenant_id())
  WITH CHECK (id = open_loops_current_tenant_id());
CREATE POLICY authenticator_tenant_lookup ON tenants TO open_loops_authenticator USING (true);
CREATE POLICY authenticator_membership_lookup ON tenant_memberships TO open_loops_authenticator USING (true);
CREATE POLICY authenticator_membership_roles_lookup ON tenant_membership_roles TO open_loops_authenticator USING (true);
CREATE POLICY authenticator_key_lookup ON api_keys TO open_loops_authenticator USING (true);
CREATE POLICY authenticator_audit_insert ON audit_events
  FOR INSERT TO open_loops_authenticator WITH CHECK (true);

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
ALTER TABLE preauth_audit_events OWNER TO open_loops_authenticator;
ALTER TABLE open_loops_schema_migrations OWNER TO open_loops_owner;

GRANT USAGE ON SCHEMA public TO open_loops_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON loops, loop_runs, daemon_lease, workflow_specs, workflow_runs, workflow_invocations,
  workflow_work_items, workflow_step_runs, workflow_events, goals, goal_plan_nodes, goal_runs,
  runner_machines, runner_leases, run_receipts TO open_loops_runtime;
GRANT SELECT ON audit_events TO open_loops_runtime;
GRANT SELECT ON open_loops_schema_migrations TO open_loops_runtime;
GRANT SELECT ON tenants, principals, tenant_memberships, tenant_membership_roles, api_keys TO open_loops_authenticator;
GRANT INSERT ON audit_events TO open_loops_authenticator;

CREATE OR REPLACE FUNCTION open_loops_authenticate_key(p_kid TEXT, p_token_hash TEXT)
RETURNS TABLE (
  kid TEXT, app TEXT, agent TEXT, scopes JSONB, token_hash TEXT, issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, disabled_at TIMESTAMPTZ,
  tenant_id TEXT, tenant_status TEXT, principal_id TEXT, principal_status TEXT,
  membership_status TEXT, token_kind TEXT, roles TEXT[]
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT key.kid, key.app, key.agent, key.scopes, key.token_hash, key.issued_at,
         key.expires_at, key.revoked_at, key.disabled_at,
         key.tenant_id, tenant.status, key.principal_id, principal.status,
         membership.status, key.token_kind,
         COALESCE(array_agg(membership_role.role ORDER BY membership_role.role)
           FILTER (WHERE membership_role.role IS NOT NULL), ARRAY[]::TEXT[])
    FROM api_keys key
    JOIN tenants tenant ON tenant.id = key.tenant_id
    JOIN principals principal ON principal.id = key.principal_id
    JOIN tenant_memberships membership
      ON membership.tenant_id = key.tenant_id AND membership.principal_id = key.principal_id
    LEFT JOIN tenant_membership_roles membership_role
      ON membership_role.tenant_id = membership.tenant_id AND membership_role.principal_id = membership.principal_id
   WHERE key.kid = p_kid AND key.token_hash = p_token_hash
   GROUP BY key.kid, key.app, key.agent, key.scopes, key.token_hash, key.issued_at,
            key.expires_at, key.revoked_at, key.disabled_at, key.tenant_id, tenant.status,
            key.principal_id, principal.status, membership.status, key.token_kind;
$$;
ALTER FUNCTION open_loops_authenticate_key(TEXT, TEXT) OWNER TO open_loops_authenticator;
REVOKE ALL ON FUNCTION open_loops_authenticate_key(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_loops_authenticate_key(TEXT, TEXT) TO open_loops_runtime;

CREATE OR REPLACE FUNCTION open_loops_append_auth_audit(
  p_id TEXT, p_kid TEXT, p_token_hash TEXT, p_request_id TEXT,
  p_operation_id TEXT, p_decision TEXT, p_deny_reason TEXT, p_metadata JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  bound_tenant_id TEXT;
  bound_principal_id TEXT;
BEGIN
  SELECT key.tenant_id, key.principal_id
    INTO bound_tenant_id, bound_principal_id
    FROM api_keys key
   WHERE key.kid = p_kid AND key.token_hash = p_token_hash;

  IF bound_tenant_id IS NULL THEN
    INSERT INTO preauth_audit_events(id, request_id, operation_id, deny_reason, metadata_json)
    VALUES (p_id, p_request_id, p_operation_id, COALESCE(p_deny_reason, 'unauthorized'), p_metadata);
  ELSE
    INSERT INTO audit_events(
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
ALTER FUNCTION open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO open_loops_authenticator;
REVOKE ALL ON FUNCTION open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO open_loops_runtime;

DROP TABLE api_key_tenant_bindings;
DROP TABLE tenant_row_assignments;
