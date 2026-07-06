#!/usr/bin/env bun
// `loops-serve` — the self-hosted HTTP control-plane binary.
//
// Amendment A1 (PURE REMOTE): the service reads and writes RDS Postgres
// directly. There is no local SQLite, no cache, and no sync engine in the
// serve process. Storage is the vendored @hasna/contracts kit pool wrapping the
// real `PostgresLoopStorage` backend; auth is the framework-agnostic
// `verifyApiKey` verifier from @hasna/contracts/auth backed by the shared
// `api_keys` table.
import { Command } from "commander";
import { ApiKeyStore, verifyApiKey } from "@hasna/contracts/auth";
import { createLoopsApiServer, type ApiAuthenticator } from "../api/index.js";
import { PgPoolExecutor } from "../lib/storage/pg-executor.js";
import { PostgresStorage } from "../lib/storage/postgres.js";
import { createPostgresLoopStorage } from "../lib/storage/postgres-loop-storage.js";
import { packageVersion } from "../lib/version.js";

const APP = "loops";

function resolveDatabaseUrl(): string {
  const dsn =
    process.env.HASNA_LOOPS_DATABASE_URL?.trim() ||
    process.env.LOOPS_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!dsn) {
    throw new Error(
      "loops-serve requires a cloud database URL: set HASNA_LOOPS_DATABASE_URL (or LOOPS_DATABASE_URL / DATABASE_URL)",
    );
  }
  return dsn;
}

function resolveSigningSecret(): string | undefined {
  return (
    process.env.HASNA_LOOPS_API_SIGNING_KEY?.trim() ||
    process.env.HASNA_API_SIGNING_KEY?.trim() ||
    process.env.API_KEY_SIGNING_SECRET?.trim() ||
    undefined
  );
}

function buildExecutor(applicationName: string): PgPoolExecutor {
  return PgPoolExecutor.fromConnectionString({
    connectionString: resolveDatabaseUrl(),
    applicationName,
    max: Number(process.env.LOOPS_PG_POOL_MAX ?? "5"),
    connectionTimeoutMillis: 10_000,
  });
}

const program = new Command();
program
  .name("loops-serve")
  .description("OpenLoops self-hosted HTTP control-plane (RDS-direct, API-key auth)")
  .version(packageVersion());

program
  .command("serve", { isDefault: true })
  .description("serve the control-plane API (GET /health,/ready,/version + /v1)")
  .option("--host <host>", "bind host", process.env.LOOPS_API_HOST ?? "0.0.0.0")
  .option("--port <port>", "bind port", (v) => Number(v), Number(process.env.PORT ?? process.env.LOOPS_API_PORT ?? "8787"))
  .action(async (opts: { host: string; port: number }) => {
    const executor = buildExecutor("loops-serve");
    const client = executor.queryClient;
    const storage = createPostgresLoopStorage(client);
    const schema = new PostgresStorage(executor);

    const keys = new ApiKeyStore(client);
    // Idempotent: the api_keys table is normally created by the migration task,
    // but ensureSchema keeps a fresh DB self-healing without a separate step.
    await keys.ensureSchema();

    const signingSecret = resolveSigningSecret();
    let authenticator: ApiAuthenticator | undefined;
    if (signingSecret) {
      authenticator = verifyApiKey({
        app: APP,
        signingSecret,
        // Strict: unknown OR revoked kids are denied (a token must be recorded).
        isRevoked: keys.statusChecker(),
        audit: (event) =>
          console.log(
            JSON.stringify({ evt: "api_auth", outcome: event.outcome, kid: event.kid, reason: event.reason, path: event.path, status: event.status }),
          ),
      }) as unknown as ApiAuthenticator;
    } else if (opts.host !== "127.0.0.1" && opts.host !== "localhost" && opts.host !== "::1") {
      throw new Error(
        "loops-serve on a non-local host requires an API signing secret (HASNA_LOOPS_API_SIGNING_KEY / API_KEY_SIGNING_SECRET)",
      );
    }

    const server = createLoopsApiServer({
      host: opts.host,
      port: opts.port,
      storage,
      authenticator,
      readyCheck: async () => {
        try {
          const applied = await schema.listAppliedMigrations();
          const known = new Set(schema.migrations.map((m) => m.id));
          const missing = schema.migrations.filter((m) => !applied.some((a) => a.id === m.id)).map((m) => m.id);
          const unknown = applied.filter((a) => !known.has(a.id)).map((a) => a.id);
          if (missing.length) return { ready: false, detail: `pending_migrations:${missing.join(",")}` };
          if (unknown.length) return { ready: false, detail: `unknown_migrations:${unknown.join(",")}` };
          return { ready: true };
        } catch (error) {
          return { ready: false, detail: error instanceof Error ? error.message : "storage_unreachable" };
        }
      },
    });
    console.log(
      JSON.stringify({
        evt: "loops_serve_listening",
        url: `http://${server.hostname}:${server.port}`,
        auth: authenticator ? "api_key" : "loopback",
        version: packageVersion(),
      }),
    );
  });

program
  .command("migrate")
  .description("apply the Postgres schema migrations + the api_keys table, then exit")
  .option("--dry-run", "preview the migration plan without applying")
  .action(async (opts: { dryRun?: boolean }) => {
    const executor = buildExecutor("loops-migrate");
    try {
      const result = await new PostgresStorage(executor).migrate({ dryRun: Boolean(opts.dryRun) });
      const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
      console.log(JSON.stringify({ evt: "migrate", dryRun: result.dryRun, applied: result.applied.map((a) => a.id), pending }));
      if (!opts.dryRun) {
        await new ApiKeyStore(executor.queryClient).ensureSchema();
        console.log(JSON.stringify({ evt: "api_keys_ensured" }));
      }
    } finally {
      await executor.close();
    }
  });

program
  .command("version")
  .description("print { status, version, mode }")
  .action(() => console.log(JSON.stringify({ status: "ok", version: packageVersion(), mode: "self_hosted" })));

if (import.meta.main) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { program };
