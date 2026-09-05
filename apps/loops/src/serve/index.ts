#!/usr/bin/env bun
// `loops-serve` — the HTTP control-plane binary (PostgreSQL-direct).
//
// The service reads and writes RDS/Postgres directly (PostgreSQL-direct). There is no
// local SQLite, no cache, and no sync engine in the
// serve process. Storage is the generated @hasna/contracts kit pool wrapping the
// real `PostgresLoopStorage` backend. Every authenticated request gets one
// dedicated transaction with tenant RLS context.
import { openSync, writeSync, closeSync, fchmodSync } from "node:fs";
import { hostname } from "node:os";
import { Command } from "commander";
import { createLoopsApiServer } from "../api/index.js";
import { TenantApiAuthenticator } from "../lib/auth/tenant-auth.js";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { BundleArtifactStorage } from "../lib/bundle/artifact-storage.js";
import { PgPoolExecutor } from "../lib/storage/pg-executor.js";
import { PostgresStorage } from "../lib/storage/postgres.js";
import { createPostgresLoopStorage } from "../lib/storage/postgres-loop-storage.js";
import { runRevisionBackfillCommand } from "../lib/storage/revision-backfill.js";
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
  RUNNER_KEY_DEFAULT_ROLES,
  RUNNER_KEY_DEFAULT_SCOPES,
  RUNNER_KEY_DEFAULT_TTL_SECONDS,
  provisionRunnerKey,
  type ProvisionRunnerKeyOutcome,
} from "../lib/storage/provision-runner-key.js";
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
import { runtimeStorage } from "../lib/runtime-config.js";

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
export type ServeReadinessFailureCode =
  | "storage_unreachable"
  | "migration_checksum_mismatch";

export function classifyMigrationReadinessError(error: unknown): ServeReadinessFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Postgres migration checksum mismatch")
    ? "migration_checksum_mismatch"
    : "storage_unreachable";
}

