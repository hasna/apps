import type { Command } from "commander";
import chalk from "chalk";
import { getStorageConnectionString } from "../../db/storage-config.js";
import {
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
} from "../../db/storage-sync.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printResults(results: Awaited<ReturnType<typeof pushStorageChanges>>): void {
  for (const result of results) {
    const line = `${result.table}: ${result.rowsWritten}/${result.rowsRead} row(s)`;
    console.log(result.errors.length > 0 ? chalk.yellow(line) : chalk.green(line));
    for (const error of result.errors) {
      console.error(chalk.red(`  ${error}`));
    }
  }
}

function installStorageSubcommands(storage: Command): void {
  storage
    .command("status")
    .description("Show local database and remote storage sync status")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show all table row counts")
    .action((opts) => {
      const status = getStorageStatus();
      if (opts.json) {
        printJson(status);
        return;
      }
      const nonEmpty = status.tables.filter((table) => table.rows > 0);
      const totalRows = status.tables.reduce((sum, table) => sum + table.rows, 0);
      console.log(`Mode: ${status.mode}`);
      console.log(`Enabled: ${status.enabled ? "yes" : "no"}`);
      console.log(`Database: ${status.db_path}`);
      console.log(`Tables: ${status.tables.length} (${nonEmpty.length} non-empty, ${totalRows} rows)`);
      const visibleTables = opts.verbose ? status.tables : nonEmpty.slice(0, 5);
      for (const table of visibleTables) {
        console.log(`  ${table.table}: ${table.rows}`);
      }
      if (!opts.verbose && status.tables.length > visibleTables.length) {
        console.log(`Use --verbose for all table counts or --json for the full status object.`);
      }
    });

  storage
    .command("push")
    .description("Push local shield data to remote PostgreSQL storage")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const results = await pushStorageChanges(parseStorageTables(opts.tables));
        if (opts.json) printJson(results);
        else printResults(results);
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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
        console.log(chalk.bold("Push"));
        printResults(result.push);
        console.log(chalk.bold("Pull"));
        printResults(result.pull);
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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
        const { applyPgMigrations } = await import("../../db/pg-migrate.js");
        const result = await applyPgMigrations(opts.connectionString || getStorageConnectionString("security"));
        if (opts.json) {
          printJson(result);
          return;
        }
        if (result.applied.length > 0) console.log(chalk.green(`Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`));
        if (result.alreadyApplied.length > 0) console.log(chalk.gray(`Already applied: ${result.alreadyApplied.length}`));
        if (result.errors.length > 0) {
          for (const error of result.errors) console.error(chalk.red(error));
          process.exitCode = 1;
        }
      } catch (error) {
        if (opts.json) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}

export function registerStorageCommands(program: Command): void {
  installStorageSubcommands(program.command("storage").description("Manage shield local/remote storage sync"));
}
