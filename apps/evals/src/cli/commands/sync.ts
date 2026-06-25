import { Command } from "commander";
import {
  STORAGE_TABLES,
  getStoragePg,
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
  getSyncMetaAll,
  runStorageMigrations,
  type SyncResult,
} from "../../db/storage-sync.js";
import { PG_MIGRATIONS } from "../../db/pg-migrations.js";

function parseTables(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((table) => table.trim()).filter(Boolean);
}

function printResults(results: SyncResult[], label: string): void {
  const total = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  for (const result of results) {
    const errors = result.errors.length > 0 ? ` (${result.errors.join("; ")})` : "";
    console.log(`  ${result.table}: ${result.rowsWritten}/${result.rowsRead} rows ${label}${errors}`);
  }
  console.log(`\x1b[32m✓ ${total} rows ${label}\x1b[0m`);
}

export function syncCommand(): Command {
  const cmd = new Command("sync")
    .description("Sync eval runs and baselines with remote PostgreSQL storage");

  cmd
    .command("push")
    .description("Push local runs and baselines to remote storage")
    .option("--dry-run", "Show what would be pushed without doing it")
    .option("--tables <tables>", "Comma-separated table names")
    .action(async (opts: { dryRun?: boolean; tables?: string }) => {
      try {
        if (opts.dryRun) {
          console.log(`Dry run — would push tables: ${(parseTables(opts.tables) ?? [...STORAGE_TABLES]).join(", ")}`);
          return;
        }

        const results = await storagePush({ tables: parseTables(opts.tables) });
        printResults(results, "pushed");
      } catch (err) {
        console.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command("pull")
    .description("Pull runs and baselines from remote storage")
    .option("--dry-run", "Show what would be pulled without doing it")
    .option("--tables <tables>", "Comma-separated table names")
    .action(async (opts: { dryRun?: boolean; tables?: string }) => {
      try {
        if (opts.dryRun) {
          console.log(`Dry run — would pull tables: ${(parseTables(opts.tables) ?? [...STORAGE_TABLES]).join(", ")}`);
          return;
        }

        const results = await storagePull({ tables: parseTables(opts.tables) });
        printResults(results, "pulled");
      } catch (err) {
        console.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command("sync")
    .description("Bidirectional sync: pull then push")
    .option("--tables <tables>", "Comma-separated table names")
    .action(async (opts: { tables?: string }) => {
      try {
        const result = await storageSync({ tables: parseTables(opts.tables) });
        printResults(result.pull, "pulled");
        printResults(result.push, "pushed");
      } catch (err) {
        console.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command("migrate")
    .description("Apply PostgreSQL migrations for evals")
    .option("--dry-run", "Print SQL without executing")
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        if (opts.dryRun) {
          for (const sql of PG_MIGRATIONS) console.log(sql);
          return;
        }
        const pg = await getStoragePg();
        await runStorageMigrations(pg);
        await pg.close();
        console.log("\x1b[32m✓ Migrations applied\x1b[0m");
      } catch (err) {
        console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Show storage sync status")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const status = getStorageStatus();
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      console.log(`Storage configured: ${status.configured ? "yes" : "no"}`);
      console.log(`Mode: ${status.mode}`);
      console.log(`Env: ${status.env.join(", ")}`);
      console.log(`Tables: ${status.tables.join(", ")}`);
      const sync = getSyncMetaAll();
      if (sync.length === 0) console.log("Sync: no local sync history");
      for (const entry of sync) {
        console.log(`  ${entry.table_name} ${entry.direction}: ${entry.last_synced_at ?? "never"}`);
      }
    });

  return cmd;
}
