#!/usr/bin/env bun
/**
 * conversations migration runner (one-shot).
 *
 * Applies the app schema (PG_MIGRATIONS) plus the @hasna/contracts api_keys
 * table to the cloud Postgres, running as the OWNER role (DDL privileges).
 * Idempotent — every statement is CREATE ... IF NOT EXISTS or additive, so it
 * never clobbers existing data on a database that already holds rows.
 *
 * Uses the vendored storage kit's pool so TLS is resolved the ONE correct way
 * (libpq `require` semantics — encrypt without hard-failing on the RDS CA
 * chain), exactly like the serve process.
 *
 * Env (owner DSN preferred for DDL):
 *   HASNA_CONVERSATIONS_DATABASE_URL_OWNER  (owner role — used first if set)
 *   HASNA_CONVERSATIONS_DATABASE_URL        (fallback)
 */

import { createPgPool } from "../generated/storage-kit/pool.js";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { ApiKeyStore } from "@hasna/contracts/auth";

function resolveOwnerUrl(): string {
  const url =
    process.env.HASNA_CONVERSATIONS_DATABASE_URL_OWNER ||
    process.env.CONVERSATIONS_DATABASE_URL_OWNER ||
    process.env.HASNA_CONVERSATIONS_DATABASE_URL ||
    process.env.CONVERSATIONS_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing migration DSN. Set HASNA_CONVERSATIONS_DATABASE_URL_OWNER (owner role) " +
        "or HASNA_CONVERSATIONS_DATABASE_URL.",
    );
  }
  return url;
}

export async function runMigrations(): Promise<void> {
  const pool = createPgPool({ connectionString: resolveOwnerUrl(), applicationName: "conversations-migrate", max: 2 });
  const client = createQueryClient(pool);
  try {
    console.log("[migrate] applying app schema (PG_MIGRATIONS)…");
    await client.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    for (const sql of PG_MIGRATIONS) await client.execute(sql);

    console.log("[migrate] ensuring api_keys table…");
    const keys = new ApiKeyStore(client);
    await keys.ensureSchema();

    const tables = await client.many<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    console.log(`[migrate] done. ${tables.length} tables present: ${tables.map((t) => t.tablename).join(", ")}`);
  } finally {
    await pool.end();
  }
}

const isDirect =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js");

if (isDirect) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[migrate] failed:", (e as Error).message);
      process.exit(1);
    });
}
