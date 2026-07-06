#!/usr/bin/env bun
/**
 * Migration runner for the contacts cloud (A1 pure-remote) database.
 *
 * Applies the relational contacts schema (translated for Postgres in
 * src/db/pg-migrations.ts) plus the contracts API-key store, idempotently
 * (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT). NEVER
 * drops or rewrites existing tables — safe to run against a populated DB.
 *
 * The canonical DDL is also committed under migrations/*.sql for transparency;
 * this runner applies the same statements via the repo-native cloud path so the
 * serve process and the migration task share a single tested code path.
 *
 * Env: HASNA_CONTACTS_DATABASE_URL (or CONTACTS_DATABASE_URL / DATABASE_URL).
 * Usage: bun run scripts/migrate.ts
 */
import { ensureCloudSchema, pingCloud, resolveCloudDatabaseUrl, closeCloud } from "../src/server/cloud.js";

async function main() {
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    console.error("migrate: no database URL (HASNA_CONTACTS_DATABASE_URL / CONTACTS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (contacts relational schema + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

main().catch((e) => {
  console.error("migrate: failed:", (e as Error).message);
  process.exit(1);
});
