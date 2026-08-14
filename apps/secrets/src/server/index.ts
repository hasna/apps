#!/usr/bin/env bun
/**
 * secrets-serve bin entrypoint — the ONLY place server/DSN code is shipped.
 *
 * This binary lives exclusively in the deployed container image (Dockerfile.package),
 * never on fleet client machines. It owns everything that needs a Postgres DSN:
 *
 *   secrets-serve                    boot the cloud HTTP API (default)
 *   secrets-serve db <migrate|status|init>
 *                                    run the checksummed cloud migration ledger
 *
 * The client CLI (`secrets`) deliberately has NO db/serve-cloud commands, so the
 * DSN-consuming code (createCloudPoolFromEnv, DATABASE_URL fallback, cloud-store)
 * is never bundled into the fleet binary.
 */
import { startCloudServer } from "./serve.js";
import { runDbCommand } from "./db-cli.js";

async function main(): Promise<void> {
  const [command, sub] = process.argv.slice(2);
  if (command === "db") {
    await runDbCommand(sub);
    return;
  }
  await startCloudServer();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
