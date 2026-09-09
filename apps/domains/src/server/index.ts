#!/usr/bin/env bun
/**
 * domains-serve — standalone HTTP API server, PostgreSQL backend.
 *
 * Usage: domains-serve [--port 8080] [--host 0.0.0.0]
 *
 * The server backend is selected by the environment:
 *   HASNA_DOMAINS_DATABASE_URL      Postgres DSN -> PostgreSQL backend
 *                                   (unset -> SQLite backend)
 *   HASNA_DOMAINS_API_SIGNING_KEY   HMAC signing secret for API keys
 * Falls back to the generic DATABASE_URL / API_KEY_SIGNING_SECRET env names the
 * hasna-app Terraform module injects.
 */

import { ApiKeyStore } from "@hasna/contracts/auth";
import { createServerPoolFromEnv } from "../generated/storage-kit/index.js";
import { getPackageVersion } from "../lib/version.js";
import { createServeApp } from "./app.js";

const DEFAULT_PORT = 8080;

export const SIGNING_KEY_ENVS = [
  "HASNA_DOMAINS_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
] as const;

/** Normalize the module-injected env names to the kit/auth conventions. */
export function normalizeEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (!env["HASNA_DOMAINS_DATABASE_URL"] && env["DATABASE_URL"]) {
    env["HASNA_DOMAINS_DATABASE_URL"] = env["DATABASE_URL"];
  }
}

export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  for (const key of SIGNING_KEY_ENVS) {
    const v = env[key]?.trim();
    if (v) return v;
  }
  throw new Error(
    `Missing API-key signing secret. Set ${SIGNING_KEY_ENVS[0]} (or ${SIGNING_KEY_ENVS[2]}).`,
  );
}

function parseArg(name: string, fallback: string | undefined): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

export const USAGE = `domains-serve — standalone HTTP API server for @hasna/domains (PostgreSQL backend)

Usage: domains-serve [--port <n>] [--host <addr>]

Options:
  --port <n>       Port to listen on (default: $PORT or ${DEFAULT_PORT})
  --host <addr>    Address to bind (default: $HOST or 0.0.0.0)
  -h, --help       Print this help and exit
  -V, --version    Print the package version and exit

Environment:
  HASNA_DOMAINS_DATABASE_URL     PostgreSQL DSN (falls back to DATABASE_URL)
  HASNA_DOMAINS_API_SIGNING_KEY  HMAC signing secret for API keys
                                 (falls back to API_KEY_SIGNING_SECRET)`;

/** Informational flags are answered before any environment is inspected. */
function earlyArgAnswer(argv: readonly string[]): string | undefined {
  if (argv.includes("--help") || argv.includes("-h")) return USAGE;
  if (argv.includes("--version") || argv.includes("-V")) return getPackageVersion();
  return undefined;
}

async function main(): Promise<void> {
  // --help/-h and --version/-V answer before the signing secret or the
  // database DSN is resolved: neither needs a configured environment.
  const early = earlyArgAnswer(process.argv);
  if (early !== undefined) {
    console.log(early);
    return;
  }

  await startDomainsServer({
    port: Number(parseArg("--port", process.env["PORT"]) ?? DEFAULT_PORT),
    host: parseArg("--host", process.env["HOST"]) ?? "0.0.0.0",
  });
}

/** Shared authenticated server for both domains serve and domains-serve. */
export async function startDomainsServer(options: { port: number; host: string }): Promise<void> {
  const { port, host } = options;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535.");
  if (!host.trim()) throw new Error("Host must not be blank.");
  normalizeEnv();
  const version = getPackageVersion();
  const signingSecret = resolveSigningSecret();

  const { client, connectionSource } = createServerPoolFromEnv("domains", {
    applicationName: "domains-serve",
    max: 5,
  });

  // NOTE: do NOT call store.ensureSchema() here — the service runs as the
  // DML-only app role and cannot run DDL. The api_keys table is created by the
  // owner-role migration task (`domains db migrate`). The store is used only for
  // the read-path revocation check.
  const store = new ApiKeyStore(client);

  const app = createServeApp({
    db: client,
    signingSecret,
    version,
    keyStatus: store.keyStatus,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.error(JSON.stringify({ level: "warn", event: "api_auth_deny", ...e }));
      }
    },
  });

  Bun.serve({
    port,
    hostname: host,
    idleTimeout: 30,
    fetch: (req) => app.handle(req),
  });

  console.log(
    JSON.stringify({
      level: "info",
      event: "domains_serve_started",
      version,
      port,
      host,
      dsnSource: connectionSource,
    }),
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(JSON.stringify({ level: "error", event: "domains_serve_fatal", error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
