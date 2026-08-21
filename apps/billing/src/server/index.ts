#!/usr/bin/env bun
import { assertServeSafeToStart, buildApp, getBindHost, getPort } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { resolveStorageBackend } from "../config.js";
import { getDatabase } from "../db/database.js";
import { APP_VERSION } from "../version.js";

/** Boot the Hono serve tier (BUILD-SPEC §6.1). */
export function startServer(): { port: number; hostname: string } {
  // Fail closed if bound wide or using PostgreSQL without credentials.
  assertServeSafeToStart();

  // Warm SQLite so /ready reflects a real connection. PostgreSQL remains
  // selected by DATABASE_URL for the process lifetime and fails closed in
  // domain handlers until their PostgreSQL query path is implemented.
  if (resolveStorageBackend() === "sqlite") getDatabase();

  const app = buildApp();
  const port = getPort();
  const hostname = getBindHost();
  Bun.serve({ port, hostname, fetch: app.fetch });
  return { port, hostname };
}

/**
 * Classify early-exit arguments before any bind, pool, or credential-touch
 * work. --help/--version must answer with rc=0 and the server never bound
 * (binds-before-help class; billing-serve previously ran startServer() first
 * and bound the port before answering, BUG row ad3ae2fe).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

export function printHelp(): void {
  console.log(`usage: billing-serve [--help] [--version]

billing-serve — HTTP service for @hasna/billing (BUILD-SPEC §6.1).

options:
  --help              show this help and exit
  --version           print the package version and exit

environment:
  HASNA_BILLING_BIND_HOST     bind address (default 127.0.0.1)
  HASNA_BILLING_PORT          listen port (default 3487)
  HASNA_BILLING_API_CREDENTIALS  JSON array of distinct scoped credentials
`);
}

export function printVersion(): void {
  console.log(APP_VERSION);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const early = handleEarlyArgs(args);
  if (early === "help") {
    printHelp();
    process.exit(0);
  }
  if (early === "version") {
    printVersion();
    process.exit(0);
  }
  const { port, hostname } = startServer();
  console.log(`billing serve on http://${hostname}:${port} (backend=${resolveStorageBackend()})`);
  console.log(`API auth ${isApiAuthConfigured() ? "enabled" : "disabled (SQLite loopback dev only)"}`);
}
