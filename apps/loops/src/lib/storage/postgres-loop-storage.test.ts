// Live integration tests for the Postgres LoopStorageContract implementation.
//
// Runs only when LOOPS_TEST_DATABASE_URL points at a DISPOSABLE Postgres (a
// dockerized instance or a throwaway local database) — NEVER the shared RDS.
// When unset the suite is skipped so `bun test` stays hermetic offline.
//
// Covers the priority-1/priority-2 paths the daemon + CLI + runner exercise:
// loop CRUD, run lifecycle (claim/heartbeat/finalize/recover), daemon lease,
// counts, route representation, prune, and the two-connection claim race.
// Remaining TIER-2 unported methods are asserted to throw NotImplementedError
// rather than silently no-op.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import pg from "pg";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { PostgresLoopStorage, NotImplementedError } from "./postgres-loop-storage.js";
import { assertTenantEnforcementBootstrap, isSafeServiceConnection } from "../../serve/index.js";
import type { CreateLoopInput, Loop, LoopRun, WorkflowSpec } from "../../types.js";

const DATABASE_URL = process.env.LOOPS_TEST_DATABASE_URL;
const RUN_LIVE = typeof DATABASE_URL === "string" && DATABASE_URL.length > 0;
const suite = RUN_LIVE ? describe : describe.skip;

// Isolate in a dedicated throwaway database so this file never interferes with
// the sibling `postgres-concurrency.test.ts` (its claim path drains ALL queued
// / lease-expired runs table-wide; running both files in one `bun test` against
// a shared database would let each see the other's rows).
const ISO_DB = `loops_pgstore_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const RUNTIME_LOGIN = `loops_runtime_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const RUNTIME_PASSWORD = `runtime-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const AUTH_LOGIN = `loops_auth_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const AUTH_PASSWORD = `auth-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const UNSAFE_LOGIN = `loops_unsafe_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const CROSS_ROLE_LOGIN = `loops_cross_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const BRIDGE_ROLE = `loops_bridge_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const BRIDGE_LOGIN = `loops_bridge_login_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const EXTRA_AUTH_ROLE = `loops_auth_extra_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const EXTRA_SERVICE_ROLE = `loops_service_extra_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ADMIN_LOGIN = `loops_admin_option_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const HOSTILE_FUNCTION_OWNER = `loops_hostile_fn_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const DRIFT_DATABASE_LOGIN = `loops_db_drift_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
function isolatedUrl(credentials?: { username: string; password: string }): string {
  const u = new URL(DATABASE_URL!);
  u.pathname = `/${ISO_DB}`;
  if (credentials) {
    u.searchParams.delete("host");
    u.hostname = "127.0.0.1";
    u.username = credentials.username;
    u.password = credentials.password;
  }
  return u.toString();
}
async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function loopInput(name: string, over: Partial<CreateLoopInput> = {}): CreateLoopInput {
  return {
    name,
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "true" },
    ...over,
  } as CreateLoopInput;
}

