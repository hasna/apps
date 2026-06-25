import type { Command } from "commander";
import {
  STORAGE_TABLES,
  getStorageDatabaseUrl,
  getStorageMode,
  getSyncMetaAll,
  storagePull,
  storagePush,
  storageSync,
  type SyncResult,
} from "../../db/storage-sync.js";
import { applyPgMigrations } from "../../db/pg-migrate.js";
import { printError, printInfo, printSuccess } from "../ui.js";

const STORAGE_ENV = [
  "HASNA_BRAINS_DATABASE_URL",
  "BRAINS_DATABASE_URL",
] as const;

function parseTables(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((table) => table.trim()).filter(Boolean);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printResults(results: SyncResult[], label: string): void {
  const total = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  for (const result of results) {
    const errorSuffix = result.errors.length > 0 ? ` (${result.errors.join("; ")})` : "";
    printInfo(`  ${result.table}: ${result.rowsWritten}/${result.rowsRead} rows ${label}${errorSuffix}`);
  }
  printSuccess(`Done. ${total} rows ${label}.`);
}

export function registerStorageCommands(program: Command): void {
  const storageCmd = program.command("storage").description("Storage sync commands");

  storageCmd
    .command("status")
    .description("Show storage config and local sync state")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const info = {
        configured: Boolean(getStorageDatabaseUrl()),
        mode: getStorageMode(),
        env: STORAGE_ENV,
        service: "brains",
        tables: STORAGE_TABLES,
        sync: getSyncMetaAll(),
      };

      if (opts.json) {
        printJson(info);
        return;
      }

      printInfo(`Storage configured: ${info.configured ? "yes" : "no"}`);
      printInfo(`Tables: ${info.tables.join(", ")}`);
      if (info.sync.length === 0) printInfo("Sync: no local sync history");
      for (const entry of info.sync) {
        printInfo(`  ${entry.table_name} ${entry.direction}: ${entry.last_synced_at ?? "never"}`);
      }
    });

  storageCmd
    .command("push")
    .description("Push local data to storage PostgreSQL")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      try {
        const results = await storagePush({ tables: parseTables(opts.tables) });
        if (opts.json) {
          printJson(results);
          return;
        }
        printResults(results, "pushed");
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  storageCmd
    .command("pull")
    .description("Pull storage data to local SQLite")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      try {
        const results = await storagePull({ tables: parseTables(opts.tables) });
        if (opts.json) {
          printJson(results);
          return;
        }
        printResults(results, "pulled");
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  storageCmd
    .command("sync")
    .description("Bidirectional sync: pull then push")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      try {
        const result = await storageSync({ tables: parseTables(opts.tables) });
        if (opts.json) {
          printJson(result);
          return;
        }
        printResults(result.pull, "pulled");
        printResults(result.push, "pushed");
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  storageCmd
    .command("migrate-pg")
    .description("Apply PostgreSQL migrations to the storage database")
    .requiredOption("--connection-string <connStr>", "PostgreSQL connection string")
    .option("--json", "Output as JSON")
    .action(async (opts: { connectionString: string; json?: boolean }) => {
      try {
        const result = await applyPgMigrations(opts.connectionString);
        if (opts.json) {
          printJson(result);
          return;
        }
        printSuccess(`Applied ${result.applied.length} migration(s), skipped ${result.alreadyApplied.length}.`);
        if (result.errors.length > 0) {
          printError(result.errors.join("\n"));
          process.exit(1);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
