#!/usr/bin/env bun
// `loops-serve` — the self-hosted HTTP control-plane binary.
//
// The service reads and writes self-hosted RDS/Postgres directly. There is no
// local SQLite, no cache, and no sync engine in the
// serve process. Storage is the generated @hasna/contracts kit pool wrapping the
// real `PostgresLoopStorage` backend. Every authenticated request gets one
// dedicated transaction with tenant RLS context.
import { Command } from "commander";
import { createLoopsApiServer } from "../api/index.js";
import { TenantApiAuthenticator } from "../lib/auth/tenant-auth.js";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { PgPoolExecutor } from "../lib/storage/pg-executor.js";
import { PostgresStorage } from "../lib/storage/postgres.js";
import { createPostgresLoopStorage } from "../lib/storage/postgres-loop-storage.js";
import { runSharedToDedicatedTransfer } from "../lib/storage/shared-database-transfer.js";
import {
  POSTGRES_MIGRATION_ADVISORY_LOCK_SQL,
  POSTGRES_MIGRATION_LEDGER_TABLE,
  POSTGRES_TENANT_BOOTSTRAP_MEMBERSHIPS_SQL,
  POSTGRES_TENANT_BOOTSTRAP_ROLES_SQL,
  POSTGRES_TENANT_CLUSTER_ROLE_EXCLUSIVITY_SQL,
  POSTGRES_TENANT_PRIVILEGED_MEMBERSHIPS_SQL,
  POSTGRES_TENANT_SERVICE_MEMBER_CLEANUP_SQL,
  POSTGRES_TENANT_SERVICE_ROLE_MEMBERSHIPS_SQL,
  POSTGRES_TENANT_UNSAFE_SERVICE_MEMBERSHIPS_SQL,
} from "../lib/storage/postgres-schema.js";
import { loadTenantBackfillBundle, parseTenantBackfillBundle } from "../lib/storage/tenant-backfill.js";
import {
  loadApprovedTenantBackfillBundle,
  logTenantBackfillS3Success,
} from "../lib/storage/tenant-backfill-s3.js";
import {
  logProviderCredentialSuccess,
  reconcileProviderCredentials,
  resolveProviderCredentialOptions,
} from "../lib/storage/provider-credentials.js";
import { packageVersion } from "../lib/version.js";

function resolveDatabaseUrl(purpose: "runtime" | "auth" | "migrator"): string {
  const envName = purpose === "runtime"
    ? "HASNA_LOOPS_DATABASE_URL"
    : purpose === "auth"
      ? "HASNA_LOOPS_AUTH_DATABASE_URL"
      : "HASNA_LOOPS_MIGRATOR_DATABASE_URL";
  const dsn = process.env[envName]?.trim();
  if (!dsn) {
    throw new Error(`loops-serve ${purpose} requires ${envName}`);
  }
  return dsn;
}

function resolveSigningSecret(): string | undefined {
  return process.env.HASNA_LOOPS_API_SIGNING_KEY?.trim() || undefined;
}

function buildExecutor(applicationName: string, purpose: "runtime" | "auth" | "migrator"): PgPoolExecutor {
  return PgPoolExecutor.fromConnectionString({
    connectionString: resolveDatabaseUrl(purpose),
    applicationName,
    max: Number(process.env.LOOPS_PG_POOL_MAX ?? "5"),
    connectionTimeoutMillis: 10_000,
  });
}

function defaultHost(): string {
  return process.env.LOOPS_API_HOST ?? "0.0.0.0";
}
function defaultPort(): number {
  return Number(process.env.PORT ?? process.env.LOOPS_API_PORT ?? "8787");
}

type ServiceDatabaseRole = "open_loops_runtime" | "open_loops_authenticator";
const TENANT_ENFORCEMENT_MIGRATION_ID = "0010_tenant_enforce";
const LOOPS_IDENTITY_MIGRATION_ID = "0013_loops_identity_aliases";
export type ServeReadinessFailureCode =
  | "storage_unreachable"
  | "migration_checksum_mismatch";

export function classifyMigrationReadinessError(error: unknown): ServeReadinessFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Postgres migration checksum mismatch")
    ? "migration_checksum_mismatch"
    : "storage_unreachable";
}

interface CanonicalIdentityFunctionState {
  name: string;
  args: string;
  result: string;
  owner: string;
  language: string;
  security_definer: boolean;
  volatility: string;
  parallel: string;
  kind: string;
  returns_set: boolean;
  is_strict: boolean;
  is_leakproof: boolean;
  config: string[] | null;
  source: string;
  definition: string;
  acl: string[];
}

interface CanonicalIdentityFunctionExpectation {
  args: string;
  result: string;
  owner: "open_loops_owner";
  language: "sql" | "plpgsql";
  securityDefiner: boolean;
  volatility: "s" | "v";
  parallel: "s" | "u";
  returnsSet: boolean;
  source?: string;
  definitionFragment?: string;
  acl: string[];
}

function normalizedCatalogSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const CANONICAL_IDENTITY_FUNCTIONS: Readonly<Record<string, CanonicalIdentityFunctionExpectation>> =
  Object.freeze({
    loops_current_tenant_id: {
      args: "",
      result: "text",
      owner: "open_loops_owner",
      language: "sql",
      securityDefiner: false,
      volatility: "s",
      parallel: "s",
      returnsSet: false,
      definitionFragment:
        "RETURN COALESCE(NULLIF(current_setting('loops.tenant_id'::text, true), ''::text), NULLIF(current_setting('open_loops.tenant_id'::text, true), ''::text))",
      acl: [
        "open_loops_owner:EXECUTE:f",
        "open_loops_runtime:EXECUTE:f",
      ],
    },
    loops_reject_runtime_tenant_update: {
      args: "",
      result: "trigger",
      owner: "open_loops_owner",
      language: "plpgsql",
      securityDefiner: false,
      volatility: "v",
      parallel: "u",
      returnsSet: false,
      source: `
        BEGIN
          IF pg_has_role(current_user, 'open_loops_runtime', 'USAGE') THEN
            RAISE EXCEPTION 'runtime role cannot update tenants' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END;
      `,
      acl: ["open_loops_owner:EXECUTE:f"],
    },
    loops_authenticate_key: {
      args: "p_kid text, p_token_hash text",
      result:
        "TABLE(kid text, app text, agent text, scopes jsonb, token_hash text, issued_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone, disabled_at timestamp with time zone, tenant_id text, tenant_status text, principal_id text, principal_status text, membership_status text, token_kind text, roles text[])",
      owner: "open_loops_owner",
      language: "sql",
      securityDefiner: true,
      volatility: "v",
      parallel: "u",
      returnsSet: true,
      source: "SELECT * FROM public.open_loops_authenticate_key(p_kid, p_token_hash);",
      acl: [
        "open_loops_authenticator:EXECUTE:f",
        "open_loops_owner:EXECUTE:f",
      ],
    },
    loops_append_auth_audit: {
      args:
        "p_id text, p_kid text, p_token_hash text, p_request_id text, p_operation_id text, p_decision text, p_deny_reason text, p_metadata jsonb",
      result: "void",
      owner: "open_loops_owner",
      language: "sql",
      securityDefiner: true,
      volatility: "v",
      parallel: "u",
      returnsSet: false,
      source: `
        SELECT public.open_loops_append_auth_audit(
          p_id, p_kid, p_token_hash, p_request_id,
          p_operation_id, p_decision, p_deny_reason, p_metadata
        );
      `,
      acl: [
        "open_loops_authenticator:EXECUTE:f",
        "open_loops_owner:EXECUTE:f",
      ],
    },
  });

