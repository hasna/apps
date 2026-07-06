import type { Command } from "commander";
import chalk from "chalk";
import {
  DEFAULT_STORAGE_TABLES,
  getCanonicalConversationsRdsConfig,
  getStorageConfig,
  getStorageDatabaseUrl,
  getStoragePg,
  listConflicts,
  runStorageMigrations,
  storagePull,
  storagePush,
  storageSync,
  type StorageSyncResult,
} from "../lib/storage-sync.js";
import { getDb } from "../lib/db.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";

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
  storage.command("status").description("Show remote storage config and sync state").option("--json", "Output as JSON").action((opts: { json?: boolean }) => {
    const config = getStorageConfig();
    const canonical = getCanonicalConversationsRdsConfig();
    const local = getDb();
    const unresolved = listConflicts(local, { resolved: false });
    const resolved = listConflicts(local, { resolved: true });
    const info = {
      mode: config.mode,
      configured: Boolean(getStorageDatabaseUrl()),
      service: "conversations",
      canonical,
      tables: DEFAULT_STORAGE_TABLES,
      conflicts: { unresolved: unresolved.length, resolved: resolved.length },
    };
    if (opts.json) { printJson(info); return; }
    console.log(`Mode: ${info.mode}`);
    console.log("Service: conversations");
    console.log(`Canonical RDS cluster: ${canonical.cluster}`);
    console.log(`Canonical database: ${canonical.database}`);
    console.log(`Runtime secret path: ${canonical.runtimeSecretPath}`);
    console.log(`Database env: ${canonical.env} (fallback: ${canonical.fallbackEnv})`);
    console.log(`Remote storage configured: ${info.configured ? "yes" : "no"}`);
    console.log(`Tables: ${info.tables.join(", ")}`);
    console.log(`Sync conflicts: ${info.conflicts.unresolved} unresolved, ${info.conflicts.resolved} resolved`);
  });

  storage.command("push").description("Push safe local conversations tables to remote PostgreSQL storage").option("--tables <tables>", "Comma-separated table names").option("--json", "Output as JSON").action(async (opts: { tables?: string; json?: boolean }) => {
    try {
      const results = await storagePush({ tables: opts.tables });
      if (opts.json) { printJson(results); return; }
      printResults(results, "pushed");
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

  storage.command("pull").description("Pull conversations tables from remote PostgreSQL storage to local SQLite").option("--tables <tables>", "Comma-separated table names").option("--json", "Output as JSON").action(async (opts: { tables?: string; json?: boolean }) => {
    try {
      const results = await storagePull({ tables: opts.tables });
      if (opts.json) { printJson(results); return; }
      printResults(results, "pulled");
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

  // CUTOVER: gate off. Bidirectional sync is forbidden under Storage Amendment
  // A1 (pure remote). The flip lane must remove this `sync` subcommand (and the
  // push/pull data-path subcommands) before conversations goes remote. See
  // docs/CUTOVER-RUNBOOK.md.
  storage.command("sync").description("Bidirectional sync: pull then push").option("--tables <tables>", "Comma-separated table names").option("--json", "Output as JSON").action(async (opts: { tables?: string; json?: boolean }) => {
    try {
      const result = await storageSync({ tables: opts.tables });
      if (opts.json) { printJson(result); return; }
      printResults(result.pull, "pulled");
      printResults(result.push, "pushed");
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

  storage.command("migrate").description("Run PostgreSQL migrations against the configured remote storage database").option("--dry-run", "Print SQL without executing").action(async (opts: { dryRun?: boolean }) => {
    try {
      if (opts.dryRun) {
        console.log(chalk.dim("-- Dry run: SQL that would be executed --\n"));
        for (const sql of PG_MIGRATIONS) console.log(sql);
        return;
      }
      const pg = await getStoragePg();
      await runStorageMigrations(pg);
      await pg.close();
      console.log(chalk.green("All migrations applied."));
    } catch (error) {
      console.error(chalk.red(`Migration failed: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
}

export function registerStorageCommands(program: Command): void {
  installStorageSubcommands(program.command("storage").description("Storage sync commands"));
}
