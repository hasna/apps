-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0010_tenant_enforce"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:f923c70c2960e0372b4c01c5f01d9432fa0c76b24921c616dc149fa191409053)

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
             COALESCE(regexp_replace(pg_get_expr(policy.polqual, policy.polrelid), '\s+', ' ', 'g'), '') AS qualifier,
             COALESCE(regexp_replace(pg_get_expr(policy.polwithcheck, policy.polrelid), '\s+', ' ', 'g'), '') AS check_expr
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
