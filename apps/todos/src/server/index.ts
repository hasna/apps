#!/usr/bin/env bun
/**
 * Standalone entry point for the todos HTTP server.
 * Usage: todos-serve [--port 19427]
 *
 * If the default port is in use, automatically finds the next free port.
 */

import { getPackageVersion } from "../lib/package-version.js";
import { DEFAULT_PORT, coercePort, findFreePort, refuseInvalidPort } from "./port.js";

function hasVersionFlag(): boolean {
  return process.argv.includes("--version") || process.argv.includes("-V");
}

function hasHelpFlag(): boolean {
  return process.argv.includes("--help") || process.argv.includes("-h");
}

function printHelp(): void {
  console.log(`Usage: todos-serve [options]

Start the @hasna/todos HTTP server (REST API + MCP).

Commands:
  migrate                 Apply idempotent schema migrations
  redact-comments         Preview historical comment redaction (dry-run by default)
  backfill-timestamps     Preview the terminal-status timestamp backfill
                          (dry-run by default)

Options:
  --port <port>     HTTP port to bind. Defaults to ${DEFAULT_PORT}
  --host <host>     Hostname to bind. Defaults to 127.0.0.1
  --api-key <key>   Require this API key for API requests
  --batch-size <n>  redact-comments / backfill-timestamps batch size,
                    1-500 (default: 100)
  --apply           Apply changes (default is dry-run) for redact-comments
                    and backfill-timestamps
  --confirm <value> Explicit confirmation required with --apply
  --evidence-path <path>
                    backfill-timestamps: pre-state evidence file, REQUIRED
                    with --apply (written before any mutation)
  --json            Emit redact-comments / backfill-timestamps aggregate JSON
  -V, --version     output the version number
  -h, --help        display help for command

Environment:
  TODOS_API_KEY=<key>      Require this API key for API requests`);
}

function parsePort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    const raw = portArg.includes("=")
      ? portArg.split("=")[1]
      : process.argv[process.argv.indexOf(portArg) + 1];
    // An explicit --port that cannot be a port is refused rather than quietly
    // replaced by the default, which would start the server somewhere the
    // operator did not ask for and say nothing.
    return coercePort(raw) ?? refuseInvalidPort("--port", raw ?? "");
  }
  return DEFAULT_PORT;
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!arg) return undefined;
  if (arg.includes("=")) return arg.split("=")[1] || undefined;
  const idx = process.argv.indexOf(arg);
  return process.argv[idx + 1] || undefined;
}


