// Migration runner for the machines cloud database. Connects as the OWNER role
// (DDL) and applies, in order: the api-keys auth schema (@hasna/contracts) then
// the machines registry schema. Idempotent and checksum-guarded by the vendored
// storage kit's MigrationLedger.

import { apiKeyMigrations } from "@hasna/contracts/auth";
import { MigrationLedger, defineMigration, type Migration } from "../generated/storage-kit/migrations.js";
import { getOwnerClient } from "./db.js";
import { MACHINES_MIGRATIONS } from "./migrations.js";

/** Full ordered migration set for the machines database. */
export function allMigrations(): Migration[] {
  const auth = apiKeyMigrations().map((m) => defineMigration(m.id, m.sql));
  return [...auth, ...MACHINES_MIGRATIONS];
}

export interface RunMigrationsResult {
  applied: string[];
  pending: string[];
  alreadyApplied: string[];
}

/** Apply all pending migrations (or report the plan with `dryRun`). */
export async function runMigrations(options: { dryRun?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<RunMigrationsResult> {
  const client = getOwnerClient(options.env ?? process.env);
  try {
    const migrations = allMigrations();
    const ledger = new MigrationLedger(client, migrations);
    const before = new Set((await ledger.listApplied()).map((m) => m.id));
    const result = await ledger.migrate({ dryRun: options.dryRun === true });
    const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
    const alreadyApplied = result.plan.filter((p) => p.state === "already_applied").map((p) => p.migration.id);
    const applied = options.dryRun ? [] : pending.filter((id) => !before.has(id));
    return { applied, pending: options.dryRun ? pending : [], alreadyApplied };
  } finally {
    await client.close();
  }
}
