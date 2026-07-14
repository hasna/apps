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
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
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
            pg_has_role(role.oid, 'open_loops_migrator', 'MEMBER') AS migrator_member
       FROM pg_roles role
      WHERE role.rolname = session_user`,
    [expectedRole, forbiddenRole],
  );
  return Boolean(
    row?.rolcanlogin && row.rolinherit && row.expected_member && row.expected_usage && row.expected_direct &&
    !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole &&
    !row.rolreplication && !row.rolbypassrls &&
    !row.unexpected_membership && !row.has_members &&
    !row.forbidden_member && !row.owner_member && !row.migrator_member,
  );
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