suite("PostgresLoopStorage (live)", () => {
  let executor: PgPoolExecutor;
  let runtimeExecutor: PgPoolExecutor;
  let authExecutor: PgPoolExecutor;
  let storage: PostgresLoopStorage;
  let unsafeMembershipRemoved = false;
  let unsafeDirectPrivilegesRemoved = false;
  let ownedObjectRejected = false;
  let bridgeMembershipRemoved = false;
  let adminMembershipRemoved = false;

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${ISO_DB}`);
    executor = PgPoolExecutor.fromConnectionString({ connectionString: isolatedUrl(), applicationName: "loops-pgstore-test" });
    const schema = new PostgresStorage(executor);
    await schema.migrate({ through: "0008_tenant_prepare" });
    await executor.queryClient.execute(
      `INSERT INTO tenants(id, slug, name, status) VALUES ('tenant-test', 'tenant-test', 'Tenant Test', 'active');
       INSERT INTO principals(id, kind, display_name, status) VALUES ('principal-test', 'service', 'Principal Test', 'active');
       INSERT INTO tenant_memberships(tenant_id, principal_id, status) VALUES ('tenant-test', 'principal-test', 'active');
       INSERT INTO tenant_membership_roles(tenant_id, principal_id, role) VALUES ('tenant-test', 'principal-test', 'service');`,
    );
    await admin(`
      DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_owner') THEN CREATE ROLE open_loops_owner LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_migrator') THEN CREATE ROLE open_loops_migrator LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_runtime') THEN CREATE ROLE open_loops_runtime LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_authenticator') THEN CREATE ROLE open_loops_authenticator LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
      END $roles$;
      ALTER ROLE open_loops_owner LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      ALTER ROLE open_loops_migrator LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      ALTER ROLE open_loops_runtime NOINHERIT LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      ALTER ROLE open_loops_authenticator NOINHERIT LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      CREATE ROLE ${UNSAFE_LOGIN} LOGIN BYPASSRLS;
      GRANT open_loops_runtime TO ${UNSAFE_LOGIN};
      CREATE ROLE ${CROSS_ROLE_LOGIN} LOGIN;
      GRANT open_loops_owner, open_loops_runtime TO ${CROSS_ROLE_LOGIN};
      CREATE ROLE ${BRIDGE_ROLE} NOLOGIN;
      CREATE ROLE ${BRIDGE_LOGIN} LOGIN;
      GRANT open_loops_runtime TO ${BRIDGE_ROLE};
      GRANT ${BRIDGE_ROLE} TO ${BRIDGE_LOGIN};
      CREATE ROLE ${ADMIN_LOGIN} LOGIN;
      GRANT open_loops_runtime TO ${ADMIN_LOGIN} WITH ADMIN OPTION;
      CREATE ROLE ${HOSTILE_FUNCTION_OWNER} NOLOGIN;
      CREATE ROLE ${EXTRA_SERVICE_ROLE} NOLOGIN;
      GRANT ${EXTRA_SERVICE_ROLE} TO open_loops_runtime;
      CREATE ROLE ${RUNTIME_LOGIN} LOGIN PASSWORD '${RUNTIME_PASSWORD}' NOBYPASSRLS;
      GRANT open_loops_runtime TO ${RUNTIME_LOGIN};
      ALTER ROLE ${RUNTIME_LOGIN} SET search_path=evil,public;
      CREATE ROLE ${AUTH_LOGIN} LOGIN PASSWORD '${AUTH_PASSWORD}' NOBYPASSRLS;
      GRANT open_loops_authenticator TO ${AUTH_LOGIN};
    `);
    await admin(`
      GRANT CONNECT ON DATABASE ${ISO_DB} TO ${UNSAFE_LOGIN}, ${CROSS_ROLE_LOGIN}, ${ADMIN_LOGIN};
      GRANT CREATE ON DATABASE ${ISO_DB} TO ${RUNTIME_LOGIN};
    `);
    await executor.queryClient.execute(`
      GRANT CREATE ON SCHEMA public TO ${RUNTIME_LOGIN};
      GRANT CREATE ON SCHEMA public TO ${AUTH_LOGIN};
      GRANT SELECT ON tenants TO ${RUNTIME_LOGIN};
      GRANT SELECT ON tenants TO ${UNSAFE_LOGIN};
      CREATE FUNCTION public.open_loops_authenticate_key(TEXT, TEXT)
      RETURNS TABLE (
        kid TEXT, app TEXT, agent TEXT, scopes JSONB, token_hash TEXT, issued_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, disabled_at TIMESTAMPTZ,
        tenant_id TEXT, tenant_status TEXT, principal_id TEXT, principal_status TEXT,
        membership_status TEXT, token_kind TEXT, roles TEXT[]
      ) LANGUAGE sql AS 'SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB, NULL::TEXT,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ,
        NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT[] WHERE false';
      CREATE FUNCTION public.open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
      RETURNS VOID LANGUAGE plpgsql AS 'BEGIN NULL; END';
      GRANT EXECUTE ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) TO open_loops_runtime;
      GRANT EXECUTE ON FUNCTION public.open_loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
        TO open_loops_runtime;
      CREATE FUNCTION public.open_loops_current_tenant_id() RETURNS TEXT
        LANGUAGE sql STABLE AS 'SELECT ''hostile-tenant''::TEXT';
      ALTER FUNCTION public.open_loops_current_tenant_id() OWNER TO ${HOSTILE_FUNCTION_OWNER};
      GRANT EXECUTE ON FUNCTION public.open_loops_current_tenant_id() TO PUBLIC, open_loops_authenticator;
      ALTER TABLE loops ENABLE ROW LEVEL SECURITY;
      CREATE POLICY preexisting_allow_all ON loops USING (true) WITH CHECK (true);
      CREATE SCHEMA residual_acl;
      CREATE TABLE residual_acl.private_rows(id INTEGER PRIMARY KEY);
      CREATE SEQUENCE residual_acl.private_sequence;
      CREATE FUNCTION residual_acl.private_function() RETURNS INTEGER LANGUAGE sql RETURN 1;
      GRANT USAGE ON SCHEMA residual_acl TO open_loops_runtime, open_loops_authenticator;
      GRANT SELECT ON residual_acl.private_rows TO PUBLIC, open_loops_runtime, open_loops_authenticator;
      GRANT USAGE ON SEQUENCE residual_acl.private_sequence TO PUBLIC, open_loops_runtime, open_loops_authenticator;
      GRANT EXECUTE ON FUNCTION residual_acl.private_function() TO open_loops_runtime, open_loops_authenticator;
      SET ROLE ${RUNTIME_LOGIN};
      CREATE SCHEMA service_owned_probe;
      CREATE FUNCTION service_owned_probe.escalate() RETURNS INTEGER
        LANGUAGE sql SECURITY DEFINER RETURN 1;
      RESET ROLE;
    `);
    try {
      await schema.migrate();
    } catch (error) {
      ownedObjectRejected = error instanceof Error && error.message.includes("owns database objects");
    }
    await executor.queryClient.execute(`DROP SCHEMA service_owned_probe CASCADE`);
    await schema.migrate();
    const unsafeMembership = await executor.queryClient.get(
      `SELECT 1 FROM pg_auth_members membership
        JOIN pg_roles granted ON granted.oid=membership.roleid
        JOIN pg_roles member ON member.oid=membership.member
       WHERE granted.rolname='open_loops_runtime' AND member.rolname=$1`, [UNSAFE_LOGIN],
    );
    unsafeMembershipRemoved = !unsafeMembership;
    const crossMembership = await executor.queryClient.get(
      `SELECT 1 FROM pg_auth_members membership
        JOIN pg_roles granted ON granted.oid=membership.roleid
        JOIN pg_roles member ON member.oid=membership.member
       WHERE granted.rolname='open_loops_runtime' AND member.rolname=$1`, [CROSS_ROLE_LOGIN],
    );
    unsafeMembershipRemoved = unsafeMembershipRemoved && !crossMembership;
    bridgeMembershipRemoved = !(await executor.queryClient.get<{ inherited: boolean }>(
      "SELECT pg_has_role($1, 'open_loops_runtime', 'MEMBER') AS inherited", [BRIDGE_LOGIN],
    ))?.inherited;
    adminMembershipRemoved = !(await executor.queryClient.get<{ inherited: boolean }>(
      "SELECT pg_has_role($1, 'open_loops_runtime', 'MEMBER') AS inherited", [ADMIN_LOGIN],
    ))?.inherited;
    unsafeDirectPrivilegesRemoved = !(await executor.queryClient.get<{ can_select: boolean }>(
      "SELECT has_table_privilege($1, 'tenants', 'SELECT') AS can_select", [UNSAFE_LOGIN],
    ))?.can_select;
    await admin(`DROP ROLE ${UNSAFE_LOGIN}; DROP ROLE ${CROSS_ROLE_LOGIN}; DROP ROLE ${BRIDGE_LOGIN}; DROP ROLE ${BRIDGE_ROLE}; DROP ROLE ${ADMIN_LOGIN}`);
    await executor.queryClient.execute(`
      CREATE SCHEMA evil;
      CREATE TABLE evil.loops(id TEXT PRIMARY KEY);
      GRANT USAGE ON SCHEMA evil TO open_loops_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON evil.loops TO open_loops_runtime;
    `);
    await admin(`ALTER ROLE ${AUTH_LOGIN} SET search_path=evil,public`);
    runtimeExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-runtime-test",
    });
    authExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: AUTH_LOGIN, password: AUTH_PASSWORD }),
      applicationName: "loops-pgstore-auth-test",
    });
    storage = new PostgresLoopStorage(runtimeExecutor.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "request-test",
    });
  });

  afterAll(async () => {
    if (authExecutor) await authExecutor.close();
    if (runtimeExecutor) await runtimeExecutor.close();
    if (executor) await executor.close();
    await admin(`DROP DATABASE IF EXISTS ${ISO_DB} WITH (FORCE)`);
    await admin(`
      DROP OWNED BY ${RUNTIME_LOGIN};
      DROP OWNED BY ${AUTH_LOGIN};
      DROP ROLE IF EXISTS ${RUNTIME_LOGIN};
      DROP ROLE IF EXISTS ${AUTH_LOGIN};
    `);
    await admin(`DROP ROLE IF EXISTS ${EXTRA_AUTH_ROLE}`);
    await admin(`DROP ROLE IF EXISTS ${EXTRA_SERVICE_ROLE}`);
    await admin(`DROP ROLE IF EXISTS ${HOSTILE_FUNCTION_OWNER}`);
    await admin(`DO $cleanup$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DRIFT_DATABASE_LOGIN}') THEN REVOKE open_loops_runtime FROM ${DRIFT_DATABASE_LOGIN}; DROP ROLE ${DRIFT_DATABASE_LOGIN}; END IF; END $cleanup$`);
  });

  test("tenant enforcement normalizes poisoned roles and removes unsafe service members", async () => {
    await expect(assertTenantEnforcementBootstrap(executor.queryClient)).resolves.toBeUndefined();
    expect(unsafeMembershipRemoved).toBe(true);
    expect(unsafeDirectPrivilegesRemoved).toBe(true);
    expect(ownedObjectRejected).toBe(true);
    expect(bridgeMembershipRemoved).toBe(true);
    expect(adminMembershipRemoved).toBe(true);
    const roles = await executor.queryClient.many<{
      rolname: string; rolcanlogin: boolean; rolinherit: boolean; rolsuper: boolean; rolcreatedb: boolean;
      rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean;
    }>(`SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
          FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`, [[
      "open_loops_owner", "open_loops_migrator", "open_loops_runtime", "open_loops_authenticator",
    ]]);
    expect(roles).toHaveLength(4);
    for (const role of roles) {
      expect(role).toMatchObject({
        rolcanlogin: false, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
        rolreplication: false, rolbypassrls: false,
      });
    }
    expect(await executor.queryClient.get<{ can_create: boolean }>(
      "SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create", [RUNTIME_LOGIN],
    )).toEqual({ can_create: false });
    expect(await executor.queryClient.get<{ can_create: boolean }>(
      "SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create", [AUTH_LOGIN],
    )).toEqual({ can_create: false });
    expect(await executor.queryClient.get<{ direct_connect: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_database database
         CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
         JOIN pg_roles grantee ON grantee.oid=acl.grantee
         WHERE database.datname=current_database() AND grantee.rolname=$1 AND acl.privilege_type='CONNECT'
       ) AS direct_connect`, [RUNTIME_LOGIN],
    )).toEqual({ direct_connect: true });
    expect(await executor.queryClient.get<{ public_connect: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_database database
         CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
         WHERE database.datname=current_database() AND acl.grantee=0 AND acl.privilege_type='CONNECT'
       ) AS public_connect`,
    )).toEqual({ public_connect: false });
    expect(await executor.queryClient.get<{ direct_connect: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_database database
         CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
         JOIN pg_roles grantee ON grantee.oid=acl.grantee
         WHERE database.datname=current_database() AND grantee.rolname=$1 AND acl.privilege_type='CONNECT'
       ) AS direct_connect`, [AUTH_LOGIN],
    )).toEqual({ direct_connect: true });
    expect(await executor.queryClient.get<{ can_select: boolean; can_reference: boolean; can_insert: boolean; can_update: boolean; can_update_id: boolean }>(
      `SELECT has_table_privilege($1, 'tenants', 'SELECT') AS can_select,
              has_table_privilege($1, 'tenants', 'REFERENCES') AS can_reference,
              has_table_privilege($1, 'tenants', 'INSERT') AS can_insert,
              has_table_privilege($1, 'tenants', 'UPDATE') AS can_update,
              has_column_privilege($1, 'tenants', 'id', 'UPDATE') AS can_update_id`,
      [RUNTIME_LOGIN],
    )).toEqual({
      can_select: true,
      can_reference: true,
      can_insert: false,
      can_update: true,
      can_update_id: true,
    });
    await expect(runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "tenant-update-denied" },
      (client) => client.execute("UPDATE tenants SET name='Runtime Mutated' WHERE id='tenant-test'"),
    )).rejects.toMatchObject({ code: "42501" });
    expect(await executor.queryClient.get<{ inherited: boolean }>(
      "SELECT pg_has_role('open_loops_runtime', $1, 'MEMBER') AS inherited", [EXTRA_SERVICE_ROLE],
    )).toEqual({ inherited: false });
    expect(await executor.queryClient.get<{
      runtime_schema: boolean; runtime_table: boolean; runtime_sequence: boolean;
      runtime_function: boolean; auth_function: boolean;
    }>(
      `SELECT has_schema_privilege($1, 'residual_acl', 'USAGE') AS runtime_schema,
              has_table_privilege($1, 'residual_acl.private_rows', 'SELECT') AS runtime_table,
              has_sequence_privilege($1, 'residual_acl.private_sequence', 'USAGE') AS runtime_sequence,
              has_function_privilege($1, 'residual_acl.private_function()', 'EXECUTE') AS runtime_function,
              has_function_privilege($2, 'residual_acl.private_function()', 'EXECUTE') AS auth_function`,
      [RUNTIME_LOGIN, AUTH_LOGIN],
    )).toEqual({
      runtime_schema: false,
      runtime_table: false,
      runtime_sequence: false,
      runtime_function: false,
      auth_function: false,
    });
    expect(await executor.queryClient.get<{ runtime_temp: boolean; auth_temp: boolean }>(
      `SELECT has_database_privilege($1, current_database(), 'TEMPORARY') AS runtime_temp,
              has_database_privilege($2, current_database(), 'TEMPORARY') AS auth_temp`,
      [RUNTIME_LOGIN, AUTH_LOGIN],
    )).toEqual({ runtime_temp: false, auth_temp: false });
    expect(await executor.queryClient.get<{ owner: string }>(
      "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.open_loops_current_tenant_id()'::regprocedure",
    )).toEqual({ owner: "open_loops_owner" });
    expect(await executor.queryClient.get<{ auth_execute: boolean; public_execute: boolean }>(
      `SELECT has_function_privilege($1, 'public.open_loops_current_tenant_id()', 'EXECUTE') AS auth_execute,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
              ) AS public_execute
         FROM pg_proc proc
        WHERE proc.oid='public.open_loops_current_tenant_id()'::regprocedure`,
      [AUTH_LOGIN],
    )).toEqual({ auth_execute: false, public_execute: true });
    expect(await executor.queryClient.get<{ runtime_execute: boolean; role_execute: boolean; runtime_member: boolean; runtime_inherit: boolean }>(
      `SELECT has_function_privilege($1, 'public.open_loops_current_tenant_id()', 'EXECUTE') AS runtime_execute,
              has_function_privilege('open_loops_runtime', 'public.open_loops_current_tenant_id()', 'EXECUTE') AS role_execute,
              pg_has_role($1, 'open_loops_runtime', 'MEMBER') AS runtime_member,
              (SELECT rolinherit FROM pg_roles WHERE rolname=$1) AS runtime_inherit`,
      [RUNTIME_LOGIN],
    )).toEqual({ runtime_execute: true, role_execute: true, runtime_member: true, runtime_inherit: true });
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE ALL ON evil.loops FROM open_loops_runtime; REVOKE ALL ON SCHEMA evil FROM open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute("GRANT TRUNCATE ON loops TO open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute("REVOKE TRUNCATE ON loops FROM open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    expect(await executor.queryClient.many<{ policyname: string }>(
      "SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='loops' ORDER BY policyname",
    )).toEqual([{ policyname: "tenant_isolation" }]);
    await executor.queryClient.execute(`ALTER TABLE loops DISABLE ROW LEVEL SECURITY`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER TABLE loops ENABLE ROW LEVEL SECURITY; ALTER TABLE loops FORCE ROW LEVEL SECURITY`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`ALTER TABLE loops NO FORCE ROW LEVEL SECURITY`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER TABLE loops FORCE ROW LEVEL SECURITY`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`DROP POLICY tenant_isolation ON loops`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`
      CREATE POLICY tenant_isolation ON loops
      USING (tenant_id = public.open_loops_current_tenant_id())
      WITH CHECK (tenant_id = public.open_loops_current_tenant_id())
    `);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`CREATE POLICY preexisting_allow_all ON loops USING (true) WITH CHECK (true)`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`DROP POLICY preexisting_allow_all ON loops`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`ALTER TABLE loops OWNER TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER TABLE loops OWNER TO open_loops_owner`);
    await executor.queryClient.execute(`GRANT SELECT, INSERT, UPDATE, DELETE ON loops TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await admin(`GRANT ${EXTRA_SERVICE_ROLE} TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await admin(`REVOKE ${EXTRA_SERVICE_ROLE} FROM open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await admin(`ALTER ROLE open_loops_runtime BYPASSRLS`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await admin(`ALTER ROLE open_loops_runtime NOBYPASSRLS`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`GRANT CONNECT ON DATABASE ${ISO_DB} TO PUBLIC`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`REVOKE CONNECT ON DATABASE ${ISO_DB} FROM PUBLIC`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`GRANT CONNECT ON DATABASE ${ISO_DB} TO ${RUNTIME_LOGIN} WITH GRANT OPTION`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE CONNECT ON DATABASE ${ISO_DB} FROM ${RUNTIME_LOGIN}; GRANT CONNECT ON DATABASE ${ISO_DB} TO ${RUNTIME_LOGIN}`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await admin(`CREATE ROLE ${DRIFT_DATABASE_LOGIN} LOGIN BYPASSRLS; GRANT open_loops_runtime TO ${DRIFT_DATABASE_LOGIN}; GRANT CONNECT ON DATABASE ${ISO_DB} TO ${DRIFT_DATABASE_LOGIN}`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await admin(`REVOKE open_loops_runtime FROM ${DRIFT_DATABASE_LOGIN}; DROP OWNED BY ${DRIFT_DATABASE_LOGIN}; DROP ROLE ${DRIFT_DATABASE_LOGIN}`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_current_tenant_id() OWNER TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_current_tenant_id() OWNER TO open_loops_owner`);
    await executor.queryClient.execute(`GRANT EXECUTE ON FUNCTION public.open_loops_current_tenant_id() TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_current_tenant_id() SECURITY DEFINER`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_current_tenant_id() SECURITY INVOKER`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) OWNER TO open_loops_authenticator`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) OWNER TO open_loops_owner`);
    await executor.queryClient.execute(`GRANT EXECUTE ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) TO open_loops_authenticator`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) SECURITY INVOKER`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) SECURITY DEFINER`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) SET search_path=public`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) SET search_path=pg_catalog`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`GRANT SELECT ON loops TO open_loops_runtime WITH GRANT OPTION`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE SELECT ON loops FROM open_loops_runtime; GRANT SELECT ON loops TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`GRANT EXECUTE ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) TO open_loops_authenticator WITH GRANT OPTION`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`REVOKE EXECUTE ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) FROM open_loops_authenticator; GRANT EXECUTE ON FUNCTION public.open_loops_authenticate_key(TEXT, TEXT) TO open_loops_authenticator`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`CREATE FUNCTION evil.public_escalate() RETURNS INTEGER LANGUAGE sql RETURN 1`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`REVOKE EXECUTE ON FUNCTION evil.public_escalate() FROM PUBLIC`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    await executor.queryClient.execute(`GRANT USAGE ON SCHEMA evil TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE USAGE ON SCHEMA evil FROM open_loops_runtime`);
    await executor.queryClient.execute(`CREATE SEQUENCE evil.runtime_sequence; GRANT USAGE ON SEQUENCE evil.runtime_sequence TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE USAGE ON SEQUENCE evil.runtime_sequence FROM open_loops_runtime`);
    await executor.queryClient.execute(`GRANT TEMPORARY ON DATABASE ${ISO_DB} TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE TEMPORARY ON DATABASE ${ISO_DB} FROM open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`
      CREATE TABLE evil.credentials(secret TEXT NOT NULL);
      INSERT INTO evil.credentials(secret) VALUES ('cross-app-secret');
      GRANT USAGE ON SCHEMA evil TO open_loops_authenticator;
      GRANT SELECT ON evil.credentials TO open_loops_authenticator;
    `);
    expect(await authExecutor.queryClient.get<{ secret: string }>("SELECT secret FROM evil.credentials"))
      .toEqual({ secret: "cross-app-secret" });
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`
      REVOKE SELECT ON evil.credentials FROM open_loops_authenticator;
      REVOKE USAGE ON SCHEMA evil FROM open_loops_authenticator;
      DROP TABLE evil.credentials;
    `);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
    expect(await isSafeServiceConnection(executor.queryClient, "open_loops_runtime")).toBe(false);
    await admin(`ALTER ROLE ${AUTH_LOGIN} NOINHERIT`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await admin(`ALTER ROLE ${AUTH_LOGIN} INHERIT; CREATE ROLE ${EXTRA_AUTH_ROLE}`);
    await executor.queryClient.execute(`GRANT SELECT ON api_keys TO ${EXTRA_AUTH_ROLE}`);
    await admin(`GRANT ${EXTRA_AUTH_ROLE} TO ${AUTH_LOGIN}`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await expect(authExecutor.queryClient.get("SELECT token_hash FROM api_keys LIMIT 1"))
      .rejects.toMatchObject({ code: "42501" });
    await admin(`REVOKE ${EXTRA_AUTH_ROLE} FROM ${AUTH_LOGIN}`);
    await executor.queryClient.execute(`REVOKE SELECT ON api_keys FROM ${EXTRA_AUTH_ROLE}`);
    await admin(`DROP ROLE ${EXTRA_AUTH_ROLE}`);
    await executor.queryClient.execute(`REVOKE UPDATE ON loops FROM open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`GRANT UPDATE ON loops TO open_loops_runtime`);
    await executor.queryClient.execute(`GRANT SELECT ON api_keys TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`REVOKE SELECT ON api_keys FROM open_loops_runtime`);
    await executor.queryClient.execute(`REVOKE EXECUTE ON FUNCTION open_loops_authenticate_key(TEXT, TEXT) FROM open_loops_authenticator`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(false);
    await executor.queryClient.execute(`GRANT EXECUTE ON FUNCTION open_loops_authenticate_key(TEXT, TEXT) TO open_loops_authenticator`);
    expect(await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")).toBe(true);
  });

  beforeEach(async () => {
    // Disposable DB: wipe between tests. CASCADE clears child rows.
    await executor.queryClient.execute(
      "TRUNCATE loops, loop_runs, workflow_specs, workflow_runs, workflow_step_runs, workflow_events, workflow_invocations, workflow_work_items, goals, goal_plan_nodes, goal_runs, daemon_lease, runner_machines, runner_leases, audit_events RESTART IDENTITY CASCADE",
    );
  });

  test("createLoop round-trips json/timestamps and reads resolve", async () => {
    const loop = await storage.createLoop(loopInput("alpha"));
    expect(loop.id).toBeTruthy();
    expect(loop.status).toBe("active");
    expect(loop.schedule).toEqual({ type: "interval", everyMs: 60_000 });
    expect(loop.target.type).toBe("command");
    expect(loop.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const byId = await storage.getLoop(loop.id);
    expect(byId?.id).toBe(loop.id);
    const byName = await storage.findLoopByName("alpha");
    expect(byName?.id).toBe(loop.id);
    const required = await storage.requireLoop("alpha");
    expect(required.id).toBe(loop.id);
    await expect(storage.requireLoop("nope")).rejects.toThrow();
  });

  test("listLoops / dueLoops / countLoops", async () => {
    const a = await storage.createLoop(loopInput("a"));
    await storage.createLoop(loopInput("b"));
    expect((await storage.listLoops()).length).toBe(2);
    expect(await storage.countLoops()).toBe(2);
    expect(await storage.countLoops("active")).toBe(2);

    // a is due (next_run set in the past); make it due explicitly.
    await storage.updateLoop(a.id, { nextRunAt: "2000-01-01T00:00:00.000Z" });
    const due = await storage.dueLoops(new Date());
    expect(due.map((l) => l.id)).toContain(a.id);
  });

  test("updateLoop enforces archive freeze + rename/archive/unarchive/delete", async () => {
    const loop = await storage.createLoop(loopInput("mut"));
    const paused = await storage.updateLoop(loop.id, { status: "paused" });
    expect(paused.status).toBe("paused");

    const renamed = await storage.renameLoop(loop.id, "mut2");
    expect(renamed.name).toBe("mut2");

    const archived = await storage.archiveLoop(loop.id);
    expect(archived.archivedAt).toBeTruthy();
    await expect(storage.updateLoop(loop.id, { status: "active" })).rejects.toThrow();

    const un = await storage.unarchiveLoop(loop.id);
    expect(un.archivedAt).toBeUndefined();

    expect(await storage.deleteLoop(loop.id)).toBe(true);
    expect(await storage.getLoop(loop.id)).toBeUndefined();
  });

  test("run lifecycle: claim -> record -> heartbeat -> finalize", async () => {
    const loop = await storage.createLoop(loopInput("runner", { leaseMs: 60_000 }));
    const slot = "2026-07-06T10:00:00.000Z";
    const claim = await storage.claimRun(loop, slot, "runner-1");
    expect(claim).toBeTruthy();
    expect(claim!.run.status).toBe("running");
    const token = claim!.claimToken!;

    // A second claim on the same live-leased slot must fail.
    const second = await storage.claimRun(loop, slot, "runner-2");
    expect(second).toBeUndefined();

    const rec = await storage.recordRunProcess(claim!.run.id, { pid: 4242 });
    expect(rec?.pid).toBe(4242);

    const hb = await storage.heartbeatRunLease(claim!.run.id, "runner-1", 60_000, new Date(), { claimToken: token });
    expect(hb?.status).toBe("running");

    const fin = await storage.finalizeRun(
      claim!.run.id,
      { status: "succeeded", finishedAt: new Date().toISOString(), durationMs: 5, stdout: "ok", stderr: "" },
      { claimedBy: "runner-1", claimToken: token },
    );
    expect(fin.status).toBe("succeeded");
    expect(fin.stdout).toBe("ok");

    expect(await storage.countRuns("succeeded")).toBe(1);
    const runs = await storage.listRuns({ loopId: loop.id });
    expect(runs.length).toBe(1);
    expect((await storage.getRunBySlot(loop.id, slot))?.id).toBe(claim!.run.id);
  });

  test("createSkippedRun is idempotent per slot", async () => {
    const loop = await storage.createLoop(loopInput("skip"));
    const slot = "2026-07-06T11:00:00.000Z";
    const a = await storage.createSkippedRun(loop, slot, "overlap");
    const b = await storage.createSkippedRun(loop, slot, "overlap again");
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("skipped");
  });

  test("recoverExpiredRunLeases abandons expired running runs", async () => {
    const loop = await storage.createLoop(loopInput("recover", { leaseMs: 1 }));
    const slot = "2026-07-06T12:00:00.000Z";
    const past = new Date(Date.now() - 60_000);
    const claim = await storage.claimRun(loop, slot, "runner-x", past);
    expect(claim).toBeTruthy();
    const result = await storage.recoverExpiredRunLeasesDetailed(new Date());
    expect(result.abandoned.length).toBe(1);
    expect(result.abandoned[0]!.status).toBe("abandoned");
    expect(result.deferred.length).toBe(0);
  });

  test("daemon lease acquire/heartbeat/release/get", async () => {
    const acq = await storage.acquireDaemonLease({ id: "d1", pid: 1, hostname: "h", ttlMs: 60_000 });
    expect(acq?.id).toBe("d1");
    // A different daemon cannot steal a live lease.
    const stolen = await storage.acquireDaemonLease({ id: "d2", pid: 2, hostname: "h2", ttlMs: 60_000 });
    expect(stolen).toBeUndefined();
    const hb = await storage.heartbeatDaemonLease("d1", 60_000);
    expect(hb?.id).toBe("d1");
    expect((await storage.getDaemonLease())?.id).toBe("d1");
    await storage.releaseDaemonLease("d1");
    expect(await storage.getDaemonLease()).toBeUndefined();
  });

  test("pruneHistory deletes old terminal runs", async () => {
    const loop = await storage.createLoop(loopInput("prune"));
    // Insert an old terminal run directly.
    await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-setup" },
      (client) => client.execute(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,1,'succeeded',$5,$5)`,
        ["oldrun", loop.id, "prune", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
      ),
    );
    await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-goal-setup" },
      async (client) => {
        await client.execute(
          `INSERT INTO goals(
            id, plan_id, objective, status, tokens_used, time_used_seconds, auto_execute,
            loop_id, loop_run_id, created_at, updated_at
          ) VALUES (
            'goal-prune-loop-run','plan-prune','objective','complete',0,0,'ready_only',
            $1,'oldrun','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
          )`,
          [loop.id],
        );
        await client.execute(
          `INSERT INTO goal_runs(
            id, goal_id, plan_id, loop_id, loop_run_id, turn, phase, status, tokens_used,
            created_at, updated_at
          ) VALUES (
            'goal-run-prune-loop-run','goal-prune-loop-run','plan-prune',$1,'oldrun',1,'run','complete',0,
            '2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
          )`,
          [loop.id],
        );
      },
    );
    const summary = await storage.pruneHistory({ maxAgeDays: 30 });
    expect(summary.loopRuns).toBe(1);
    expect(summary.goalRuns).toBe(1);
    expect(await storage.getRun("oldrun")).toBeUndefined();
    expect(await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-goal-read" },
      (client) => client.get<{ goal_loop_run_id: string | null }>(
        `SELECT loop_run_id AS goal_loop_run_id
           FROM goals
          WHERE id='goal-prune-loop-run'`,
      ),
    )).toEqual({ goal_loop_run_id: null });
    expect(await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-goal-run-read" },
      (client) => client.get<{ id: string }>(
        `SELECT id FROM goal_runs WHERE id='goal-run-prune-loop-run'`,
      ),
    )).toBeNull();
  });

  test("pruneHistory nulls work-item references to deleted workflow runs", async () => {
    const loop = await storage.createLoop(loopInput("prune-workflow"));
    await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-workflow-setup" },
      async (client) => {
        await client.execute(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, created_at, updated_at)
         VALUES ('prune-loop-run',$1,'prune-workflow','2020-01-01T00:00:00Z',1,'succeeded','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`,
        [loop.id],
        );
        await client.execute(
          `INSERT INTO workflow_specs(id,name,version,status,steps_json,created_at,updated_at)
           VALUES ('prune-workflow-spec','prune-workflow-spec',1,'active','[]','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`,
        );
        await client.execute(
          `INSERT INTO workflow_invocations(
           id,source_kind,source_json,subject_kind,subject_json,intent,created_at,updated_at
           ) VALUES ('prune-invocation','manual','{}','loop','{}','test','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`,
        );
        await client.execute(
          `INSERT INTO workflow_work_items(
           id,route_key,idempotency_key,invocation_id,source_type,source_ref,subject_ref,
           priority,status,attempts,created_at,updated_at
           ) VALUES (
             'prune-work-item','test','prune-work-item','prune-invocation','manual','test','test',
             0,'completed',0,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
           )`,
        );
        await client.execute(
          `INSERT INTO workflow_runs(
           id,workflow_id,workflow_name,loop_id,loop_run_id,status,created_at,updated_at
           ) VALUES (
             'prune-workflow-run','prune-workflow-spec','prune-workflow-spec',$1,'prune-loop-run','succeeded',
             '2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
           )`,
          [loop.id],
        );
        await client.execute(
          "UPDATE workflow_work_items SET workflow_run_id='prune-workflow-run' WHERE id='prune-work-item'",
        );
        await client.execute(
          `INSERT INTO goals(
            id, plan_id, objective, status, tokens_used, time_used_seconds, auto_execute,
            workflow_id, workflow_run_id, created_at, updated_at
          ) VALUES (
            'goal-prune-workflow-run','plan-prune-workflow','objective','complete',0,0,'ready_only',
            'prune-workflow-spec','prune-workflow-run','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
          )`,
        );
        await client.execute(
          `INSERT INTO goal_runs(
            id, goal_id, plan_id, workflow_id, workflow_run_id, turn, phase, status, tokens_used,
            created_at, updated_at
          ) VALUES (
            'goal-run-prune-workflow-run','goal-prune-workflow-run','plan-prune-workflow',
            'prune-workflow-spec','prune-workflow-run',1,'run','complete',0,
            '2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'
          )`,
        );
      },
    );
    const summary = await storage.pruneHistory({ maxAgeDays: 30 });
    expect(summary).toMatchObject({ loopRuns: 1, workflowRuns: 1, goalRuns: 1 });
    expect(await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-workflow-read" },
      (client) => client.get<{ item_workflow_run_id: string | null; goal_workflow_run_id: string | null }>(
        `SELECT item.workflow_run_id AS item_workflow_run_id,
                goal.workflow_run_id AS goal_workflow_run_id
           FROM workflow_work_items item
           JOIN goals goal ON goal.id='goal-prune-workflow-run'
          WHERE item.id='prune-work-item'`,
      ),
    )).toEqual({ item_workflow_run_id: null, goal_workflow_run_id: null });
    expect(await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "prune-workflow-goal-run-read" },
      (client) => client.get<{ id: string }>(
        `SELECT id FROM goal_runs WHERE id='goal-run-prune-workflow-run'`,
      ),
    )).toBeNull();
  });

  test("upsertMigrationLoop/Run/Workflow preserve id+status, are idempotent, and honor replace", async () => {
    const loop: Loop = {
      id: "mig-loop-1",
      name: "migrated",
      description: "backfill",
      status: "stopped",
      archivedAt: "2026-01-02T00:00:00.000Z",
      archivedFromStatus: "paused",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const first = await storage.upsertMigrationLoop(loop);
    expect(first.id).toBe("mig-loop-1");
    // status preserved exactly (not forced to "active"), archived state kept.
    expect(first.status).toBe("stopped");
    expect(first.archivedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(first.createdAt).toBe("2026-01-01T00:00:00.000Z");

    // Idempotent: re-upsert without replace keeps a single row and does not
    // overwrite even if the incoming row differs.
    await storage.upsertMigrationLoop({ ...loop, name: "changed" });
    expect((await storage.getLoop("mig-loop-1"))?.name).toBe("migrated");
    expect(await storage.countLoops(undefined, { includeArchived: true })).toBe(1);

    // replace=true updates in place (still one row).
    await storage.upsertMigrationLoop({ ...loop, name: "changed" }, { replace: true });
    expect((await storage.getLoop("mig-loop-1"))?.name).toBe("changed");
    expect(await storage.countLoops(undefined, { includeArchived: true })).toBe(1);

    const run: LoopRun = {
      id: "mig-run-1",
      loopId: "mig-loop-1",
      loopName: "migrated",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      attempt: 1,
      status: "succeeded",
      finishedAt: "2026-01-01T00:00:05.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:05.000Z",
    };
    const importedRun = await storage.upsertMigrationRun(run);
    expect(importedRun.id).toBe("mig-run-1");
    expect(importedRun.status).toBe("succeeded");
    await storage.upsertMigrationRun(run); // idempotent
    expect(await storage.countRuns()).toBe(1);
    // Running runs are rejected (volatile lease/process ownership).
    await expect(storage.upsertMigrationRun({ ...run, id: "mig-run-2", status: "running" })).rejects.toThrow();

    const workflow: WorkflowSpec = {
      id: "mig-wf-1",
      name: "wf",
      version: 1,
      status: "active",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const importedWf = await storage.upsertMigrationWorkflow(workflow);
    expect(importedWf.id).toBe("mig-wf-1");
    await storage.upsertMigrationWorkflow(workflow); // idempotent
    expect(await storage.countWorkflows()).toBe(1);
  });

  test("fleet-union import tolerates secondary-unique collisions (skips, never aborts)", async () => {
    // Baseline: one loop, one run occupying a schedule slot, one active workflow.
    await storage.upsertMigrationLoop({
      id: "u-loop-1", name: "u-migrated", status: "active",
      schedule: { type: "interval", everyMs: 60_000, anchor: "fixed_rate" },
      target: { type: "command", command: "echo", shell: true },
      catchUp: "latest", catchUpLimit: 50, overlap: "skip", maxAttempts: 1,
      retryDelayMs: 1000, leaseMs: 1000,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as Loop);
    const baseRun: LoopRun = {
      id: "u-run-1", loopId: "u-loop-1", loopName: "u-migrated",
      scheduledFor: "2026-02-02T00:00:00.000Z", attempt: 1, status: "succeeded",
      finishedAt: "2026-02-02T00:00:05.000Z",
      createdAt: "2026-02-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:05.000Z",
    };
    await storage.upsertMigrationRun(baseRun);
    const runsBefore = await storage.countRuns();

    // Another machine's run: NEW id, SAME (loop_id, scheduled_for). The
    // (loop_id, scheduled_for) unique constraint can't be caught by ON
    // CONFLICT(id); the import must skip it and return the existing occupant.
    const collidingRun = await storage.upsertMigrationRun({ ...baseRun, id: "u-run-2-different-id" });
    expect(collidingRun.id).toBe("u-run-1");
    expect(await storage.countRuns()).toBe(runsBefore); // no new row, no throw

    // Another machine's workflow: NEW id, SAME active name. The partial unique
    // on (name) WHERE status='active' must be tolerated and the existing owner
    // returned rather than aborting the batch.
    await storage.upsertMigrationWorkflow({
      id: "u-wf-1", name: "u-wf", version: 1, status: "active",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as WorkflowSpec);
    const wfBefore = await storage.countWorkflows();
    const collidingWf = await storage.upsertMigrationWorkflow({
      id: "u-wf-2-different-id", name: "u-wf", version: 2, status: "active",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as WorkflowSpec);
    expect(collidingWf.id).toBe("u-wf-1");
    expect(await storage.countWorkflows()).toBe(wfBefore); // no new row, no throw
  });

  test("createWorkflow persists a spec and archiveWorkflow flips its status", async () => {
    const created = await storage.createWorkflow({
      name: "pg-created-wf",
      steps: [{ id: "s1", target: { type: "command", command: "true" } }],
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("active");

    const fetched = await storage.getWorkflow(created.id);
    expect(fetched?.name).toBe("pg-created-wf");
    expect(fetched?.steps).toHaveLength(1);

    const listed = await storage.listWorkflows({ status: "active" });
    expect(listed.some((wf) => wf.id === created.id)).toBe(true);

    const archived = await storage.archiveWorkflow(created.id);
    expect(archived.status).toBe("archived");
    expect((await storage.getWorkflow(created.id))?.status).toBe("archived");
  });

  test("route invocation and work-item upserts preserve caller ids", async () => {
    const invocation = await storage.createWorkflowInvocation({
      id: "pg-inv-1",
      sourceRef: { kind: "task", id: "task-1", dedupeKey: "task-1" },
      subjectRef: { kind: "repo", path: "/repo" },
      intent: "route",
    });
    expect(invocation.id).toBe("pg-inv-1");
    const deduped = await storage.createWorkflowInvocation({
      id: "pg-inv-2",
      sourceRef: { kind: "task", id: "task-1", dedupeKey: "task-1" },
      subjectRef: { kind: "repo", path: "/repo" },
      intent: "route",
    });
    expect(deduped.id).toBe("pg-inv-1");

    const item = await storage.upsertWorkflowWorkItem({
      id: "pg-wi-1",
      routeKey: "todos-task",
      idempotencyKey: "task-1",
      invocationId: "pg-inv-1",
      sourceType: "task",
      sourceRef: "task:task-1",
      subjectRef: "repo:/repo",
      priority: 10,
      status: "queued",
    });
    expect(item.id).toBe("pg-wi-1");
    expect(item.routeKey).toBe("todos-task");
    const replay = await storage.upsertWorkflowWorkItem({
      id: "pg-wi-2",
      routeKey: "todos-task",
      idempotencyKey: "task-1",
      invocationId: "pg-inv-1",
      sourceType: "task",
      sourceRef: "task:task-1",
      subjectRef: "repo:/repo",
      priority: 20,
      status: "deferred",
    });
    expect(replay.id).toBe("pg-wi-1");
    expect(replay.priority).toBe(20);
    expect(replay.status).toBe("deferred");
  });

  test("TIER-2 unported methods throw NotImplementedError (never silently no-op)", () => {
    expect(() => storage.createGoal()).toThrow(NotImplementedError);
    expect(() => storage.finalizeWorkflowRun()).toThrow(/not implemented/i);
  });

  test("two connections never double-claim the same slot (contract claimRun)", async () => {
    const execB = PgPoolExecutor.fromConnectionString({ connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }), applicationName: "loops-pgstore-test-b" });
    const storageB = new PostgresLoopStorage(execB.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "request-test-b",
    });
    try {
      const loop = await storage.createLoop(loopInput("race", { leaseMs: 60_000 }));
      const slot = "2026-07-06T13:00:00.000Z";
      const [a, b] = await Promise.all([
        storage.claimRun(loop, slot, "runner-a"),
        storageB.claimRun(loop, slot, "runner-b"),
      ]);
      const winners = [a, b].filter(Boolean);
      expect(winners.length).toBe(1);
      const running = await runtimeExecutor.withRequestContext(
        { tenantId: "tenant-test", principalId: "principal-test", requestId: "race-count" },
        (client) => client.get<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM loop_runs WHERE loop_id=$1 AND status='running'",
          [loop.id],
        ),
      );
      expect(running?.count).toBe(1);
    } finally {
      await execB.close();
    }
  });

  test("tenant foreign keys reject an unregistered request tenant", async () => {
    const unknown = new PostgresLoopStorage(runtimeExecutor.queryClient, {
      tenantId: "tenant-does-not-exist",
      principalId: "principal-test",
      requestId: "unknown-tenant",
    });
    await expect(unknown.createLoop(loopInput("unknown"))).rejects.toMatchObject({ code: "23503" });
  });

  test("runtime requests cannot read stored API key hashes", async () => {
    const runtimeStorage = new PostgresLoopStorage(runtimeExecutor.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "least-privilege-runtime",
    });
    expect((await runtimeStorage.createLoop(loopInput("least-privilege"))).name).toBe("least-privilege");
    await expect(runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "raw-key-read" },
      (client) => client.many("SELECT token_hash FROM api_keys"),
    )).rejects.toMatchObject({ code: "42501" });
  });

  test("auth audit derives tenant and principal from the exact stored key", async () => {
    await executor.queryClient.execute(
      `INSERT INTO api_keys(
        kid, app, agent, scopes, token_hash, issued_at, tenant_id, principal_id, token_kind
      ) VALUES ('audit-key', 'loops', 'principal-test', '["loops:read"]', 'audit-hash', now(),
        'tenant-test', 'principal-test', 'api_key')`,
    );
    expect(await authExecutor.queryClient.get<{ tenant_id: string; principal_id: string }>(
      "SELECT tenant_id, principal_id FROM open_loops_authenticate_key($1,$2)", ["audit-key", "audit-hash"],
    )).toEqual({ tenant_id: "tenant-test", principal_id: "principal-test" });
    await expect(authExecutor.queryClient.get("SELECT token_hash FROM api_keys LIMIT 1"))
      .rejects.toMatchObject({ code: "42501" });
    await authExecutor.queryClient.execute(
      "SELECT open_loops_append_auth_audit($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      ["audit-event", "audit-key", "audit-hash", "audit-request", "loops.list", "allow", null, "{}"],
    );
    const row = await executor.queryClient.get<{ tenant_id: string; principal_id: string }>(
      "SELECT tenant_id, principal_id FROM audit_events WHERE id='audit-event'",
    );
    expect(row).toEqual({ tenant_id: "tenant-test", principal_id: "principal-test" });
  });

  test("runtime login cannot execute authentication functions or forge audit rows", async () => {
    await expect(runtimeExecutor.queryClient.get(
      "SELECT * FROM open_loops_authenticate_key($1,$2)", ["missing", "missing"],
    )).rejects.toMatchObject({ code: "42501" });
    await expect(runtimeExecutor.queryClient.execute(
      "SELECT open_loops_append_auth_audit($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      ["forged", null, null, "request", "loops.list", "deny", "forged", "{}"],
    )).rejects.toMatchObject({ code: "42501" });
    await expect(runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "forge-insert" },
      (client) => client.execute(
        "INSERT INTO audit_events(tenant_id,id,actor,action,subject_type,subject_id,metadata_json,created_at) VALUES ('tenant-test','forged','x','auth.allow','api_request','x','{}',now())",
      ),
    )).rejects.toMatchObject({ code: "42501" });
  });

  test("request transactions do not leak tenant context and roll back failures", async () => {
    await executor.queryClient.execute(
      `INSERT INTO tenants(id, slug, name, status) VALUES ('tenant-other', 'tenant-other', 'Tenant Other', 'active');
       INSERT INTO tenant_memberships(tenant_id, principal_id, status) VALUES ('tenant-other', 'principal-test', 'active');
       INSERT INTO tenant_membership_roles(tenant_id, principal_id, role) VALUES ('tenant-other', 'principal-test', 'service');`,
    );
    const other = new PostgresLoopStorage(runtimeExecutor.queryClient, {
      tenantId: "tenant-other",
      principalId: "principal-test",
      requestId: "other-request",
    });
    await storage.upsertMigrationLoop({
      id: "same-id", name: "tenant-a", status: "active",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      catchUp: "latest", catchUpLimit: 50, overlap: "skip", maxAttempts: 1,
      retryDelayMs: 1_000, leaseMs: 60_000,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as Loop);
    await other.upsertMigrationLoop({
      id: "same-id", name: "tenant-b", status: "active",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      catchUp: "latest", catchUpLimit: 50, overlap: "skip", maxAttempts: 1,
      retryDelayMs: 1_000, leaseMs: 60_000,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as Loop);
    expect((await storage.getLoop("same-id"))?.name).toBe("tenant-a");
    expect((await other.getLoop("same-id"))?.name).toBe("tenant-b");

    await expect(runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "rollback" },
      async (client) => {
        await client.execute(
          `INSERT INTO loops(id, name, status, schedule_json, target_json, catch_up, catch_up_limit,
             overlap, max_attempts, retry_delay_ms, lease_ms, created_at, updated_at)
           VALUES ('rolled-back', 'rolled-back', 'active', '{}', '{}', 'latest', 50,
             'skip', 1, 1000, 60000, now(), now())`,
        );
        throw new Error("force rollback");
      },
    )).rejects.toThrow("force rollback");
    expect(await storage.getLoop("rolled-back")).toBeUndefined();
  });

  test("runner leases require exactly one run target", async () => {
    const loop = await storage.createLoop(loopInput("lease-xor"));
    const claim = await storage.claimRun(loop, "2026-07-06T14:00:00.000Z", "runner-xor");
    expect(claim).toBeTruthy();
    await expect(runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "lease-xor" },
      async (client) => {
        await client.execute(
          `INSERT INTO workflow_specs(id, name, version, status, steps_json, created_at, updated_at)
           VALUES ('wf-xor', 'wf-xor', 1, 'active', '[]', now(), now())`,
        );
        await client.execute(
          `INSERT INTO workflow_runs(id, workflow_id, workflow_name, status, created_at, updated_at)
           VALUES ('wf-run-xor', 'wf-xor', 'wf-xor', 'running', now(), now())`,
        );
        await client.execute(
          `INSERT INTO runner_machines(id, hostname, status, last_seen_at, created_at, updated_at)
           VALUES ('machine-xor', 'host', 'online', now(), now(), now())`,
        );
        await client.execute(
          `INSERT INTO runner_leases(id, runner_id, loop_run_id, workflow_run_id, claim_token, status,
             heartbeat_at, expires_at, created_at, updated_at)
           VALUES ('lease-xor', 'machine-xor', $1, 'wf-run-xor', 'claim', 'active', now(), now(), now(), now())`,
          [claim!.run.id],
        );
      },
    )).rejects.toMatchObject({ code: "23514" });
  });
});
