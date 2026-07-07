#!/usr/bin/env bun
/**
 * Migration runner for the todos cloud (A1 pure-remote) database.
 *
 * Applies the JSONB sync tables the Postgres storage adapter reads/writes and
 * the contracts API-key store, idempotently (CREATE ... IF NOT EXISTS). NEVER
 * drops or rewrites existing tables — safe to run against a populated DB.
 *
 * The canonical DDL is committed under migrations/*.sql for transparency; this
 * runner applies the same statements via the repo-native cloud path so it has a
 * single, tested code path shared with the serve process.
 *
 * Env: HASNA_TODOS_DATABASE_URL (or TODOS_DATABASE_URL / DATABASE_URL).
 * Usage: bun run scripts/migrate.ts
 */
import { ensureCloudSchema, pingCloud, resolveCloudDatabaseUrl, closeCloud } from "../src/server/cloud.js";

async function main() {
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    console.error("migrate: no database URL (HASNA_TODOS_DATABASE_URL / TODOS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (sync tables + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

main().catch((e) => {
  console.error("migrate: failed:", (e as Error).message);
  process.exit(1);
});
