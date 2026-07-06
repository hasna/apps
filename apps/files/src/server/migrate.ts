#!/usr/bin/env bun
/**
 * Cloud migration runner for open-files (used by the one-shot ECS migration
 * task and local ops). Applies the full ordered CLOUD_MIGRATIONS set through
 * the vendored storage kit's drift/downgrade-guarded MigrationLedger against
 * the RDS Postgres reachable via HASNA_FILES_DATABASE_URL.
 *
 * Idempotent: already-applied migrations are skipped; the existing schema (if
 * pre-created) is inventoried and never clobbered (all DDL is IF NOT EXISTS /
 * ADD COLUMN IF NOT EXISTS).
 */
import { createCloudPoolFromEnv } from "../generated/storage-kit/index.js";
import { MigrationLedger } from "../generated/storage-kit/migrations.js";
import { CLOUD_MIGRATIONS } from "../db/cloud-migrations.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--check") || process.argv.includes("--dry-run");
  const { client, connectionSource } = createCloudPoolFromEnv("files", { applicationName: "files-migrate", max: 2 });
  console.log(`files-migrate: connected (source=${connectionSource}) — ${CLOUD_MIGRATIONS.length} migrations`);
  const ledger = new MigrationLedger(client, CLOUD_MIGRATIONS);
  const result = await ledger.migrate({ dryRun });
  const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
  const applied = result.plan.filter((p) => p.state === "already_applied").length;
  if (dryRun) {
    console.log(`files-migrate: dry-run — ${pending.length} pending, ${applied} already applied`);
    if (pending.length) console.log(`  pending: ${pending.join(", ")}`);
    process.exit(pending.length ? 1 : 0);
  }
  console.log(`files-migrate: done — ${result.applied.length} migrations recorded in ledger`);
}

main().catch((e) => { console.error(`files-migrate: FAILED — ${(e as Error).message}`); process.exit(1); });
