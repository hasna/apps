#!/usr/bin/env bun
/**
 * Entry point for `calendar-serve`.
 *
 *   calendar-serve [--port <n>] [--host <h>]   Start the HTTP API
 *              [--api-key <k>] [--allow-anonymous]
 *   calendar-serve migrate                     Apply the cloud (RDS) schema then exit
 *   calendar-serve --version                   Print the version
 *
 * When PORT is set (container/ECS) it is bound EXACTLY so the ALB health check
 * targets the right port.
 *
 * Startup fails loudly (exit 1) rather than degrading when either
 *   - `HASNA_CALENDAR_STORAGE_MODE` holds a non-canonical value, or
 *   - no auth posture can be resolved without serving `/mcp` anonymously.
 */
import { getPackageVersion } from "./version.js";
import { UnknownStorageModeError, resolveConfiguredStorageMode } from "../store/storage-mode.js";
import { AuthNotConfiguredError, SplitStorePlaneError } from "./auth-posture.js";

const DEFAULT_PORT = 19428;

function parsePort(): number {
  const arg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (arg) {
    if (arg.includes("=")) return parseInt(arg.split("=")[1]!, 10) || DEFAULT_PORT;
    const idx = process.argv.indexOf(arg);
    return parseInt(process.argv[idx + 1]!, 10) || DEFAULT_PORT;
  }
  const env = process.env["PORT"] || process.env["CALENDAR_PORT"];
  return env ? parseInt(env, 10) || DEFAULT_PORT : DEFAULT_PORT;
}

function parseHost(): string | undefined {
  return parseStringFlag("--host");
}

function parseStringFlag(flag: string): string | undefined {
  const arg = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!arg) return undefined;
  if (arg.includes("=")) return arg.split("=").slice(1).join("=") || undefined;
  const idx = process.argv.indexOf(arg);
  return process.argv[idx + 1] || undefined;
}

/**
 * Validate the storage-mode vocabulary before anything else runs.
 * An unrecognised value is fatal: silently falling back to a different data
 * store is how `/v1` (RDS) and `/mcp` (on-box SQLite) ended up on two different
 * datasets inside one production container.
 */
export function assertStorageModeValid(env: NodeJS.ProcessEnv = process.env): void {
  resolveConfiguredStorageMode("calendar", env as Record<string, string | undefined>);
}

async function runMigrate(): Promise<void> {
  const { ensureCloudSchema, pingCloud, resolveCloudDatabaseUrl, closeCloud } = await import("./cloud.js");
  if (!resolveCloudDatabaseUrl()) {
    console.error("migrate: no database URL (HASNA_CALENDAR_DATABASE_URL / CALENDAR_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (calendar tables + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }

  // Fail loudly on a non-canonical storage mode before any store is resolved.
  assertStorageModeValid();

  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  const port = parsePort();
  const { serve } = await import("./serve.js");
  console.log(`Starting calendar server on port ${port}...`);
  serve(port, {
    host: parseHost(),
    apiKey: parseStringFlag("--api-key") ?? null,
    allowAnonymous: process.argv.includes("--allow-anonymous") || undefined,
  });
}

main().catch((e) => {
  if (
    e instanceof UnknownStorageModeError
    || e instanceof AuthNotConfiguredError
    || e instanceof SplitStorePlaneError
  ) {
    // Already an actionable, credential-free multi-line message.
    console.error(e.message);
    process.exit(1);
  }
  console.error("calendar-serve failed:", (e as Error).message);
  process.exit(1);
});
