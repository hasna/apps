#!/usr/bin/env bun
/**
 * domains-serve — standalone HTTP API server (self_hosted / cloud).
 *
 * Usage: domains-serve [--port 8080] [--host 0.0.0.0]
 *
 * PURE REMOTE (Amendment A1): talks to the app's cloud Postgres directly via
 * the vendored storage kit. Requires:
 *   HASNA_DOMAINS_DATABASE_URL      app-role DSN (RDS)
 *   HASNA_DOMAINS_STORAGE_MODE      "cloud"
 *   HASNA_DOMAINS_API_SIGNING_KEY   HMAC signing secret for API keys
 * Falls back to the generic DATABASE_URL / API_KEY_SIGNING_SECRET env names the
 * hasna-app Terraform module injects.
 */

import { ApiKeyStore } from "@hasna/contracts/auth";
import { createCloudPoolFromEnv } from "../generated/storage-kit/index.js";
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
  if (!env["HASNA_DOMAINS_STORAGE_MODE"] && env["HASNA_DOMAINS_DATABASE_URL"]) {
    env["HASNA_DOMAINS_STORAGE_MODE"] = "cloud";
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

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }

  normalizeEnv();
  const version = getPackageVersion();
  const signingSecret = resolveSigningSecret();

  const { client, connectionSource } = createCloudPoolFromEnv("domains", {
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
    mode: process.env["HASNA_APP_MODE"] ?? "self_hosted",
    isRevoked: store.isRevoked,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.error(JSON.stringify({ level: "warn", event: "api_auth_deny", ...e }));
      }
    },
  });

  const port = Number(parseArg("--port", process.env["PORT"]) ?? DEFAULT_PORT) || DEFAULT_PORT;
  const host = parseArg("--host", process.env["HOST"]) ?? "0.0.0.0";

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
