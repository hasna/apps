import type { Command } from "commander";
import { getStorageConnectionString } from "../db/cloud-config.js";
import {
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
} from "../db/cloud-sync.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printResults(results: Awaited<ReturnType<typeof pushStorageChanges>>): void {
  for (const result of results) {
    console.log(`${result.table}: ${result.rowsWritten}/${result.rowsRead} row(s)`);
    for (const error of result.errors) console.error(`  ${error}`);
  }
}

function installStorageSubcommands(storage: Command): void {
  storage
    .command("status")
    .description("Show local database and remote storage sync status")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const status = getStorageStatus();
      if (opts.json) {
        printJson(status);
        return;
      }
      console.log(`Mode: ${status.mode}`);
      console.log(`Enabled: ${status.enabled ? "yes" : "no"}`);
      console.log(`Database: ${status.db_path}`);
      for (const table of status.tables) console.log(`  ${table.table}: ${table.rows}`);
    });

  storage
    .command("push")
    .description("Push local brains data to remote PostgreSQL storage")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const results = await pushStorageChanges(parseStorageTables(opts.tables));
        if (opts.json) printJson(results);
        else printResults(results);
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  storage
    .command("pull")
    .description("Pull remote PostgreSQL storage data into the local database")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const results = await pullStorageChanges(parseStorageTables(opts.tables));
        if (opts.json) printJson(results);
        else printResults(results);
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  storage
    .command("sync")
    .description("Push local changes, then pull remote changes")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const result = await syncStorageChanges(parseStorageTables(opts.tables));
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log("Push");
        printResults(result.push);
        console.log("Pull");
        printResults(result.pull);
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  storage
    .command("migrate")
    .description("Apply PostgreSQL migrations to remote storage")
    .option("--connection-string <url>", "PostgreSQL connection string")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const { applyPgMigrations } = await import("../db/pg-migrate.js");
        const result = await applyPgMigrations(opts.connectionString || getStorageConnectionString("brains"));
        if (opts.json) {
          printJson(result);
          return;
        }
        if (result.applied.length > 0) console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`);
        if (result.alreadyApplied.length > 0) console.log(`Already applied: ${result.alreadyApplied.length}`);
        if (result.errors.length > 0) {
          for (const error of result.errors) console.error(error);
          process.exitCode = 1;
        }
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export function registerStorageCommands(program: Command): void {
  installStorageSubcommands(program.command("storage").description("Manage brains local/remote storage sync"));
  installStorageSubcommands(program.command("cloud", { hidden: true }).description("Deprecated alias for storage commands"));
}

export const registerCloudCommands = registerStorageCommands;
