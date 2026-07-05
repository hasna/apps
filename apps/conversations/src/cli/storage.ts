import type { Command } from "commander";
import chalk from "chalk";
import {
  DEFAULT_STORAGE_TABLES,
  getCanonicalConversationsRdsConfig,
  getStorageConfig,
  getStorageDatabaseUrl,
  getStoragePg,
  getStorageReadiness,
  listConflicts,
  listDuplicateMessageUuids,
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
    const readiness = getStorageReadiness();
    const local = getDb();
    const unresolved = listConflicts(local, { resolved: false });
    const resolved = listConflicts(local, { resolved: true });
    const duplicateMessageUuids = listDuplicateMessageUuids(local);
    const info = {
      mode: config.mode,
      configured: Boolean(getStorageDatabaseUrl()),
      service: "conversations",
      canonical,
      tables: DEFAULT_STORAGE_TABLES,
      table_groups: readiness.tableGroups,
      runtime_paths: readiness.runtimePaths,
      privacy_and_migration_gates: readiness.privacyAndMigrationGates,
      conflicts: { unresolved: unresolved.length, resolved: resolved.length },
      message_uuid_duplicates: duplicateMessageUuids,
    };
    if (opts.json) { printJson(info); return; }
    console.log(`Mode: ${info.mode}`);
    console.log("Service: conversations");
    console.log(`Canonical RDS cluster: ${canonical.cluster}`);
    console.log(`Canonical database: ${canonical.database}`);
    console.log(`Runtime secret path: ${canonical.runtimeSecretPath}`);
    console.log(`Database env: ${canonical.env} (fallback: ${canonical.fallbackEnv})`);
    console.log(`Remote storage configured: ${info.configured ? "yes" : "no"}`);
    console.log(`Default sync group: metadata (${info.tables.join(", ")})`);
    console.log(`Cloud runtime group: cloud-runtime (${readiness.tableGroups.cloudRuntime.join(", ")})`);
    console.log("Attachments: local files only; S3 object storage is an approval-gated follow-up.");
    console.log(`Sync conflicts: ${info.conflicts.unresolved} unresolved, ${info.conflicts.resolved} resolved`);
    console.log(`Message UUID duplicates: ${duplicateMessageUuids.length}`);
  });

  storage.command("readiness").description("Show local/remote storage runtime readiness and migration gates").option("--json", "Output as JSON").action((opts: { json?: boolean }) => {
    const readiness = getStorageReadiness();
    if (opts.json) { printJson(readiness); return; }
    console.log(`Mode: ${readiness.mode}`);
    console.log(`Remote storage configured: ${readiness.configured ? "yes" : "no"}`);
    console.log(`Local SQLite: ${readiness.local.sqlite}`);
    console.log(`Local attachments: ${readiness.local.attachments}`);
    console.log(`Default sync group: metadata (${readiness.tableGroups.default.join(", ")})`);
    console.log(`Cloud runtime group: cloud-runtime (${readiness.tableGroups.cloudRuntime.join(", ")})`);
    for (const path of readiness.runtimePaths) {
      console.log(`\n${path.surface}: ${path.status}`);
      console.log(`  local: ${path.local}`);
      console.log(`  remote: ${path.remote}`);
      if (path.tables.length > 0) console.log(`  tables: ${path.tables.join(", ")}`);
      if (path.gates.length > 0) console.log(`  gates: ${path.gates.join("; ")}`);
    }
    console.log("\nPrivacy and migration gates:");
    for (const gate of readiness.privacyAndMigrationGates) console.log(`  - ${gate}`);
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
