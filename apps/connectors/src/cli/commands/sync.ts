import { Command } from "commander";
import chalk from "chalk";
import { getRemoteDatabaseUrl, getSyncMetaAll, remotePull, remotePush } from "../../lib/remote-sync.js";
import type { SyncProgress, SyncResult } from "../../lib/storage-sync.js";

function parseTables(value?: string): string[] | undefined {
  return value?.split(",").map((table) => table.trim()).filter(Boolean);
}

function progressLine(progress: SyncProgress): void {
  if (progress.phase !== "done") return;
  console.log(`  ${progress.table}: ${progress.rowsWritten} rows synced`);
}

function printResults(direction: "pushed" | "pulled", results: SyncResult[]): void {
  const total = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  console.log(`Done. ${total} rows ${direction}.`);
  for (const result of results) {
    if (result.errors.length > 0) console.warn(`  ${result.table}: ${result.errors.join(", ")}`);
  }
}

function printSyncError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exitCode = 1;
}

function requireDatabaseUrl(): boolean {
  if (!getRemoteDatabaseUrl()) {
    console.error(chalk.red("Missing HASNA_CONNECTORS_DATABASE_URL or CONNECTORS_DATABASE_URL"));
    process.exitCode = 1;
    return false;
  }
  return true;
}

export function registerCommands(program: Command): void {
  const storageCmd = program
    .command("storage")
    .description("Remote PostgreSQL storage sync commands");

  storageCmd
    .command("status")
    .description("Show configured remote database and local sync history")
    .action(() => {
      const url = getRemoteDatabaseUrl();
      console.log(chalk.bold("\nRemote storage:\n"));
      console.log(`  database: ${url ? "configured" : "not configured"}`);
      const meta = getSyncMetaAll();
      if (!meta.length) {
        console.log("\nNo sync history found. Run: connectors storage sync push");
        return;
      }
      console.log(chalk.bold("\nSync status:\n"));
      for (const item of meta) {
        console.log(`  ${chalk.cyan(item.table_name.padEnd(32))} last synced: ${item.last_synced_at ?? "never"} (${item.direction})`);
      }
      console.log();
    });

  const syncCmd = storageCmd
    .command("sync")
    .description("Sync local SQLite data with repo-owned remote PostgreSQL storage");

  syncCmd
    .command("push")
    .description("Push local changes to remote PostgreSQL")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--full", "Compatibility flag; sync is table-wide by default", false)
    .action(async (opts: { tables?: string }) => {
      if (!requireDatabaseUrl()) return;
      try {
        const results = await remotePush({ tables: parseTables(opts.tables), onProgress: progressLine });
        printResults("pushed", results);
      } catch (error) {
        printSyncError(error);
      }
    });

  syncCmd
    .command("pull")
    .description("Pull remote PostgreSQL changes to local SQLite")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--full", "Compatibility flag; sync is table-wide by default", false)
    .action(async (opts: { tables?: string }) => {
      if (!requireDatabaseUrl()) return;
      try {
        const results = await remotePull({ tables: parseTables(opts.tables), onProgress: progressLine });
        printResults("pulled", results);
      } catch (error) {
        printSyncError(error);
      }
    });

  syncCmd
    .command("status")
    .description("Show last-synced timestamps per table")
    .action(() => {
      const meta = getSyncMetaAll();
      if (!meta.length) {
        console.log("No sync history found. Run: connectors storage sync push");
        return;
      }
      console.log(chalk.bold("\nSync status:\n"));
      for (const item of meta) {
        console.log(`  ${chalk.cyan(item.table_name.padEnd(32))} last synced: ${item.last_synced_at ?? "never"} (${item.direction})`);
      }
      console.log();
    });
}
