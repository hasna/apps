#!/usr/bin/env bun
import { buildCoreApp } from "./core-app.js";
import { createCoreAuthenticator } from "./core-auth.js";
import { createCorePool } from "./core-store.js";
import { migrateCoreSchema } from "./core-schema.js";
import { APP_VERSION } from "../version.js";

export const DEFAULT_SERVE_PORT = 3483;

/**
 * Classify early-exit arguments before any bind or environment-bound work.
 * --help/--version must answer with the port never listening (binds-before-args
 * class; access-serve previously ignored both flags and bound unconditionally,
 * BUG row 2920eed6).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

export function printHelp(): void {
  console.log(`usage: access-serve [--help] [--version] [--migrate]

access-serve — self-hosted HTTP API for @hasna/access.

options:
  --help          show this help and exit
  --version       print the package version and exit
  --migrate       explicitly apply PostgreSQL schema, then exit (requires separate operational approval)
`);
}

export function printVersion(): void {
  console.log(APP_VERSION);
}

export function getPort(): number {
  const raw = process.env["HASNA_ACCESS_PORT"] || process.env["ACCESS_PORT"];
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SERVE_PORT;
}

export function getBindHost(): string {
  return process.env["HASNA_ACCESS_BIND_HOST"] || process.env["ACCESS_BIND_HOST"] || "127.0.0.1";
}

/**
 * Core server credentials are mandatory on every bind address. The historical
 * signature remains for import compatibility; mode cannot disable authentication.
 */
export function assertAuthPosture(_host: string, _mode: "local" | "cloud"): void {
  createCoreAuthenticator();
}

export async function startServer(): Promise<ReturnType<typeof Bun.serve>> {
  const port = getPort();
  const host = getBindHost();
  assertAuthPosture(host, "cloud");
  const pool = createCorePool();
  try {
    // Bind signing authority before the first async startup step; runtime env/file
    // changes cannot retarget a running server's issuance or authentication.
    const app = buildCoreApp(pool);
    const connection = await pool.connect();
    try {
      const result = await connection.query("SELECT id FROM schema_migrations WHERE id = 1");
      if (result.rows.length !== 1) throw new Error("Access PostgreSQL schema migration is required.");
    } finally { connection.release(); }
    const server = Bun.serve({ port, hostname: host, fetch(req, server) {
      return app.fetch(req, { peer: server.requestIP(req)?.address ?? "unknown" });
    } });
    console.error(`access-serve v${APP_VERSION} listening on http://${host}:${port} (backend=postgresql)`);
    return server;
  } catch {
    await pool.end();
    throw new Error("Access PostgreSQL startup failed; verify server configuration and explicit schema migration.");
  }
}

if (import.meta.main) {
  const early = handleEarlyArgs(process.argv.slice(2));
  if (early === "help") {
    printHelp();
    process.exit(0);
  }
  if (early === "version") {
    printVersion();
    process.exit(0);
  }
  try {
    if (process.argv.includes("--migrate")) {
      const pool = createCorePool();
      try { await migrateCoreSchema(pool); } finally { await pool.end(); }
    } else await startServer();
  } catch {
    console.error("Access server could not start or migrate; check PostgreSQL, schema, and authentication configuration.");
    process.exitCode = 1;
  }
}