function sameCatalogValues(actual: readonly string[] | null, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

/**
 * Migration 0013 is a forward-only identity boundary. Before its physical
 * ledger row exists, none of the canonical aliases are required. Once the row
 * exists, every alias is part of readiness and catalog drift fails closed.
 */
export async function isCanonicalIdentityAliasStateSafe(client: TypedQueryClient): Promise<boolean> {
  const ledger = await client.get<{ identity_recorded: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM public.open_loops_schema_migrations
        WHERE id=$1
     ) AS identity_recorded`,
    [LOOPS_IDENTITY_MIGRATION_ID],
  );
  if (!ledger?.identity_recorded) return true;

  const view = await client.get<{
    owner: string;
    kind: string;
    options: string[] | null;
    definition: string;
    columns: string[];
    acl: string[];
    trigger_count: number;
    trigger_definition: string | null;
    trigger_enabled: string | null;
  }>(`
    SELECT pg_get_userbyid(canonical.relowner) AS owner,
           canonical.relkind AS kind,
           canonical.reloptions AS options,
           pg_get_viewdef(canonical.oid, true) AS definition,
           ARRAY(
             SELECT attribute.attname || ':' || format_type(attribute.atttypid, attribute.atttypmod)
               FROM pg_attribute attribute
              WHERE attribute.attrelid=canonical.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
              ORDER BY attribute.attnum
           ) AS columns,
           ARRAY(
             SELECT concat(
               CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
               ':', acl.privilege_type, ':', acl.is_grantable
             )
               FROM aclexplode(COALESCE(canonical.relacl, acldefault('r', canonical.relowner))) acl
              ORDER BY 1
           ) AS acl,
           (
             SELECT count(*)::int
               FROM pg_trigger trigger
              WHERE trigger.tgrelid='public.tenants'::regclass
                AND trigger.tgname='loops_reject_runtime_tenant_update'
                AND NOT trigger.tgisinternal
           ) AS trigger_count,
           (
             SELECT pg_get_triggerdef(trigger.oid, true)
               FROM pg_trigger trigger
              WHERE trigger.tgrelid='public.tenants'::regclass
                AND trigger.tgname='loops_reject_runtime_tenant_update'
                AND NOT trigger.tgisinternal
           ) AS trigger_definition,
           (
             SELECT trigger.tgenabled::text
               FROM pg_trigger trigger
              WHERE trigger.tgrelid='public.tenants'::regclass
                AND trigger.tgname='loops_reject_runtime_tenant_update'
                AND NOT trigger.tgisinternal
           ) AS trigger_enabled
      FROM pg_class canonical
     WHERE canonical.oid=to_regclass('public.loops_schema_migrations')
  `);
  if (
    !view ||
    view.owner !== "open_loops_migrator" ||
    view.kind !== "v" ||
    (view.options?.length ?? 0) !== 0 ||
    normalizedCatalogSql(view.definition) !==
      "SELECT id, checksum, applied_at FROM open_loops_schema_migrations;" ||
    !sameCatalogValues(view.columns, [
      "id:text",
      "checksum:text",
      "applied_at:timestamp with time zone",
    ]) ||
    !sameCatalogValues(view.acl, [
      "open_loops_migrator:DELETE:f",
      "open_loops_migrator:INSERT:f",
      "open_loops_migrator:REFERENCES:f",
      "open_loops_migrator:SELECT:f",
      "open_loops_migrator:TRIGGER:f",
      "open_loops_migrator:TRUNCATE:f",
      "open_loops_migrator:UPDATE:f",
      "open_loops_runtime:SELECT:f",
    ]) ||
    view.trigger_count !== 1 ||
    view.trigger_enabled !== "O" ||
    normalizedCatalogSql(view.trigger_definition ?? "") !==
      "CREATE TRIGGER loops_reject_runtime_tenant_update BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION loops_reject_runtime_tenant_update()"
  ) {
    return false;
  }

  const functions = await client.many<CanonicalIdentityFunctionState>(`
    SELECT proc.proname AS name,
           pg_get_function_identity_arguments(proc.oid) AS args,
           pg_get_function_result(proc.oid) AS result,
           pg_get_userbyid(proc.proowner) AS owner,
           language.lanname AS language,
           proc.prosecdef AS security_definer,
           proc.provolatile AS volatility,
           proc.proparallel AS parallel,
           proc.prokind AS kind,
           proc.proretset AS returns_set,
           proc.proisstrict AS is_strict,
           proc.proleakproof AS is_leakproof,
           proc.proconfig AS config,
           proc.prosrc AS source,
           pg_get_functiondef(proc.oid) AS definition,
           ARRAY(
             SELECT concat(
               CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
               ':', acl.privilege_type, ':', acl.is_grantable
             )
               FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
              ORDER BY 1
           ) AS acl
      FROM pg_proc proc
      JOIN pg_language language ON language.oid=proc.prolang
     WHERE proc.oid IN (
       to_regprocedure('public.loops_current_tenant_id()'),
       to_regprocedure('public.loops_reject_runtime_tenant_update()'),
       to_regprocedure('public.loops_authenticate_key(text,text)'),
       to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)')
     )
     ORDER BY proc.proname
  `);
  if (functions.length !== Object.keys(CANONICAL_IDENTITY_FUNCTIONS).length) return false;
  for (const state of functions) {
    const expected = CANONICAL_IDENTITY_FUNCTIONS[state.name];
    if (
      !expected ||
      state.args !== expected.args ||
      state.result !== expected.result ||
      state.owner !== expected.owner ||
      state.language !== expected.language ||
      state.security_definer !== expected.securityDefiner ||
      state.volatility !== expected.volatility ||
      state.parallel !== expected.parallel ||
      state.kind !== "f" ||
      state.returns_set !== expected.returnsSet ||
      state.is_strict ||
      state.is_leakproof ||
      !sameCatalogValues(state.config, ["search_path=pg_catalog"]) ||
      !sameCatalogValues(state.acl, expected.acl) ||
      (expected.source !== undefined &&
        normalizedCatalogSql(state.source) !== normalizedCatalogSql(expected.source)) ||
      (expected.definitionFragment !== undefined &&
        !normalizedCatalogSql(state.definition).includes(expected.definitionFragment))
    ) {
      return false;
    }
  }

  const parity = await client.get<{ rows_and_checksums_equal: boolean }>(`
    SELECT NOT EXISTS (
      (SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations
       EXCEPT
       SELECT id, checksum, applied_at FROM public.loops_schema_migrations)
      UNION ALL
      (SELECT id, checksum, applied_at FROM public.loops_schema_migrations
       EXCEPT
       SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations)
    ) AS rows_and_checksums_equal
  `);
  return parity?.rows_and_checksums_equal === true;
}

export async function isSafeServiceConnection(
  client: TypedQueryClient,
  expectedRole: ServiceDatabaseRole,
): Promise<boolean> {
  if (
    expectedRole === "open_loops_runtime" &&
    !await isCanonicalIdentityAliasStateSafe(client)
  ) {
    return false;
  }
  const forbiddenRole = expectedRole === "open_loops_runtime"
    ? "open_loops_authenticator"
    : "open_loops_runtime";
  const row = await client.get<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    expected_member: boolean;
    expected_usage: boolean;
    expected_direct: boolean;
    expected_role_has_memberships: boolean;
    expected_role_safe: boolean;
    unexpected_membership: boolean;
    has_members: boolean;
    forbidden_member: boolean;
    owner_member: boolean;
    migrator_member: boolean;
    required_database_privileges: boolean;
    database_acl_safe: boolean;
    required_schema_privileges: boolean;
    required_table_privileges: boolean;
    forbidden_table_privileges: boolean;
    forbidden_column_privileges: boolean;
    forbidden_sequence_privileges: boolean;
    required_function_privileges: boolean;
    required_function_security: boolean;
    forbidden_function_privileges: boolean;
    forbidden_grant_options: boolean;
  }>(
    `SELECT role.rolcanlogin, role.rolinherit, role.rolsuper, role.rolcreatedb, role.rolcreaterole,
            role.rolreplication, role.rolbypassrls,
            pg_has_role(role.oid, $1, 'MEMBER') AS expected_member,
            pg_has_role(role.oid, $1, 'USAGE') AS expected_usage,
            EXISTS (
              SELECT 1 FROM pg_auth_members direct
               JOIN pg_roles granted ON granted.oid=direct.roleid
              WHERE direct.member=role.oid AND granted.rolname=$1
                AND NOT direct.admin_option AND direct.inherit_option AND direct.set_option
            ) AS expected_direct,
            EXISTS (
              SELECT 1
                FROM pg_auth_members membership
                JOIN pg_roles member ON member.oid=membership.member
               WHERE member.rolname=$1
            ) AS expected_role_has_memberships,
            EXISTS (
              SELECT 1
                FROM pg_roles expected
               WHERE expected.rolname=$1
                 AND NOT expected.rolcanlogin
                 AND expected.rolinherit
                 AND NOT expected.rolsuper
                 AND NOT expected.rolcreatedb
                 AND NOT expected.rolcreaterole
                 AND NOT expected.rolreplication
                 AND NOT expected.rolbypassrls
            ) AS expected_role_safe,
            EXISTS (
              SELECT 1 FROM pg_auth_members other
               JOIN pg_roles granted ON granted.oid=other.roleid
              WHERE other.member=role.oid AND granted.rolname<>$1
            ) AS unexpected_membership,
            EXISTS (SELECT 1 FROM pg_auth_members child WHERE child.roleid=role.oid) AS has_members,
            pg_has_role(role.oid, $2, 'MEMBER') AS forbidden_member,
            pg_has_role(role.oid, 'open_loops_owner', 'MEMBER') AS owner_member,
            pg_has_role(role.oid, 'open_loops_migrator', 'MEMBER') AS migrator_member,
            has_database_privilege(session_user, current_database(), 'CONNECT')
              AND NOT has_database_privilege(session_user, current_database(), 'CREATE')
              AND NOT has_database_privilege(session_user, current_database(), 'TEMPORARY')
              AND EXISTS (
                SELECT 1
                  FROM pg_database database
                  CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
                 WHERE database.datname=current_database()
                   AND acl.grantee=role.oid
                   AND acl.privilege_type='CONNECT'
                   AND NOT acl.is_grantable
              ) AS required_database_privileges,
            NOT EXISTS (
              SELECT 1
                FROM pg_database database
                CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
                LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
               WHERE database.datname=current_database()
                 AND acl.grantee<>database.datdba
                 AND (
                   acl.grantee=0
                   OR grantee.oid IS NULL
                   OR NOT (
                     grantee.rolcanlogin
                     AND grantee.rolinherit
                     AND NOT grantee.rolsuper
                     AND NOT grantee.rolcreatedb
                     AND NOT grantee.rolcreaterole
                     AND NOT grantee.rolreplication
                     AND NOT grantee.rolbypassrls
                     AND acl.privilege_type='CONNECT'
                     AND NOT acl.is_grantable
                     AND EXISTS (
                       SELECT 1
                         FROM pg_auth_members direct
                         JOIN pg_roles granted ON granted.oid=direct.roleid
                        WHERE direct.member=grantee.oid
                          AND granted.rolname IN ('open_loops_runtime', 'open_loops_authenticator')
                          AND NOT direct.admin_option
                          AND direct.inherit_option
                          AND direct.set_option
                     )
                     AND (SELECT count(*) FROM pg_auth_members membership WHERE membership.member=grantee.oid)=1
                     AND NOT EXISTS (
                       SELECT 1
                         FROM pg_auth_members membership
                         JOIN pg_roles granted ON granted.oid=membership.roleid
                        WHERE membership.member=grantee.oid
                          AND granted.rolname NOT IN ('open_loops_runtime', 'open_loops_authenticator')
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM pg_auth_members downstream WHERE downstream.roleid=grantee.oid
                     )
                   )
                 )
            ) AS database_acl_safe,
            has_schema_privilege(session_user, 'public', 'USAGE')
              AND NOT has_schema_privilege(session_user, 'public', 'CREATE')
              AND NOT EXISTS (
                SELECT 1
                  FROM pg_namespace namespace
                 WHERE namespace.nspname <> 'public'
                   AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND namespace.nspname NOT LIKE 'pg_toast%'
                   AND namespace.nspname NOT LIKE 'pg_temp_%'
                   AND has_schema_privilege(session_user, namespace.oid, 'USAGE, CREATE')
              ) AS required_schema_privileges,
            CASE WHEN $1 = 'open_loops_runtime' THEN
              NOT EXISTS (
                SELECT 1
                  FROM unnest(ARRAY[
                    'public.loops', 'public.loop_runs', 'public.daemon_lease',
                    'public.workflow_specs', 'public.workflow_runs', 'public.workflow_invocations',
                    'public.workflow_work_items', 'public.workflow_step_runs', 'public.workflow_events',
                    'public.goals', 'public.goal_plan_nodes', 'public.goal_runs',
                    'public.runner_machines', 'public.runner_leases', 'public.run_receipts'
                  ]) AS required_table(name)
                  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS required_privilege(name)
                 WHERE NOT has_table_privilege(session_user, required_table.name, required_privilege.name)
              ) AND has_table_privilege(session_user, 'public.tenants', 'SELECT')
                AND has_table_privilege(session_user, 'public.tenants', 'UPDATE')
                AND has_table_privilege(session_user, 'public.tenants', 'REFERENCES')
                AND has_column_privilege(session_user, 'public.tenants', 'id', 'UPDATE')
                AND has_table_privilege(session_user, 'public.open_loops_schema_migrations', 'SELECT')
            ELSE true END AS required_table_privileges,
            CASE WHEN $1 = 'open_loops_runtime' THEN
              NOT EXISTS (
                SELECT 1
                  FROM pg_class object
                 JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
                 WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND namespace.nspname NOT LIKE 'pg_toast%'
                   AND namespace.nspname NOT LIKE 'pg_temp_%'
                   AND object.relkind IN ('r', 'p', 'v', 'm', 'f')
                   AND has_table_privilege(session_user, object.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                   AND NOT (
                     namespace.nspname = 'public'
                     AND object.relname = ANY(ARRAY[
                       'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
                       'workflow_invocations', 'workflow_work_items', 'workflow_step_runs',
                       'workflow_events', 'goals', 'goal_plan_nodes', 'goal_runs',
                       'runner_machines', 'runner_leases', 'run_receipts',
                       'open_loops_schema_migrations', 'loops_schema_migrations'
                     ])
                   )
                   AND NOT (
                     namespace.nspname = 'public'
                     AND object.relname = 'tenants'
                     AND has_table_privilege(session_user, object.oid, 'SELECT')
                     AND has_table_privilege(session_user, object.oid, 'UPDATE')
                     AND has_table_privilege(session_user, object.oid, 'REFERENCES')
                     AND NOT has_table_privilege(session_user, object.oid, 'INSERT, DELETE, TRUNCATE, TRIGGER')
                   )
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM unnest(ARRAY[
                    'public.loops', 'public.loop_runs', 'public.daemon_lease',
                    'public.workflow_specs', 'public.workflow_runs', 'public.workflow_invocations',
                    'public.workflow_work_items', 'public.workflow_step_runs', 'public.workflow_events',
                    'public.goals', 'public.goal_plan_nodes', 'public.goal_runs',
                    'public.runner_machines', 'public.runner_leases', 'public.run_receipts',
                    'public.open_loops_schema_migrations'
                  ]) AS protected_table(name)
                  CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS forbidden_privilege(name)
                 WHERE has_table_privilege(session_user, protected_table.name, forbidden_privilege.name)
              )
              AND NOT has_table_privilege(session_user, 'public.open_loops_schema_migrations', 'INSERT')
              AND NOT has_table_privilege(session_user, 'public.open_loops_schema_migrations', 'UPDATE')
              AND NOT has_table_privilege(session_user, 'public.open_loops_schema_migrations', 'DELETE')
            ELSE
              NOT EXISTS (
                SELECT 1
                  FROM pg_class object
                  JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
                 WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND namespace.nspname NOT LIKE 'pg_toast%'
                   AND namespace.nspname NOT LIKE 'pg_temp_%'
                   AND object.relkind IN ('r', 'p', 'v', 'm', 'f')
                   AND has_table_privilege(session_user, object.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
              )
            END AS forbidden_table_privileges,
            CASE WHEN $1 = 'open_loops_runtime' THEN
              NOT EXISTS (
                SELECT 1
                  FROM pg_class object
                  JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
                  JOIN pg_attribute attribute ON attribute.attrelid=object.oid
                  CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
                  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
                 WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND namespace.nspname NOT LIKE 'pg_toast%'
                   AND namespace.nspname NOT LIKE 'pg_temp_%'
                   AND object.relkind IN ('r', 'p')
                   AND attribute.attnum > 0
                   AND NOT attribute.attisdropped
                   AND acl.privilege_type IS NOT NULL
                   AND (acl.grantee = 0 OR pg_has_role(session_user, acl.grantee, 'USAGE'))
              )
            ELSE
              NOT EXISTS (
                SELECT 1
                  FROM pg_class object
                  JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
                  JOIN pg_attribute attribute ON attribute.attrelid=object.oid
                  CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
                 WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND namespace.nspname NOT LIKE 'pg_toast%'
                   AND namespace.nspname NOT LIKE 'pg_temp_%'
                   AND object.relkind IN ('r', 'p')
                   AND attribute.attnum > 0
                   AND NOT attribute.attisdropped
                   AND acl.privilege_type IS NOT NULL
                   AND (acl.grantee = 0 OR pg_has_role(session_user, acl.grantee, 'USAGE'))
              )
            END AS forbidden_column_privileges,
            NOT EXISTS (
              SELECT 1
                FROM pg_class sequence
                JOIN pg_namespace namespace ON namespace.oid=sequence.relnamespace
               WHERE sequence.relkind='S'
                 AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                 AND namespace.nspname NOT LIKE 'pg_toast%'
                 AND namespace.nspname NOT LIKE 'pg_temp_%'
                 AND has_sequence_privilege(session_user, sequence.oid, 'USAGE, SELECT, UPDATE')
            ) AS forbidden_sequence_privileges,
            CASE WHEN $1 = 'open_loops_runtime' THEN
              has_function_privilege(session_user, 'public.open_loops_current_tenant_id()', 'EXECUTE')
            ELSE
              has_function_privilege(session_user, 'public.open_loops_authenticate_key(text,text)', 'EXECUTE')
              AND has_function_privilege(
                session_user,
                'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)',
                'EXECUTE'
              )
            END AS required_function_privileges,
            NOT EXISTS (
              SELECT 1
                FROM pg_proc function
               WHERE (
                 function.oid = ANY(ARRAY[
                   to_regprocedure('public.loops_current_tenant_id()'),
                   'public.open_loops_current_tenant_id()'::regprocedure
                 ])
                 AND $1='open_loops_runtime'
                 AND (
                   pg_get_userbyid(function.proowner)<>'open_loops_owner'
                   OR function.prosecdef
                   OR function.provolatile<>'s'
                   OR function.proparallel<>'s'
                   OR NOT COALESCE(function.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']
                 )
               ) OR (
                 function.oid = ANY(ARRAY[
                   to_regprocedure('public.loops_authenticate_key(text,text)'),
                   to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'),
                   'public.open_loops_authenticate_key(text,text)'::regprocedure,
                   'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'::regprocedure
                 ])
                 AND $1='open_loops_authenticator'
                 AND (
                   pg_get_userbyid(function.proowner)<>'open_loops_owner'
                   OR NOT function.prosecdef
                   OR NOT COALESCE(function.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']
                 )
               )
            ) AS required_function_security,
            NOT EXISTS (
              SELECT 1
                FROM pg_proc function
                JOIN pg_namespace namespace ON namespace.oid=function.pronamespace
               WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                 AND namespace.nspname NOT LIKE 'pg_toast%'
                 AND namespace.nspname NOT LIKE 'pg_temp_%'
                 AND has_function_privilege(session_user, function.oid, 'EXECUTE')
                 AND NOT (
                   namespace.nspname='public'
                   AND (
                     ($1='open_loops_runtime'
                       AND function.oid = ANY(ARRAY[
                         to_regprocedure('public.loops_current_tenant_id()'),
                         'public.open_loops_current_tenant_id()'::regprocedure
                       ]))
                     OR
                     ($1='open_loops_authenticator'
                       AND function.oid = ANY(ARRAY[
                         to_regprocedure('public.loops_authenticate_key(text,text)'),
                         to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'),
                         'public.open_loops_authenticate_key(text,text)'::regprocedure,
                         'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'::regprocedure
                       ]))
                   )
                 )
            ) AS forbidden_function_privileges,
            NOT has_database_privilege(session_user, current_database(), 'CONNECT WITH GRANT OPTION')
              AND NOT has_schema_privilege(session_user, 'public', 'USAGE WITH GRANT OPTION')
              AND NOT EXISTS (
                SELECT 1
                  FROM unnest(ARRAY[
                    'public.loops', 'public.loop_runs', 'public.daemon_lease',
                    'public.workflow_specs', 'public.workflow_runs', 'public.workflow_invocations',
                    'public.workflow_work_items', 'public.workflow_step_runs', 'public.workflow_events',
                    'public.goals', 'public.goal_plan_nodes', 'public.goal_runs',
                    'public.runner_machines', 'public.runner_leases', 'public.run_receipts'
                  ]) AS allowed_table(name)
                  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS allowed_privilege(name)
                 WHERE has_table_privilege(
                   session_user,
                   allowed_table.name,
                   allowed_privilege.name || ' WITH GRANT OPTION'
                 )
              )
              AND NOT has_table_privilege(
                session_user,
                'public.open_loops_schema_migrations',
                'SELECT WITH GRANT OPTION'
              )
              AND (
                to_regclass('public.loops_schema_migrations') IS NULL
                OR NOT has_table_privilege(
                  session_user,
                  to_regclass('public.loops_schema_migrations'),
                  'SELECT WITH GRANT OPTION'
                )
              )
              AND NOT has_table_privilege(
                session_user,
                'public.tenants',
                'REFERENCES WITH GRANT OPTION'
              )
              AND NOT has_table_privilege(
                session_user,
                'public.tenants',
                'SELECT WITH GRANT OPTION'
              )
              AND NOT has_table_privilege(
                session_user,
                'public.tenants',
                'UPDATE WITH GRANT OPTION'
              )
              AND NOT has_column_privilege(
                session_user,
                'public.tenants',
                'id',
                'UPDATE WITH GRANT OPTION'
              )
              AND (
                to_regprocedure('public.loops_current_tenant_id()') IS NULL
                OR NOT has_function_privilege(
                  session_user,
                  to_regprocedure('public.loops_current_tenant_id()'),
                  'EXECUTE WITH GRANT OPTION'
                )
              )
              AND (
                to_regprocedure('public.loops_authenticate_key(text,text)') IS NULL
                OR NOT has_function_privilege(
                  session_user,
                  to_regprocedure('public.loops_authenticate_key(text,text)'),
                  'EXECUTE WITH GRANT OPTION'
                )
              )
              AND (
                to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)') IS NULL
                OR NOT has_function_privilege(
                  session_user,
                  to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'),
                  'EXECUTE WITH GRANT OPTION'
                )
              )
              AND NOT has_function_privilege(
                session_user,
                'public.open_loops_current_tenant_id()',
                'EXECUTE WITH GRANT OPTION'
              )
              AND NOT has_function_privilege(
                session_user,
                'public.open_loops_authenticate_key(text,text)',
                'EXECUTE WITH GRANT OPTION'
              )
              AND NOT has_function_privilege(
                session_user,
                'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)',
                'EXECUTE WITH GRANT OPTION'
              ) AS forbidden_grant_options
       FROM pg_roles role
      WHERE role.rolname = session_user`,
    [expectedRole, forbiddenRole],
  );
  const rolePrivilegesSafe = Boolean(
    row?.rolcanlogin && row.rolinherit && row.expected_member && row.expected_usage && row.expected_direct &&
    !row.expected_role_has_memberships && row.expected_role_safe &&
    !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole &&
    !row.rolreplication && !row.rolbypassrls &&
    !row.unexpected_membership && !row.has_members &&
    !row.forbidden_member && !row.owner_member && !row.migrator_member &&
    row.required_database_privileges && row.database_acl_safe && row.required_schema_privileges &&
    row.required_table_privileges && row.forbidden_table_privileges &&
    row.forbidden_column_privileges &&
    row.forbidden_sequence_privileges &&
    row.required_function_privileges && row.required_function_security && row.forbidden_function_privileges &&
    row.forbidden_grant_options,
  );
  if (!rolePrivilegesSafe) return false;
  return isTenantRlsInvariantSafe(client);
}

export async function isTenantRlsInvariantSafe(client: TypedQueryClient): Promise<boolean> {
  const row = await client.get<{ safe: boolean }>(
    `WITH protected(table_name, discriminator) AS (
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
    table_state AS (
      SELECT protected.table_name,
             class.oid AS relation_oid,
             pg_get_userbyid(class.relowner) AS owner_name,
             class.relrowsecurity,
             class.relforcerowsecurity
        FROM protected
        LEFT JOIN pg_class class ON class.oid = format('public.%I', protected.table_name)::regclass
    ),
    tenant_update_guard AS (
      SELECT
        COUNT(*) FILTER (
          WHERE trigger.tgname = 'open_loops_reject_runtime_tenant_update'
            AND proc.oid = 'public.open_loops_reject_runtime_tenant_update()'::regprocedure
        ) = 1 AS legacy_safe,
        to_regprocedure('public.loops_reject_runtime_tenant_update()') IS NULL
          OR COUNT(*) FILTER (
            WHERE trigger.tgname = 'loops_reject_runtime_tenant_update'
              AND proc.oid = to_regprocedure('public.loops_reject_runtime_tenant_update()')
          ) = 1 AS canonical_safe
        FROM pg_trigger trigger
        JOIN pg_proc proc ON proc.oid = trigger.tgfoid
       WHERE trigger.tgrelid = 'public.tenants'::regclass
         AND NOT trigger.tgisinternal
         AND trigger.tgenabled = 'O'
         AND pg_get_userbyid(proc.proowner) = 'open_loops_owner'
         AND NOT proc.prosecdef
         AND COALESCE(proc.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']
         AND proc.prosrc ILIKE '%pg_has_role%open_loops_runtime%USAGE%'
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
    bad_table AS (
      SELECT 1
        FROM table_state
       WHERE relation_oid IS NULL
          OR owner_name <> 'open_loops_owner'
          OR NOT relrowsecurity
          OR NOT relforcerowsecurity
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
              '(tenant_id = loops_current_tenant_id())',
              '(tenant_id = public.loops_current_tenant_id())',
              '(tenant_id = open_loops_current_tenant_id())',
              '(tenant_id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'id' THEN actual.qualifier = ANY(ARRAY[
              '(id = loops_current_tenant_id())',
              '(id = public.loops_current_tenant_id())',
              '(id = open_loops_current_tenant_id())',
              '(id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'true' THEN actual.qualifier = 'true'
            ELSE actual.qualifier = ''
          END
          OR NOT CASE expected.check_expr
            WHEN 'tenant_id' THEN actual.check_expr = ANY(ARRAY[
              '(tenant_id = loops_current_tenant_id())',
              '(tenant_id = public.loops_current_tenant_id())',
              '(tenant_id = open_loops_current_tenant_id())',
              '(tenant_id = public.open_loops_current_tenant_id())'
            ])
            WHEN 'id' THEN actual.check_expr = ANY(ARRAY[
              '(id = loops_current_tenant_id())',
              '(id = public.loops_current_tenant_id())',
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
    SELECT NOT EXISTS (SELECT 1 FROM bad_table)
       AND NOT EXISTS (SELECT 1 FROM missing_or_bad)
       AND NOT EXISTS (SELECT 1 FROM unexpected)
       AND COALESCE(
         (SELECT legacy_safe AND canonical_safe FROM tenant_update_guard),
         false
       ) AS safe`,
  );
  return row?.safe === true;
}

export async function assertTenantEnforcementBootstrap(client: PoolQueryClient): Promise<void> {
  let probeStage = "role inventory";
  const role = await client.get<{
    rolcreaterole: boolean;
    rolsuper: boolean;
    controls_database: boolean;
    controls_public_schema: boolean;
    controls_helper_functions: boolean;
    controls_existing_objects: boolean;
  }>(
    `SELECT login.rolcreaterole, login.rolsuper,
            EXISTS (
              SELECT 1
                FROM pg_database database
               WHERE database.datname=current_database()
                 AND (database.datdba=login.oid OR login.rolsuper)
            ) AS controls_database,
            EXISTS (
              SELECT 1 FROM pg_namespace namespace
               WHERE namespace.nspname='public'
                 AND pg_has_role(login.oid, namespace.nspowner, 'USAGE')
            ) AS controls_public_schema,
            NOT EXISTS (
              SELECT 1
                FROM pg_proc helper
               WHERE helper.oid = ANY(ARRAY[
                 to_regprocedure('public.loops_current_tenant_id()'),
                 to_regprocedure('public.loops_authenticate_key(text,text)'),
                 to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)'),
                 to_regprocedure('public.open_loops_current_tenant_id()'),
                 to_regprocedure('public.open_loops_authenticate_key(text,text)'),
                 to_regprocedure('public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)')
               ])
                 AND helper.proowner<>login.oid
                 AND NOT login.rolsuper
                 AND NOT pg_has_role(login.oid, helper.proowner, 'USAGE')
            ) AS controls_helper_functions,
            NOT EXISTS (
              SELECT 1
                FROM (
                  SELECT namespace.nspowner AS owner_oid
                    FROM pg_namespace namespace
                   WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND namespace.nspname NOT LIKE 'pg_toast%'
                     AND namespace.nspname NOT LIKE 'pg_temp_%'
                  UNION
                  SELECT relation.relowner
                    FROM pg_class relation
                    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
                   WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND namespace.nspname NOT LIKE 'pg_toast%'
                     AND namespace.nspname NOT LIKE 'pg_temp_%'
                     AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
                  UNION
                  SELECT function.proowner
                    FROM pg_proc function
                    JOIN pg_namespace namespace ON namespace.oid=function.pronamespace
                   WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND namespace.nspname NOT LIKE 'pg_toast%'
                     AND namespace.nspname NOT LIKE 'pg_temp_%'
                ) existing_owner
               WHERE existing_owner.owner_oid<>login.oid
                 AND NOT login.rolsuper
                 AND NOT pg_has_role(login.oid, existing_owner.owner_oid, 'USAGE')
            ) AS controls_existing_objects
       FROM pg_roles login
      WHERE login.rolname = session_user`,
  );
  if (!role || (!role.rolsuper && (
    !role.rolcreaterole ||
    !role.controls_database || !role.controls_public_schema ||
    !role.controls_helper_functions || !role.controls_existing_objects
  ))) {
    throw new Error(
      "tenant enforcement requires a database-owning bootstrap login with CREATEROLE and provider authority over every existing non-system schema, relation, function, and migration ledger owner; reassign legacy objects or grant exact owner-role membership before retrying",
    );
  }
  try {
    await client.transaction(async (transaction) => {
      await transaction.execute(POSTGRES_MIGRATION_ADVISORY_LOCK_SQL);
      await transaction.execute("SAVEPOINT open_loops_bootstrap_probe");
      try {
        probeStage = "role normalization";
        await transaction.execute(POSTGRES_TENANT_BOOTSTRAP_ROLES_SQL);
        probeStage = "cluster role exclusivity";
        await transaction.execute(POSTGRES_TENANT_CLUSTER_ROLE_EXCLUSIVITY_SQL);
        await transaction.execute(POSTGRES_TENANT_BOOTSTRAP_MEMBERSHIPS_SQL);
        probeStage = "service role memberships";
        await transaction.execute(POSTGRES_TENANT_SERVICE_ROLE_MEMBERSHIPS_SQL);
        probeStage = "privileged memberships";
        await transaction.execute(POSTGRES_TENANT_PRIVILEGED_MEMBERSHIPS_SQL);
        probeStage = "unsafe service memberships";
        await transaction.execute(POSTGRES_TENANT_UNSAFE_SERVICE_MEMBERSHIPS_SQL);
        probeStage = "owner schema grants";
        await transaction.execute("GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator");
        probeStage = "owner SET ROLE";
        await transaction.execute("SET LOCAL ROLE open_loops_owner");
        await transaction.execute("RESET ROLE");
        probeStage = "migration ledger ownership";
        await transaction.execute(`ALTER TABLE ${POSTGRES_MIGRATION_LEDGER_TABLE} OWNER TO open_loops_migrator`);
        await transaction.execute("SET LOCAL ROLE open_loops_migrator");
        await transaction.execute(
          `INSERT INTO ${POSTGRES_MIGRATION_LEDGER_TABLE} (id, checksum, applied_at) VALUES ('__open_loops_bootstrap_role_probe__', 'probe', NOW())`,
        );
        await transaction.execute("RESET ROLE");
        probeStage = "migration ledger inherited write";
        await transaction.execute(
          `INSERT INTO ${POSTGRES_MIGRATION_LEDGER_TABLE} (id, checksum, applied_at) VALUES ('__open_loops_bootstrap_session_probe__', 'probe', NOW())`,
        );
        probeStage = "database ACL";
        await transaction.execute(`
          DO $probe_database_acl$
          DECLARE probe_role TEXT := format('open_loops_bootstrap_probe_%s', pg_backend_pid());
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = probe_role) THEN
              RAISE EXCEPTION 'bootstrap probe role already exists';
            END IF;
            EXECUTE format('CREATE ROLE %I NOLOGIN', probe_role);
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), probe_role);
            IF NOT EXISTS (
              SELECT 1
                FROM pg_database database
                CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl
                JOIN pg_roles grantee ON grantee.oid = acl.grantee
               WHERE database.datname = current_database()
                 AND grantee.rolname = probe_role
                 AND acl.privilege_type = 'CONNECT'
            ) THEN
              RAISE EXCEPTION 'bootstrap login cannot grant direct database CONNECT';
            END IF;
          END
          $probe_database_acl$;
        `);
        probeStage = "service role ACL";
        await transaction.execute(`
          DO $probe_service_role_acl$
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
              EXECUTE format(
                'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
                current_database(),
                database_grantee.grantee_role
              );
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
          $probe_service_role_acl$;
        `);
        probeStage = "service login cleanup";
        await transaction.execute(POSTGRES_TENANT_SERVICE_MEMBER_CLEANUP_SQL);
      } finally {
        await transaction.execute("ROLLBACK TO SAVEPOINT open_loops_bootstrap_probe");
      }
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith("non-superuser tenant enforcement requires pre-provisioned owner/migrator memberships") ||
      error.message.startsWith("non-superuser tenant enforcement must run before runtime/authenticator service login memberships") ||
      error.message.startsWith("reserved OpenLoops database role") ||
      error.message.startsWith("reserved OpenLoops role") ||
      error.message.startsWith("unsafe privileged role membership") ||
      error.message.startsWith("unsafe service login membership")
    )) {
      throw error;
    }
    throw new Error(
      `tenant enforcement bootstrap login lacks provider-level authority during ${probeStage}`,
    );
  }
}

export async function assertTenantEnforcementBootstrapIfPending(
  client: PoolQueryClient,
  schema: PostgresStorage,
): Promise<void> {
  let preview;
  try {
    preview = await schema.migrate({ dryRun: true });
  } catch (error) {
    if (!isPostgresInsufficientPrivilege(error)) throw error;
    await assertTenantEnforcementBootstrap(client);
    throw new Error(
      "tenant enforcement migration ledger remains unreadable after the authority probe; reassign the ledger and all legacy Loops objects to a role the bootstrap login can SET before retrying",
    );
  }
  if (preview.plan.some((item) =>
    item.migration.id === TENANT_ENFORCEMENT_MIGRATION_ID && item.state === "pending")) {
    await assertTenantEnforcementBootstrap(client);
  }
}

function isPostgresInsufficientPrivilege(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "42501";
}

async function runServe(opts: { host: string; port: number }): Promise<void> {
  {
    const executor = buildExecutor("loops-serve", "runtime");
    const authExecutor = buildExecutor("loops-auth", "auth");
    const schema = new PostgresStorage(executor);

    const signingSecret = resolveSigningSecret();
    const authenticator = signingSecret ? new TenantApiAuthenticator(authExecutor.queryClient, signingSecret) : undefined;
    if (!authenticator) {
      throw new Error(
        "loops-serve requires HASNA_LOOPS_API_SIGNING_KEY",
      );
    }

    const server = createLoopsApiServer({
      host: opts.host,
      port: opts.port,
      authenticator,
      withTenantStorage: (principal, fn) =>
        executor.withRequestContext(principal, (transactionClient) =>
          fn(createPostgresLoopStorage(transactionClient, principal, { contextAlreadyBound: true }))),
      readyCheck: async () => {
        try {
          const result = await schema.migrate({ dryRun: true });
          const applied = result.applied;
          const known = new Set(schema.migrations.map((m) => m.id));
          const missing = schema.migrations.filter((m) => !applied.some((a) => a.id === m.id)).map((m) => m.id);
          const unknown = applied.filter((a) => !known.has(a.id)).map((a) => a.id);
          if (missing.length) return { ready: false, code: "pending_migrations" };
          if (unknown.length) return { ready: false, code: "unknown_migrations" };
        } catch (error) {
          return { ready: false, code: classifyMigrationReadinessError(error) };
        }
        try {
          if (!await isSafeServiceConnection(executor.queryClient, "open_loops_runtime")) {
            return { ready: false, code: "unsafe_database_role" };
          }
        } catch {
          return { ready: false, code: "storage_unreachable" };
        }
        try {
          if (!await isSafeServiceConnection(authExecutor.queryClient, "open_loops_authenticator")) {
            return { ready: false, code: "unsafe_database_role" };
          }
        } catch {
          return { ready: false, code: "auth_unreachable" };
        }
        return { ready: true };
      },
    });
    console.log(
      JSON.stringify({
        evt: "loops_serve_listening",
        url: `http://${server.hostname}:${server.port}`,
        auth: "api_key",
        version: packageVersion(),
      }),
    );
  }
}

const program = new Command();
program
  .name("loops-serve")
  .description("Loops self-hosted HTTP control-plane (RDS-direct, API-key auth)")
  .version(packageVersion());

program
  .command("serve")
  .description("serve the control-plane API (GET /health,/ready,/version + /v1)")
  .option("--host <host>", "bind host", defaultHost())
  .option("--port <port>", "bind port", (v) => Number(v), defaultPort())
  .action((opts: { host: string; port: number }) => runServe(opts));

program
  .command("migrate")
  .description("prepare tenant schema, or explicitly enforce a loaded tenant mapping")
  .option("--dry-run", "preview the migration plan without applying")
  .option("--enforce-tenancy", "apply the explicit backfill and hard tenant/RLS enforcement")
  .action(async (opts: { dryRun?: boolean; enforceTenancy?: boolean }) => {
    const executor = buildExecutor("loops-migrate", "migrator");
    try {
      const schema = new PostgresStorage(executor);
      if (opts.enforceTenancy) await assertTenantEnforcementBootstrapIfPending(executor.queryClient, schema);
      const result = await schema.migrate({
        dryRun: Boolean(opts.dryRun),
        through: opts.enforceTenancy ? undefined : "0008_tenant_prepare",
      });
      const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
      console.log(JSON.stringify({ evt: "migrate", dryRun: result.dryRun, applied: result.applied.map((a) => a.id), pending }));
    } finally {
      await executor.close();
    }
  });

program
  .command("tenant-backfill")
  .description("load an explicit tenant/principal/key/row mapping bundle after migration 0008")
  .requiredOption("--input <path>", "tenant backfill JSON bundle")
  .action(async (opts: { input: string }) => {
    const executor = buildExecutor("loops-tenant-backfill", "migrator");
    try {
      const bundle = parseTenantBackfillBundle(await Bun.file(opts.input).json());
      const result = await loadTenantBackfillBundle(executor.queryClient, bundle);
      console.log(JSON.stringify({ evt: "tenant_backfill_loaded", ...result }));
    } finally {
      await executor.close();
    }
  });

program
  .command("tenant-backfill-s3")
  .description("load the single approved tenant backfill bundle from S3 using the ECS task role")
  .action(async () => {
    const executor = buildExecutor("loops-tenant-backfill-s3", "migrator");
    let result: Awaited<ReturnType<typeof loadApprovedTenantBackfillBundle>>;
    try {
      result = await loadApprovedTenantBackfillBundle(executor.queryClient, {
        bucket: process.env.HASNA_LOOPS_BACKFILL_BUCKET?.trim() ?? "",
        region: process.env.AWS_REGION?.trim() ?? "",
        credentialsRelativeUri: process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim() ?? "",
      });
    } finally {
      try {
        await executor.close();
      } catch {
        throw new Error("tenant backfill database cleanup failed");
      }
    }
    logTenantBackfillS3Success(result);
  });

const dbCredentials = program
  .command("db-credentials")
  .description("reconcile provider-managed database credential secrets");

dbCredentials
  .command("reconcile")
  .description("rotate and verify provider-managed RDS app credentials")
  .action(async () => {
    const result = await reconcileProviderCredentials(resolveProviderCredentialOptions(), {
      bootstrapProbe: assertTenantEnforcementBootstrapIfPending,
    });
    logProviderCredentialSuccess(result);
  });

program
  .command("shared-to-dedicated-transfer")
  .description("run the fixed shared apps DB to dedicated loops DB logical transfer inside the protected ECS task")
  .action(async () => {
    const result = await runSharedToDedicatedTransfer();
    console.log(JSON.stringify({ evt: "shared_to_dedicated_transfer", ...result }));
  });

program
  .command("version")
  .description("print { status, version, mode }")
  .action(() => console.log(JSON.stringify({ status: "ok", version: packageVersion(), mode: "self_hosted" })));

if (import.meta.main) {
  // Bare `loops-serve` (no subcommand) defaults to `serve`. Commander cannot
  // combine a root action with subcommand dispatch without swallowing the
  // subcommand name, so we inject the default subcommand here instead.
  const known = new Set([
    "serve",
    "migrate",
    "tenant-backfill",
    "tenant-backfill-s3",
    "db-credentials",
    "shared-to-dedicated-transfer",
    "version",
    "help",
  ]);
  const passthroughFlags = new Set(["-h", "--help", "-V", "--version"]);
  const argv = [...process.argv];
  const firstArg = argv[2];
  // Bare invocation, or leading serve flags, default to `serve`; but let
  // top-level --help/--version reach the program.
  if (!firstArg || (!known.has(firstArg) && !passthroughFlags.has(firstArg))) {
    argv.splice(2, 0, "serve");
  }
  program.parseAsync(argv).catch((error) => {
    logServeCommandFailure(error);
    process.exit(1);
  });
}

export function logServeCommandFailure(error: unknown): void {
  const gate = classifyTenantEnforcementGate(error);
  console.error(JSON.stringify({
    evt: "loops_serve_command_failed",
    errorType: error instanceof Error ? "error" : typeof error,
    ...(gate ?? {}),
  }));
}

export function classifyTenantEnforcementGate(
  error: unknown,
): { gate: string; action: string } | undefined {
  if (!(error instanceof Error)) return undefined;
  const message = error.message;
  if (message.startsWith("tenant enforcement requires a database-owning bootstrap login")) {
    return {
      gate: "legacy_object_ownership",
      action: "reassign every non-system database object to the bootstrap login or an exact SETtable owner role",
    };
  }
  if (message.startsWith("reserved OpenLoops database role")) {
    return {
      gate: "reserved_role_is_login",
      action: "detach or replace the credential bound to the reserved NOLOGIN role with provider authority",
    };
  }
  if (message.startsWith("reserved OpenLoops role")) {
    return {
      gate: "cross_database_role_dependency",
      action: "remove the cross-database dependency or use an isolated Loops cluster",
    };
  }
  if (message.startsWith("unsafe privileged role membership")) {
    return {
      gate: "privileged_membership_cleanup",
      action: "remove the membership with its original grantor or provider authority",
    };
  }
  if (message.startsWith("non-superuser tenant enforcement requires pre-provisioned")) {
    return {
      gate: "bootstrap_membership_contract",
      action: "provision only owner and migrator memberships with ADMIN FALSE INHERIT TRUE SET TRUE",
    };
  }
  if (message.startsWith("non-superuser tenant enforcement must run before")) {
    return {
      gate: "service_membership_order",
      action: "detach runtime and authenticator LOGIN memberships until tenant enforcement succeeds",
    };
  }
  if (message.startsWith("unsafe service login membership")) {
    return {
      gate: "unsafe_service_membership",
      action: "normalize the service LOGIN with provider authority before tenant enforcement",
    };
  }
  if (message.startsWith("tenant enforcement migration ledger remains unreadable")) {
    return {
      gate: "migration_ledger_ownership",
      action: "reassign the ledger and legacy Loops objects to a role the bootstrap login can SET",
    };
  }
  const authorityStage = message.match(
    /^tenant enforcement bootstrap login lacks provider-level authority during ([a-z ]+)$/,
  )?.[1];
  if (authorityStage) {
    return {
      gate: `bootstrap_authority_${authorityStage.replaceAll(" ", "_")}`,
      action: "grant the named provider-level authority and rerun the dry-run probe",
    };
  }
  return undefined;
}

export { program };
