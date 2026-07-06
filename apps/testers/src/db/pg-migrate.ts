/**
 * Postgres migration runner for testers cloud mode.
 *
 * The canonical schema lives in `pg-migrations.ts` (PG_MIGRATIONS) plus the
 * shared api-keys migrations from `@hasna/contracts/auth`. Those are stamped
 * into the `migrations/` directory as .sql files (see scripts/gen-migrations.ts)
 * for inventory/inspection; this runner uses the canonical in-code definitions
 * as the single source of truth and applies them through the vendored storage
 * kit's checksum-guarded MigrationLedger (idempotent, drift/downgrade-safe).
 */
import { apiKeyMigrations } from "@hasna/contracts/auth";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import {
  MigrationLedger,
  defineMigration,
  type Migration,
  type MigrationResult,
} from "../generated/storage-kit/migrations.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

/**
 * Build the ordered migration list. The entire PG schema is a single
 * checksum-guarded migration (every statement is idempotent — `IF NOT EXISTS` /
 * `ADD COLUMN IF NOT EXISTS`), followed by the shared api-keys table migrations.
 */
export function getPgMigrations(): Migration[] {
  const coreSql = PG_MIGRATIONS.map((s) => s.trim().replace(/;+\s*$/, "")).join(";\n\n") + ";";
  const core = defineMigration("0001_testers_core_schema", coreSql);
  const auth = apiKeyMigrations().map((m) => defineMigration(m.id, m.sql));
  return [core, ...auth];
}

/** Apply all pending migrations against the cloud Postgres. */
export async function runPgMigrations(
  client: TypedQueryClient,
  opts: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const ledger = new MigrationLedger(client, getPgMigrations());
  return ledger.migrate({ dryRun: opts.dryRun === true });
}
