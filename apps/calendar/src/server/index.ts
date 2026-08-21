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
 * Startup fails loudly (exit 1) rather than degrading when no auth posture can
 * be resolved without serving `/mcp` anonymously.
 */
import { getPackageVersion } from "./version.js";
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

async function runMigrate(): Promise<void> {
  const { ensureCloudSchema, pingCloud, resolveCloudDatabaseUrl, closeCloud } = await import("./cloud.js");
  if (!resolveCloudDatabaseUrl(process.env, { includeGenericDatabaseUrl: true })) {
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

/**
 * Classify early-exit arguments before any port parse, serve import, or bind.
 * --help/--version must answer with rc=0 and the server never started
 * (binds-before-help class; calendar-serve --help previously fell through to
 * the bind path and refused without a serve credential instead of answering,
 * BUG row dd27cac0).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

export function printHelp(): void {
  console.log(`usage: calendar-serve [--port <n>] [--host <h>]   Start the HTTP API
              [--api-key <k>] [--allow-anonymous]
  calendar-serve migrate                     Apply the cloud (RDS) schema then exit
  calendar-serve --version                   Print the version

options:
  --help              show this help and exit
  --version           print the package version and exit
`);
}

async function main() {
  const early = handleEarlyArgs(process.argv.slice(2));
  if (early === "help") {
    printHelp();
    return;
  }
  if (early === "version") {
    console.log(getPackageVersion());
    return;
  }

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
    e instanceof AuthNotConfiguredError
    || e instanceof SplitStorePlaneError
  ) {
    // Already an actionable, credential-free multi-line message.
    console.error(e.message);
    process.exit(1);
  }
  console.error("calendar-serve failed:", (e as Error).message);
  process.exit(1);
});
