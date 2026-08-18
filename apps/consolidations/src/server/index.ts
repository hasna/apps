#!/usr/bin/env bun
import { resolveDataBackend } from "../config.js";
import { APP_VERSION } from "../version.js";
import { createApp } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { authApplies, getBindHost, getPort, isLoopbackBind } from "./request-auth.js";

// Boot the Hono serve tier. Fail-closed: a non-loopback bind or remote bind with
// no credentials configured refuses to start rather than serving open.
function assertAuthSafe(): void {
  const openBind = !isLoopbackBind() || resolveDataBackend() === "postgresql";
  if (openBind && !isApiAuthConfigured()) {
    throw new Error(
      "Refusing to start: non-loopback/cloud bind requires API credentials. " +
        "Set HASNA_CONSOLIDATIONS_API_CREDENTIALS (or bind 127.0.0.1 on sqlite).",
    );
  }
}

function printHelp(): void {
  console.log(`Usage: consolidations-serve [options]

Start the @hasna/consolidations HTTP API server.

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Environment:
  HASNA_CONSOLIDATIONS_PORT           HTTP port to bind (default 3488)
  HASNA_CONSOLIDATIONS_BIND_HOST      Hostname to bind (default 127.0.0.1)
  HASNA_CONSOLIDATIONS_BACKEND        Data backend: sqlite | postgresql
  HASNA_CONSOLIDATIONS_DB_PATH        SQLite database path
  HASNA_CONSOLIDATIONS_DATABASE_URL   PostgreSQL DSN (implies postgresql)
  HASNA_CONSOLIDATIONS_API_CREDENTIALS  API credentials for non-loopback binds`);
}

if (import.meta.main) {
  // Answer --help/--version without binding a socket (recordings pattern).
  // These must run before assertAuthSafe: help is reachable with no credentials.
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(APP_VERSION);
    process.exit(0);
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  assertAuthSafe();
  const app = createApp();
  const port = getPort();
  const hostname = getBindHost();
  Bun.serve({ port, hostname, fetch: app.fetch });
  console.log(`consolidations-serve v${APP_VERSION} on http://${hostname}:${port} (backend=${resolveDataBackend()})`);
  console.log(`/v1 auth ${authApplies() ? "enabled" : "disabled (loopback + local)"}`);
}

export { createApp };
