#!/usr/bin/env bun
/**
 * `shortlinks-serve` — the cloud HTTP service entrypoint.
 *
 * PURE REMOTE (Amendment A1): reads/writes the shared RDS Postgres directly via
 * the vendored storage kit. No sync engine, cache, or local database in the
 * service.
 *
 * Usage:
 *   shortlinks-serve            Run migrations (idempotent) then serve.
 *   shortlinks-serve migrate    Run migrations and exit (one-shot task).
 *   shortlinks-serve --no-migrate  Serve without running migrations on boot.
 */

import { createCloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import { MigrationLedger } from "../generated/storage-kit/migrations.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { resolveStorageMode } from "../generated/storage-kit/mode.js";
import { ApiKeyStore } from "@hasna/contracts/auth";
import { SHORTLINKS_MIGRATIONS } from "../db/migrations.js";
import { PgShortlinksStore } from "../pg-store.js";
import { createServeApp } from "./app.js";

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const migrateOnly = args.includes("migrate");
  const skipMigrate = args.includes("--no-migrate") || process.env.SHORTLINKS_SKIP_MIGRATE === "1";

  const modeResolution = resolveStorageMode(APP_SLUG);
  const { client, connectionSource } = createCloudPoolFromEnv(APP_SLUG, {
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
  const store = PgShortlinksStore.fromQueryClient(client);
  const keyStore = new ApiKeyStore(client);
  const version = await resolveVersion();

  const app = createServeApp({
    client,
    store,
    version,
    mode: modeResolution.mode,
    signingSecret,
    isRevoked: keyStore.isRevoked,
    audit: (e) => console.log("[api_auth]", JSON.stringify(e)),
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  const hostname = process.env.HOST?.trim() || "0.0.0.0";
  Bun.serve({ port, hostname, fetch: app.fetch, idleTimeout: 120 });
  console.log(
    `shortlinks-serve listening on http://${hostname}:${port} (mode=${modeResolution.mode}, db_source=${connectionSource})`,
  );

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("[shortlinks-serve] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
