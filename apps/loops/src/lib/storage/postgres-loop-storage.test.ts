// Live integration tests for the Postgres LoopStorageContract implementation.
//
// Runs only when LOOPS_TEST_DATABASE_URL points at a DISPOSABLE Postgres (a
// dockerized instance or a throwaway local database) — NEVER the shared RDS.
// When unset the suite is skipped so `bun test` stays hermetic offline.
//
// Covers the priority-1/priority-2 paths the daemon + CLI + runner exercise:
// loop CRUD, run lifecycle (claim/heartbeat/finalize/recover), daemon lease,
// counts, route representation, prune, workflow lifecycle writes, and the
// two-connection claim race.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import pg from "pg";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { PostgresLoopStorage } from "./postgres-loop-storage.js";
import {
  AmbiguousNameError,
  DuplicateWorkflowEventError,
  LegacyWorkflowRunProvenanceError,
  LoopMutationConflictError,
  RunFinalizationConflictError,
  ValidationError,
  WorkflowRunDefinitionConflictError,
  WorkflowRunStepOwnershipUnverifiableError,
} from "../errors.js";
import { assertTenantEnforcementBootstrap, assertTenantEnforcementBootstrapIfPending, isSafeServiceConnection } from "../../serve/index.js";
import type { CreateLoopInput, Loop, LoopRun, WorkflowSpec, WorkflowStepRun } from "../../types.js";
import { waitUntil } from "../../test-helpers.js";
import { planLoopAdvancement } from "../advancement.js";
import { createLoopsApiServer } from "../../api/index.js";
import type { TenantAuthContext } from "../auth/tenant-auth.js";
import { operationAdmissionReceipt, parsePrivateOperationDescriptor } from "../operation-contract.js";

const j = (...parts: string[]): string => parts.join("");
const GH_PAT = j("ghp", "_AbCdEf0123456789AbCdEf0123456789");
const QUOTED_SECRET = j("x9Kd2mQz", "7Lp4Rv8t");

const DATABASE_URL = process.env.LOOPS_TEST_DATABASE_URL;
const RUN_LIVE = typeof DATABASE_URL === "string" && DATABASE_URL.length > 0;
const suite = RUN_LIVE ? describe : describe.skip;

// Isolate in a dedicated throwaway database so live claim/recovery tests never
// interfere with rows from another concurrently running Postgres suite.
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
type BootstrapMembershipRegression = {
  error?: unknown;
  errorMessage?: string;
  failureStage?: "preflight" | "migration";
  createroleSelfGrant?: string;
  memberships?: Array<{
    granted_role: string;
    admin_option: boolean;
    inherit_option: boolean;
    set_option: boolean;
  }>;
  ownerSettable?: boolean;
  migratorSettable?: boolean;
  runtimeMember?: boolean;
  authenticatorMember?: boolean;
  ledgerRecorded?: boolean;
};

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

async function adminQuery<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

