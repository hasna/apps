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
import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { PostgresLoopStorage } from "./postgres-loop-storage.js";
import { POSTGRES_STORAGE_MIGRATIONS, checksumStorageSql } from "./postgres-schema.js";
import { createLoopsApiServer } from "../../api/index.js";
import type { LoopStorageContract } from "./contract.js";
import {
  AmbiguousNameError,
  DuplicateWorkflowEventError,
  LegacyWorkflowRunProvenanceError,
  RunFinalizationConflictError,
  ValidationError,
  WorkflowRunDefinitionConflictError,
  WorkflowRunStepOwnershipUnverifiableError,
} from "../errors.js";
import {
  assertTenantEnforcementBootstrap,
  assertTenantEnforcementBootstrapIfPending,
  createServeReadinessCheck,
  isCanonicalIdentityAliasStateSafe,
  isCanonicalIdentityPreApplyStateSafe,
  isSafeServiceConnection,
  migrateCanonicalIdentityAliases,
  repairCanonicalIdentityCatalog,
  type IdentityCatalogRepairReceipt,
} from "../../serve/index.js";
import type { CreateLoopInput, Loop, LoopRun, WorkflowSpec, WorkflowStepRun } from "../../types.js";
import { waitUntil } from "../../test-helpers.js";
import { planLoopAdvancement } from "../advancement.js";

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

type ReadinessProbe = {
  status: number;
  body: {
    status?: string;
    code?: string;
  };
};