export async function isSafeServiceConnection(
  client: TypedQueryClient,
  expectedRole: ServiceDatabaseRole,
): Promise<boolean> {
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
                    'public.runner_machines', 'public.runner_leases', 'public.run_receipts',
                    'public.loop_mutation_leases'
                  ]) AS required_table(name)
                  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS required_privilege(name)
                 WHERE NOT has_table_privilege(session_user, required_table.name, required_privilege.name)
              ) AND has_table_privilege(session_user, 'public.tenants', 'SELECT')
                AND has_table_privilege(session_user, 'public.tenants', 'UPDATE')
                AND has_table_privilege(session_user, 'public.tenants', 'REFERENCES')
                AND has_column_privilege(session_user, 'public.tenants', 'id', 'UPDATE')
                AND has_table_privilege(session_user, 'public.open_loops_schema_migrations', 'SELECT')
                AND has_table_privilege(session_user, 'public.loop_mutation_operations', 'SELECT')
                AND has_table_privilege(session_user, 'public.loop_mutation_operations', 'INSERT')
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
                       'open_loops_schema_migrations',
                       'loop_mutation_operations', 'loop_mutation_leases'
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
                    'public.open_loops_schema_migrations',
                    'public.loop_mutation_operations', 'public.loop_mutation_leases'
                  ]) AS protected_table(name)
                  CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS forbidden_privilege(name)
                 WHERE has_table_privilege(session_user, protected_table.name, forbidden_privilege.name)
              )
              AND NOT has_table_privilege(session_user, 'public.loop_mutation_operations', 'UPDATE')
              AND NOT has_table_privilege(session_user, 'public.loop_mutation_operations', 'DELETE')
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
                 function.oid='public.open_loops_current_tenant_id()'::regprocedure
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
                       AND function.oid='public.open_loops_current_tenant_id()'::regprocedure)
                     OR
                     ($1='open_loops_authenticator'
                       AND function.oid = ANY(ARRAY[
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
                    'public.runner_machines', 'public.runner_leases', 'public.run_receipts',
                    'public.loop_mutation_leases'
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
                'public.loop_mutation_operations',
                'SELECT WITH GRANT OPTION'
              )
              AND NOT has_table_privilege(
                session_user,
                'public.loop_mutation_operations',
                'INSERT WITH GRANT OPTION'
              )
              AND NOT has_table_privilege(
                session_user,
                'public.open_loops_schema_migrations',
                'SELECT WITH GRANT OPTION'
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
        ('run_receipts', 'tenant_id'),
        ('loop_mutation_operations', 'tenant_id'),
        ('loop_mutation_leases', 'tenant_id')
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
    SELECT NOT EXISTS (SELECT 1 FROM bad_table)
       AND NOT EXISTS (SELECT 1 FROM missing_or_bad)
       AND NOT EXISTS (SELECT 1 FROM unexpected)
       AND EXISTS (SELECT 1 FROM tenant_update_guard) AS safe`,
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
  .description("Loops HTTP control-plane (PostgreSQL-direct, API-key auth)")
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

program
  .command("provision-runner-key")
  .description(
    "provision or confirm one machine runner principal + machine-kind API key (idempotent; token to --token-out file or --print-token, never logged)",
  )
  .option("--runner-id <id>", "runner principal id (default: container hostname; must equal the runner's machine id)")
  .option("--tenant-id <id>", "tenant id (default: env HASNA_LOOPS_TENANT_ID)")
  .option("--roles <csv>", "comma-separated membership roles (default: worker,service)")
  .option("--scope <csv>", "comma-separated key scopes (default: loops:runner)")
  .option("--ttl-seconds <n>", "key lifetime in seconds (default: 31536000 = 365 days)", (value) => Number(value))
  .option("--token-out <path>", "write the minted token to this file (mode 600) — required unless --print-token")
  .option("--print-token", "print the minted token to stdout after the JSON summary (explicit opt-in; never used otherwise)")
  .action((opts: ProvisionRunnerKeyCliOptions) => {
    void runProvisionRunnerKeyCommand(opts).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ evt: "loops_serve_command_failed", errorType: "error", message }));
      process.exitCode = 1;
    });
  });

// ---------------------------------------------------------------------------
// provision-runner-key — one repeatable path that mints a machine-kind runner
// token bound to a tenant + machine principal, so runner provisioning never
// depends on hand-minting at deploy time again. Idempotent: an existing active
// machine key for the runner is confirmed, never doubled. The minted token is
// delivered ONLY to an explicit destination (--token-out file, mode 600, or
// --print-token) and is never written to logs. stdout carries exactly
// { runnerId, kid, expiresAt }.
// ---------------------------------------------------------------------------

export interface ProvisionRunnerKeyCliOptions {
  runnerId?: string;
  tenantId?: string;
  roles?: string;
  scope?: string;
  ttlSeconds?: number;
  tokenOut?: string;
  printToken?: boolean;
}

export function splitCsv(value: string | undefined): string[] {
  if (!value || value.trim() === "") return [];
  return value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Write the token to a file at mode 600 (fchmod after open, so umask cannot widen it). */
export function writeTokenFile(path: string, token: string): void {
  const fd = openSync(path, "w", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${token}\n`);
  } finally {
    closeSync(fd);
  }
}