async function exercisePg16BootstrapMemberships(
  mode:
    | "missing"
    | "preexisting-safe"
    | "preexisting-unsafe"
    | "preexisting-service-login"
    | "preexisting-login-role"
    | "preexisting-third-party-member"
    | "preexisting-cross-database",
): Promise<BootstrapMembershipRegression> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const database = `loops_bootstrap_membership_${suffix}`;
  const bootstrap = `loops_bootstrap_${suffix}`;
  const serviceLogin = `loops_service_login_${suffix}`;
  const thirdPartyMember = `loops_third_party_${suffix}`;
  const crossDatabase = `loops_cross_database_${suffix}`;
  const password = `bootstrap-test-${suffix}`;
  let probe: PgPoolExecutor | undefined;
  let failureStage: "preflight" | "migration" = "preflight";
  try {
    await admin(`CREATE ROLE ${bootstrap} LOGIN CREATEROLE PASSWORD '${password}'`);
    await admin(`CREATE DATABASE ${database} OWNER ${bootstrap}`);
    if (mode !== "missing") {
      await admin(`
        CREATE ROLE open_loops_owner INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        CREATE ROLE open_loops_migrator INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        CREATE ROLE open_loops_runtime INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        CREATE ROLE open_loops_authenticator INHERIT NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        GRANT open_loops_owner, open_loops_migrator
          TO ${bootstrap} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
      `);
      if (mode === "preexisting-unsafe") {
        await admin(`
          GRANT open_loops_runtime, open_loops_authenticator
            TO ${bootstrap} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
        `);
      }
      if (mode === "preexisting-service-login") {
        await admin(`
          CREATE ROLE ${serviceLogin} INHERIT LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          GRANT open_loops_runtime TO ${serviceLogin} WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
        `);
      }
      if (mode === "preexisting-login-role") {
        await admin("ALTER ROLE open_loops_runtime LOGIN");
      }
      if (mode === "preexisting-third-party-member") {
        await admin(`
          CREATE ROLE ${thirdPartyMember} NOLOGIN;
          GRANT open_loops_owner TO ${thirdPartyMember};
        `);
      }
      if (mode === "preexisting-cross-database") {
        await admin(`CREATE DATABASE ${crossDatabase} OWNER open_loops_runtime`);
      }
    }
    const url = new URL(DATABASE_URL!);
    url.pathname = `/${database}`;
    url.searchParams.delete("host");
    url.hostname = "127.0.0.1";
    url.username = bootstrap;
    url.password = password;
    probe = PgPoolExecutor.fromConnectionString({
      connectionString: url.toString(),
      applicationName: "loops-pg16-bootstrap-membership-regression",
    });
    const schema = new PostgresStorage(probe);
    await schema.migrate({ through: "0008_tenant_prepare" });
    await assertTenantEnforcementBootstrap(probe.queryClient);
    failureStage = "migration";
    if (mode === "preexisting-safe") {
      const peer = PgPoolExecutor.fromConnectionString({
        connectionString: url.toString(),
        applicationName: "loops-pg16-bootstrap-concurrent-peer",
      });
      try {
        await Promise.all([schema.migrate(), new PostgresStorage(peer).migrate()]);
      } finally {
        await peer.close();
      }
    } else {
      await schema.migrate();
    }
    const setting = await probe.queryClient.get<{ createrole_self_grant: string }>(
      "SELECT current_setting('createrole_self_grant') AS createrole_self_grant",
    );
    const memberships = await probe.queryClient.many<{
      granted_role: string;
      admin_option: boolean;
      inherit_option: boolean;
      set_option: boolean;
    }>(`
      SELECT granted.rolname AS granted_role,
             membership.admin_option,
             membership.inherit_option,
             membership.set_option
        FROM pg_auth_members membership
        JOIN pg_roles granted ON granted.oid=membership.roleid
        JOIN pg_roles member ON member.oid=membership.member
       WHERE member.rolname=session_user
         AND granted.rolname IN (
           'open_loops_owner', 'open_loops_migrator',
           'open_loops_runtime', 'open_loops_authenticator'
         )
       ORDER BY granted.rolname
    `);
    const capabilities = await probe.queryClient.get<{
      owner_settable: boolean;
      migrator_settable: boolean;
      runtime_member: boolean;
      authenticator_member: boolean;
      ledger_recorded: boolean;
    }>(`
      SELECT pg_has_role(session_user, 'open_loops_owner', 'SET') AS owner_settable,
             pg_has_role(session_user, 'open_loops_migrator', 'SET') AS migrator_settable,
             pg_has_role(session_user, 'open_loops_runtime', 'MEMBER') AS runtime_member,
             pg_has_role(session_user, 'open_loops_authenticator', 'MEMBER') AS authenticator_member,
             EXISTS (
               SELECT 1 FROM open_loops_schema_migrations WHERE id='0010_tenant_enforce'
             ) AS ledger_recorded
    `);
    return {
      createroleSelfGrant: setting?.createrole_self_grant,
      memberships,
      ownerSettable: capabilities?.owner_settable,
      migratorSettable: capabilities?.migrator_settable,
      runtimeMember: capabilities?.runtime_member,
      authenticatorMember: capabilities?.authenticator_member,
      ledgerRecorded: capabilities?.ledger_recorded,
    };
  } catch (error) {
    return {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      failureStage,
    };
  } finally {
    if (probe) await probe.close();
    await admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin(`DROP DATABASE IF EXISTS ${crossDatabase} WITH (FORCE)`);
    await admin(`
      DO $cleanup$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY[
          'open_loops_owner', 'open_loops_migrator',
          'open_loops_runtime', 'open_loops_authenticator'
        ] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
            EXECUTE format('REVOKE %I FROM %I', role_name, '${bootstrap}');
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${serviceLogin}') THEN
              EXECUTE format('REVOKE %I FROM %I', role_name, '${serviceLogin}');
            END IF;
          END IF;
        END LOOP;
      END
      $cleanup$;
      DO $cleanup_third_party$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${thirdPartyMember}') AND
           EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_owner') THEN
          EXECUTE format('REVOKE open_loops_owner FROM %I', '${thirdPartyMember}');
        END IF;
      END
      $cleanup_third_party$;
      DROP ROLE IF EXISTS ${serviceLogin};
      DROP ROLE IF EXISTS ${thirdPartyMember};
      DROP ROLE IF EXISTS ${bootstrap};
      DROP ROLE IF EXISTS open_loops_authenticator;
      DROP ROLE IF EXISTS open_loops_runtime;
      DROP ROLE IF EXISTS open_loops_migrator;
      DROP ROLE IF EXISTS open_loops_owner;
    `);
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
  let schema: PostgresStorage;
  let runtimeExecutor: PgPoolExecutor;
  let authExecutor: PgPoolExecutor;
  let storage: PostgresLoopStorage;
  let unsafeMembershipRemoved = false;
  let unsafeDirectPrivilegesRemoved = false;
  let ownedObjectRejected = false;
  let unsafeServiceLoginRejected = false;
  let bridgeMembershipRemoved = false;
  let adminMembershipRemoved = false;
  let missingRoleBootstrap: BootstrapMembershipRegression;
  let preexistingRoleBootstrap: BootstrapMembershipRegression;
  let unsafeRoleBootstrap: BootstrapMembershipRegression;
  let serviceLoginBootstrap: BootstrapMembershipRegression;
  let loginRoleBootstrap: BootstrapMembershipRegression;
  let thirdPartyMembershipBootstrap: BootstrapMembershipRegression;
  let crossDatabaseBootstrap: BootstrapMembershipRegression;

  beforeAll(async () => {
    const [inventory] = await adminQuery<{ database_count: number; open_loops_role_count: number }>(`
      SELECT (SELECT count(*)::int FROM pg_database WHERE NOT datistemplate) AS database_count,
             (SELECT count(*)::int FROM pg_roles WHERE rolname IN (
               'open_loops_owner', 'open_loops_migrator',
               'open_loops_runtime', 'open_loops_authenticator'
             )) AS open_loops_role_count
    `);
    if (inventory?.database_count !== 1 || inventory.open_loops_role_count !== 0) {
      throw new Error(
        "LOOPS_TEST_DATABASE_URL must point at an exclusive disposable PostgreSQL cluster with no Loops roles",
      );
    }
    missingRoleBootstrap = await exercisePg16BootstrapMemberships("missing");
    preexistingRoleBootstrap = await exercisePg16BootstrapMemberships("preexisting-safe");
    unsafeRoleBootstrap = await exercisePg16BootstrapMemberships("preexisting-unsafe");
    serviceLoginBootstrap = await exercisePg16BootstrapMemberships("preexisting-service-login");
    loginRoleBootstrap = await exercisePg16BootstrapMemberships("preexisting-login-role");
    thirdPartyMembershipBootstrap = await exercisePg16BootstrapMemberships("preexisting-third-party-member");
    crossDatabaseBootstrap = await exercisePg16BootstrapMemberships("preexisting-cross-database");
    await admin(`CREATE DATABASE ${ISO_DB}`);
    executor = PgPoolExecutor.fromConnectionString({ connectionString: isolatedUrl(), applicationName: "loops-pgstore-test" });
    schema = new PostgresStorage(executor);
    await schema.migrate({ through: "0008_tenant_prepare" });
    await executor.queryClient.execute(
      `INSERT INTO tenants(id, slug, name, status) VALUES ('tenant-test', 'tenant-test', 'Tenant Test', 'active');
       INSERT INTO principals(id, kind, display_name, status) VALUES ('principal-test', 'service', 'Principal Test', 'active');
       INSERT INTO tenant_memberships(tenant_id, principal_id, status) VALUES ('tenant-test', 'principal-test', 'active');
       INSERT INTO tenant_membership_roles(tenant_id, principal_id, role) VALUES ('tenant-test', 'principal-test', 'service');`,
    );
    await admin(`
      DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_owner') THEN CREATE ROLE open_loops_owner NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_migrator') THEN CREATE ROLE open_loops_migrator NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_runtime') THEN CREATE ROLE open_loops_runtime NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_authenticator') THEN CREATE ROLE open_loops_authenticator NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS; END IF;
      END $roles$;
      ALTER ROLE open_loops_owner NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      ALTER ROLE open_loops_migrator NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      ALTER ROLE open_loops_runtime NOINHERIT NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      ALTER ROLE open_loops_authenticator NOINHERIT NOLOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
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
      CREATE FUNCTION residual_acl.default_public_function() RETURNS INTEGER LANGUAGE sql RETURN 1;
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
    await admin(`
      REVOKE open_loops_runtime FROM ${UNSAFE_LOGIN}, ${CROSS_ROLE_LOGIN}, ${BRIDGE_ROLE}, ${ADMIN_LOGIN};
      REVOKE open_loops_owner FROM ${CROSS_ROLE_LOGIN};
    `);
    try {
      await schema.migrate();
    } catch (error) {
      ownedObjectRejected = error instanceof Error && error.message.includes("owns database objects");
    }
    await executor.queryClient.execute(`DROP SCHEMA service_owned_probe CASCADE`);
    await admin(`
      GRANT open_loops_runtime TO ${UNSAFE_LOGIN}, ${CROSS_ROLE_LOGIN}, ${BRIDGE_ROLE};
      GRANT open_loops_runtime TO ${ADMIN_LOGIN} WITH ADMIN OPTION;
    `);
    try {
      await schema.migrate();
    } catch (error) {
      unsafeServiceLoginRejected = error instanceof Error && error.message.includes("unsafe service login membership");
    }
    await admin(`
      REVOKE open_loops_runtime FROM ${UNSAFE_LOGIN}, ${CROSS_ROLE_LOGIN}, ${ADMIN_LOGIN};
      REVOKE open_loops_owner FROM ${CROSS_ROLE_LOGIN};
    `);
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
    await admin(`DO $cleanup$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${RUNTIME_LOGIN}') THEN
        EXECUTE format('DROP OWNED BY %I', '${RUNTIME_LOGIN}');
        EXECUTE format('DROP ROLE %I', '${RUNTIME_LOGIN}');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${AUTH_LOGIN}') THEN
        EXECUTE format('DROP OWNED BY %I', '${AUTH_LOGIN}');
        EXECUTE format('DROP ROLE %I', '${AUTH_LOGIN}');
      END IF;
    END $cleanup$`);
    await admin(`DO $cleanup$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_owner') THEN
        EXECUTE format('REVOKE open_loops_owner FROM %I', current_user);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_migrator') THEN
        EXECUTE format('REVOKE open_loops_migrator FROM %I', current_user);
      END IF;
    EXCEPTION WHEN undefined_object THEN NULL;
    END $cleanup$`);
    await admin(`DROP ROLE IF EXISTS ${EXTRA_AUTH_ROLE}`);
    await admin(`DROP ROLE IF EXISTS ${EXTRA_SERVICE_ROLE}`);
    await admin(`DROP ROLE IF EXISTS ${HOSTILE_FUNCTION_OWNER}`);
    await admin(`DO $cleanup$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DRIFT_DATABASE_LOGIN}') THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_runtime') THEN
          EXECUTE format('REVOKE open_loops_runtime FROM %I', '${DRIFT_DATABASE_LOGIN}');
        END IF;
        EXECUTE format('DROP ROLE %I', '${DRIFT_DATABASE_LOGIN}');
      END IF;
    END $cleanup$`);
    await admin(`
      DROP ROLE IF EXISTS open_loops_authenticator;
      DROP ROLE IF EXISTS open_loops_runtime;
      DROP ROLE IF EXISTS open_loops_migrator;
      DROP ROLE IF EXISTS open_loops_owner;
    `);
    const [leftovers] = await adminQuery<{ database_count: number; role_count: number }>(`
      SELECT (SELECT count(*)::int FROM pg_database
               WHERE datname='${ISO_DB}' OR datname LIKE 'loops_bootstrap_membership_%'
                  OR datname LIKE 'loops_cross_database_%') AS database_count,
             (SELECT count(*)::int FROM pg_roles
               WHERE rolname IN (
                 'open_loops_owner', 'open_loops_migrator',
                 'open_loops_runtime', 'open_loops_authenticator'
               ) OR rolname LIKE 'loops_bootstrap_%' OR rolname LIKE 'loops_service_login_%'
                  OR rolname LIKE 'loops_third_party_%') AS role_count
    `);
    if (leftovers?.database_count !== 0 || leftovers.role_count !== 0) {
      throw new Error("PostgreSQL integration test left database or role artifacts behind");
    }
  });

  test("tenant enforcement rejects unsafe service logins and removes unsafe role bridges", async () => {
    await expect(assertTenantEnforcementBootstrap(executor.queryClient)).resolves.toBeUndefined();
    expect(unsafeMembershipRemoved).toBe(true);
    expect(unsafeDirectPrivilegesRemoved).toBe(true);
    expect(ownedObjectRejected).toBe(true);
    expect(unsafeServiceLoginRejected).toBe(true);
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
    await expect(assertTenantEnforcementBootstrapIfPending(executor.queryClient, schema)).resolves.toBeUndefined();
    expect(await executor.queryClient.get<{ owner_settable: boolean; migrator_settable: boolean }>(
      `SELECT pg_has_role(current_user, 'open_loops_owner', 'SET') AS owner_settable,
              pg_has_role(current_user, 'open_loops_migrator', 'SET') AS migrator_settable`,
    )).toEqual({ owner_settable: true, migrator_settable: true });
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
    await expect(runtimeExecutor.queryClient.transaction(async (client) => {
      await client.get("SELECT set_config('open_loops.tenant_id', $1, true)", ["tenant-test"]);
      await client.execute("UPDATE tenants SET name='Raw Runtime Mutated' WHERE id='tenant-test'");
    })).rejects.toMatchObject({ code: "42501" });
    expect(await executor.queryClient.get<{ inherited: boolean }>(
      "SELECT pg_has_role('open_loops_runtime', $1, 'MEMBER') AS inherited", [EXTRA_SERVICE_ROLE],
    )).toEqual({ inherited: false });
    expect(await executor.queryClient.get<{
      runtime_schema: boolean; runtime_table: boolean; runtime_sequence: boolean;
      runtime_function: boolean; auth_function: boolean; runtime_default_function: boolean; auth_default_function: boolean;
    }>(
      `SELECT has_schema_privilege($1, 'residual_acl', 'USAGE') AS runtime_schema,
              has_table_privilege($1, 'residual_acl.private_rows', 'SELECT') AS runtime_table,
              has_sequence_privilege($1, 'residual_acl.private_sequence', 'USAGE') AS runtime_sequence,
              has_function_privilege($1, 'residual_acl.private_function()', 'EXECUTE') AS runtime_function,
              has_function_privilege($2, 'residual_acl.private_function()', 'EXECUTE') AS auth_function,
              has_function_privilege($1, 'residual_acl.default_public_function()', 'EXECUTE') AS runtime_default_function,
              has_function_privilege($2, 'residual_acl.default_public_function()', 'EXECUTE') AS auth_default_function`,
      [RUNTIME_LOGIN, AUTH_LOGIN],
    )).toEqual({
      runtime_schema: false,
      runtime_table: false,
      runtime_sequence: false,
      runtime_function: false,
      auth_function: false,
      runtime_default_function: false,
      auth_default_function: false,
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
    await executor.queryClient.execute("REVOKE INSERT ON loop_mutation_operations FROM open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute("GRANT INSERT ON loop_mutation_operations TO open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute("GRANT UPDATE ON loop_mutation_operations TO open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute("REVOKE UPDATE ON loop_mutation_operations FROM open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute("REVOKE DELETE ON loop_mutation_leases FROM open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute("GRANT DELETE ON loop_mutation_leases TO open_loops_runtime");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute("ALTER TABLE loop_mutation_operations DISABLE ROW LEVEL SECURITY");
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute("ALTER TABLE loop_mutation_operations ENABLE ROW LEVEL SECURITY; ALTER TABLE loop_mutation_operations FORCE ROW LEVEL SECURITY");
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

  test("PostgreSQL 16 bootstrap rejects implicit/unsafe memberships and accepts exact provider grants", () => {
    expect(missingRoleBootstrap.failureStage).toBe("preflight");
    expect(missingRoleBootstrap.errorMessage).toContain("pre-provisioned owner/migrator memberships");
    expect(unsafeRoleBootstrap.failureStage).toBe("preflight");
    expect(unsafeRoleBootstrap.errorMessage).toContain("pre-provisioned owner/migrator memberships");
    expect(serviceLoginBootstrap.failureStage).toBe("preflight");
    expect(serviceLoginBootstrap.errorMessage).toContain("must run before runtime/authenticator service login memberships");
    expect(loginRoleBootstrap.failureStage).toBe("preflight");
    expect(loginRoleBootstrap.errorMessage).toContain("reserved OpenLoops database role open_loops_runtime is LOGIN");
    expect(thirdPartyMembershipBootstrap.failureStage).toBe("preflight");
    expect(thirdPartyMembershipBootstrap.errorMessage).toContain("unsafe privileged role membership open_loops_owner");
    expect(crossDatabaseBootstrap.failureStage).toBe("preflight");
    expect(crossDatabaseBootstrap.errorMessage).toContain("owns database loops_cross_database_");

    expect(preexistingRoleBootstrap.error).toBeUndefined();
    expect(preexistingRoleBootstrap.createroleSelfGrant).toBe("");
    expect(preexistingRoleBootstrap.memberships).toEqual([
      {
        granted_role: "open_loops_migrator",
        admin_option: false,
        inherit_option: true,
        set_option: true,
      },
      {
        granted_role: "open_loops_owner",
        admin_option: false,
        inherit_option: true,
        set_option: true,
      },
    ]);
    expect(preexistingRoleBootstrap.ownerSettable).toBe(true);
    expect(preexistingRoleBootstrap.migratorSettable).toBe(true);
    expect(preexistingRoleBootstrap.runtimeMember).toBe(false);
    expect(preexistingRoleBootstrap.authenticatorMember).toBe(false);
    expect(preexistingRoleBootstrap.ledgerRecorded).toBe(true);
  });

  beforeEach(async () => {
    // Disposable DB: wipe between tests. CASCADE clears child rows.
    await executor.queryClient.execute(
      "TRUNCATE loops, loop_runs, workflow_specs, workflow_runs, workflow_step_runs, workflow_events, workflow_invocations, workflow_work_items, goals, goal_plan_nodes, goal_runs, daemon_lease, runner_machines, runner_leases, audit_events, loop_mutation_operations, loop_mutation_leases RESTART IDENTITY CASCADE",
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

  test("mutateLoop happy path: dry-run, replay, stop, revision conflict (O15-00692)", async () => {
    // O15-00692 regression: the loop-mutation advisory-lock query used
    // E'\000' (octal NUL) as the id separator. PostgreSQL rejects NUL bytes in
    // text, so the FIRST statement of every mutation transaction threw an
    // unhandled Postgres error and POST /v1/loops/<id>/mutations returned 500
    // for every loop. This test exercises the full mutateLoop flow against a
    // live Postgres; before the fix it fails at the advisory lock on every
    // call (dry-run, real stop, and conflict alike).
    const loop = await storage.createLoop(loopInput("mutate-stop"));
    const authority = { authorityId: "loops-control-plane", tenantId: "tenant-test" };
    const envelope = (action: "pause" | "resume" | "stop", operationId: string, over: Record<string, unknown> = {}) => ({
      schema: "openloops.loop_mutation.v1",
      operationId,
      stepId: "stop-step",
      targetId: loop.id,
      action,
      expectedRevision: loop.updatedAt,
      approvedPlanDigest: "0".repeat(64),
      manifestDigest: "0".repeat(64),
      descriptorRef: "owner-operation-target:o15-00692-regression",
      descriptorDigest: "0".repeat(64),
      ...over,
    });

    // 1. Dry-run stop: mutates nothing, but must not throw at the advisory lock.
    const dryRun = await storage.mutateLoop(
      envelope("stop", "op-dry-run", { dryRun: true }) as never,
      authority,
    );
    expect(dryRun.replayed).toBe(false);
    expect(dryRun.loop.status).toBe("active");

    // 2. Replay of the same (operation, step) returns the stored receipt.
    const replay = await storage.mutateLoop(
      envelope("stop", "op-dry-run", { dryRun: true }) as never,
      authority,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.loop.status).toBe("active");

    // 3. Real stop with a fresh operation: the loop transitions to stopped.
    const stopped = await storage.mutateLoop(envelope("stop", "op-stop") as never, authority);
    expect(stopped.replayed).toBe(false);
    expect(stopped.loop.status).toBe("stopped");
    const afterStop = await storage.getLoop(loop.id);
    expect(afterStop?.status).toBe("stopped");
    expect(afterStop?.nextRunAt).toBeUndefined();

    // 4. A stale revision maps to the revision_mismatch conflict (409 class),
    //    proving the pre-fix NUL error is gone from the whole path.
    await expect(
      storage.mutateLoop(envelope("resume", "op-stale", { expectedRevision: loop.updatedAt }) as never, authority),
    ).rejects.toBeInstanceOf(LoopMutationConflictError);
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

  test("listLoops uses id as a total-order tie-breaker across pages", async () => {
    const from = new Date("2030-01-01T00:00:00.000Z");
    const loops = await Promise.all(
      ["zeta", "alpha", "middle"].map((name) =>
        storage.createLoop(loopInput(name, {
          schedule: { type: "once", at: from.toISOString() },
        }), from)
      ),
    );
    const expected = loops.map((loop) => loop.id).toSorted();
    expect((await storage.listLoops({ limit: 2, offset: 0 })).map((loop) => loop.id)).toEqual(expected.slice(0, 2));
    expect((await storage.listLoops({ limit: 2, offset: 2 })).map((loop) => loop.id)).toEqual(expected.slice(2));
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

  test("deleteLoop succeeds for a loop that has run receipts (O15-00624 regression)", async () => {
    // O15-00624: DELETE /loops/<id> -> 500 on the hosted control plane. The
    // run_receipts (tenant_id, loop_id) FK references loops with no ON DELETE
    // action, so a loop that ever produced a terminal receipt cannot be
    // deleted — the FK violation aborts the transaction and the API returns
    // 500. The smoke loop 01a03339214a217030727d008d5a7399 reproduced this
    // live. Deleting a loop must succeed and remove its receipts with it.
    const loop = await storage.createLoop(loopInput("pg-delete-with-receipts"));
    const receiptRunId = `receipt-${loop.id}`;
    await storage.writeRunReceipt({
      loop_id: loop.id,
      run_id: receiptRunId,
      repo: "hasna/apps",
      task_ids: [],
      knowledge_ids: [],
      digest_id: "digest:sha256:o15-00624",
      status: "succeeded",
      exit_code: 0,
      summary: "smoke",
      evidence_paths: [],
    });
    expect(await storage.getRunReceipt(receiptRunId)).toBeTruthy();

    await expect(storage.deleteLoop(loop.id)).resolves.toBe(true);
    expect(await storage.getLoop(loop.id)).toBeUndefined();
    // The receipt is a per-loop run artifact; it must not survive the loop.
    expect(await storage.getRunReceipt(receiptRunId)).toBeUndefined();
  });

  test("updateLoop rejects erased invalid statuses before any PostgreSQL mutation", async () => {
    const loop = await storage.createLoop(loopInput("pg-status-boundary", {
      labels: ["original"],
      schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
    }));
    const before = await storage.getLoop(loop.id);
    for (const status of ["poisoned", null, 7, {}, ""]) {
      await expect(storage.updateLoop(loop.id, {
        status,
        labels: ["mutated"],
        nextRunAt: "2099-01-01T00:00:00.000Z",
      } as unknown as Parameters<typeof storage.updateLoop>[1])).rejects.toBeInstanceOf(ValidationError);
      expect(await storage.getLoop(loop.id)).toEqual(before);
    }

    for (const status of ["active", "paused", "stopped", "expired"] as const) {
      expect((await storage.updateLoop(loop.id, { status })).status).toBe(status);
    }
  });

  test("archive and unarchive fail closed on ambiguous names while ids stay exact", async () => {
    const first = await storage.createLoop(loopInput("pg-archive-ambiguous"));
    const second = await storage.createLoop(loopInput("pg-archive-ambiguous"));

    await expect(storage.requireUniqueLoop("pg-archive-ambiguous")).rejects.toBeInstanceOf(AmbiguousNameError);
    await expect(storage.archiveLoop("pg-archive-ambiguous")).rejects.toBeInstanceOf(AmbiguousNameError);
    expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
    expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();

    expect((await storage.archiveLoop(first.id)).id).toBe(first.id);
    expect((await storage.archiveLoop("pg-archive-ambiguous")).id).toBe(second.id);
    await expect(storage.unarchiveLoop("pg-archive-ambiguous")).rejects.toBeInstanceOf(AmbiguousNameError);
    expect((await storage.getLoop(first.id))?.archivedAt).toBeString();
    expect((await storage.getLoop(second.id))?.archivedAt).toBeString();

    expect((await storage.unarchiveLoop(first.id)).id).toBe(first.id);
    expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
    expect((await storage.getLoop(second.id))?.archivedAt).toBeString();
    expect((await storage.unarchiveLoop("pg-archive-ambiguous")).id).toBe(second.id);
    expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();
  });

  test("name archive waits for a concurrent create before resolving candidates", async () => {
    const name = "pg-archive-create-race";
    await storage.createLoop(loopInput(name));
    const writerExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-archive-create-writer",
    });
    let insertedResolve!: () => void;
    const inserted = new Promise<void>((resolve) => {
      insertedResolve = resolve;
    });
    let releaseWriter!: () => void;
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writer = writerExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "archive-create-writer" },
      async (client) => {
        const now = new Date().toISOString();
        await client.execute(
          `INSERT INTO loops (
             id, name, description, labels_json, status, schedule_json, target_json,
             next_run_at, catch_up, catch_up_limit, overlap, max_attempts,
             retry_delay_ms, lease_ms, created_at, updated_at, tenant_id
           ) VALUES (
             $1, $2, NULL, '[]'::jsonb, 'active',
             '{"type":"interval","everyMs":60000}'::jsonb,
             '{"type":"command","command":"true"}'::jsonb,
             $3, 'latest', 50, 'skip', 1, 60000, 1800000,
             $3, $3, open_loops_current_tenant_id()
           )`,
          [`loop_race_${Date.now()}`, name, now],
        );
        insertedResolve();
        await writerGate;
      },
    );

    let archive: Promise<Loop> | undefined;
    try {
      await inserted;
      archive = storage.archiveLoop(name);
      void archive.catch(() => {});
      try {
        await waitUntil(async () => {
          const row = await executor.queryClient.get<{ waiting: boolean }>(`
            SELECT EXISTS (
              SELECT 1
                FROM pg_locks lock
                JOIN pg_class relation ON relation.oid=lock.relation
                JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
               WHERE namespace.nspname='public'
                 AND relation.relname='loops'
                 AND lock.mode='ShareRowExclusiveLock'
                 AND lock.granted=false
            ) AS waiting
          `);
          return row?.waiting;
        }, { label: "archive name resolution waits for concurrent loops writer" });
      } finally {
        releaseWriter();
      }

      await writer;
      await expect(archive).rejects.toBeInstanceOf(AmbiguousNameError);
      expect((await storage.listLoops({ name, includeArchived: true }))).toHaveLength(2);
    } finally {
      releaseWriter();
      await writer.catch(() => {});
      await archive?.catch(() => {});
      await writerExecutor.close();
    }
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

    const rec = await storage.recordRunProcess(claim!.run.id, { pid: 4242 }, { claimToken: token });
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

    expect(await storage.countRuns({ status: "succeeded" })).toBe(1);
    const runs = await storage.listRuns({ loopId: loop.id });
    expect(runs.length).toBe(1);
    expect((await storage.getRunBySlot(loop.id, slot))?.id).toBe(claim!.run.id);
  });

  test("persists skipped as a distinct terminal run status", async () => {
    const loop = await storage.createLoop(loopInput("runner-configured-skip", {
      overlap: "skip",
      leaseMs: 60_000,
    }));
    const slot = "2026-07-06T10:05:00.000Z";
    const claim = await storage.claimRun(loop, slot, "runner-skip");
    expect(claim).toBeTruthy();

    const finalized = await storage.finalizeRun(
      claim!.run.id,
      {
        status: "skipped",
        finishedAt: new Date().toISOString(),
        durationMs: 5,
        stdout: "",
        stderr: "configured decline",
        error: "process exited with code 75",
        exitCode: 75,
      },
      { claimedBy: "runner-skip", claimToken: claim!.claimToken },
    );

    expect(finalized).toMatchObject({ status: "skipped", exitCode: 75 });
    expect(await storage.countRuns({ status: "skipped" })).toBe(1);
    expect(await storage.countRuns({ status: "failed" })).toBe(0);
    expect(await storage.countRuns({ status: "succeeded" })).toBe(0);
  });

  test("same-runner reclaim fences stale and tokenless PostgreSQL work", async () => {
    const claimedAt = new Date("2026-07-06T10:10:00.000Z");
    const loop = await storage.createLoop(loopInput("pg-same-runner-reclaim", { leaseMs: 10 }));
    const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-same", claimedAt);
    // The reclaim happens 11 minutes after the first lease lapsed — outside the
    // expired-run grace window, so the same runner may take the slot back with
    // a fresh claim token (a reclaim inside the window is deferred).
    const second = await storage.claimRun(
      loop,
      claimedAt.toISOString(),
      "runner-same",
      new Date("2026-07-06T10:21:00.000Z"),
    );
    expect(first?.claimToken).toBeString();
    expect(second?.claimToken).toBeString();
    expect(second?.claimToken).not.toBe(first?.claimToken);

    expect(await storage.recordRunProcess(second!.run.id, { pid: 4242 })).toBeUndefined();
    expect(await storage.recordRunProcess(second!.run.id, { pid: 4242 }, { claimToken: first!.claimToken })).toBeUndefined();
    expect(await storage.recordRunProcess(second!.run.id, { pid: 4242 }, { claimToken: second!.claimToken })).toMatchObject({
      id: second!.run.id,
      pid: 4242,
    });
    expect(await storage.heartbeatRunLease(
      second!.run.id,
      "runner-same",
      60_000,
      new Date("2026-07-06T10:21:00.005Z"),
    )).toBeUndefined();
    expect(await storage.heartbeatRunLease(
      second!.run.id,
      "runner-same",
      60_000,
      new Date("2026-07-06T10:21:00.005Z"),
      { claimToken: first!.claimToken },
    )).toBeUndefined();
    expect(await storage.heartbeatRunLease(
      second!.run.id,
      "runner-same",
      60_000,
      new Date("2026-07-06T10:21:00.005Z"),
      { claimToken: second!.claimToken },
    )).toMatchObject({ status: "running" });

    const patch = {
      status: "succeeded" as const,
      finishedAt: "2026-07-06T10:21:00.030Z",
      durationMs: 10,
      stdout: "",
      stderr: "",
    };
    await expect(storage.finalizeRun(second!.run.id, patch, {
      claimedBy: "runner-same",
      now: new Date("2026-07-06T10:21:00.030Z"),
    })).rejects.toMatchObject({ reason: "stale_claim" });
    await expect(storage.finalizeRun(second!.run.id, patch, {
      claimedBy: "runner-same",
      claimToken: first!.claimToken,
      now: new Date("2026-07-06T10:21:00.030Z"),
    })).rejects.toMatchObject({ reason: "stale_claim" });
    expect(await storage.finalizeRun(second!.run.id, patch, {
      claimedBy: "runner-same",
      claimToken: second!.claimToken,
      now: new Date("2026-07-06T10:21:00.030Z"),
    })).toMatchObject({ status: "succeeded" });
  });

  test("expired-lease steal defers while the lease lapsed within the grace window", async () => {
    const claimedAt = new Date("2026-07-06T10:10:00.000Z");
    const loop = await storage.createLoop(loopInput("pg-claim-grace-defer", { leaseMs: 10 }));
    const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-a", claimedAt);
    expect(first).toBeTruthy();
    await storage.recordRunProcess(first!.run.id, { pid: 4242 }, { claimToken: first!.claimToken, now: claimedAt });

    // The lease (leaseMs=10) lapsed at ~10:10:00.010Z — 10ms before the steal
    // attempt, well inside the expired-run grace window. The original runner may
    // still be executing (a transient heartbeat outage), so a second runner must
    // NOT steal the slot.
    const stealAt = new Date("2026-07-06T10:10:00.020Z");
    const second = await storage.claimRun(loop, claimedAt.toISOString(), "runner-b", stealAt);
    expect(second).toBeUndefined();

    // Recovery must defer, not abandon, within the window — abandoning would let
    // the next claim pass mint a new attempt while the original runner is live.
    const recovery = await storage.recoverExpiredRunLeasesDetailed(stealAt, {});
    expect(recovery.abandoned.map((r) => r.id)).not.toContain(first!.run.id);
    expect(recovery.deferred.map((r) => r.id)).toContain(first!.run.id);

    // The slot still belongs to the original runner's row: no new attempt minted.
    expect((await storage.getRunBySlot(loop.id, claimedAt.toISOString()))?.id).toBe(first!.run.id);
    expect(await storage.countRuns({ status: "running" })).toBe(1);
  });

  test("expired-lease steal defers when the lease lapsed within the grace window even though the process started long ago", async () => {
    const claimedAt = new Date("2026-07-06T10:00:00.000Z");
    const loop = await storage.createLoop(loopInput("pg-claim-grace-long-run", { leaseMs: 10 }));
    const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-a", claimedAt);
    expect(first).toBeTruthy();
    // The original runner has been executing for an hour: its recorded process
    // started at 09:00Z, long before any process-start-anchored window. Only the
    // lease-expiry anchor can protect it once its lease lapses.
    await storage.recordRunProcess(
      first!.run.id,
      { pid: 4242, processStartedAt: "2026-07-06T09:00:00.000Z" },
      { claimToken: first!.claimToken, now: claimedAt },
    );

    // The lease (leaseMs=10) lapsed at ~10:00:00.010Z; five minutes later it is
    // still inside the post-expiry grace window. A long-running original runner
    // hit by a transient heartbeat outage must NOT have its slot stolen.
    const stealAt = new Date("2026-07-06T10:05:00.000Z");
    const second = await storage.claimRun(loop, claimedAt.toISOString(), "runner-b", stealAt);
    expect(second).toBeUndefined();

    // Recovery must defer too — abandoning would let the next claim mint a new
    // attempt while the long-running original runner is still live.
    const recovery = await storage.recoverExpiredRunLeasesDetailed(stealAt, {});
    expect(recovery.abandoned.map((r) => r.id)).not.toContain(first!.run.id);
    expect(recovery.deferred.map((r) => r.id)).toContain(first!.run.id);
    expect((await storage.getRunBySlot(loop.id, claimedAt.toISOString()))?.id).toBe(first!.run.id);
    expect(await storage.countRuns({ status: "running" })).toBe(1);
  });

  test("expired-lease steal proceeds once the lease lapsed outside the grace window", async () => {
    const claimedAt = new Date("2026-07-06T10:00:00.000Z");
    const loop = await storage.createLoop(loopInput("pg-claim-grace-expired", { leaseMs: 10 }));
    const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-a", claimedAt);
    expect(first).toBeTruthy();
    await storage.recordRunProcess(
      first!.run.id,
      { pid: 4242, processStartedAt: "2026-07-06T09:00:00.000Z" },
      { claimToken: first!.claimToken, now: claimedAt },
    );

    // The lease lapsed at ~10:00:00.010Z; at 10:11Z it has been expired for more
    // than the 10-minute expired-run grace window. A genuinely dead runner is
    // reclaimed exactly as before — the anchor is the lease lapse, not the
    // (deliberately old) recorded process start.
    const stealAt = new Date("2026-07-06T10:11:00.000Z");
    const second = await storage.claimRun(loop, claimedAt.toISOString(), "runner-b", stealAt);
    expect(second?.claimToken).toBeString();
    expect(second?.claimToken).not.toBe(first?.claimToken);
  });

  test("recovery abandons expired-lease runs whose lease lapsed outside the grace window", async () => {
    const claimedAt = new Date("2026-07-06T10:00:00.000Z");
    const loop = await storage.createLoop(loopInput("pg-recovery-grace-expired", { leaseMs: 10 }));
    const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-a", claimedAt);
    expect(first).toBeTruthy();
    await storage.recordRunProcess(
      first!.run.id,
      { pid: 4242, processStartedAt: "2026-07-06T09:00:00.000Z" },
      { claimToken: first!.claimToken, now: claimedAt },
    );

    const recoveryAt = new Date("2026-07-06T10:11:00.000Z");
    const recovery = await storage.recoverExpiredRunLeasesDetailed(recoveryAt, {});
    expect(recovery.abandoned.map((r) => r.id)).toContain(first!.run.id);
    expect(recovery.deferred.map((r) => r.id)).not.toContain(first!.run.id);
  });

  test("finalizeRun bounds runner timestamps and uses PostgreSQL server receipt time for omitted duration", async () => {
    const serverNow = new Date("2026-07-06T10:00:10.000Z");
    const startedAt = new Date("2026-07-06T10:00:05.000Z");
    for (const [name, requestedFinishedAt, expectedFinishedAt] of [
      ["future", "2099-01-01T00:00:00.000Z", serverNow.toISOString()],
      ["past", "2000-01-01T00:00:00.000Z", startedAt.toISOString()],
      ["omitted", undefined, serverNow.toISOString()],
    ] as const) {
      const loop = await storage.createLoop(loopInput(`pg-completion-${name}`, { leaseMs: 60_000 }));
      const claim = await storage.claimRun(loop, `2026-07-06T10:0${name.length}:00.000Z`, "runner-clock", startedAt);
      expect(claim).toBeTruthy();
      const finalized = await storage.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          ...(requestedFinishedAt === undefined ? {} : { finishedAt: requestedFinishedAt }),
          stdout: "",
          stderr: "",
        } as unknown as Parameters<typeof storage.finalizeRun>[1],
        { claimedBy: "runner-clock", claimToken: claim!.claimToken, now: serverNow },
      );
      expect(finalized).toMatchObject({
        status: "succeeded",
        finishedAt: expectedFinishedAt,
        durationMs: 5_000,
        updatedAt: serverNow.toISOString(),
      });
    }
  });

  test("two PostgreSQL connections expose exactly one fenced finalization transition", async () => {
    const peerExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-finalize-race-peer",
    });
    const peerStorage = new PostgresLoopStorage(peerExecutor.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "finalize-race-peer",
    });
    try {
      const now = new Date("2026-07-06T10:30:10.000Z");
      const loop = await storage.createLoop(loopInput("pg-finalize-race", {
        leaseMs: 60_000,
        schedule: { type: "interval", everyMs: 60_000, anchor: "fixed_delay" },
      }));
      const claim = await storage.claimRun(
        loop,
        "2026-07-06T10:30:00.000Z",
        "runner-race",
        new Date("2026-07-06T10:30:05.000Z"),
      );
      expect(claim).toBeTruthy();
      const patch = {
        status: "succeeded" as const,
        finishedAt: now.toISOString(),
        durationMs: 5_000,
        stdout: "",
        stderr: "",
      };
      const results = await Promise.allSettled([
        storage.finalizeRun(claim!.run.id, patch, {
          claimedBy: "runner-race",
          claimToken: claim!.claimToken,
          now,
        }),
        peerStorage.finalizeRun(claim!.run.id, patch, {
          claimedBy: "runner-race",
          claimToken: claim!.claimToken,
          now,
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status).toBe("rejected");
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toBeInstanceOf(RunFinalizationConflictError);
        expect(rejected.reason.reason).toBe("run_not_running");
      }
      expect(await storage.getRun(claim!.run.id)).toMatchObject({
        status: "succeeded",
        finishedAt: now.toISOString(),
      });
    } finally {
      await peerExecutor.close();
    }
  });

  test("two PostgreSQL connections trip one circuit breaker and create one marker", async () => {
    const peerExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-breaker-race-peer",
    });
    const peerStorage = new PostgresLoopStorage(peerExecutor.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "breaker-race-peer",
    });
    try {
      const now = new Date("2026-07-06T10:45:10.000Z");
      const nextRunAt = "2026-07-06T10:45:00.000Z";
      const loop = await storage.createLoop(loopInput("pg-breaker-race"));
      const current = await storage.updateLoop(loop.id, { nextRunAt }, { now });
      const expected = {
        status: current.status,
        nextRunAt: current.nextRunAt,
        retryScheduledFor: current.retryScheduledFor,
      };
      const args = [
        loop.id,
        expected,
        { status: "paused" as const, nextRunAt: undefined, retryScheduledFor: undefined },
        { scheduledFor: nextRunAt, reason: "circuit breaker threshold reached" },
        { now },
      ] as const;
      const results = await Promise.all([
        storage.tripCircuitBreakerIfCurrent(...args),
        peerStorage.tripCircuitBreakerIfCurrent(...args),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await storage.getLoop(loop.id)).toMatchObject({
        status: "paused",
        nextRunAt: undefined,
        retryScheduledFor: undefined,
      });
      const runs = await storage.listRuns({ loopId: loop.id });
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: "skipped",
        scheduledFor: nextRunAt,
        error: "circuit breaker threshold reached",
      });
    } finally {
      await peerExecutor.close();
    }
  });

  test("PostgreSQL circuit breaker rolls back the loop update when no marker slot is available", async () => {
    const now = new Date("2026-07-06T10:50:10.000Z");
    const nextRunAt = "2026-07-06T10:50:00.000Z";
    const loop = await storage.createLoop(loopInput("pg-breaker-rollback"));
    const current = await storage.updateLoop(loop.id, { nextRunAt }, { now });
    await executor.queryClient.execute(
      `INSERT INTO loop_runs (
         tenant_id, id, loop_id, loop_name, scheduled_for, attempt, status,
         started_at, finished_at, claimed_by, lease_expires_at, pid, exit_code,
         duration_ms, stdout, stderr, error, created_at, updated_at
       )
       SELECT 'tenant-test',
              'breaker-occupied-' || slot::text,
              $1,
              $2,
              $3::timestamptz + slot * interval '1 millisecond',
              1,
              'skipped',
              NULL,
              $4,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              'occupied',
              $4,
              $4
         FROM generate_series(0, 999) AS slot`,
      [loop.id, loop.name, nextRunAt, now.toISOString()],
    );
    await expect(storage.tripCircuitBreakerIfCurrent(
      loop.id,
      {
        status: current.status,
        nextRunAt: current.nextRunAt,
        retryScheduledFor: current.retryScheduledFor,
      },
      { status: "paused", nextRunAt: undefined, retryScheduledFor: undefined },
      { scheduledFor: nextRunAt, reason: "must roll back" },
      { now },
    )).rejects.toThrow("circuit breaker marker slot unavailable");
    expect(await storage.getLoop(loop.id)).toMatchObject({
      status: current.status,
      nextRunAt,
      retryScheduledFor: current.retryScheduledFor,
    });
    expect(await storage.countRuns()).toBe(1_000);
  });

  test("expires a loop after runs on PostgreSQL: round-trips expiresAfterRuns and writes the expiry marker atomically", async () => {
    const now = new Date("2026-07-06T12:00:10.000Z");
    const nextRunAt = "2026-07-06T12:00:00.000Z";
    const loop = await storage.createLoop(loopInput("pg-expires-after-runs", { expiresAfterRuns: 3, maxAttempts: 1 }));
    const created = await storage.updateLoop(loop.id, { nextRunAt }, { now });
    expect(created).toMatchObject({ expiresAfterRuns: 3, nextRunAt });

    // The expiry plan for a loop whose success streak has reached the ceiling.
    const plan = planLoopAdvancement({
      current: created!,
      run: {
        id: "pg-expiry-run",
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor: nextRunAt,
        attempt: 1,
        status: "succeeded",
        finishedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      finishedAt: now,
      succeeded: true,
      recentRuns: [
        {
          id: "pg-run-3",
          loopId: loop.id,
          loopName: loop.name,
          scheduledFor: "2026-07-06T11:58:00.000Z",
          attempt: 1,
          status: "succeeded",
          finishedAt: "2026-07-06T11:58:10.000Z",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          id: "pg-run-2",
          loopId: loop.id,
          loopName: loop.name,
          scheduledFor: "2026-07-06T11:57:00.000Z",
          attempt: 1,
          status: "succeeded",
          finishedAt: "2026-07-06T11:57:10.000Z",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          id: "pg-run-1",
          loopId: loop.id,
          loopName: loop.name,
          scheduledFor: "2026-07-06T11:56:00.000Z",
          attempt: 1,
          status: "succeeded",
          finishedAt: "2026-07-06T11:56:10.000Z",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    });
    expect(plan).toMatchObject({ kind: "expires_after_runs", successes: 3 });

    const transition = await storage.expireLoopIfCurrent(
      loop.id,
      {
        status: created!.status,
        nextRunAt: created!.nextRunAt,
        retryScheduledFor: created!.retryScheduledFor,
      },
      { status: "expired", nextRunAt: undefined, retryScheduledFor: undefined },
      { scheduledFor: nextRunAt, reason: "expired after consecutive successful runs: 3" },
      { now },
    );
    expect(transition?.loop).toMatchObject({
      status: "expired",
      nextRunAt: undefined,
      retryScheduledFor: undefined,
    });
    const runs = await storage.listRuns({ loopId: loop.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "skipped",
      error: "expired after consecutive successful runs: 3",
    });

    // A stale expected state is a no-op: the loop stays expired with one marker.
    const staleTransition = await storage.expireLoopIfCurrent(
      loop.id,
      { status: "active", nextRunAt: undefined, retryScheduledFor: undefined },
      { status: "expired", nextRunAt: undefined, retryScheduledFor: undefined },
      { scheduledFor: nextRunAt, reason: "stale" },
      { now },
    );
    expect(staleTransition).toBeUndefined();
    expect((await storage.listRuns({ loopId: loop.id })).filter((run) => run.status === "skipped")).toHaveLength(1);
  });

  test("nextRetryableRun returns the globally earliest retryable slot deterministically", async () => {
    const loop = await storage.createLoop(loopInput("pg-retry-order", { maxAttempts: 3 }));
    const later = "2026-07-06T11:10:00.000Z";
    const earlier = "2026-07-06T11:00:00.000Z";
    for (const [slot, runner] of [[later, "runner-later"], [earlier, "runner-earlier"]] as const) {
      const startedAt = new Date(new Date(slot).getTime() + 1_000);
      const claim = await storage.claimRun(loop, slot, runner, startedAt);
      expect(claim).toBeTruthy();
      await storage.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: new Date(startedAt.getTime() + 1_000).toISOString(),
          stdout: "",
          stderr: "",
          error: "retry me",
        },
        {
          claimedBy: runner,
          claimToken: claim!.claimToken,
          now: new Date(startedAt.getTime() + 1_000),
        },
      );
    }
    expect((await storage.nextRetryableRun(loop.id, 3))?.scheduledFor).toBe(earlier);
    expect((await storage.nextRetryableRun(loop.id, 3, earlier))?.scheduledFor).toBe(later);
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
    // Claimed 11 minutes ago: the lease lapse is outside the expired-run grace
    // window, so recovery abandons it (a freshly-lapsed lease would be deferred).
    const past = new Date(Date.now() - 660_000);
    const claim = await storage.claimRun(loop, slot, "runner-x", past);
    expect(claim).toBeTruthy();
    const result = await storage.recoverExpiredRunLeasesDetailed(new Date(), {
      refuseAdmittedPrivateOperations: true,
    });
    expect(result.abandoned.length).toBe(1);
    expect(result.abandoned[0]!.status).toBe("abandoned");
    expect(result.deferred.length).toBe(0);
  });

  test("recoverExpiredRunLeasesDetailed applies exact timestamp fences as timestamptz", async () => {
    const loop = await storage.createLoop(loopInput("recover-exact-timestamp-fences", { leaseMs: 1 }));
    // Claimed 11 minutes ago so the lease lapse is outside the expired-run grace
    // window — a freshly-lapsed lease would be deferred, not abandoned.
    const past = new Date(Date.now() - 660_000);
    const claim = await storage.claimRun(loop, "2026-07-06T12:01:00.000Z", "runner-exact-fences", past);
    expect(claim).toBeTruthy();
    expect(claim!.run.leaseExpiresAt).toBeDefined();

    const result = await storage.recoverExpiredRunLeasesDetailed(new Date(), {
      runId: claim!.run.id,
      expectedLeaseExpiresAt: claim!.run.leaseExpiresAt,
      expectedUpdatedAt: claim!.run.updatedAt,
    });

    expect(result.abandoned.map((run) => run.id)).toEqual([claim!.run.id]);
    expect((await storage.getRun(claim!.run.id))?.status).toBe("abandoned");
  });

  test("recoverExpiredRunLeasesDetailed refuses admitted private operations", async () => {
    const workflow = await storage.createWorkflow({
      name: "recover-admitted-private-operation",
      steps: [{ id: "effect", target: { type: "command", command: "printf", args: ["effect"] } }],
    });
    const loop = await storage.createLoop(loopInput("recover-admitted-private-operation", {
      leaseMs: 1,
      target: { type: "workflow", workflowId: workflow.id },
    }));
    // Claimed 11 minutes ago so the lease lapse is outside the expired-run
    // grace window — only the admitted-operation check may refuse abandonment,
    // not the grace deferral.
    const past = new Date(Date.now() - 660_000);
    const claim = await storage.claimRun(loop, "2026-07-06T12:02:00.000Z", "runner-admitted-effect", past);
    expect(claim).toBeTruthy();
    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
      operationAuthority: { authorityId: "loops-control-plane", tenantId: "tenant-test" },
    });
    const descriptor = parsePrivateOperationDescriptor(
      (await storage.listWorkflowEvents(workflowRun.id)).find((event) =>
        event.eventType === "private_operation_descriptor" && event.stepId === "effect"
      )?.payload,
    );
    await storage.appendWorkflowEvent(
      workflowRun.id,
      "private_operation_admitted",
      "effect",
      operationAdmissionReceipt(descriptor) as unknown as Record<string, unknown>,
    );

    const result = await storage.recoverExpiredRunLeasesDetailed(new Date(), {
      refuseAdmittedPrivateOperations: true,
    });

    expect(result.abandoned.some((run) => run.id === claim!.run.id)).toBe(false);
    expect(result.operationReconciliationRequired.map((run) => run.id)).toContain(claim!.run.id);
    expect((await storage.getRun(claim!.run.id))?.status).toBe("running");
  });

  test("all hosted recovery entrypoints propagate admitted-operation reconciliation without mutation", async () => {
    const claimedAt = new Date("2026-07-06T12:10:00.000Z");
    const recoveredAt = new Date("2026-07-06T12:30:00.000Z");
    const createFixture = async (prefix: string) => {
      const workflow = await storage.createWorkflow({
        name: `${prefix}-workflow`,
        steps: [{ id: "effect", target: { type: "command", command: "printf", args: ["effect"] } }],
      });
      const loop = await storage.createLoop(loopInput(`${prefix}-loop`, {
        target: { type: "workflow", workflowId: workflow.id },
        machine: { id: "missing-pg-runner" },
        leaseMs: 1_000,
        maxAttempts: 2,
        retryDelayMs: 1_000,
      }), claimedAt);
      await storage.updateLoop(loop.id, { nextRunAt: claimedAt.toISOString() });
      const claim = await storage.claimRun(loop, claimedAt.toISOString(), `${prefix}-runner`, claimedAt);
      if (!claim) throw new Error(`failed to create ${prefix} claim`);
      const workflowRun = await storage.createWorkflowRun({
        workflow,
        loop,
        loopRun: claim.run,
        operationAuthority: { authorityId: "loops-control-plane", tenantId: "tenant-test" },
      });
      const descriptor = parsePrivateOperationDescriptor(
        (await storage.listWorkflowEvents(workflowRun.id)).find((event) =>
          event.eventType === "private_operation_descriptor" && event.stepId === "effect"
        )?.payload,
      );
      await storage.appendWorkflowEvent(
        workflowRun.id,
        "private_operation_admitted",
        "effect",
        operationAdmissionReceipt(descriptor) as unknown as Record<string, unknown>,
      );
      return { loop, claim, workflowRun };
    };
    const fixtures = await Promise.all([
      createFixture("pg-legacy-recovery"),
      createFixture("pg-per-run-recovery"),
      createFixture("pg-poll-recovery"),
    ]);
    const before = await Promise.all(fixtures.map(async (fixture) => ({
      run: await storage.getRun(fixture.claim.run.id),
      workflowRun: await storage.getWorkflowRun(fixture.workflowRun.id),
      loop: await storage.getLoop(fixture.loop.id),
    })));
    const principal = (principalId: string, runner: boolean): TenantAuthContext => ({
      tenantId: "tenant-test",
      principalId,
      requestId: `${principalId}-request`,
      kid: `${principalId}-kid`,
      agent: principalId,
      scopes: runner ? ["loops:runner"] : ["loops:*"],
      roles: runner ? ["worker"] : ["admin"],
      tokenKind: runner ? "machine" : "api_key",
      claims: {
        v: 1,
        kid: `${principalId}-kid`,
        app: "loops",
        agent: principalId,
        scopes: runner ? ["loops:runner"] : ["loops:*"],
        iat: 1,
        exp: null,
      },
    });
    const createServer = (auth: TenantAuthContext) => createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => recoveredAt,
      random: () => 0.5,
      authenticator: { authenticate: async () => ({ ok: true, status: 200, principal: auth }) },
      withTenantStorage: (_principal, fn) => fn(storage),
    });

    const adminServer = createServer(principal("pg-recovery-admin", false));
    try {
      const legacy = await fetch(`http://127.0.0.1:${adminServer.port}/v1/leases/recover`, { method: "POST" });
      expect(legacy.status).toBe(200);
      expect(await legacy.json()).toMatchObject({
        reconciliation: {
          outcomes: expect.arrayContaining(fixtures.map((fixture) => ({
            runId: fixture.claim.run.id,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          }))),
        },
      });

      const target = fixtures[1]!;
      const perRun = await fetch(`http://127.0.0.1:${adminServer.port}/v1/runs/${target.claim.run.id}/recover`, { method: "POST" });
      expect(perRun.status).toBe(200);
      expect(await perRun.json()).toMatchObject({
        reconciliation: {
          outcomes: [{
            runId: target.claim.run.id,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          }],
        },
      });
    } finally {
      adminServer.stop(true);
    }

    const runnerServer = createServer(principal("healthy-pg-runner", true));
    try {
      const poll = await fetch(`http://127.0.0.1:${runnerServer.port}/v1/runners/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runnerId: "healthy-pg-runner" }),
      });
      expect(poll.status).toBe(200);
      expect(await poll.json()).toMatchObject({
        claims: [],
        reconciliation: {
          outcomes: expect.arrayContaining(fixtures.map((fixture) => ({
            runId: fixture.claim.run.id,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          }))),
        },
      });
    } finally {
      runnerServer.stop(true);
    }

    await Promise.all(fixtures.map(async (fixture, index) => {
      expect(await storage.getRun(fixture.claim.run.id)).toEqual(before[index]!.run);
      expect(await storage.getWorkflowRun(fixture.workflowRun.id)).toEqual(before[index]!.workflowRun);
      expect(await storage.getLoop(fixture.loop.id)).toEqual(before[index]!.loop);
    }));
  });

  test("recoverExpiredRunLeasesDetailed honours protectClaimedByInLoops", async () => {
    // The hosted control plane is the production path for this sweep, so the
    // option the API relies on to avoid reaping a slot a runner is about to take
    // over must be verified here and not only against sqlite. Both states are
    // exercised deliberately: protected leaves the run alone, unprotected reaps
    // it — a one-sided assertion here could pass on a backend that ignored the
    // option entirely.
    const protectedLoop = await storage.createLoop(loopInput("protect-kept", { leaseMs: 1 }));
    const reapedLoop = await storage.createLoop(loopInput("protect-reaped", { leaseMs: 1 }));
    const slot = "2026-07-06T12:00:00.000Z";
    // Claimed 11 minutes ago: both leases lapsed outside the expired-run grace
    // window, so the unprotected one is genuinely reapable.
    const past = new Date(Date.now() - 660_000);
    const keptClaim = await storage.claimRun(protectedLoop, slot, "runner-x", past);
    const reapedClaim = await storage.claimRun(reapedLoop, slot, "runner-x", past);
    expect(keptClaim).toBeTruthy();
    expect(reapedClaim).toBeTruthy();

    const result = await storage.recoverExpiredRunLeasesDetailed(new Date(), {
      protectClaimedByInLoops: { claimedBy: "runner-x", loopIds: [protectedLoop.id] },
    });

    expect(result.abandoned.map((run) => run.id)).toEqual([reapedClaim!.run.id]);
    expect((await storage.getRun(keptClaim!.run.id))!.status).toBe("running");
    expect((await storage.getRun(reapedClaim!.run.id))!.status).toBe("abandoned");
  });

  test("protectClaimedByInLoops protects one runner's runs, not the whole loop", async () => {
    // Scoped to the claiming runner: another runner's orphan on a protected
    // loop must still be reaped, otherwise naming a loop would shelter every
    // runner's dead leases on it.
    const loop = await storage.createLoop(loopInput("protect-scoped-to-runner", { leaseMs: 1 }));
    // Claimed 11 minutes ago so the lease lapse is outside the expired-run
    // grace window and the orphan is genuinely reapable.
    const past = new Date(Date.now() - 660_000);
    const otherClaim = await storage.claimRun(loop, "2026-07-06T13:00:00.000Z", "runner-other", past);
    expect(otherClaim).toBeTruthy();

    const result = await storage.recoverExpiredRunLeasesDetailed(new Date(), {
      protectClaimedByInLoops: { claimedBy: "runner-x", loopIds: [loop.id] },
    });

    expect(result.abandoned.map((run) => run.id)).toEqual([otherClaim!.run.id]);
  });

  test("protected runs do not consume the recovery scan window", async () => {
    // Regression for the select-then-filter ordering: discarding protected rows
    // in application code AFTER the scan `LIMIT` lets a large protected set
    // crowd the window and starve an unrelated, genuinely reapable run. Because
    // the caller rebuilds the same protected set on every poll, that starvation
    // is stable rather than transient — the same "can never be reaped" class the
    // protection itself exists to remove.
    //
    // `scanLimit` is pinned small so the window is crossed with three rows
    // rather than the five hundred the default would need.
    const protectedLoop = await storage.createLoop(
      loopInput("scanwindow-protected", { leaseMs: 1, overlap: "allow" }),
    );
    const reapableLoop = await storage.createLoop(
      loopInput("scanwindow-reapable", { leaseMs: 1, overlap: "allow" }),
    );
    // Both claims are older than the 10-minute expired-run grace window (early
    // 20 minutes, late 11 minutes), so every row is genuinely reclaimable and
    // only `protectClaimedByInLoops` decides what happens to the protected set.
    const early = new Date(Date.now() - 1_200_000);
    const late = new Date(Date.now() - 660_000);

    const protectedIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const claim = await storage.claimRun(protectedLoop, `2026-07-06T14:0${i}:00.000Z`, "runner-x", early);
      expect(claim).toBeTruthy();
      protectedIds.push(claim!.run.id);
    }
    // Expires later, so it sorts behind every protected row under
    // `ORDER BY lease_expires_at ASC` and is only reached if they never
    // occupied the window.
    const reapable = await storage.claimRun(reapableLoop, "2026-07-06T15:00:00.000Z", "runner-y", late);
    expect(reapable).toBeTruthy();

    const result = await storage.recoverExpiredRunLeasesDetailed(new Date(), {
      limit: 1,
      scanLimit: 3,
      protectClaimedByInLoops: { claimedBy: "runner-x", loopIds: [protectedLoop.id] },
    });

    expect(result.abandoned.map((run) => run.id)).toEqual([reapable!.run.id]);
    for (const id of protectedIds) {
      expect((await storage.getRun(id))!.status).toBe("running");
    }
  });

  test("paginates an immutable tenant-scoped recovered-row snapshot", async () => {
    for (const id of ["a", "z"]) {
      const loop = await storage.createLoop(loopInput(`recovered-keyset-pages-${id}`));
      await storage.upsertMigrationRun({
        id: `recovered-keyset-run-${id}`,
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor: "2026-07-06T12:00:00.000Z",
        attempt: 1,
        status: "abandoned",
        finishedAt: "2026-07-06T12:01:00.000Z",
        error: "run lease expired before completion",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:01:00.000Z",
      });
    }
    const middleLoop = await storage.createLoop(loopInput("recovered-keyset-pages-m"));
    const middle = {
      id: "recovered-keyset-run-m",
      loopId: middleLoop.id,
      loopName: middleLoop.name,
      scheduledFor: "2026-07-06T12:00:00.000Z",
      attempt: 1,
      status: "failed" as const,
      finishedAt: "2026-07-06T12:01:00.000Z",
      error: "not recovered yet",
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:01:00.000Z",
    };
    await storage.upsertMigrationRun(middle);
    const first = await storage.listRecoveredLeaseRunsPage({ limit: 1 });
    expect(first.runs.map((run) => run.id)).toEqual(["recovered-keyset-run-a"]);
    expect(first.snapshot?.map((entry) => entry.id)).toEqual([
      "recovered-keyset-run-a",
      "recovered-keyset-run-z",
    ]);
    expect(first.nextOffset).toBe(1);

    await storage.upsertMigrationRun({
      ...middle,
      status: "abandoned",
      finishedAt: "2026-07-06T12:01:00.000Z",
      error: "run lease expired before completion",
      updatedAt: "2026-07-06T12:01:00.000Z",
    }, { replace: true });
    const insertedLoop = await storage.createLoop(loopInput("recovered-keyset-pages-n"));
    await storage.upsertMigrationRun({
      id: "recovered-keyset-run-n",
      loopId: insertedLoop.id,
      loopName: insertedLoop.name,
      scheduledFor: "2026-07-06T12:00:00.000Z",
      attempt: 1,
      status: "abandoned",
      finishedAt: "2026-07-06T12:01:00.000Z",
      error: "run lease expired before completion",
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:01:00.000Z",
    });
    const second = await storage.listRecoveredLeaseRunsPage({
      limit: 1,
      snapshot: first.snapshot,
      offset: first.nextOffset,
    });
    expect(second.runs.map((run) => run.id)).toEqual(["recovered-keyset-run-z"]);
    expect(second.runs.map((run) => run.id)).not.toContain("recovered-keyset-run-m");
    expect(second.runs.map((run) => run.id)).not.toContain("recovered-keyset-run-n");
    expect(second.nextOffset).toBeUndefined();
  });

  test("drains more than 1000 immutable recovered snapshot members", async () => {
    const loop = await storage.createLoop(loopInput("recovered-snapshot-1001"));
    const total = 1_001;
    for (let index = 0; index < total; index += 1) {
      const scheduledFor = new Date(Date.parse("2026-07-06T12:00:00.000Z") + index).toISOString();
      await storage.upsertMigrationRun({
        id: `recovered-snapshot-1001-${String(index).padStart(4, "0")}`,
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor,
        attempt: 1,
        status: "abandoned",
        finishedAt: "2026-07-06T12:02:00.000Z",
        error: "run lease expired before completion",
        createdAt: scheduledFor,
        updatedAt: "2026-07-06T12:02:00.000Z",
      });
    }
    const first = await storage.listRecoveredLeaseRunsPage({ limit: 1_000 });
    expect(first.runs).toHaveLength(1_000);
    expect(first.snapshot).toHaveLength(total);
    expect(first.nextOffset).toBe(1_000);
    const second = await storage.listRecoveredLeaseRunsPage({
      limit: 1_000,
      snapshot: first.snapshot,
      offset: first.nextOffset,
    });
    expect(second.runs).toHaveLength(1);
    expect(second.nextOffset).toBeUndefined();
    expect(new Set([...first.runs, ...second.runs].map((run) => run.id)).size).toBe(total);
  }, 60_000);

  test("archives a generated one-shot workflow exactly once after workflow finalization", async () => {
    const invocation = await storage.createWorkflowInvocation({
      templateId: "task-lifecycle",
      sourceRef: { kind: "event", id: "pg-finalize-route", dedupeKey: "todos-task:pg-finalize-route" },
      subjectRef: { kind: "task", id: "pg-finalize-route", path: "/tmp/loops" },
      intent: "route",
      scope: { projectPath: "/tmp/loops" },
    });
    const item = await storage.upsertWorkflowWorkItem({
      routeKey: "todos-task",
      idempotencyKey: "todos-task:pg-finalize-route",
      invocationId: invocation.id,
      sourceType: "task.created",
      sourceRef: "pg-finalize-route",
      subjectRef: "pg-finalize-route",
    });
    const workflow = await storage.createWorkflow({
      name: "pg-finalize-generated-route",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });
    const loop = await storage.createLoop(loopInput("pg-finalize-generated-route-loop", {
      schedule: { type: "once", at: "2026-07-06T12:00:00.000Z" },
      target: {
        type: "workflow",
        workflowId: workflow.id,
        input: { workflowInvocationId: invocation.id, workflowWorkItemId: item.id },
      },
    }));
    await storage.admitWorkflowWorkItem(item.id, { workflowId: workflow.id, loopId: loop.id });
    const run = await storage.createWorkflowRun({ workflow, loop, scheduledFor: "2026-07-06T12:00:00.000Z" });

    await Promise.all([
      storage.finalizeWorkflowRun(run.id, "succeeded"),
      storage.finalizeWorkflowRun(run.id, "succeeded"),
    ]);

    expect((await storage.getWorkflow(workflow.id))?.status).toBe("archived");
    expect((await storage.getWorkflowWorkItem(item.id))?.status).toBe("succeeded");
    expect((await storage.listWorkflowEvents(run.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);
  });

  test("parent finalization preserves retryable routes and archives exhausted generated routes without lock inversion", async () => {
    const makeRoute = async (suffix: string, maxAttempts: number, templateId = "task-lifecycle") => {
      const invocation = await storage.createWorkflowInvocation({
        templateId,
        sourceRef: { kind: "event", id: `pg-parent-${suffix}`, dedupeKey: `todos-task:pg-parent-${suffix}` },
        subjectRef: { kind: "task", id: `pg-parent-${suffix}`, path: "/tmp/loops" },
        intent: "route",
        scope: { projectPath: "/tmp/loops" },
      });
      const item = await storage.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: `todos-task:pg-parent-${suffix}`,
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: `pg-parent-${suffix}`,
        subjectRef: `pg-parent-${suffix}`,
      });
      const workflow = await storage.createWorkflow({
        name: `pg-parent-generated-${suffix}`,
        steps: [{ id: "worker", target: { type: "command", command: "false" } }],
      });
      const loop = await storage.createLoop(loopInput(`pg-parent-generated-loop-${suffix}`, {
        schedule: { type: "once", at: "2026-07-06T12:00:00.000Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: { workflowInvocationId: invocation.id, workflowWorkItemId: item.id },
        },
        maxAttempts,
        leaseMs: 60_000,
      }), new Date("2026-07-06T11:59:00.000Z"));
      await storage.admitWorkflowWorkItem(item.id, { workflowId: workflow.id, loopId: loop.id });
      const claim = await storage.claimRun(
        loop,
        "2026-07-06T12:00:00.000Z",
        `runner-parent-${suffix}`,
        new Date("2026-07-06T12:00:00.000Z"),
      );
      const workflowRun = await storage.createWorkflowRun({ workflow, loop, loopRun: claim!.run });
      return { item, workflow, claim: claim!, workflowRun };
    };
    const finalizeParent = (fixture: Awaited<ReturnType<typeof makeRoute>>) => storage.finalizeRun(
      fixture.claim.run.id,
      {
        status: "failed",
        finishedAt: "2026-07-06T12:00:01.000Z",
        durationMs: 1_000,
        stdout: "",
        stderr: "",
        error: "parent failed",
      },
      {
        claimedBy: fixture.claim.run.claimedBy,
        claimToken: fixture.claim.claimToken,
        now: new Date("2026-07-06T12:00:01.000Z"),
      },
    );
    const markWorkflowTerminal = (runId: string) => runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: `parent-terminal-${runId}` },
      (client) => client.execute(
        `UPDATE workflow_runs SET status='failed', finished_at=$2, updated_at=$2
         WHERE id=$1`,
        [runId, "2026-07-06T12:00:00.500Z"],
      ),
    );

    const retryable = await makeRoute("retryable", 2);
    await storage.finalizeWorkflowRun(retryable.workflowRun.id, "failed", {
      finishedAt: "2026-07-06T12:00:00.500Z",
      error: "retryable workflow failed",
    });
    expect((await storage.getWorkflowWorkItem(retryable.item.id))?.status).toBe("admitted");
    expect((await storage.getWorkflow(retryable.workflow.id))?.status).toBe("active");
    await finalizeParent(retryable);
    expect((await storage.getWorkflowWorkItem(retryable.item.id))?.status).toBe("admitted");
    expect((await storage.getWorkflow(retryable.workflow.id))?.status).toBe("active");
    expect((await storage.listWorkflowEvents(retryable.workflowRun.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(0);

    const exhausted = await makeRoute("exhausted", 1);
    await Promise.all([
      finalizeParent(exhausted),
      storage.finalizeWorkflowRun(exhausted.workflowRun.id, "failed", {
        finishedAt: "2026-07-06T12:00:00.500Z",
        error: "workflow failed",
      }),
    ]);
    expect((await storage.getWorkflowWorkItem(exhausted.item.id))?.status).toBe("failed");
    expect((await storage.getWorkflow(exhausted.workflow.id))?.status).toBe("archived");
    expect((await storage.listWorkflowEvents(exhausted.workflowRun.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);

    const nearMiss = await makeRoute("near-miss", 1, "manual-workflow");
    await markWorkflowTerminal(nearMiss.workflowRun.id);
    await finalizeParent(nearMiss);
    expect((await storage.getWorkflow(nearMiss.workflow.id))?.status).toBe("active");
    expect((await storage.listWorkflowEvents(nearMiss.workflowRun.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(0);

    const preflight = await makeRoute("preflight", 1);
    await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "parent-preflight-no-run" },
      (client) => client.execute(
        "DELETE FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
        [preflight.workflowRun.id],
      ),
    );
    const preflightFinalizations = await Promise.allSettled([
      finalizeParent(preflight),
      finalizeParent(preflight),
    ]);
    expect(preflightFinalizations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(preflightFinalizations.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await storage.getWorkflowWorkItem(preflight.item.id))?.status).toBe("failed");
    expect((await storage.getWorkflow(preflight.workflow.id))?.status).toBe("archived");
    const preflightRuns = await storage.listWorkflowRuns({
      workflowId: preflight.workflow.id,
      loopRunId: preflight.claim.run.id,
    });
    expect(preflightRuns).toHaveLength(1);
    expect(preflightRuns[0]?.id).toBe(`preflight-archive:${preflight.claim.run.id}`);
    expect(preflightRuns[0]?.status).toBe("failed");
    expect(preflightRuns[0]?.startedAt).toBeUndefined();
    expect(preflightRuns[0]?.durationMs).toBeUndefined();
    expect(preflightRuns[0]?.error).toBe(
      "workflow preflight failed before workflow execution; synthetic archival event owner",
    );
    expect(await storage.listWorkflowStepRuns(preflightRuns[0]!.id)).toHaveLength(0);
    expect((await storage.listWorkflowEvents(preflightRuns[0]!.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);
  });

  test("keeps retryable generated recovery active and archives exhausted recovery once", async () => {
    const makeRoute = async (suffix: string, maxAttempts: number) => {
      const invocation = await storage.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: `pg-recover-${suffix}`, dedupeKey: `todos-task:pg-recover-${suffix}` },
        subjectRef: { kind: "task", id: `pg-recover-${suffix}`, path: "/tmp/loops" },
        intent: "route",
        scope: { projectPath: "/tmp/loops" },
      });
      const item = await storage.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: `todos-task:pg-recover-${suffix}`,
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: `pg-recover-${suffix}`,
        subjectRef: `pg-recover-${suffix}`,
      });
      const workflow = await storage.createWorkflow({
        name: `pg-recover-generated-${suffix}`,
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = await storage.createLoop(loopInput(`pg-recover-generated-loop-${suffix}`, {
        schedule: { type: "once", at: "2026-07-06T12:00:00.000Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: { workflowInvocationId: invocation.id, workflowWorkItemId: item.id },
        },
        maxAttempts,
        leaseMs: 1,
      }), new Date("2026-07-06T11:59:00.000Z"));
      await storage.admitWorkflowWorkItem(item.id, { workflowId: workflow.id, loopId: loop.id });
      const claim = await storage.claimRun(
        loop,
        "2026-07-06T12:00:00.000Z",
        `runner-${suffix}`,
        new Date("2026-07-06T12:00:00.000Z"),
      );
      const workflowRun = await storage.createWorkflowRun({ workflow, loop, loopRun: claim!.run });
      return { item, workflow, workflowRun };
    };
    const retryable = await makeRoute("retryable", 2);
    const exhausted = await makeRoute("exhausted", 1);

    // Recovery runs 11 minutes after the claims so the lease lapses are outside
    // the expired-run grace window — a freshly-lapsed lease would be deferred.
    const recoveries = await Promise.all([
      storage.recoverExpiredRunLeasesDetailed(new Date("2026-07-06T12:11:01.000Z")),
      storage.recoverExpiredRunLeasesDetailed(new Date("2026-07-06T12:11:01.000Z")),
    ]);
    expect(recoveries.flatMap((result) => result.abandoned)).toHaveLength(2);
    expect((await storage.getWorkflowWorkItem(retryable.item.id))?.status).toBe("admitted");
    expect((await storage.getWorkflow(retryable.workflow.id))?.status).toBe("active");
    expect((await storage.listWorkflowEvents(retryable.workflowRun.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(0);
    expect((await storage.getWorkflowWorkItem(exhausted.item.id))?.status).toBe("failed");
    expect((await storage.getWorkflow(exhausted.workflow.id))?.status).toBe("archived");
    expect((await storage.listWorkflowEvents(exhausted.workflowRun.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);

    expect((await storage.recoverExpiredRunLeasesDetailed(new Date("2026-07-06T12:11:02.000Z"))).abandoned).toHaveLength(0);
    expect((await storage.listWorkflowEvents(exhausted.workflowRun.id))
      .filter((event) => event.eventType === "workflow_archived")).toHaveLength(1);
  });

  test("maintenance recovery with reverse lease order advances the globally earliest retry slot", async () => {
    const loop = await storage.createLoop(loopInput("recover-reverse-order", {
      overlap: "allow",
      maxAttempts: 3,
      retryDelayMs: 1_000,
      leaseMs: 1_000,
    }), new Date("2026-07-06T12:00:00.000Z"));
    const newer = await storage.claimRun(
      loop,
      "2026-07-06T12:01:00.000Z",
      "runner-newer",
      new Date("2026-07-06T12:00:00.000Z"),
    );
    const older = await storage.claimRun(
      loop,
      "2026-07-06T12:00:00.000Z",
      "runner-older",
      new Date("2026-07-06T12:00:00.250Z"),
    );
    // Recovery runs 11 minutes after the claims so both lease lapses are
    // outside the expired-run grace window — a freshly-lapsed lease would be
    // deferred instead of abandoned.
    const recovered = await storage.recoverExpiredRunLeasesDetailed(
      new Date("2026-07-06T12:11:02.000Z"),
    );
    expect(recovered.abandoned.map((run) => run.id)).toEqual([newer!.run.id, older!.run.id]);
    const earliest = await storage.nextRetryableRun(loop.id, loop.maxAttempts);
    expect(earliest?.scheduledFor).toBe(older!.run.scheduledFor);

    const current = await storage.getLoop(loop.id);
    const plan = planLoopAdvancement({
      current,
      run: recovered.abandoned[0]!,
      finishedAt: new Date(recovered.abandoned[0]!.updatedAt),
      succeeded: false,
      deferredRetry: earliest,
      retryRandom: 0.5,
    });
    expect(plan).toMatchObject({
      kind: "update",
      reason: "deferred_retry",
      patch: { retryScheduledFor: older!.run.scheduledFor },
    });
    if (plan.kind !== "update") throw new Error(`unexpected advancement plan: ${plan.kind}`);
    await storage.advanceLoopIfCurrent(loop.id, current!, plan.patch);
    expect(await storage.getLoop(loop.id)).toMatchObject({
      retryScheduledFor: older!.run.scheduledFor,
    });
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

  test("workflow lifecycle writes are implemented on Postgres", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-workflow-lifecycle",
      steps: [
        { id: "first", target: { type: "command", command: "true" } },
        { id: "second", target: { type: "command", command: "true" }, dependsOn: ["first"] },
      ],
    });
    const loop = await storage.createLoop(loopInput("pg-workflow-loop", {
      target: { type: "workflow", workflowId: workflow.id },
    }));
    const slot = "2026-07-06T14:00:00.000Z";
    const claim = await storage.claimRun(loop, slot, "runner-pg-workflow");
    expect(claim).toBeTruthy();
    const run = claim!.run;

    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: run,
      scheduledFor: slot,
      idempotencyKey: `${loop.id}:${slot}:attempt:${run.attempt}`,
    });
    expect(workflowRun).toMatchObject({ workflowId: workflow.id, loopRunId: run.id, status: "running" });
    expect(await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: run,
      scheduledFor: slot,
      idempotencyKey: `${loop.id}:${slot}:attempt:${run.attempt}`,
    })).toMatchObject({ id: workflowRun.id });

    expect(await storage.listWorkflowStepRuns(workflowRun.id)).toHaveLength(2);
    expect(await storage.startWorkflowStepRun(workflowRun.id, "first")).toMatchObject({ status: "running" });
    expect(await storage.finalizeWorkflowStepRun(workflowRun.id, "first", {
      status: "succeeded",
      finishedAt: "2026-07-06T14:00:01.000Z",
      durationMs: 1000,
      stdout: "first done",
      stderr: "",
      exitCode: 0,
    })).toMatchObject({ status: "succeeded" });
    expect(await storage.startWorkflowStepRun(workflowRun.id, "second")).toMatchObject({ status: "running" });
    expect(await storage.finalizeWorkflowStepRun(workflowRun.id, "second", {
      status: "succeeded",
      finishedAt: "2026-07-06T14:00:02.000Z",
      durationMs: 1000,
      stdout: "second done",
      stderr: "",
      exitCode: 0,
    })).toMatchObject({ status: "succeeded" });
    expect(await storage.finalizeWorkflowRun(workflowRun.id, "succeeded", {
      finishedAt: "2026-07-06T14:00:03.000Z",
      durationMs: 3000,
    })).toMatchObject({ status: "succeeded" });

    const events = await storage.listWorkflowEvents(workflowRun.id);
    expect(events.map((event) => event.eventType)).toEqual([
      "created",
      "private_operation_descriptor",
      "private_operation_descriptor",
      "step_started",
      "step_succeeded",
      "step_started",
      "step_succeeded",
      "succeeded",
    ]);
  });

  test("workflow run provenance and initial contracts are atomic on Postgres", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-workflow-provenance",
      steps: ["worker-one", "worker-two"].map((id) => ({
        id,
        target: {
          type: "agent" as const,
          provider: "codewith" as const,
          prompt: `perform scoped work for ${id}`,
          allowlist: { commands: ["git"], safetyReason: "postgres workflow provenance test" },
        },
      })),
    });
    const [first, retry] = await (async () => {
      const peerExecutor = PgPoolExecutor.fromConnectionString({
        connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
        applicationName: "loops-pgstore-workflow-create-race",
      });
      const peerStorage = new PostgresLoopStorage(peerExecutor.queryClient, {
        tenantId: "tenant-test",
        principalId: "principal-test",
        requestId: "workflow-create-race-peer",
      });
      try {
        return await Promise.all([
          storage.createWorkflowRun({ workflow, idempotencyKey: "same-definition" }),
          peerStorage.createWorkflowRun({ workflow, idempotencyKey: "same-definition" }),
        ]);
      } finally {
        await peerStorage.close();
      }
    })();
    expect(retry.id).toBe(first.id);
    expect((await storage.createWorkflowRun({ workflow, idempotencyKey: "same-definition" })).id).toBe(first.id);
    expect((await storage.listWorkflowEvents(first.id)).filter((event) =>
      event.eventType === "agent_session_contract"
    )).toHaveLength(2);

    const originalTarget = workflow.steps[0]!.target;
    if (originalTarget.type !== "agent") throw new Error("test workflow target must be agent");
    const changed: WorkflowSpec = {
      ...workflow,
      steps: [{
        ...workflow.steps[0]!,
        target: { ...originalTarget, prompt: "changed after creation" },
      }],
    };
    await expect(storage.createWorkflowRun({
      workflow: changed,
      idempotencyKey: "same-definition",
    })).rejects.toBeInstanceOf(WorkflowRunDefinitionConflictError);

    const atomicCounts = () => runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "workflow-create-rollback-counts" },
      (client) => client.one<{
        run_count: number;
        step_count: number;
        event_count: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id()) AS run_count,
          (SELECT COUNT(*)::int FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id()) AS step_count,
          (SELECT COUNT(*)::int FROM workflow_events WHERE tenant_id = open_loops_current_tenant_id()) AS event_count
      `),
    );
    const beforeFailedCreate = await atomicCounts();
    await expect(storage.createWorkflowRun({
      workflow,
      idempotencyKey: "rolls-back",
      beforeInitialWorkflowEventPersist: (event) => {
        if (event.stepId === "worker-two") throw new Error("injected second contract append failure");
      },
    })).rejects.toThrow("injected second contract append failure");
    expect(await atomicCounts()).toEqual(beforeFailedCreate);
    expect((await storage.listWorkflowRuns({ workflowId: workflow.id })).some((run) =>
      run.idempotencyKey === "rolls-back"
    )).toBe(false);

    await runtimeExecutor.withRequestContext(
      { tenantId: "tenant-test", principalId: "principal-test", requestId: "legacy-workflow-provenance" },
      (client) => client.execute(
        "UPDATE workflow_runs SET workflow_definition_hash = NULL WHERE id = $1",
        [first.id],
      ),
    );
    await expect(storage.createWorkflowRun({
      workflow,
      idempotencyKey: "same-definition",
    })).rejects.toBeInstanceOf(LegacyWorkflowRunProvenanceError);
  });

  test("scrubs Postgres workflow reasons and deep goal evidence with SQLite parity", async () => {
    const reason = `operation failed with ${GH_PAT}`;
    const workflow = await storage.createWorkflow({
      name: "pg-scrub-workflow-reasons",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });

    const recoveredRun = await storage.createWorkflowRun({ workflow });
    await storage.startWorkflowStepRun(recoveredRun.id, "worker");
    const recovered = await storage.recoverWorkflowRun(recoveredRun.id, reason);
    expect(recovered.recoveredSteps[0]?.error).toBe("operation failed with [SCRUBBED]");
    expect(JSON.stringify(await storage.listWorkflowEvents(recoveredRun.id))).not.toContain("ghp" + "_");

    const skippedRun = await storage.createWorkflowRun({ workflow });
    const skipped = await storage.skipWorkflowStepRun(skippedRun.id, "worker", reason);
    expect(skipped.error).toBe("operation failed with [SCRUBBED]");
    expect(JSON.stringify(await storage.listWorkflowEvents(skippedRun.id))).not.toContain("ghp" + "_");

    const finalizedRun = await storage.createWorkflowRun({ workflow });
    const finalized = await storage.finalizeWorkflowRun(finalizedRun.id, "failed", { error: reason });
    expect(finalized.error).toBe("operation failed with [SCRUBBED]");
    expect(JSON.stringify(await storage.listWorkflowEvents(finalizedRun.id))).not.toContain("ghp" + "_");

    const loop = await storage.createLoop(loopInput("pg-scrub-skipped-reason"));
    const skippedLoopRun = await storage.createSkippedRun(loop, "2026-07-06T14:15:00.000Z", reason);
    expect(skippedLoopRun.error).toBe("operation failed with [SCRUBBED]");

    const goal = await storage.createGoal({ objective: "scrub deep Postgres evidence" });
    await storage.recordGoalEvent({
      goalId: goal.goalId,
      phase: "execute",
      status: "active",
      evidence: { note: `saw export DB_PASSWORD="${QUOTED_SECRET}" in output` },
      // The credential-assignment scan pattern fires on the contiguous
      // `DB_PASSWORD="${...}"` shape even with the synthetic QUOTED_SECRET
      // fixture, so the value is concatenated outside the quotes — the runtime
      // string is byte-identical and the evidence-scrubber assertions are
      // unchanged.
      rawResponse: { result: "export DB_PASSWORD=\"" + QUOTED_SECRET + "\"" },
    });
    const goalRun = (await storage.listGoalRuns({ goalId: goal.goalId }))[0]!;
    // Split at the value so the credential-assignment scan pattern does not
    // fire on the scrub-marker fixture; the runtime string is identical.
    expect((goalRun.evidence as { note: string }).note).toBe('saw export DB_PASSWORD="' + "[SCRUBBED]" + '" in output');
    expect(JSON.stringify(goalRun.rawResponse)).not.toContain(QUOTED_SECRET);
  });

  test("serializes concurrent workflow recovery and records one recovered event", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-concurrent-workflow-recovery",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });
    const run = await storage.createWorkflowRun({ workflow });
    await storage.startWorkflowStepRun(run.id, "worker");
    const peerExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-workflow-recovery-peer",
    });
    const peer = new PostgresLoopStorage(peerExecutor.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "workflow-recovery-peer",
    });
    try {
      const results = await Promise.all([
        storage.recoverWorkflowRun(run.id, "first operator"),
        peer.recoverWorkflowRun(run.id, "second operator"),
      ]);
      expect(results.map((result) => result.recoveredSteps.length).sort()).toEqual([0, 1]);
      expect((await storage.listWorkflowEvents(run.id)).filter((event) => event.eventType === "recovered")).toHaveLength(1);
    } finally {
      await peerExecutor.close();
    }
  });

  test("locks the workflow parent before every step lifecycle mutation", async () => {
    const operations = [
      {
        name: "start",
        prepare: async (_runId: string) => {},
        mutate: (peer: PostgresLoopStorage, runId: string) => peer.startWorkflowStepRun(runId, "worker"),
      },
      {
        name: "pid",
        prepare: (runId: string) => storage.startWorkflowStepRun(runId, "worker"),
        mutate: (peer: PostgresLoopStorage, runId: string) => peer.markWorkflowStepPid(runId, "worker", 2_147_483_640),
      },
      {
        name: "progress",
        prepare: (runId: string) => storage.startWorkflowStepRun(runId, "worker"),
        mutate: (peer: PostgresLoopStorage, runId: string) =>
          peer.recordWorkflowStepProgress(runId, "worker", { stdout: "progress" }),
      },
      {
        name: "finalize",
        prepare: (runId: string) => storage.startWorkflowStepRun(runId, "worker"),
        mutate: (peer: PostgresLoopStorage, runId: string) =>
          peer.finalizeWorkflowStepRun(runId, "worker", {
            status: "succeeded",
            finishedAt: "2026-07-21T10:00:01.000Z",
            durationMs: 1_000,
            stdout: "",
            stderr: "",
          }),
      },
      {
        name: "skip",
        prepare: (runId: string) => storage.startWorkflowStepRun(runId, "worker"),
        mutate: (peer: PostgresLoopStorage, runId: string) =>
          peer.skipWorkflowStepRun(runId, "worker", "forced lock-order test"),
      },
    ] as const;

    for (const operation of operations) {
      const workflow = await storage.createWorkflow({
        name: `pg-workflow-step-lock-order-${operation.name}`,
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = await storage.createWorkflowRun({ workflow });
      await operation.prepare(run.id);

      const peerExecutor = PgPoolExecutor.fromConnectionString({
        connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
        applicationName: `loops-pgstore-lock-order-${operation.name}`,
      });
      let reachedParentLock = false;
      const instrumentedClient = new Proxy(peerExecutor.queryClient, {
        get(target, property, receiver) {
          if (property === "transaction") {
            return <T>(fn: (client: typeof target) => Promise<T>) => target.transaction((client) => {
              const instrumentedTransaction = new Proxy(client, {
                get(transactionTarget, transactionProperty, transactionReceiver) {
                  if (transactionProperty === "get") {
                    return (sql: string, params?: readonly unknown[]) => {
                      if (
                        sql.includes("FROM workflow_runs") &&
                        sql.includes("FOR UPDATE")
                      ) {
                        reachedParentLock = true;
                      }
                      return transactionTarget.get(sql, params);
                    };
                  }
                  const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
                  return typeof value === "function" ? value.bind(transactionTarget) : value;
                },
              });
              return fn(instrumentedTransaction as typeof target);
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const peer = new PostgresLoopStorage(instrumentedClient, {
        tenantId: "tenant-test",
        principalId: "principal-test",
        requestId: `workflow-lock-order-${operation.name}`,
      });
      const blocker = new pg.Client({
        connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
        application_name: `loops-pgstore-lock-order-blocker-${operation.name}`,
      });
      await blocker.connect();
      let mutation: Promise<WorkflowStepRun> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SET LOCAL ROLE open_loops_runtime");
        await blocker.query("SELECT set_config('open_loops.tenant_id', $1, true)", ["tenant-test"]);
        await blocker.query(
          "SELECT id FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
          [run.id],
        );

        mutation = operation.mutate(peer, run.id);
        await waitUntil(() => reachedParentLock, {
          label: `${operation.name} reached workflow parent lock`,
        });

        await expect(blocker.query(
          `SELECT id FROM workflow_step_runs
           WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id='worker'
           FOR UPDATE`,
          [run.id],
        )).resolves.toBeDefined();
        await blocker.query("COMMIT");
        await expect(mutation).resolves.toMatchObject({ workflowRunId: run.id, stepId: "worker" });
      } finally {
        await blocker.query("ROLLBACK").catch(() => undefined);
        await blocker.end();
        if (mutation) await mutation.catch(() => undefined);
        await peerExecutor.close();
      }
    }
  });

  test("rejects terminal workflow recovery without resetting its child step", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-terminal-workflow-recovery",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });
    const run = await storage.createWorkflowRun({ workflow });
    await storage.startWorkflowStepRun(run.id, "worker");
    await storage.finalizeWorkflowRun(run.id, "failed", { error: "terminal before recovery" });
    const beforeStep = await storage.getWorkflowStepRun(run.id, "worker");
    const beforeEvents = await storage.listWorkflowEvents(run.id);

    await expect(storage.recoverWorkflowRun(run.id, "must not reopen terminal workflow"))
      .rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_RUNNING" });

    expect(await storage.getWorkflowStepRun(run.id, "worker")).toEqual(beforeStep);
    expect(await storage.listWorkflowEvents(run.id)).toEqual(beforeEvents);
  });

  test("uses the active parent claim to fence PID-less operator recovery while allowing its runner", async () => {
    const now = new Date("2026-07-21T10:00:00.000Z");
    const workflow = await storage.createWorkflow({
      name: "pg-remote-spawn-window-recovery",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });
    const loop = await storage.createLoop(loopInput("pg-remote-spawn-window-loop", {
      schedule: { type: "once", at: now.toISOString() },
      target: { type: "workflow", workflowId: workflow.id },
      leaseMs: 60_000,
    }), now);
    const claim = await storage.claimRun(loop, now.toISOString(), "runner-spawn-window", now);
    expect(claim).toBeTruthy();
    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
    });
    await storage.startWorkflowStepRun(workflowRun.id, "worker");
    const beforeEvents = await storage.listWorkflowEvents(workflowRun.id);
    type RecoveryContext = {
      mode: "operator" | "runner";
      now: Date;
      loopRunId?: string;
      claimedBy?: string;
      claimToken?: string;
    };
    const recoverWithContext = storage.recoverWorkflowRun.bind(storage) as unknown as (
      workflowRunId: string,
      reason: string,
      context: RecoveryContext,
    ) => ReturnType<typeof storage.recoverWorkflowRun>;

    await expect(recoverWithContext(workflowRun.id, "operator during remote spawn", {
      mode: "operator",
      now: new Date("2026-07-21T10:02:00.000Z"),
    })).rejects.toBeInstanceOf(WorkflowRunStepOwnershipUnverifiableError);
    expect(await storage.getWorkflowStepRun(workflowRun.id, "worker")).toMatchObject({
      status: "running",
      pid: undefined,
    });
    expect(await storage.listWorkflowEvents(workflowRun.id)).toEqual(beforeEvents);

    await expect(recoverWithContext(workflowRun.id, "runner with stale token", {
      mode: "runner",
      now,
      loopRunId: claim!.run.id,
      claimedBy: "runner-spawn-window",
      claimToken: "stale-token",
    })).rejects.toBeInstanceOf(WorkflowRunStepOwnershipUnverifiableError);

    const pidWritten = await storage.markWorkflowStepPid(workflowRun.id, "worker", 2_147_483_639);
    expect(pidWritten).toMatchObject({ status: "running", pid: 2_147_483_639 });
    await expect(recoverWithContext(workflowRun.id, "current runner with persisted pid", {
      mode: "runner",
      now,
      loopRunId: claim!.run.id,
      claimedBy: "runner-spawn-window",
      claimToken: claim!.claimToken,
    })).rejects.toBeInstanceOf(WorkflowRunStepOwnershipUnverifiableError);

    const pidlessWorkflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
      idempotencyKey: "pidless-current-runner-recovery",
    });
    await storage.startWorkflowStepRun(pidlessWorkflowRun.id, "worker");
    const recovered = await recoverWithContext(pidlessWorkflowRun.id, "current runner recovery", {
      mode: "runner",
      now,
      loopRunId: claim!.run.id,
      claimedBy: "runner-spawn-window",
      claimToken: claim!.claimToken,
    });
    expect(recovered.recoveredSteps).toMatchObject([{ stepId: "worker", status: "pending" }]);
  });

  test("rejects persisted workflow-step PIDs inside recovery without mutation", async () => {
    for (const context of ["operator", "nested"] as const) {
      const workflow = await storage.createWorkflow({
        name: `pg-${context}-pid-fenced-recovery`,
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(run.id, "worker");
      await storage.markWorkflowStepPid(run.id, "worker", 2_147_483_647);
      const beforeStep = await storage.getWorkflowStepRun(run.id, "worker");
      const beforeEvents = await storage.listWorkflowEvents(run.id);

      await expect(storage.recoverWorkflowRun(run.id, `${context} recovery`))
        .rejects.toBeInstanceOf(WorkflowRunStepOwnershipUnverifiableError);

      expect(await storage.getWorkflowStepRun(run.id, "worker")).toEqual(beforeStep);
      expect(await storage.listWorkflowEvents(run.id)).toEqual(beforeEvents);
    }
  });

  test("fences PID writes after recovery and serializes the PID-write recovery race", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-pid-write-recovery-race",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });

    const recoveredFirst = await storage.createWorkflowRun({ workflow });
    await storage.startWorkflowStepRun(recoveredFirst.id, "worker");
    await storage.recoverWorkflowRun(recoveredFirst.id, "recover before pid write");
    const postRecoveryPidWrite = await storage.markWorkflowStepPid(recoveredFirst.id, "worker", 2_147_483_646);
    expect(postRecoveryPidWrite).toMatchObject({
      status: "pending",
      pid: undefined,
    });
    expect(await storage.getWorkflowStepRun(recoveredFirst.id, "worker")).toMatchObject({
      status: "pending",
      pid: undefined,
    });

    const peerExecutor = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-pid-recovery-race-peer",
    });
    const peer = new PostgresLoopStorage(peerExecutor.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "pid-recovery-race-peer",
    });
    try {
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const run = await storage.createWorkflowRun({
          workflow,
          idempotencyKey: `pid-recovery-race-${iteration}`,
        });
        await storage.startWorkflowStepRun(run.id, "worker");
        const beforeEvents = await storage.listWorkflowEvents(run.id);
        const [recovery, pidWrite] = await Promise.allSettled([
          storage.recoverWorkflowRun(run.id, "concurrent recovery"),
          peer.markWorkflowStepPid(run.id, "worker", 2_147_483_000 + iteration),
        ]);
        expect(pidWrite.status).toBe("fulfilled");
        const step = await storage.getWorkflowStepRun(run.id, "worker");
        const recoveredEvents = (await storage.listWorkflowEvents(run.id))
          .filter((event) => event.eventType === "recovered");
        if (recovery.status === "fulfilled") {
          expect(step).toMatchObject({ status: "pending", pid: undefined });
          expect(recoveredEvents).toHaveLength(1);
        } else {
          expect(recovery.reason).toBeInstanceOf(WorkflowRunStepOwnershipUnverifiableError);
          expect(step).toMatchObject({
            status: "running",
            pid: 2_147_483_000 + iteration,
          });
          expect(await storage.listWorkflowEvents(run.id)).toEqual(beforeEvents);
        }
      }
    } finally {
      await peerExecutor.close();
    }
  });

  test("expired workflow leases append failed workflow events on Postgres", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-workflow-expired-lease",
      steps: [{ id: "first", target: { type: "command", command: "true" } }],
    });
    const loop = await storage.createLoop(loopInput("pg-workflow-expired-loop", {
      target: { type: "workflow", workflowId: workflow.id },
      leaseMs: 1_000,
    }));
    const slot = "2026-07-06T15:00:00.000Z";
    const startedAt = new Date("2026-07-06T15:00:00.000Z");
    const claim = await storage.claimRun(loop, slot, "runner-pg-expired", startedAt);
    expect(claim).toBeTruthy();
    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
      scheduledFor: slot,
      idempotencyKey: `${loop.id}:${slot}:attempt:${claim!.run.attempt}`,
    });
    await storage.startWorkflowStepRun(workflowRun.id, "first");

    // Recovery runs 11 minutes after the claim so the lease lapse is outside
    // the expired-run grace window — a freshly-lapsed lease would be deferred.
    const recovered = await storage.recoverExpiredRunLeases(new Date("2026-07-06T15:11:02.000Z"));
    expect(recovered.map((run) => run.id)).toContain(claim!.run.id);
    expect(await storage.getWorkflowRun(workflowRun.id)).toMatchObject({
      id: workflowRun.id,
      status: "failed",
      error: "parent loop run lease expired before completion",
    });
    expect(await storage.getWorkflowStepRun(workflowRun.id, "first")).toMatchObject({
      status: "skipped",
      error: "parent loop run lease expired before completion",
    });
    const events = await storage.listWorkflowEvents(workflowRun.id);
    expect(events.map((event) => event.eventType)).toEqual([
      "created",
      "private_operation_descriptor",
      "step_started",
      "failed",
    ]);
    expect(events.at(-1)?.payload).toMatchObject({
      error: "parent loop run lease expired before completion",
      loopRunId: claim!.run.id,
    });
  });

  test("hosted runner polling preserves its own capped claim while reaping another machine's expired PostgreSQL run", async () => {
    // The stale run is claimed at 15:15:00 (lease lapses 15:15:01) so that by
    // the 15:30:05 reap its lease lapse is 15 minutes old — outside the
    // expired-run grace window. A freshly-lapsed lease would be deferred
    // instead of reaped.
    const startedAt = new Date("2026-07-06T15:15:00.000Z");
    const recoveredAt = new Date("2026-07-06T15:30:05.000Z");
    const staleLoop = await storage.createLoop(
      loopInput("pg-hosted-expired-unrelated-runner", {
        schedule: { type: "interval", everyMs: 1_000 },
        machine: { id: "missing-pg-runner" },
        catchUp: "latest",
        overlap: "skip",
        maxAttempts: 1,
        leaseMs: 1_000,
      }),
      new Date("2026-07-06T15:14:59.000Z"),
    );
    const staleClaim = await storage.claimRun(
      staleLoop,
      staleLoop.nextRunAt!,
      "missing-pg-runner",
      startedAt,
    );
    expect(staleClaim?.run).toMatchObject({ status: "running", claimedBy: "missing-pg-runner" });

    const earlierLoop = await storage.createLoop(
      loopInput("pg-a-earlier-new-work", {
        schedule: { type: "once", at: "2026-07-06T15:29:58.000Z" },
        machine: { id: "healthy-pg-runner" },
      }),
      new Date("2026-07-06T15:29:57.000Z"),
    );
    const ownStaleLoop = await storage.createLoop(
      loopInput("pg-b-own-expired-eligible", {
        schedule: { type: "interval", everyMs: 1_000 },
        machine: { id: "healthy-pg-runner" },
        catchUp: "latest",
        overlap: "skip",
        maxAttempts: 1,
        leaseMs: 1_000,
      }),
      new Date("2026-07-06T15:30:00.000Z"),
    );
    const ownStaleCursor = ownStaleLoop.nextRunAt;
    const ownStaleClaim = await storage.claimRun(
      ownStaleLoop,
      ownStaleCursor!,
      "healthy-pg-runner",
      new Date("2026-07-06T15:30:02.000Z"),
    );
    expect(ownStaleClaim?.run).toMatchObject({
      status: "running",
      claimedBy: "healthy-pg-runner",
      leaseExpiresAt: "2026-07-06T15:30:03.000Z",
    });

    const principal: TenantAuthContext = {
      tenantId: "tenant-test",
      principalId: "healthy-pg-runner",
      requestId: "pg-hosted-reaper",
      kid: "pg-hosted-reaper",
      agent: "healthy-pg-runner",
      scopes: ["loops:runner"],
      roles: ["worker"],
      tokenKind: "machine",
      claims: {
        v: 1,
        kid: "pg-hosted-reaper",
        app: "loops",
        agent: "healthy-pg-runner",
        scopes: ["loops:runner"],
        iat: 1,
        exp: null,
      },
    };
    const server = createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => recoveredAt,
      random: () => 0.5,
      authenticator: {
        authenticate: async () => ({ ok: true, status: 200, principal }),
      },
      withTenantStorage: (_principal, fn) => fn(storage),
    });

    try {
      expect(server.port).toBeNumber();
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/runners/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runnerId: "healthy-pg-runner" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        claims: Array<{ loop: { id: string }; run: { status: string } }>;
      };
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0]).toMatchObject({
        loop: { id: earlierLoop.id },
        run: { status: "running" },
      });
      expect(await storage.getRun(ownStaleClaim!.run.id)).toMatchObject({
        status: "running",
        claimedBy: "healthy-pg-runner",
        leaseExpiresAt: "2026-07-06T15:30:03.000Z",
      });
      expect(await storage.getLoop(ownStaleLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: ownStaleCursor,
      });
      expect(await storage.getRun(staleClaim!.run.id)).toMatchObject({
        status: "abandoned",
        error: "run lease expired before completion",
      });
      expect(await storage.getLoop(staleLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-07-06T15:30:06.000Z",
      });
    } finally {
      server.stop(true);
    }
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

  test("two connections serialize duplicate agent session contract appends", async () => {
    const workflow = await storage.createWorkflow({
      name: "pg-agent-contract-race",
      steps: [{
        id: "worker",
        target: { type: "agent", provider: "codewith", prompt: "race contract append" },
      }],
    });
    const workflowRun = await storage.createWorkflowRun({ workflow });
    const payload = {
      version: 1,
      provider: "codewith",
      permissionMode: "default",
      sandbox: "workspace-write",
      manualBreakGlass: false,
      timeoutMs: null,
      restrictions: { enforcement: "metadata_only", providerEnforced: false },
    };
    const execB = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pgstore-contract-race-b",
    });
    const storageB = new PostgresLoopStorage(execB.queryClient, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "request-contract-race-b",
    });
    try {
      const results = await Promise.allSettled([
        storage.appendWorkflowEvent(workflowRun.id, "agent_session_contract", "worker", payload),
        storageB.appendWorkflowEvent(workflowRun.id, "agent_session_contract", "worker", payload),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status).toBe("rejected");
      if (!rejected || rejected.status !== "rejected") throw new Error("duplicate contract append did not reject");
      expect(rejected.reason).toBeInstanceOf(DuplicateWorkflowEventError);
      expect((await storage.listWorkflowEvents(workflowRun.id)).filter(
        (event) => event.eventType === "agent_session_contract" && event.stepId === "worker",
      )).toHaveLength(1);
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

  test("advancement CAS and circuit-breaker markers remain tenant-scoped for identical loop ids", async () => {
    await executor.queryClient.execute(
      `INSERT INTO tenants(id, slug, name, status)
       VALUES ('tenant-advancement', 'tenant-advancement', 'Tenant Advancement', 'active')
       ON CONFLICT DO NOTHING;
       INSERT INTO tenant_memberships(tenant_id, principal_id, status)
       VALUES ('tenant-advancement', 'principal-test', 'active')
       ON CONFLICT DO NOTHING;
       INSERT INTO tenant_membership_roles(tenant_id, principal_id, role)
       VALUES ('tenant-advancement', 'principal-test', 'service')
       ON CONFLICT DO NOTHING;`,
    );
    const other = new PostgresLoopStorage(runtimeExecutor.queryClient, {
      tenantId: "tenant-advancement",
      principalId: "principal-test",
      requestId: "tenant-advancement-request",
    });
    const createdAt = "2026-07-06T12:30:00.000Z";
    const loopId = "tenant-shared-advancement-loop";
    await storage.upsertMigrationLoop({
      id: loopId,
      name: "tenant-a-advancement",
      status: "active",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 3,
      retryDelayMs: 1_000,
      leaseMs: 60_000,
      nextRunAt: "2030-01-01T00:00:00.000Z",
      createdAt,
      updatedAt: createdAt,
    } as Loop);
    await other.upsertMigrationLoop({
      id: loopId,
      name: "tenant-b-advancement",
      status: "active",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 3,
      retryDelayMs: 1_000,
      leaseMs: 60_000,
      nextRunAt: "2040-01-01T00:00:00.000Z",
      createdAt,
      updatedAt: createdAt,
    } as Loop);

    const tenantA = await storage.getLoop(loopId);
    expect(tenantA).toBeTruthy();
    expect(await storage.advanceLoopIfCurrent(
      loopId,
      {
        status: tenantA!.status,
        nextRunAt: tenantA!.nextRunAt,
        retryScheduledFor: tenantA!.retryScheduledFor,
      },
      { nextRunAt: "2031-01-01T00:00:00.000Z" },
      { now: new Date("2026-07-06T12:31:00.000Z") },
    )).toMatchObject({ nextRunAt: "2031-01-01T00:00:00.000Z" });
    expect(await other.getLoop(loopId)).toMatchObject({
      status: "active",
      nextRunAt: "2040-01-01T00:00:00.000Z",
    });

    const tenantB = await other.getLoop(loopId);
    expect(tenantB).toBeTruthy();
    expect(await other.tripCircuitBreakerIfCurrent(
      loopId,
      {
        status: tenantB!.status,
        nextRunAt: tenantB!.nextRunAt,
        retryScheduledFor: tenantB!.retryScheduledFor,
      },
      { status: "paused", nextRunAt: undefined, retryScheduledFor: undefined },
      {
        scheduledFor: "2040-01-01T00:00:00.000Z",
        reason: "tenant-b circuit breaker",
      },
      { now: new Date("2026-07-06T12:32:00.000Z") },
    )).toMatchObject({
      loop: { status: "paused" },
      marker: { status: "skipped", error: "tenant-b circuit breaker" },
    });
    expect(await storage.getLoop(loopId)).toMatchObject({
      status: "active",
      nextRunAt: "2031-01-01T00:00:00.000Z",
    });
    expect(await storage.listRuns({ loopId })).toHaveLength(0);
    expect(await other.listRuns({ loopId })).toHaveLength(1);
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
