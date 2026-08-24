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
import { VERSION } from "../version.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Binds-before-help class (todos row afd9e358): --help/--version must answer
  // BEFORE ANY dispatch or boot path. The `db` subcommand is deliberately
  // covered too — runDbCommand() opens the cloud pool and, for any sub other
  // than `status`, runs ledger.migrate(), so `db --help`/`db --version` falling
  // through to it could perform a migration instead of answering. Previously
  // these flags fell through to startCloudServer(), which either refused at the
  // master-key gate (rc=1) or bound and served forever (rc=124 under timeout).
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`usage: secrets-serve [options]   Start the secrets cloud HTTP API
  secrets-serve db <migrate|status|init>   run the checksummed cloud migration ledger
  secrets-serve --version                  Print the package version

options:
  -h, --help          show this help and exit
  -V, --version       print the package version and exit
`);
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    process.exit(0);
  }
  const [command, sub] = args;
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
