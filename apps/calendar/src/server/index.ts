#!/usr/bin/env bun
/**
 * Entry point for `calendar-serve`.
 *
 *   calendar-serve [--port <n>] [--host <h>]   Start the HTTP API
 *   calendar-serve migrate                     Apply the cloud (RDS) schema then exit
 *   calendar-serve --version                   Print the version
 *
 * When PORT is set (container/ECS) it is bound EXACTLY so the ALB health check
 * targets the right port.
 */
import { getPackageVersion } from "./version.js";

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
  const arg = process.argv.find((a) => a === "--host" || a.startsWith("--host="));
  if (arg) {
    if (arg.includes("=")) return arg.split("=")[1] || undefined;
    const idx = process.argv.indexOf(arg);
    return process.argv[idx + 1] || undefined;
  }
  return undefined;
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
  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }
  const port = parsePort();
  const { serve } = await import("./serve.js");
  console.log(`Starting calendar server on port ${port}...`);
  serve(port, { host: parseHost() });
}

main().catch((e) => {
  console.error("calendar-serve failed:", (e as Error).message);
  process.exit(1);
});
