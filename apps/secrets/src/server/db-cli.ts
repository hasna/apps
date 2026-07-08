/**
 * `secrets-serve db <migrate|status|init>` — the cloud migration runner.
 *
 * Invoked by the one-shot ECS migration task (["secrets-serve","db","migrate"])
 * before every service update, and usable locally against a throwaway Postgres.
 * Runs the checksummed MigrationLedger over SECRETS_MIGRATIONS (PURE REMOTE, A1).
 * Lives in the server bundle only — the client `secrets` binary never ships it.
 */

import { createCloudPoolFromEnv, MigrationLedger } from "../generated/storage-kit/index.js";
import { APP_NAME, bootstrapCloudEnv } from "./cloud-env.js";
import { SECRETS_MIGRATIONS } from "./cloud-migrations.js";

export async function runDbCommand(sub: string | undefined): Promise<void> {
  bootstrapCloudEnv();
  const { client, connectionSource } = createCloudPoolFromEnv(APP_NAME, { applicationName: "secrets-migrate" });
  const ledger = new MigrationLedger(client, SECRETS_MIGRATIONS);
  try {
    if (sub === "status") {
      const result = await ledger.migrate({ dryRun: true });
      const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
      console.log(JSON.stringify({ command: "status", source: connectionSource, applied: result.applied.map((a) => a.id), pending }, null, 2));
      return;
    }
    // migrate / init
    const result = await ledger.migrate();
    const applied = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
    console.log(JSON.stringify({ command: "migrate", source: connectionSource, appliedNow: applied, total: result.applied.length }, null, 2));
  } finally {
    await client.close();
  }
}
