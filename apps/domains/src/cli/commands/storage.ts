import type { Command } from "commander";
import chalk from "chalk";
import {
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
  type StorageSyncResult,
} from "../../db/storage-sync.js";
import { compactHint, pageItemsOrExit } from "../../lib/compact-output.js";

function parseTables(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((table) => table.trim()).filter(Boolean);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printResults(results: StorageSyncResult[], label: string): void {
  const total = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  for (const result of results) {
    const errors = result.errors.length > 0 ? ` (${result.errors.join("; ")})` : "";
    console.log(`  ${result.table}: ${result.rowsWritten}/${result.rowsRead} rows ${label}${errors}`);
  }
  console.log(`Done. ${total} rows ${label}.`);
}

function installStorageSubcommands(storage: Command): void {
  storage
    .command("status")
    .description("Show remote storage config and local sync state")
    .option("--limit <n>", "Limit number of displayed sync entries")
    .option("--all", "Show every sync entry")
    .option("--json", "Output as JSON")
    .action((opts: { limit?: string; all?: boolean; json?: boolean }) => {
      const info = getStorageStatus();
      if (opts.json) {
        printJson(info);
        return;
      }
      console.log(`Storage mode: ${info.mode}`);
      console.log(`Remote storage configured: ${info.configured ? "yes" : "no"}`);
      console.log(`Tables: ${info.tables.join(", ")}`);
      if (info.sync.length === 0) console.log("Sync: no local sync history");
      const page = pageItemsOrExit(info.sync, { limit: opts.limit, all: opts.all });
      for (const entry of page.items) {
        console.log(`  ${entry.table_name} ${entry.direction}: ${entry.last_synced_at ?? "never"}`);
      }
      if (info.sync.length > 0) {
        console.log(`\n${compactHint(page, "sync entry(s)", "Use --all for every sync entry or --json for the full status object.", { paging: "limit" })}`);
      }
    });

  storage
    .command("push")
    .description("Push local domains data to remote PostgreSQL storage")
    .option("--tables <tables>", "Comma-separated table names")
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
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  storage
    .command("pull")
    .description("Pull domains data from remote PostgreSQL storage to local SQLite")
    .option("--tables <tables>", "Comma-separated table names")
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
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  storage
    .command("sync")
    .description("Bidirectional sync: pull then push")
    .option("--tables <tables>", "Comma-separated table names")
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
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}

export function registerStorageCommand(program: Command): void {
  installStorageSubcommands(program.command("storage").description("Manage domains local/remote storage sync"));
}