export async function runProvisionRunnerKeyCommand(
  opts: ProvisionRunnerKeyCliOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<{ runnerId: string; kid: string; expiresAt: string | null; provisioned: boolean }> {
  const executor = buildExecutor("loops-provision-runner-key", "migrator");
  try {
    return await runProvisionRunnerKeyWithClient(opts, env, executor.queryClient);
  } finally {
    await executor.close();
  }
}

/**
 * Command body with an injectable client — the seam the CLI tests use. All
 * validation and delivery behavior lives here so the unit tests exercise the
 * exact stdout/file/print-token contract without a database.
 */
export async function runProvisionRunnerKeyWithClient(
  opts: ProvisionRunnerKeyCliOptions,
  env: Record<string, string | undefined>,
  client: PoolQueryClient,
): Promise<{ runnerId: string; kid: string; expiresAt: string | null; provisioned: boolean }> {
  const runnerId = (opts.runnerId ?? "").trim() || hostname();
  const tenantId = (opts.tenantId ?? "").trim() || env.HASNA_LOOPS_TENANT_ID?.trim() || "";
  if (!tenantId) {
    throw new Error("provision-runner-key requires --tenant-id <id> or HASNA_LOOPS_TENANT_ID");
  }
  const parsedRoles = splitCsv(opts.roles);
  const roles = parsedRoles.length > 0 ? parsedRoles : [...RUNNER_KEY_DEFAULT_ROLES];
  const parsedScopes = splitCsv(opts.scope);
  const scopes = parsedScopes.length > 0 ? parsedScopes : [...RUNNER_KEY_DEFAULT_SCOPES];
  const ttlSeconds = opts.ttlSeconds ?? RUNNER_KEY_DEFAULT_TTL_SECONDS;
  const signingSecret = env.HASNA_LOOPS_API_SIGNING_KEY?.trim() || "";
  if (!signingSecret) {
    throw new Error("provision-runner-key requires HASNA_LOOPS_API_SIGNING_KEY");
  }
  const tokenOut = opts.tokenOut?.trim();
  if (opts.printToken && tokenOut) {
    throw new Error("provision-runner-key accepts either --token-out <path> or --print-token, not both");
  }
  if (!opts.printToken && !tokenOut) {
    throw new Error("provision-runner-key requires --token-out <path> or --print-token to deliver the minted token; stdout carries only the JSON summary");
  }

  const outcome = await provisionRunnerKey(client, {
    runnerId,
    tenantId,
    roles,
    scopes,
    ttlSeconds,
    signingSecret,
    // File delivery runs INSIDE the provisioning transaction (see
    // provisionRunnerKey): a write failure rolls the mint back, so a re-run
    // mints a fresh key instead of stranding an active key whose plaintext
    // was lost. `--print-token` stays post-commit to preserve the exact
    // stdout order (summary line, then token line) — a stdout write failure
    // is not a recovery hazard.
    ...(opts.printToken ? {} : { deliverToken: (token: string) => writeTokenFile(tokenOut!, token) }),
  });
  const summary = { runnerId: outcome.runnerId, kid: outcome.kid, expiresAt: outcome.expiresAt };
  console.log(JSON.stringify(summary));
  if (outcome.status === "provisioned") {
    // Token delivery is the ONE place the value may leave the process, and
    // only because the operator explicitly asked for it. It never touches a
    // log line: not here, not in the module, not in any error path.
    if (opts.printToken) {
      console.log(outcome.token);
    }
  } else {
    console.warn(
      `provision-runner-key: runner '${outcome.runnerId}' already has an active machine key (kid ${outcome.kid}, expires ${outcome.expiresAt ?? "never"}); no new token minted`,
    );
  }
  return { ...summary, provisioned: outcome.status === "provisioned" };
}

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
  .command("backfill-revisions")
  .description(
    "one-shot P3 job: append bundle revision 1 for every legacy loop that has no revision yet (current definition, bundle_name derived from the loop name when safe and free, else skipped and reported — never invented); idempotent and resumable",
  )
  .option("--dry-run", "classify, name and digest every loop, but write nothing anywhere")
  .option("--limit <n>", "stop after this many revisions (or would-be revisions under --dry-run); skips are free", (value) => Number(value))
  .option("--batch-size <n>", "loops per tenant-scoped transaction (default: 100)", (value) => Number(value))
  .option("--tenant-id <id>", "restrict the run to one tenant (default: every tenant)")
  .action(async (opts: { dryRun?: boolean; limit?: number; batchSize?: number; tenantId?: string }) => {
    const executor = buildExecutor("loops-backfill-revisions", "migrator");
    try {
      const result = await runRevisionBackfillCommand(
        executor,
        // Same seam the API uses: HASNA_LOOPS_ARTIFACTS_BUCKET for S3, or the
        // local data-dir fallback when the bucket is not configured yet.
        new BundleArtifactStorage(),
        {
          dryRun: opts.dryRun,
          ...(opts.limit === undefined ? {} : { limit: opts.limit }),
          ...(opts.batchSize === undefined ? {} : { batchSize: opts.batchSize }),
          ...(opts.tenantId === undefined ? {} : { tenantId: opts.tenantId }),
        },
      );
      console.log(JSON.stringify({ evt: "backfill_revisions", ...result }));
    } finally {
      await executor.close();
    }
  });

program
  .command("version")
  .description("print { status, version, storage }")
  .action(() => console.log(JSON.stringify({ status: "ok", version: packageVersion(), storage: runtimeStorage() })));

if (import.meta.main) {
  // Bare `loops-serve` (no subcommand) defaults to `serve`. Commander cannot
  // combine a root action with subcommand dispatch without swallowing the
  // subcommand name, so we inject the default subcommand here instead.
  const known = new Set([
    "serve",
    "migrate",
    "tenant-backfill",
    "tenant-backfill-s3",
    "provision-runner-key",
    "db-credentials",
    "shared-to-dedicated-transfer",
    "backfill-revisions",
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
