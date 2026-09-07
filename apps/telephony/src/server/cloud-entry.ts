#!/usr/bin/env bun
/**
 * telephony-serve entrypoint — the HTTP API a user runs on their own server.
 *
 * Starts the serve, which reads/writes its PostgreSQL backend directly and
 * authenticates requests with @hasna/contracts API-key middleware. Requires
 * HASNA_TELEPHONY_DATABASE_URL (which selects the `postgresql` backend on its
 * own) and a signing secret (HASNA_TELEPHONY_API_SIGNING_KEY).
 *
 * `--help` / `--version` are answered BEFORE anything is opened: no pool, no
 * port, no store. A real start without the database URL still fails closed
 * (non-zero exit, no SQLite, no port) — that gate lives in the serve itself.
 */
import pkg from "../../package.json";
import { startTelephonyServe } from "./cloud-serve.js";

function printHelp(): void {
  console.log(`Usage: telephony-serve [options]

Runs the @hasna/telephony HTTP API (PostgreSQL-backed; the server never serves SQLite).

Options:
  -V, --version    output the version number
  -h, --help       display help for command

Environment:
  HASNA_TELEPHONY_DATABASE_URL     PostgreSQL connection URL (required; selects the backend)
  HASNA_TELEPHONY_API_SIGNING_KEY  API-key signing secret (required)
  PORT                             listen port (default 8080; alias HASNA_TELEPHONY_SERVE_PORT)
  HOST                             bind address (default 0.0.0.0)`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

startTelephonyServe().catch((error) => {
  console.error("[telephony-serve] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