async function requestActualReadiness(
  schema: PostgresStorage,
  runtimeClient: PoolQueryClient,
  authClient: PoolQueryClient,
): Promise<ReadinessProbe> {
  const server = createLoopsApiServer({
    host: "127.0.0.1",
    port: 0,
    authenticator: {
      authenticate: async () => ({
        ok: false as const,
        status: 401 as const,
        reason: "not_used_by_foundation_probe",
        message: "not used by foundation probe",
        requestId: "readiness-foundation-probe",
      }),
    },
    withTenantStorage: (_principal, fn) => fn({} as LoopStorageContract),
    readyCheck: createServeReadinessCheck({ schema, runtimeClient, authClient }),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/ready`);
    return {
      status: response.status,
      body: await response.json() as ReadinessProbe["body"],
    };
  } finally {
    server.stop(true);
  }
}

type IdentityCatalogSnapshot = {
  ledger: unknown;
  schemas: unknown;
  relations: unknown;
  routines: unknown;
  triggers: unknown;
};

async function identityCatalogSnapshot(
  client: TypedQueryClient,
): Promise<IdentityCatalogSnapshot> {
  const snapshot = await client.get<IdentityCatalogSnapshot>(`
    SELECT
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ledger.id,
            'checksum', ledger.checksum,
            'applied_at', ledger.applied_at
          )
          ORDER BY ledger.id
        )
          FROM public.open_loops_schema_migrations ledger
      ), '[]'::jsonb) AS ledger,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'oid', namespace.oid::text,
            'owner', pg_get_userbyid(namespace.nspowner),
            'acl', COALESCE(namespace.nspacl::text, '')
          )
          ORDER BY namespace.oid
        )
          FROM pg_namespace namespace
         WHERE namespace.nspname='public'
      ), '[]'::jsonb) AS schemas,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'oid', relation.oid::text,
            'kind', relation.relkind,
            'owner', pg_get_userbyid(relation.relowner),
            'acl', COALESCE(relation.relacl::text, ''),
            'column_acl', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'column', attribute.attname,
                  'acl', attribute.attacl::text
                )
                ORDER BY attribute.attnum
              )
                FROM pg_attribute attribute
               WHERE attribute.attrelid=relation.oid
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped
                 AND attribute.attacl IS NOT NULL
            ), '[]'::jsonb),
            'comment', obj_description(relation.oid, 'pg_class'),
            'definition', CASE
              WHEN relation.relkind IN ('v', 'm') THEN pg_get_viewdef(relation.oid, false)
              ELSE ''
            END
          )
          ORDER BY relation.oid
        )
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public'
           AND relation.relname='loops_schema_migrations'
      ), '[]'::jsonb) AS relations,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'oid', routine.oid::text,
            'name', routine.proname,
            'kind', routine.prokind,
            'args', pg_get_function_identity_arguments(routine.oid),
            'result', pg_get_function_result(routine.oid),
            'owner', pg_get_userbyid(routine.proowner),
            'language', language.lanname,
            'security_definer', routine.prosecdef,
            'volatility', routine.provolatile,
            'parallel', routine.proparallel,
            'returns_set', routine.proretset,
            'strict', routine.proisstrict,
            'leakproof', routine.proleakproof,
            'cost', routine.procost,
            'rows', routine.prorows,
            'support', routine.prosupport,
            'config', routine.proconfig,
            'source', routine.prosrc,
            'acl', COALESCE(routine.proacl::text, ''),
            'comment', obj_description(routine.oid, 'pg_proc')
          )
          ORDER BY routine.proname, routine.prokind,
                   pg_get_function_identity_arguments(routine.oid)
        )
          FROM pg_proc routine
          JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
          JOIN pg_language language ON language.oid=routine.prolang
         WHERE namespace.nspname='public'
           AND routine.proname=ANY(ARRAY[
             'loops_current_tenant_id',
             'loops_reject_runtime_tenant_update',
             'loops_authenticate_key',
             'loops_append_auth_audit'
           ])
      ), '[]'::jsonb) AS routines,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'oid', trigger.oid::text,
            'table', trigger.tgrelid::regclass::text,
            'function', trigger.tgfoid::regprocedure::text,
            'enabled', trigger.tgenabled,
            'definition', pg_get_triggerdef(trigger.oid, false)
          )
          ORDER BY trigger.oid
        )
          FROM pg_trigger trigger
         WHERE trigger.tgname='loops_reject_runtime_tenant_update'
           AND NOT trigger.tgisinternal
      ), '[]'::jsonb) AS triggers
  `);
  if (!snapshot) throw new Error("identity catalog snapshot query returned no row");
  return snapshot;
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
        await Promise.all([
          schema.migrate({ through: "0010_tenant_enforce" }),
          new PostgresStorage(peer).migrate({ through: "0010_tenant_enforce" }),
        ]);
      } finally {
        await peer.close();
      }
    } else {
      await schema.migrate({ through: "0010_tenant_enforce" });
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
  let preIdentityRuntimeReady = false;
  let preIdentityAuthenticatorReady = false;
  let preIdentityStorageReadable = false;
  let preIdentityAliasesAbsent = false;
  let preIdentityCanonicalAliasesSafe = false;
  let hostileOverloadPreApplySafe = true;
  let hostileRoutinePreApplySafe = true;
  let hostileOverloadMigrationRejected = false;
  let hostileOverloadRefusalMutationFree = false;
  let hostileRoutineMigrationRejected = false;
  let hostileRoutineRefusalMutationFree = false;
  let hostilePartialMigrationRejected = false;
  let hostilePartialRefusalMutationFree = false;
  let unauthorizedIdentityMigrationRejected = false;
  let unauthorizedIdentityRefusalMutationFree = false;
  let identityDryRunMutationFree = false;
  let identitySearchPathPoisonIgnored = false;
  let hostileOverloadPreIdentityReadiness: ReadinessProbe;
  let safePreIdentityReadiness: ReadinessProbe;
  let unsafePreIdentityReadiness: ReadinessProbe;
  let exactPostIdentityReadiness: ReadinessProbe;
  let driftedPostIdentityReadiness: ReadinessProbe;
  let repairedPostIdentityReadiness: ReadinessProbe;
  let futurePendingReadiness: ReadinessProbe;
  let unauthorizedRepairRejected = false;
  let firstRepairReceipt: IdentityCatalogRepairReceipt;
  let idempotentRepairReceipt: IdentityCatalogRepairReceipt;
  let postIdentityLegacyPolicyPreserved = false;
  let postIdentityGuardsCoexist = false;
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
      await schema.migrate({ through: "0010_tenant_enforce" });
    } catch (error) {
      ownedObjectRejected = error instanceof Error && error.message.includes("owns database objects");
    }
    await executor.queryClient.execute(`DROP SCHEMA service_owned_probe CASCADE`);
    await admin(`
      GRANT open_loops_runtime TO ${UNSAFE_LOGIN}, ${CROSS_ROLE_LOGIN}, ${BRIDGE_ROLE};
      GRANT open_loops_runtime TO ${ADMIN_LOGIN} WITH ADMIN OPTION;
    `);
    try {
      await schema.migrate({ through: "0010_tenant_enforce" });
    } catch (error) {
      unsafeServiceLoginRejected = error instanceof Error && error.message.includes("unsafe service login membership");
    }
    await admin(`
      REVOKE open_loops_runtime FROM ${UNSAFE_LOGIN}, ${CROSS_ROLE_LOGIN}, ${ADMIN_LOGIN};
      REVOKE open_loops_owner FROM ${CROSS_ROLE_LOGIN};
    `);
    await schema.migrate({ through: "0010_tenant_enforce" });
    const preIdentityRuntime = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: RUNTIME_LOGIN, password: RUNTIME_PASSWORD }),
      applicationName: "loops-pre-identity-runtime-test",
    });
    const preIdentityAuthenticator = PgPoolExecutor.fromConnectionString({
      connectionString: isolatedUrl({ username: AUTH_LOGIN, password: AUTH_PASSWORD }),
      applicationName: "loops-pre-identity-auth-test",
    });
    try {
      const runtimeSchema = new PostgresStorage(preIdentityRuntime);
      safePreIdentityReadiness = await requestActualReadiness(
        runtimeSchema,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
      preIdentityRuntimeReady = await isSafeServiceConnection(
        preIdentityRuntime.queryClient,
        "open_loops_runtime",
      );
      preIdentityAuthenticatorReady = await isSafeServiceConnection(
        preIdentityAuthenticator.queryClient,
        "open_loops_authenticator",
      );
      preIdentityCanonicalAliasesSafe = await isCanonicalIdentityAliasStateSafe(
        preIdentityRuntime.queryClient,
      );
      const preIdentityStorage = new PostgresLoopStorage(preIdentityRuntime.queryClient, {
        tenantId: "tenant-test",
        principalId: "principal-test",
        requestId: "pre-identity-read",
      });
      preIdentityStorageReadable = Array.isArray(await preIdentityStorage.listLoops());
      const preIdentityAliases = await executor.queryClient.get<{
        view_absent: boolean;
        tenant_function_absent: boolean;
        auth_function_absent: boolean;
        audit_function_absent: boolean;
      }>(`
        SELECT
          to_regclass('public.loops_schema_migrations') IS NULL AS view_absent,
          to_regprocedure('public.loops_current_tenant_id()') IS NULL AS tenant_function_absent,
          to_regprocedure('public.loops_authenticate_key(text,text)') IS NULL AS auth_function_absent,
          to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)') IS NULL AS audit_function_absent
      `);
      preIdentityAliasesAbsent = Boolean(
        preIdentityAliases?.view_absent &&
        preIdentityAliases.tenant_function_absent &&
        preIdentityAliases.auth_function_absent &&
        preIdentityAliases.audit_function_absent
      );
      const unauthorizedIdentityBefore = await identityCatalogSnapshot(executor.queryClient);
      try {
        await migrateCanonicalIdentityAliases(preIdentityRuntime.queryClient);
      } catch (error) {
        unauthorizedIdentityMigrationRejected = error instanceof Error &&
          error.message.includes("exact owner/migrator SET authority");
      }
      unauthorizedIdentityRefusalMutationFree = JSON.stringify(
        await identityCatalogSnapshot(executor.queryClient),
      ) === JSON.stringify(unauthorizedIdentityBefore);
      await executor.queryClient.execute(`
        CREATE FUNCTION public.loops_current_tenant_id(p_tenant TEXT) RETURNS TEXT
          LANGUAGE sql STABLE AS 'SELECT p_tenant';
      `);
      hostileOverloadPreApplySafe = await isCanonicalIdentityPreApplyStateSafe(
        preIdentityRuntime.queryClient,
      );
      const hostileOverloadBefore = await identityCatalogSnapshot(executor.queryClient);
      try {
        await migrateCanonicalIdentityAliases(executor.queryClient);
      } catch (error) {
        hostileOverloadMigrationRejected = error instanceof Error &&
          error.message.includes("wholly absent canonical catalog");
      }
      hostileOverloadRefusalMutationFree = JSON.stringify(
        await identityCatalogSnapshot(executor.queryClient),
      ) === JSON.stringify(hostileOverloadBefore);
      hostileOverloadPreIdentityReadiness = await requestActualReadiness(
        runtimeSchema,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
      await executor.queryClient.execute(
        "DROP FUNCTION public.loops_current_tenant_id(TEXT)",
      );
      await executor.queryClient.execute(`
        CREATE PROCEDURE public.loops_append_auth_audit(IN p_probe INTEGER)
          LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;
      `);
      hostileRoutinePreApplySafe = await isCanonicalIdentityPreApplyStateSafe(
        preIdentityRuntime.queryClient,
      );
      const hostileRoutineBefore = await identityCatalogSnapshot(executor.queryClient);
      try {
        await migrateCanonicalIdentityAliases(executor.queryClient);
      } catch (error) {
        hostileRoutineMigrationRejected = error instanceof Error &&
          error.message.includes("wholly absent canonical catalog");
      }
      hostileRoutineRefusalMutationFree = JSON.stringify(
        await identityCatalogSnapshot(executor.queryClient),
      ) === JSON.stringify(hostileRoutineBefore);
      await executor.queryClient.execute(
        "DROP PROCEDURE public.loops_append_auth_audit(INTEGER)",
      );
      await executor.queryClient.execute(`
        CREATE FUNCTION public.loops_current_tenant_id() RETURNS TEXT
          LANGUAGE sql STABLE AS 'SELECT ''hostile-tenant''::TEXT';
        ALTER FUNCTION public.loops_current_tenant_id() OWNER TO ${HOSTILE_FUNCTION_OWNER};
        GRANT EXECUTE ON FUNCTION public.loops_current_tenant_id() TO PUBLIC, open_loops_authenticator;
      `);
      unsafePreIdentityReadiness = await requestActualReadiness(
        runtimeSchema,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
      const hostilePartialBefore = await identityCatalogSnapshot(executor.queryClient);
      try {
        await migrateCanonicalIdentityAliases(executor.queryClient);
      } catch (error) {
        hostilePartialMigrationRejected = error instanceof Error &&
          error.message.includes("wholly absent canonical catalog");
      }
      hostilePartialRefusalMutationFree = JSON.stringify(
        await identityCatalogSnapshot(executor.queryClient),
      ) === JSON.stringify(hostilePartialBefore);
      await executor.queryClient.execute(
        "DROP FUNCTION public.loops_current_tenant_id()",
      );

      await executor.queryClient.execute(`
        CREATE SCHEMA identity_poison;
        CREATE TABLE identity_poison.open_loops_schema_migrations (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE identity_poison.tenants(id TEXT PRIMARY KEY);
      `);
      const poisonedSearchPathUrl = new URL(isolatedUrl());
      poisonedSearchPathUrl.searchParams.set(
        "options",
        "-csearch_path=identity_poison,public",
      );
      const poisonedSearchPathExecutor = PgPoolExecutor.fromConnectionString({
        connectionString: poisonedSearchPathUrl.toString(),
        applicationName: "loops-identity-search-path-regression",
        max: 1,
      });
      let temporarySearchPathTargets: {
        ledger_count: number;
        trigger_count: number;
      } | null = null;
      try {
        await poisonedSearchPathExecutor.queryClient.execute(`
          CREATE TEMP TABLE open_loops_schema_migrations (
            id TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL
          );
          CREATE TEMP TABLE tenants(id TEXT PRIMARY KEY);
        `);
        const identityDryRunBefore = await identityCatalogSnapshot(executor.queryClient);
        const identityDryRun = await migrateCanonicalIdentityAliases(
          poisonedSearchPathExecutor.queryClient,
          { dryRun: true },
        );
        identityDryRunMutationFree =
          identityDryRun.plan.filter((item) => item.state === "pending").length === 1 &&
          identityDryRun.plan.find((item) =>
            item.migration.id === "0013_loops_identity_aliases"
          )?.state === "pending" &&
          JSON.stringify(await identityCatalogSnapshot(executor.queryClient)) ===
          JSON.stringify(identityDryRunBefore);
        await migrateCanonicalIdentityAliases(poisonedSearchPathExecutor.queryClient);
        temporarySearchPathTargets = await poisonedSearchPathExecutor.queryClient.get<{
          ledger_count: number;
          trigger_count: number;
        }>(`
          SELECT
            (SELECT count(*)::int FROM pg_temp.open_loops_schema_migrations) AS ledger_count,
            (
              SELECT count(*)::int
                FROM pg_trigger trigger
               WHERE trigger.tgrelid='pg_temp.tenants'::regclass
                 AND trigger.tgname='loops_reject_runtime_tenant_update'
                 AND NOT trigger.tgisinternal
            ) AS trigger_count
        `);
      } finally {
        await poisonedSearchPathExecutor.close();
      }
      const searchPathTargets = await executor.queryClient.get<{
        public_trigger_count: number;
        poison_trigger_count: number;
        poison_ledger_count: number;
        identity_recorded: boolean;
      }>(`
        SELECT
          (
            SELECT count(*)::int
              FROM pg_trigger trigger
             WHERE trigger.tgrelid='public.tenants'::regclass
               AND trigger.tgname='loops_reject_runtime_tenant_update'
               AND NOT trigger.tgisinternal
          ) AS public_trigger_count,
          (
            SELECT count(*)::int
              FROM pg_trigger trigger
             WHERE trigger.tgrelid='identity_poison.tenants'::regclass
               AND trigger.tgname='loops_reject_runtime_tenant_update'
               AND NOT trigger.tgisinternal
          ) AS poison_trigger_count,
          (SELECT count(*)::int FROM identity_poison.open_loops_schema_migrations)
            AS poison_ledger_count,
          EXISTS (
            SELECT 1
              FROM public.open_loops_schema_migrations
             WHERE id='0013_loops_identity_aliases'
          ) AS identity_recorded
      `);
      identitySearchPathPoisonIgnored =
        searchPathTargets?.public_trigger_count === 1 &&
        searchPathTargets.poison_trigger_count === 0 &&
        searchPathTargets.poison_ledger_count === 0 &&
        searchPathTargets.identity_recorded &&
        temporarySearchPathTargets?.ledger_count === 0 &&
        temporarySearchPathTargets.trigger_count === 0;
      await executor.queryClient.execute("DROP SCHEMA identity_poison CASCADE");
      exactPostIdentityReadiness = await requestActualReadiness(
        runtimeSchema,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
      await executor.queryClient.execute(
        "REVOKE SELECT ON public.loops_schema_migrations FROM open_loops_runtime",
      );
      driftedPostIdentityReadiness = await requestActualReadiness(
        runtimeSchema,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
      try {
        await repairCanonicalIdentityCatalog(preIdentityRuntime.queryClient, "repair-unauthorized");
      } catch (error) {
        unauthorizedRepairRejected = error instanceof Error &&
          error.message.includes("exact owner/migrator SET authority");
      }
      firstRepairReceipt = await repairCanonicalIdentityCatalog(
        executor.queryClient,
        "repair-first",
      );
      repairedPostIdentityReadiness = await requestActualReadiness(
        runtimeSchema,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
      idempotentRepairReceipt = await repairCanonicalIdentityCatalog(
        executor.queryClient,
        "repair-idempotent",
      );

      const futureSql = "SELECT 1";
      const schemaWithAnotherPendingMigration = new PostgresStorage(preIdentityRuntime, [
        ...POSTGRES_STORAGE_MIGRATIONS,
        {
          id: "0014_test_future",
          sql: futureSql,
          checksum: checksumStorageSql(futureSql),
        },
      ]);
      futurePendingReadiness = await requestActualReadiness(
        schemaWithAnotherPendingMigration,
        preIdentityRuntime.queryClient,
        preIdentityAuthenticator.queryClient,
      );
    } finally {
      await preIdentityAuthenticator.close();
      await preIdentityRuntime.close();
    }
    const identityTransition = await executor.queryClient.get<{
      policy_qualifier: string;
      default_expression: string;
      guards_coexist: boolean;
    }>(`
      SELECT
        (
          SELECT pg_get_expr(policy.polqual, policy.polrelid)
            FROM pg_policy policy
           WHERE policy.polrelid = 'public.loops'::regclass
             AND policy.polname = 'tenant_isolation'
        ) AS policy_qualifier,
        (
          SELECT pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
            FROM pg_attrdef attribute_default
            JOIN pg_attribute attribute
              ON attribute.attrelid = attribute_default.adrelid
             AND attribute.attnum = attribute_default.adnum
           WHERE attribute_default.adrelid = 'public.loops'::regclass
             AND attribute.attname = 'tenant_id'
        ) AS default_expression,
        (
          SELECT COUNT(*) = 2
            FROM pg_trigger trigger
           WHERE trigger.tgrelid = 'public.tenants'::regclass
             AND trigger.tgname IN (
               'open_loops_reject_runtime_tenant_update',
               'loops_reject_runtime_tenant_update'
             )
             AND NOT trigger.tgisinternal
        ) AS guards_coexist
    `);
    postIdentityLegacyPolicyPreserved = Boolean(
      identityTransition?.policy_qualifier.includes("open_loops_current_tenant_id") &&
      identityTransition.default_expression.includes("open_loops_current_tenant_id"),
    );
    postIdentityGuardsCoexist = identityTransition?.guards_coexist === true;
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
    // During the phased boundary, a canonical-only setting cannot see rows
    // through the retained legacy RLS policy and therefore cannot mutate them.
    await expect(runtimeExecutor.queryClient.transaction(async (client) => {
      await client.get("SELECT set_config('loops.tenant_id', $1, true)", ["tenant-test"]);
      await client.execute("UPDATE tenants SET name='Raw Runtime Mutated' WHERE id='tenant-test'");
    })).resolves.toBeUndefined();
    expect(await executor.queryClient.get<{ name: string }>(
      "SELECT name FROM tenants WHERE id='tenant-test'",
    )).toEqual({ name: "Tenant Test" });
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
      "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.loops_current_tenant_id()'::regprocedure",
    )).toEqual({ owner: "open_loops_owner" });
    expect(await executor.queryClient.get<{ auth_execute: boolean; public_execute: boolean }>(
      `SELECT has_function_privilege($1, 'public.loops_current_tenant_id()', 'EXECUTE') AS auth_execute,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
              ) AS public_execute
         FROM pg_proc proc
        WHERE proc.oid='public.loops_current_tenant_id()'::regprocedure`,
      [AUTH_LOGIN],
    )).toEqual({ auth_execute: false, public_execute: true });
    expect(await executor.queryClient.get<{ runtime_execute: boolean; role_execute: boolean; runtime_member: boolean; runtime_inherit: boolean }>(
      `SELECT has_function_privilege($1, 'public.loops_current_tenant_id()', 'EXECUTE') AS runtime_execute,
              has_function_privilege('open_loops_runtime', 'public.loops_current_tenant_id()', 'EXECUTE') AS role_execute,
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
      USING (tenant_id = public.loops_current_tenant_id())
      WITH CHECK (tenant_id = public.loops_current_tenant_id())
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
    await executor.queryClient.execute(`ALTER FUNCTION public.loops_current_tenant_id() OWNER TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.loops_current_tenant_id() OWNER TO open_loops_owner`);
    await executor.queryClient.execute(`GRANT EXECUTE ON FUNCTION public.loops_current_tenant_id() TO open_loops_runtime`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);
    await executor.queryClient.execute(`ALTER FUNCTION public.loops_current_tenant_id() SECURITY DEFINER`);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(false);
    await executor.queryClient.execute(`ALTER FUNCTION public.loops_current_tenant_id() SECURITY INVOKER`);
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

  test("canonical identity aliases preserve the released ledger and upgrade reruns are idempotent", async () => {
    expect(preIdentityRuntimeReady).toBe(true);
    expect(preIdentityAuthenticatorReady).toBe(true);
    expect(preIdentityStorageReadable).toBe(true);
    expect(preIdentityAliasesAbsent).toBe(true);
    expect(preIdentityCanonicalAliasesSafe).toBe(true);
    expect(hostileOverloadPreApplySafe).toBe(false);
    expect(hostileRoutinePreApplySafe).toBe(false);
    expect(hostileOverloadMigrationRejected).toBe(true);
    expect(hostileOverloadRefusalMutationFree).toBe(true);
    expect(hostileRoutineMigrationRejected).toBe(true);
    expect(hostileRoutineRefusalMutationFree).toBe(true);
    expect(hostilePartialMigrationRejected).toBe(true);
    expect(hostilePartialRefusalMutationFree).toBe(true);
    expect(unauthorizedIdentityMigrationRejected).toBe(true);
    expect(unauthorizedIdentityRefusalMutationFree).toBe(true);
    expect(identityDryRunMutationFree).toBe(true);
    expect(identitySearchPathPoisonIgnored).toBe(true);
    expect(safePreIdentityReadiness).toEqual({
      status: 200,
      body: expect.objectContaining({ status: "ready" }),
    });
    expect(hostileOverloadPreIdentityReadiness).toEqual({
      status: 503,
      body: expect.objectContaining({
        status: "not_ready",
        code: "unsafe_identity_catalog",
      }),
    });
    expect(unsafePreIdentityReadiness).toEqual({
      status: 503,
      body: expect.objectContaining({
        status: "not_ready",
        code: "unsafe_identity_catalog",
      }),
    });
    expect(exactPostIdentityReadiness).toEqual({
      status: 200,
      body: expect.objectContaining({ status: "ready" }),
    });
    expect(driftedPostIdentityReadiness).toEqual({
      status: 503,
      body: expect.objectContaining({
        status: "not_ready",
        code: "unsafe_identity_catalog",
      }),
    });
    expect(repairedPostIdentityReadiness).toEqual({
      status: 200,
      body: expect.objectContaining({ status: "ready" }),
    });
    expect(futurePendingReadiness).toEqual({
      status: 503,
      body: expect.objectContaining({
        status: "not_ready",
        code: "pending_migrations",
      }),
    });
    expect(unauthorizedRepairRejected).toBe(true);
    expect(firstRepairReceipt).toMatchObject({
      requestId: "repair-first",
      migrationId: "0013_loops_identity_aliases",
      outcome: "repaired",
    });
    expect(firstRepairReceipt.migrationChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(firstRepairReceipt.actor).toBeTruthy();
    expect(firstRepairReceipt.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(idempotentRepairReceipt).toMatchObject({
      requestId: "repair-idempotent",
      migrationId: "0013_loops_identity_aliases",
      migrationChecksum: firstRepairReceipt.migrationChecksum,
      actor: firstRepairReceipt.actor,
      outcome: "already_safe",
    });
    const ledger = await executor.queryClient.get<{
      equal: boolean;
      canonical_count: number;
      physical_count: number;
      identity_recorded: boolean;
    }>(`
      SELECT
        NOT EXISTS (
          (SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations
           EXCEPT
           SELECT id, checksum, applied_at FROM public.loops_schema_migrations)
          UNION ALL
          (SELECT id, checksum, applied_at FROM public.loops_schema_migrations
           EXCEPT
           SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations)
        ) AS equal,
        (SELECT count(*)::int FROM public.loops_schema_migrations) AS canonical_count,
        (SELECT count(*)::int FROM public.open_loops_schema_migrations) AS physical_count,
        EXISTS (
          SELECT 1 FROM public.open_loops_schema_migrations
           WHERE id = '0013_loops_identity_aliases'
        ) AS identity_recorded
    `);
    expect(ledger?.equal).toBe(true);
    expect(ledger?.canonical_count).toBe(ledger?.physical_count);
    expect(ledger?.identity_recorded).toBe(true);

    expect(postIdentityLegacyPolicyPreserved).toBe(true);
    expect(postIdentityGuardsCoexist).toBe(true);

    await executor.queryClient.transaction(async (client) => {
      await client.get("SELECT set_config('open_loops.tenant_id', $1, true)", ["legacy-tenant"]);
      expect(await client.get<{ tenant_id: string }>(
        "SELECT public.loops_current_tenant_id() AS tenant_id",
      )).toEqual({ tenant_id: "legacy-tenant" });
    });

    const rerun = await migrateCanonicalIdentityAliases(executor.queryClient);
    expect(rerun.applied.at(-1)?.id).toBe("0013_loops_identity_aliases");
    expect(rerun.plan.every((item) => item.state === "already_applied")).toBe(true);
  });

  test("a recorded identity migration fails readiness on every missing or tampered canonical alias", async () => {
    // This test is independently runnable even when Bun filters out the
    // earlier adversarial readiness test that normally clears this fixture.
    await executor.queryClient.execute(`
      REVOKE ALL ON evil.loops FROM open_loops_runtime;
      REVOKE ALL ON SCHEMA evil FROM open_loops_runtime
    `);
    expect(await isCanonicalIdentityAliasStateSafe(runtimeExecutor.queryClient)).toBe(true);
    expect(await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime")).toBe(true);

    const hostileMutations = [
      {
        name: "missing ledger view",
        sql: "DROP VIEW public.loops_schema_migrations",
      },
      {
        name: "ledger view owner drift",
        sql: "ALTER VIEW public.loops_schema_migrations OWNER TO open_loops_owner",
      },
      {
        name: "ledger view required privilege revoked",
        sql: "REVOKE SELECT ON public.loops_schema_migrations FROM open_loops_runtime",
      },
      {
        name: "ledger view privilege widened",
        sql: "GRANT SELECT ON public.loops_schema_migrations TO open_loops_authenticator",
      },
      {
        name: "ledger view column privilege widened",
        sql: "GRANT SELECT(id) ON public.loops_schema_migrations TO open_loops_authenticator",
      },
      {
        name: "ledger view row and checksum parity narrowed",
        sql: `
          CREATE OR REPLACE VIEW public.loops_schema_migrations AS
          SELECT id, checksum, applied_at
            FROM public.open_loops_schema_migrations
           WHERE id <> '0013_loops_identity_aliases'
        `,
      },
      {
        name: "tenant reader owner drift",
        sql: `ALTER FUNCTION public.loops_current_tenant_id() OWNER TO ${HOSTILE_FUNCTION_OWNER}`,
      },
      {
        name: "tenant reader security drift",
        sql: "ALTER FUNCTION public.loops_current_tenant_id() SECURITY DEFINER",
      },
      {
        name: "tenant reader planner cost drift",
        sql: "ALTER FUNCTION public.loops_current_tenant_id() COST 999",
      },
      {
        name: "tenant reader body drift",
        sql: `
          CREATE OR REPLACE FUNCTION public.loops_current_tenant_id() RETURNS TEXT
          LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
          RETURN 'hostile-tenant'
        `,
      },
      {
        name: "tenant reader required privilege revoked",
        sql: "REVOKE EXECUTE ON FUNCTION public.loops_current_tenant_id() FROM open_loops_runtime",
      },
      {
        name: "tenant reader privilege widened",
        sql: "GRANT EXECUTE ON FUNCTION public.loops_current_tenant_id() TO open_loops_authenticator",
      },
      {
        name: "missing canonical update guard function and trigger",
        sql: "DROP FUNCTION public.loops_reject_runtime_tenant_update() CASCADE",
      },
      {
        name: "canonical update guard owner drift",
        sql: `ALTER FUNCTION public.loops_reject_runtime_tenant_update() OWNER TO ${HOSTILE_FUNCTION_OWNER}`,
      },
      {
        name: "canonical update guard body drift",
        sql: `
          CREATE OR REPLACE FUNCTION public.loops_reject_runtime_tenant_update()
          RETURNS TRIGGER
          LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
          AS $$ BEGIN RETURN NEW; END; $$
        `,
      },
      {
        name: "canonical update guard privilege widened",
        sql: "GRANT EXECUTE ON FUNCTION public.loops_reject_runtime_tenant_update() TO open_loops_runtime",
      },
      {
        name: "canonical update trigger disabled",
        sql: "ALTER TABLE public.tenants DISABLE TRIGGER loops_reject_runtime_tenant_update",
      },
      {
        name: "canonical update trigger redirected",
        sql: `
          DROP TRIGGER loops_reject_runtime_tenant_update ON public.tenants;
          CREATE TRIGGER loops_reject_runtime_tenant_update
          BEFORE UPDATE ON public.tenants
          FOR EACH ROW
          EXECUTE FUNCTION public.open_loops_reject_runtime_tenant_update()
        `,
      },
      {
        name: "missing canonical authentication wrapper",
        sql: "DROP FUNCTION public.loops_authenticate_key(TEXT, TEXT)",
      },
      {
        name: "canonical authentication wrapper owner drift",
        sql: `ALTER FUNCTION public.loops_authenticate_key(TEXT, TEXT) OWNER TO ${HOSTILE_FUNCTION_OWNER}`,
      },
      {
        name: "canonical authentication wrapper security drift",
        sql: "ALTER FUNCTION public.loops_authenticate_key(TEXT, TEXT) SECURITY INVOKER",
      },
      {
        name: "canonical authentication wrapper required privilege revoked",
        sql: "REVOKE EXECUTE ON FUNCTION public.loops_authenticate_key(TEXT, TEXT) FROM open_loops_authenticator",
      },
      {
        name: "canonical authentication wrapper privilege widened",
        sql: "GRANT EXECUTE ON FUNCTION public.loops_authenticate_key(TEXT, TEXT) TO open_loops_runtime",
      },
      {
        name: "missing canonical audit wrapper",
        sql: "DROP FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)",
      },
      {
        name: "canonical audit wrapper owner drift",
        sql: `ALTER FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO ${HOSTILE_FUNCTION_OWNER}`,
      },
      {
        name: "canonical audit wrapper security drift",
        sql: "ALTER FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) SECURITY INVOKER",
      },
      {
        name: "canonical audit wrapper required privilege revoked",
        sql: "REVOKE EXECUTE ON FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM open_loops_authenticator",
      },
      {
        name: "canonical audit wrapper privilege widened",
        sql: "GRANT EXECUTE ON FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO open_loops_runtime",
      },
    ];

    for (const mutation of hostileMutations) {
      await executor.queryClient.execute(mutation.sql);
      try {
        expect({
          mutation: mutation.name,
          safe: await isSafeServiceConnection(runtimeExecutor.queryClient, "open_loops_runtime"),
        }).toEqual({ mutation: mutation.name, safe: false });
      } finally {
        const receipt = await repairCanonicalIdentityCatalog(
          executor.queryClient,
          `repair-${mutation.name.replaceAll(" ", "-")}`,
        );
        expect(receipt.outcome).toBe("repaired");
      }
      expect({
        mutation: mutation.name,
        safe: await isCanonicalIdentityAliasStateSafe(runtimeExecutor.queryClient),
      }).toEqual({ mutation: mutation.name, safe: true });
    }
  });

  test("unexpected canonical-name overloads and procedures remain fail-closed through repair and cleanup", async () => {
    // Keep this test independently runnable when Bun filters out the preceding
    // service-role test that normally clears the intentionally hostile schema.
    await executor.queryClient.execute(`
      REVOKE ALL ON evil.loops FROM open_loops_runtime;
      REVOKE ALL ON SCHEMA evil FROM open_loops_runtime
    `);
    const hostileRoutines = [
      {
        name: "function overload",
        create: `
          CREATE FUNCTION public.loops_current_tenant_id(p_tenant TEXT) RETURNS TEXT
            LANGUAGE sql STABLE AS 'SELECT p_tenant'
        `,
        drop: "DROP FUNCTION public.loops_current_tenant_id(TEXT)",
      },
      {
        name: "procedure overload",
        create: `
          CREATE PROCEDURE public.loops_append_auth_audit(IN p_probe INTEGER)
            LANGUAGE plpgsql AS $$ BEGIN NULL; END $$
        `,
        drop: "DROP PROCEDURE public.loops_append_auth_audit(INTEGER)",
      },
    ];

    for (const hostile of hostileRoutines) {
      await executor.queryClient.execute(hostile.create);
      const poisoned = await identityCatalogSnapshot(executor.queryClient);
      expect({
        routine: hostile.name,
        safe: await isCanonicalIdentityAliasStateSafe(runtimeExecutor.queryClient),
      }).toEqual({ routine: hostile.name, safe: false });
      expect(await requestActualReadiness(
        schema,
        runtimeExecutor.queryClient,
        authExecutor.queryClient,
      )).toEqual({
        status: 503,
        body: expect.objectContaining({
          status: "not_ready",
          code: "unsafe_identity_catalog",
        }),
      });
      await expect(
        repairCanonicalIdentityCatalog(
          executor.queryClient,
          `repair-unexpected-${hostile.name.replaceAll(" ", "-")}`,
        ),
      ).rejects.toThrow("postcondition failed");
      expect(await identityCatalogSnapshot(executor.queryClient)).toEqual(poisoned);

      await executor.queryClient.execute(hostile.drop);
      expect(await isCanonicalIdentityAliasStateSafe(runtimeExecutor.queryClient)).toBe(true);
      expect(await requestActualReadiness(
        schema,
        runtimeExecutor.queryClient,
        authExecutor.queryClient,
      )).toEqual({
        status: 200,
        body: expect.objectContaining({ status: "ready" }),
      });
      expect((await repairCanonicalIdentityCatalog(
        executor.queryClient,
        `repair-after-${hostile.name.replaceAll(" ", "-")}`,
      )).outcome).toBe("already_safe");
    }
  });

  test("identity catalog repair rolls back partial work on an unrecoverable relation collision", async () => {
    const schemaAcl = async () => executor.queryClient.many<{ privilege: string }>(`
      SELECT concat(
        CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
        ':', acl.privilege_type, ':', acl.is_grantable
      ) AS privilege
        FROM pg_namespace namespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
        ) acl
       WHERE namespace.nspname='public'
       ORDER BY 1
    `);
    await executor.queryClient.execute(`
      DROP VIEW public.loops_schema_migrations;
      CREATE TABLE public.loops_schema_migrations (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL
      )
    `);
    const beforeAcl = await schemaAcl();
    await expect(
      repairCanonicalIdentityCatalog(executor.queryClient, "repair-collision"),
    ).rejects.toThrow();
    expect(await schemaAcl()).toEqual(beforeAcl);
    expect(await executor.queryClient.get<{ kind: string }>(`
      SELECT relkind AS kind
        FROM pg_class
       WHERE oid='public.loops_schema_migrations'::regclass
    `)).toEqual({ kind: "r" });

    await executor.queryClient.execute("DROP TABLE public.loops_schema_migrations");
    expect((await repairCanonicalIdentityCatalog(
      executor.queryClient,
      "repair-after-collision",
    )).outcome).toBe("repaired");
    expect(await isCanonicalIdentityAliasStateSafe(runtimeExecutor.queryClient)).toBe(true);
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
             $3, $3, loops_current_tenant_id()
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

    expect(await storage.countRuns("succeeded")).toBe(1);
    const runs = await storage.listRuns({ loopId: loop.id });
    expect(runs.length).toBe(1);
    expect((await storage.getRunBySlot(loop.id, slot))?.id).toBe(claim!.run.id);
  });

  test("same-runner reclaim fences stale and tokenless PostgreSQL work", async () => {
    const claimedAt = new Date("2026-07-06T10:10:00.000Z");
    const loop = await storage.createLoop(loopInput("pg-same-runner-reclaim", { leaseMs: 10 }));
    const first = await storage.claimRun(loop, claimedAt.toISOString(), "runner-same", claimedAt);
    const second = await storage.claimRun(
      loop,
      claimedAt.toISOString(),
      "runner-same",
      new Date("2026-07-06T10:10:00.020Z"),
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
      new Date("2026-07-06T10:10:00.021Z"),
    )).toBeUndefined();
    expect(await storage.heartbeatRunLease(
      second!.run.id,
      "runner-same",
      60_000,
      new Date("2026-07-06T10:10:00.021Z"),
      { claimToken: first!.claimToken },
    )).toBeUndefined();
    expect(await storage.heartbeatRunLease(
      second!.run.id,
      "runner-same",
      60_000,
      new Date("2026-07-06T10:10:00.021Z"),
      { claimToken: second!.claimToken },
    )).toMatchObject({ status: "running" });

    const patch = {
      status: "succeeded" as const,
      finishedAt: "2026-07-06T10:10:00.030Z",
      durationMs: 10,
      stdout: "",
      stderr: "",
    };
    await expect(storage.finalizeRun(second!.run.id, patch, {
      claimedBy: "runner-same",
      now: new Date("2026-07-06T10:10:00.030Z"),
    })).rejects.toMatchObject({ reason: "stale_claim" });
    await expect(storage.finalizeRun(second!.run.id, patch, {
      claimedBy: "runner-same",
      claimToken: first!.claimToken,
      now: new Date("2026-07-06T10:10:00.030Z"),
    })).rejects.toMatchObject({ reason: "stale_claim" });
    expect(await storage.finalizeRun(second!.run.id, patch, {
      claimedBy: "runner-same",
      claimToken: second!.claimToken,
      now: new Date("2026-07-06T10:10:00.030Z"),
    })).toMatchObject({ status: "succeeded" });
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
    const past = new Date(Date.now() - 60_000);
    const claim = await storage.claimRun(loop, slot, "runner-x", past);
    expect(claim).toBeTruthy();
    const result = await storage.recoverExpiredRunLeasesDetailed(new Date());
    expect(result.abandoned.length).toBe(1);
    expect(result.abandoned[0]!.status).toBe("abandoned");
    expect(result.deferred.length).toBe(0);
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
        "DELETE FROM workflow_runs WHERE tenant_id = loops_current_tenant_id() AND id=$1",
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

    const recoveries = await Promise.all([
      storage.recoverExpiredRunLeasesDetailed(new Date("2026-07-06T12:00:01.000Z")),
      storage.recoverExpiredRunLeasesDetailed(new Date("2026-07-06T12:00:01.000Z")),
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

    expect((await storage.recoverExpiredRunLeasesDetailed(new Date("2026-07-06T12:00:02.000Z"))).abandoned).toHaveLength(0);
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
    const recovered = await storage.recoverExpiredRunLeasesDetailed(
      new Date("2026-07-06T12:00:02.000Z"),
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
          (SELECT COUNT(*)::int FROM workflow_runs WHERE tenant_id = loops_current_tenant_id()) AS run_count,
          (SELECT COUNT(*)::int FROM workflow_step_runs WHERE tenant_id = loops_current_tenant_id()) AS step_count,
          (SELECT COUNT(*)::int FROM workflow_events WHERE tenant_id = loops_current_tenant_id()) AS event_count
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
    expect(JSON.stringify(await storage.listWorkflowEvents(recoveredRun.id))).not.toContain("ghp_");

    const skippedRun = await storage.createWorkflowRun({ workflow });
    const skipped = await storage.skipWorkflowStepRun(skippedRun.id, "worker", reason);
    expect(skipped.error).toBe("operation failed with [SCRUBBED]");
    expect(JSON.stringify(await storage.listWorkflowEvents(skippedRun.id))).not.toContain("ghp_");

    const finalizedRun = await storage.createWorkflowRun({ workflow });
    const finalized = await storage.finalizeWorkflowRun(finalizedRun.id, "failed", { error: reason });
    expect(finalized.error).toBe("operation failed with [SCRUBBED]");
    expect(JSON.stringify(await storage.listWorkflowEvents(finalizedRun.id))).not.toContain("ghp_");

    const loop = await storage.createLoop(loopInput("pg-scrub-skipped-reason"));
    const skippedLoopRun = await storage.createSkippedRun(loop, "2026-07-06T14:15:00.000Z", reason);
    expect(skippedLoopRun.error).toBe("operation failed with [SCRUBBED]");

    const goal = await storage.createGoal({ objective: "scrub deep Postgres evidence" });
    await storage.recordGoalEvent({
      goalId: goal.goalId,
      phase: "execute",
      status: "active",
      evidence: { note: `saw export DB_PASSWORD="${QUOTED_SECRET}" in output` },
      rawResponse: { result: `export DB_PASSWORD="${QUOTED_SECRET}"` },
    });
    const goalRun = (await storage.listGoalRuns({ goalId: goal.goalId }))[0]!;
    expect((goalRun.evidence as { note: string }).note).toBe('saw export DB_PASSWORD="[SCRUBBED]" in output');
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
        await blocker.query("SELECT set_config('loops.tenant_id', $1, true)", ["tenant-test"]);
        await blocker.query(
          "SELECT id FROM workflow_runs WHERE tenant_id = loops_current_tenant_id() AND id=$1 FOR UPDATE",
          [run.id],
        );

        mutation = operation.mutate(peer, run.id);
        await waitUntil(() => reachedParentLock, {
          label: `${operation.name} reached workflow parent lock`,
        });

        await expect(blocker.query(
          `SELECT id FROM workflow_step_runs
           WHERE tenant_id = loops_current_tenant_id() AND workflow_run_id=$1 AND step_id='worker'
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

    const recovered = await storage.recoverExpiredRunLeases(new Date("2026-07-06T15:00:02.000Z"));
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
    expect(events.map((event) => event.eventType)).toEqual(["created", "step_started", "failed"]);
    expect(events.at(-1)?.payload).toMatchObject({
      error: "parent loop run lease expired before completion",
      loopRunId: claim!.run.id,
    });
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
