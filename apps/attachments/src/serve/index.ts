#!/usr/bin/env bun
/**
 * `attachments-serve` — the cloud HTTP service entrypoint.
 *
 * PURE REMOTE (Amendment A1): reads/writes the shared RDS Postgres directly via
 * the vendored storage kit; object bytes live in S3. No sync engine, cache, or
 * local database in the service.
 *
 * Usage:
 *   attachments-serve            Run migrations (idempotent) then serve.
 *   attachments-serve migrate    Run migrations and exit (one-shot task).
 *   attachments-serve --no-migrate  Serve without running migrations on boot.
 */

import { MigrationLedger } from "../server-storage/migrations.js";
import type { TypedQueryClient } from "../server-storage/query.js";
import { ApiKeyStore } from "@hasna/contracts/auth";
import { createServerPool } from "./database.js";
import { normalizeConfig, type AttachmentsConfig, type DeepPartial } from "../core/config.js";
import { ATTACHMENTS_MIGRATIONS } from "../db/migrations.js";
import { PgAttachmentsStore } from "../db/pg-store.js";
import { createServeApp } from "./app.js";

const APP_SLUG = "attachments";

/**
 * Classify early-exit arguments before any pool creation or bind work.
 * --help/--version must answer with rc=0 and the pool never created
 * (binds-before-help class; attachments-serve previously created the DB pool
 * first and died on createCloudPoolFromEnv before answering, BUG row 970d7c6f).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

export function printHelp(): void {
  console.log(`usage: attachments-serve [--help] [--version] [migrate] [--no-migrate]

attachments-serve — cloud HTTP service for @hasna/attachments.

commands:
  migrate             run migrations and exit (one-shot task)
  --no-migrate        serve without running migrations on boot

options:
  --help              show this help and exit
  --version           print the package version and exit
`);
}

export async function printVersion(): Promise<void> {
  const version = process.env.ATTACHMENTS_VERSION || (await import("../../package.json")).version;
  console.log(version);
}

export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const values = [env.HASNA_ATTACHMENTS_API_SIGNING_KEY, env.HASNA_API_SIGNING_KEY].filter((v): v is string => v !== undefined);
  const secret = values[0] ?? "";
  if (!secret.trim() || values.some(v => v !== v.trim() || !v.trim()) || new Set(values).size > 1) {
    throw new Error(
      "Missing API signing secret. Set HASNA_ATTACHMENTS_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY).",
    );
  }
  return secret;
}

function buildConfigFromEnv(): AttachmentsConfig {
  const bucket = process.env.ATTACHMENTS_S3_BUCKET?.trim() || "";
  if (!bucket) throw new Error("Service object storage requires ATTACHMENTS_S3_BUCKET.");
  const region =
    process.env.ATTACHMENTS_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";
  const publicBaseUrl =
    process.env.ATTACHMENTS_PUBLIC_BASE_URL?.trim() ||
    process.env.ATTACHMENTS_BASE_URL?.trim() ||
    "";
  const partial: DeepPartial<AttachmentsConfig> = {
    s3: {
      bucket,
      region,
      accessKeyId: process.env.ATTACHMENTS_S3_ACCESS_KEY_ID?.trim() || "",
      secretAccessKey: process.env.ATTACHMENTS_S3_SECRET_ACCESS_KEY?.trim() || "",
      ...(process.env.ATTACHMENTS_S3_PROFILE?.trim()
        ? { profile: process.env.ATTACHMENTS_S3_PROFILE.trim() }
        : {}),
      ...(process.env.ATTACHMENTS_S3_ENDPOINT ? { endpoint: process.env.ATTACHMENTS_S3_ENDPOINT } : {}),
    },
    storage: {
      backend: "s3",
      maxSizeBytes: process.env.ATTACHMENTS_MAX_SIZE
        ? parseInt(process.env.ATTACHMENTS_MAX_SIZE, 10)
        : 10 * 1024 * 1024 * 1024,
    },
    server: {
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3459,
      host: "0.0.0.0",
      baseUrl: publicBaseUrl || `http://0.0.0.0:${process.env.PORT ?? 3459}`,
      publicPath: "/a",
    },
    defaults: { linkType: "presigned" },
    ...(publicBaseUrl
      ? { domains: [{ hostname: new URL(publicBaseUrl).host, baseUrl: publicBaseUrl, primary: true }] }
      : {}),
  };
  return normalizeConfig(partial);
}

async function runMigrations(client: TypedQueryClient) {
  const ledger = new MigrationLedger(client, ATTACHMENTS_MIGRATIONS);
  const result = await ledger.migrate();
  const applied = result.plan.filter((p) => p.state === "pending").length;
  console.log(`[migrate] ledger ok — ${result.applied.length} total, ${applied} newly applied`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const early = handleEarlyArgs(args);
  if (early === "help") {
    printHelp();
    return;
  }
  if (early === "version") {
    await printVersion();
    return;
  }
  const migrateOnly = args.includes("migrate");
  const skipMigrate = args.includes("--no-migrate") || process.env.ATTACHMENTS_SKIP_MIGRATE === "1";

  const signingSecret = migrateOnly ? "" : resolveSigningSecret();
  const config = migrateOnly ? null : buildConfigFromEnv();
  const client = createServerPool(process.env);

  if (migrateOnly) {
    await runMigrations(client);
    await client.close();
    return;
  }

  if (!skipMigrate) {
    await runMigrations(client);
  }

  if (!config) throw new Error("Service configuration unavailable.");
  const store = new PgAttachmentsStore(client);
  const keyStore = new ApiKeyStore(client);
  const version = process.env.ATTACHMENTS_VERSION || (await import("../../package.json")).version;

  const app = createServeApp({
    client,
    store,
    config,
    version,
    mode: "postgresql",
    signingSecret,
    isRevoked: keyStore.isRevoked,
    audit: (e) => console.log("[api_auth]", JSON.stringify(e)),
  });

  const port = config.server.port;
  const hostname = config.server.host;
  Bun.serve({ port, hostname, fetch: app.fetch, idleTimeout: 120 });
  console.log(
    `attachments-serve listening on http://${hostname}:${port} (backend=postgresql, db_source=server-config)`,
  );

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await client.close();
  process.exit(0);
}

if (import.meta.main) main().catch((error) => {
  // Surface the underlying cause (e.g. the missing HASNA_ATTACHMENTS_DATABASE_URL
  // or signing-key env) so startup failures are actionable; the values are
  // never part of these messages.
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  console.error(`[attachments-serve] fatal: startup failed; verify PostgreSQL, object storage and signing configuration.${detail}`);
  process.exit(1);
});