async function runMigrate(): Promise<void> {
  const {
    ensureCloudSchema,
    ensureCloudCommentCursorIndex,
    ensureCloudTaskShortIdIndex,
    ensureCloudTaskObjectIdIndex,
    ensureCloudScopedSlugUniqueIndexes,
    normalizeCloudPayloads,
    pingCloud,
    resolveCloudDatabaseUrl,
    closeCloud,
  } =
    await import("./cloud.js");
  if (!resolveCloudDatabaseUrl()) {
    console.error("migrate: no database URL (HASNA_TODOS_DATABASE_URL / TODOS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (sync tables + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: normalizing legacy double-encoded jsonb payloads…");
  const normalized = await normalizeCloudPayloads();
  console.log(`migrate: normalized ${normalized} payload row(s)`);
  console.log("migrate: prebuilding comment cursor index concurrently…");
  await ensureCloudCommentCursorIndex();
  console.log("migrate: prebuilding task short_id resolution index concurrently…");
  await ensureCloudTaskShortIdIndex();
  console.log("migrate: prebuilding task object_id (COLLATE C) prefix index concurrently…");
  await ensureCloudTaskObjectIdIndex();
  console.log("migrate: auditing scoped slug duplicates and building unique indexes concurrently…");
  await ensureCloudScopedSlugUniqueIndexes();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

async function runCommentRedactionBackfill(): Promise<void> {
  const {
    backfillCloudCommentRedaction,
    resolveCloudDatabaseUrl,
    closeCloud,
  } = await import("./cloud.js");
  const {
    COMMENT_REDACTION_BACKFILL_CONFIRMATION,
    isCommentRedactionBackfillComplete,
  } = await import("../storage/comment-redaction-backfill.js");
  if (!resolveCloudDatabaseUrl()) {
    console.error("redact-comments: no database URL (HASNA_TODOS_DATABASE_URL / TODOS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }

  const apply = process.argv.includes("--apply");
  const rawBatchSize = parseStringArg("--batch-size");
  try {
    const report = await backfillCloudCommentRedaction({
      apply,
      confirmation: parseStringArg("--confirm"),
      batchSize: rawBatchSize === undefined ? 100 : Number(rawBatchSize),
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report));
    } else {
      console.log(
        `redact-comments: ${report.dry_run ? "dry-run" : "applied"}; ` +
        `scanned=${report.scanned} candidates=${report.candidates} updated=${report.updated} ` +
        `conflicts=${report.conflicts} remaining=${report.remaining_candidates} batches=${report.batches}`,
      );
      if (report.dry_run && report.candidates > 0) {
        console.log(
          `redact-comments: obtain approval before using ` +
          `--apply --confirm=${COMMENT_REDACTION_BACKFILL_CONFIRMATION}`,
        );
      }
    }
    if (apply && !isCommentRedactionBackfillComplete(report)) {
      console.error(
        "redact-comments: incomplete apply; resolve conflicts and rerun until conflicts=0 and remaining=0",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    const message = (error as Error).message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@");
    console.error(`redact-comments: failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeCloud();
  }
}

async function runTimestampBackfill(): Promise<void> {
  const {
    backfillCloudTimestamps,
    resolveCloudDatabaseUrl,
    closeCloud,
  } = await import("./cloud.js");
  const {
    TIMESTAMP_BACKFILL_CONFIRMATION,
  } = await import("../storage/timestamp-backfill.js");
  if (!resolveCloudDatabaseUrl()) {
    console.error("backfill-timestamps: no database URL (HASNA_TODOS_DATABASE_URL / TODOS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }

  const apply = process.argv.includes("--apply");
  const rawBatchSize = parseStringArg("--batch-size");
  const evidencePath = parseStringArg("--evidence-path");
  try {
    const report = await backfillCloudTimestamps({
      apply,
      confirmation: parseStringArg("--confirm"),
      batchSize: rawBatchSize === undefined ? 100 : Number(rawBatchSize),
      evidencePath,
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report));
    } else {
      console.log(
        `backfill-timestamps: ${report.dry_run ? "dry-run" : "applied"}; ` +
        `scanned=${report.scanned} candidates=${report.candidates} ` +
        `completed_at_backfilled=${report.completed_at_backfilled} ` +
        `started_at_backfilled=${report.started_at_backfilled} batches=${report.batches} ` +
        `remaining=${report.remaining_candidates}`,
      );
      if (report.dry_run && report.candidates > 0) {
        console.log(
          `backfill-timestamps: obtain approval before using ` +
          `--apply --confirm=${TIMESTAMP_BACKFILL_CONFIRMATION} --evidence-path=<path>`,
        );
      }
    }
  } catch (error) {
    const message = (error as Error).message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@");
    console.error(`backfill-timestamps: failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeCloud();
  }
}

async function main() {
  if (hasVersionFlag()) {
    console.log(getPackageVersion());
    return;
  }
  if (hasHelpFlag()) {
    printHelp();
    return;
  }
  // One-shot schema migration (used by the ECS migration task):
  //   todos-serve migrate
  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  if (process.argv.includes("redact-comments")) {
    await runCommentRedactionBackfill();
    return;
  }
  if (process.argv.includes("backfill-timestamps")) {
    await runTimestampBackfill();
    return;
  }
  // When PORT is set (container/service deployment) bind it EXACTLY — never scan
  // for a free port, or the ALB health check would target the wrong port.
  const explicitPortArg = process.argv.some((a) => a === "--port" || a.startsWith("--port="));
  // An empty PORT is treated as unset, which is how containers and shells
  // routinely express "no value". A non-empty PORT that is not a port is refused,
  // for the same reason an explicit --port is.
  const rawEnvPort = process.env.PORT?.trim();
  const envPort = rawEnvPort
    ? coercePort(rawEnvPort) ?? refuseInvalidPort("PORT", rawEnvPort)
    : undefined;
  const requestedPort = explicitPortArg ? parsePort() : (envPort ?? parsePort());
  // An explicitly requested port (including 0 = "kernel, pick one") is bound as
  // asked. Only the implicit default may scan for a free port.
  const port = envPort !== undefined || explicitPortArg ? requestedPort : await findFreePort(requestedPort);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} in use, using ${port}`);
  }
  const { startServer } = await import("./serve.js");
  try {
    await startServer(port, {
      host: parseStringArg("--host") || process.env.HOST,
      apiKey: parseStringArg("--api-key"),
      allowAnonymous: process.argv.includes("--allow-anonymous"),
    });
  } catch (error) {
    // Fail closed and LOUD: never fall back to serving data anonymously.
    const { AuthNotConfiguredError } = await import("./auth-posture.js");
    if (error instanceof AuthNotConfiguredError) {
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

main();
