#!/usr/bin/env bun
/**
 * `shortlinks-serve` — the hosted HTTP service entrypoint.
 *
 * Reads/writes PostgreSQL directly via the vendored storage kit: the server
 * data backend is selected by `HASNA_SHORTLINKS_DATABASE_URL` (present →
 * postgresql, absent → the pool factory fails closed). No sync engine, cache,
 * or local database in the service.
 *
 * Usage:
 *   shortlinks-serve            Run migrations (idempotent) then serve.
 *   shortlinks-serve migrate    Run migrations and exit (one-shot task).
 *   shortlinks-serve --no-migrate  Serve without running migrations on boot.
 */

import { createServerPoolFromEnv } from "../generated/storage-kit/pool.js";
import { MigrationLedger } from "../generated/storage-kit/migrations.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { resolveServerDataBackend } from "../generated/storage-kit/backend.js";
import { ApiKeyStore } from "@hasna/contracts/auth";
import { SHORTLINKS_MIGRATIONS } from "../db/migrations.js";
import { handleEarlyArgs } from "../early-args.js";
import { PgShortlinksStore } from "../pg-store.js";
import { createServeApp } from "./app.js";
import { createDomainsProvisioningClient, reconcilePendingShortlinksDomains } from "../domains-provisioning.js";

const APP_SLUG = "shortlinks";
const DEFAULT_PORT = 8080;

function resolveSigningSecret(): string {
  const secret =
    process.env.HASNA_SHORTLINKS_API_SIGNING_KEY?.trim() ||
    process.env.HASNA_API_SIGNING_KEY?.trim() ||
    "";
  if (!secret) {
    throw new Error(
      "Missing API signing secret. Set HASNA_SHORTLINKS_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY).",
    );
  }
  return secret;
}


function resolveLinkRouterSecret(): string {
  const values = [
    process.env.HASNA_LINK_ROUTER_SHARED_SECRET,
    process.env.SHORTLINKS_LINK_ROUTER_SHARED_SECRET,
  ].filter((value): value is string => value !== undefined);
  const secret = values[0]?.trim() ?? "";
  if (!secret || values.some((value) => value !== value.trim() || !value.trim()) || new Set(values).size > 1) {
    throw new Error(
      "Missing link-router shared secret. Set HASNA_LINK_ROUTER_SHARED_SECRET " +
      "(or SHORTLINKS_LINK_ROUTER_SHARED_SECRET).",
    );
  }
  return secret;
}

async function runMigrations(client: TypedQueryClient): Promise<void> {
  const ledger = new MigrationLedger(client, SHORTLINKS_MIGRATIONS);
  const result = await ledger.migrate();
  const newlyApplied = result.plan.filter((p) => p.state === "pending").length;
  console.log(`[migrate] ledger ok — ${result.applied.length} total, ${newlyApplied} newly applied`);
}

async function resolveVersion(): Promise<string> {
  if (process.env.SHORTLINKS_VERSION?.trim()) return process.env.SHORTLINKS_VERSION.trim();
  try {
    return (await import("../../package.json")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function usage(): string {
  return `usage: shortlinks-serve [--no-migrate]   Migrate (idempotent) then serve the /v1 HTTP API over PostgreSQL
       shortlinks-serve migrate           Run migrations and exit
       shortlinks-serve --version         Print the version

options:
  --no-migrate        serve without running migrations on boot (env: SHORTLINKS_SKIP_MIGRATE=1)
  --help, -h          show this help and exit
  --version, -V       print the package version and exit

environment:
  HASNA_SHORTLINKS_DATABASE_URL     PostgreSQL DSN (required; the pool factory fails closed without it)
  HASNA_SHORTLINKS_API_SIGNING_KEY  API-key signing secret (or HASNA_API_SIGNING_KEY)
  HASNA_LINK_ROUTER_SHARED_SECRET   authenticates has.na/custom-domain routing hints
  HASNA_DOMAINS_API_KEY             credential for the configured Domains API
  HASNA_DOMAINS_API_URL             optional self-hosted Domains service root (default https://api.hasna.com/domains)
  PORT, HOST                        listen address (default 0.0.0.0:8080)
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // --help / --version answer before the data backend is resolved or a port
  // is bound (hasna/apps#1720 validation): both used to fall through to the
  // PostgreSQL pool factory and die on the missing database URL.
  const early = handleEarlyArgs(args);
  if (early === "help") {
    process.stdout.write(usage());
    return;
  }
  if (early === "version") {
    process.stdout.write(`${await resolveVersion()}\n`);
    return;
  }
  const migrateOnly = args.includes("migrate");
  const skipMigrate = args.includes("--no-migrate") || process.env.SHORTLINKS_SKIP_MIGRATE === "1";

  const backendResolution = resolveServerDataBackend(APP_SLUG);
  const { client, connectionSource } = createServerPoolFromEnv(APP_SLUG, {
    applicationName: "shortlinks-serve",
  });

  if (migrateOnly) {
    await runMigrations(client);
    await client.close();
    return;
  }

  if (!skipMigrate) {
    await runMigrations(client);
  }

  const signingSecret = resolveSigningSecret();
  const linkRouterSecret = resolveLinkRouterSecret();
  const store = PgShortlinksStore.fromQueryClient(client);
  const domains = createDomainsProvisioningClient(process.env);
  const keyStore = new ApiKeyStore(client);
  const version = await resolveVersion();

  const app = createServeApp({
    client,
    store,
    version,
    backend: backendResolution.backend,
    signingSecret,
    linkRouterSecret,
    domains,
    keyStatus: keyStore.keyStatus,
    audit: (e) => console.log("[api_auth]", JSON.stringify(e)),
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  const hostname = process.env.HOST?.trim() || "0.0.0.0";
  Bun.serve({ port, hostname, fetch: app.fetch, idleTimeout: 120 });
  const configuredInterval = Number(process.env.SHORTLINKS_DOMAINS_RECONCILE_INTERVAL_MS ?? "5000");
  if (!Number.isInteger(configuredInterval) || configuredInterval < 1000 || configuredInterval > 300_000) {
    throw new Error("SHORTLINKS_DOMAINS_RECONCILE_INTERVAL_MS must be an integer from 1000 to 300000");
  }
  let reconcileRunning = false;
  const reconcileOnce = async (): Promise<void> => {
    if (reconcileRunning) return;
    reconcileRunning = true;
    try {
      await reconcilePendingShortlinksDomains(store, domains);
    } catch (error) {
      console.error("[domains-api] reconciliation failed:", error instanceof Error ? error.message : String(error));
    } finally {
      reconcileRunning = false;
    }
  };
  const reconcileTimer = setInterval(() => { void reconcileOnce(); }, configuredInterval);
  reconcileTimer.unref?.();
  void reconcileOnce();
  console.log(
    `shortlinks-serve listening on http://${hostname}:${port} (backend=${backendResolution.backend}, db_source=${connectionSource})`,
  );

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  clearInterval(reconcileTimer);
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("[shortlinks-serve] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
