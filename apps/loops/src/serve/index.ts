#!/usr/bin/env bun
// `loops-serve` — the self-hosted HTTP control-plane binary.
//
// The service reads and writes self-hosted RDS/Postgres directly. There is no
// local SQLite, no cache, and no sync engine in the
// serve process. Storage is the vendored @hasna/contracts kit pool wrapping the
// real `PostgresLoopStorage` backend. Every authenticated request gets one
// dedicated transaction with tenant RLS context.
import { Command } from "commander";
import { createLoopsApiServer } from "../api/index.js";
import { TenantApiAuthenticator } from "../lib/auth/tenant-auth.js";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { PgPoolExecutor } from "../lib/storage/pg-executor.js";
import { PostgresStorage } from "../lib/storage/postgres.js";
import { createPostgresLoopStorage } from "../lib/storage/postgres-loop-storage.js";
import { loadTenantBackfillBundle, parseTenantBackfillBundle } from "../lib/storage/tenant-backfill.js";
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
    unexpected_membership: boolean;
    has_members: boolean;
    forbidden_member: boolean;
    owner_member: boolean;
    migrator_member: boolean;
    required_table_privileges: boolean;
    forbidden_table_privileges: boolean;
    required_function_privileges: boolean;
    forbidden_function_privileges: boolean;
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
              SELECT 1 FROM pg_auth_members other
               JOIN pg_roles granted ON granted.oid=other.roleid
              WHERE other.member=role.oid AND granted.rolname<>$1
            ) AS unexpected_membership,
            EXISTS (SELECT 1 FROM pg_auth_members child WHERE child.roleid=role.oid) AS has_members,
            pg_has_role(role.oid, $2, 'MEMBER') AS forbidden_member,
            pg_has_role(role.oid, 'open_loops_owner', 'MEMBER') AS owner_member,
            pg_has_role(role.oid, 'open_loops_migrator', 'MEMBER') AS migrator_member,
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
              ) AND has_table_privilege(session_user, 'public.open_loops_schema_migrations', 'SELECT')
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
                       'open_loops_schema_migrations'
                     ])
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
              has_function_privilege(session_user, 'public.open_loops_current_tenant_id()', 'EXECUTE')
            ELSE
              has_function_privilege(session_user, 'public.open_loops_authenticate_key(text,text)', 'EXECUTE')
              AND has_function_privilege(
                session_user,
                'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)',
                'EXECUTE'
              )
            END AS required_function_privileges,
            CASE WHEN $1 = 'open_loops_runtime' THEN
              NOT has_function_privilege(session_user, 'public.open_loops_authenticate_key(text,text)', 'EXECUTE')
              AND NOT has_function_privilege(
                session_user,
                'public.open_loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)',
                'EXECUTE'
              )
            ELSE
              NOT has_function_privilege(session_user, 'public.open_loops_current_tenant_id()', 'EXECUTE')
            END AS forbidden_function_privileges
       FROM pg_roles role
      WHERE role.rolname = session_user`,
    [expectedRole, forbiddenRole],
  );
  return Boolean(
    row?.rolcanlogin && row.rolinherit && row.expected_member && row.expected_usage && row.expected_direct &&
    !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole &&
    !row.rolreplication && !row.rolbypassrls &&
    !row.unexpected_membership && !row.has_members &&
    !row.forbidden_member && !row.owner_member && !row.migrator_member &&
    row.required_table_privileges && row.forbidden_table_privileges &&
    row.required_function_privileges && row.forbidden_function_privileges,
  );
}

export async function assertTenantEnforcementBootstrap(client: PoolQueryClient): Promise<void> {
  const role = await client.get<{
    rolcreaterole: boolean;
    rolsuper: boolean;
    owner_settable: boolean;
    migrator_settable: boolean;
    controls_public_schema: boolean;
  }>(
    `SELECT login.rolcreaterole, login.rolsuper,
            EXISTS (
              SELECT 1 FROM pg_roles target
               WHERE target.rolname='open_loops_owner'
                 AND pg_has_role(login.oid, target.oid, 'SET')
            ) OR NOT EXISTS (
              SELECT 1 FROM pg_roles target WHERE target.rolname='open_loops_owner'
            ) AS owner_settable,
            (EXISTS (
              SELECT 1 FROM pg_roles target
               WHERE target.rolname='open_loops_migrator'
                 AND pg_has_role(login.oid, target.oid, 'SET')
            ) OR NOT EXISTS (
              SELECT 1 FROM pg_roles target WHERE target.rolname='open_loops_migrator'
            )) AS migrator_settable,
            EXISTS (
              SELECT 1 FROM pg_namespace namespace
               WHERE namespace.nspname='public'
                 AND pg_has_role(login.oid, namespace.nspowner, 'USAGE')
            ) AS controls_public_schema
       FROM pg_roles login
      WHERE login.rolname = session_user`,
  );
  if (!role || (!role.rolsuper && (
    !role.rolcreaterole || !role.owner_settable || !role.migrator_settable || !role.controls_public_schema
  ))) {
    throw new Error(
      "tenant enforcement requires a schema-controlling bootstrap login with CREATEROLE and SET ROLE capability for owner/migrator, or a superuser-equivalent login",
    );
  }
  try {
    await client.transaction(async (transaction) => {
      await transaction.execute("SAVEPOINT open_loops_bootstrap_probe");
      try {
        await transaction.execute(`
          DO $probe_roles$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_owner') THEN
              CREATE ROLE open_loops_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_migrator') THEN
              CREATE ROLE open_loops_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_runtime') THEN
              CREATE ROLE open_loops_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_authenticator') THEN
              CREATE ROLE open_loops_authenticator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            END IF;
          END
          $probe_roles$;
        `);
        await transaction.execute("ALTER ROLE open_loops_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
        await transaction.execute("ALTER ROLE open_loops_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
        await transaction.execute("ALTER ROLE open_loops_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
        await transaction.execute("ALTER ROLE open_loops_authenticator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
        await transaction.execute("GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator");
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
        await transaction.execute(`
          DO $probe_service_acl$
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
              EXECUTE format('DROP OWNED BY %I', service_member.member_role);
            END LOOP;
          END
          $probe_service_acl$;
        `);
      } finally {
        await transaction.execute("ROLLBACK TO SAVEPOINT open_loops_bootstrap_probe");
      }
    });
  } catch {
    throw new Error(
      "tenant enforcement bootstrap login lacks provider-level authority for exact role creation/normalization, database/schema grants, or service-login privilege cleanup",
    );
  }
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
        } catch {
          return { ready: false, code: "storage_unreachable" };
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
  .description("OpenLoops self-hosted HTTP control-plane (RDS-direct, API-key auth)")
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
      if (opts.enforceTenancy) await assertTenantEnforcementBootstrap(executor.queryClient);
      const result = await new PostgresStorage(executor).migrate({
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
  .command("version")
  .description("print { status, version, mode }")
  .action(() => console.log(JSON.stringify({ status: "ok", version: packageVersion(), mode: "self_hosted" })));

if (import.meta.main) {
  // Bare `loops-serve` (no subcommand) defaults to `serve`. Commander cannot
  // combine a root action with subcommand dispatch without swallowing the
  // subcommand name, so we inject the default subcommand here instead.
  const known = new Set(["serve", "migrate", "tenant-backfill", "version", "help"]);
  const passthroughFlags = new Set(["-h", "--help", "-V", "--version"]);
  const argv = [...process.argv];
  const firstArg = argv[2];
  // Bare invocation, or leading serve flags, default to `serve`; but let
  // top-level --help/--version reach the program.
  if (!firstArg || (!known.has(firstArg) && !passthroughFlags.has(firstArg))) {
    argv.splice(2, 0, "serve");
  }
  program.parseAsync(argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { program };
