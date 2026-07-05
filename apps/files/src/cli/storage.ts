import type { Command } from "commander";
import chalk from "chalk";
import { getStorageConnectionString } from "../db/storage-config.js";
import {
  DEFAULT_GOOGLE_DRIVE_CANONICAL_MAPPING_PATH,
  getStorageStatus,
  importGoogleDriveMetadata,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
} from "../db/storage-sync.js";

function useJson(opts: { json?: boolean }): boolean {
  return Boolean(opts.json);
}

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

interface StorageCommandOptions {
  tables?: string;
  connectionString?: string;
  mappingFile?: string;
  json?: boolean;
}

export function registerStorageCommands(program: Command): void {
  const storage = program
    .command("storage")
    .description("Manage files local/remote storage sync");

  storage
    .command("status")
    .description("Show local database, remote metadata, and object storage status")
    .option("--json", "Output as JSON")
    .action((opts: StorageCommandOptions) => {
      const status = getStorageStatus();
      if (useJson(opts)) {
        printJson(status);
        return;
      }

      console.log(`Mode: ${status.mode}`);
      console.log(`Enabled: ${status.enabled ? "yes" : "no"}`);
      console.log(`Local index: SQLite (${status.runtime.local_index.db_path})`);
      console.log(`Remote metadata: ${status.remote_configured ? "configured" : "not configured"}`);
      if (status.database_url_env) console.log(`Database URL env: ${status.database_url_env}`);
      console.log(`Remote sync: ${status.runtime.remote_metadata.sync}`);
      console.log(`Object storage: ${status.object_storage.provider}`);
      if (status.object_storage.provider === "s3") {
        console.log(`  bucket: ${status.object_storage.bucket ?? "(unset)"}`);
        console.log(`  region: ${status.object_storage.region ?? "(unset)"}`);
        if (status.object_storage.prefix) console.log(`  prefix: ${status.object_storage.prefix}`);
        console.log(`  credentials: ${status.object_storage.credential_source ?? "default_provider_chain"}`);
        if (status.object_storage.endpoint_configured) console.log("  endpoint: configured");
        if (status.object_storage.force_path_style) console.log("  force path style: yes");
      } else {
        console.log(`  local root: ${status.object_storage.local_root ?? "(unset)"}`);
      }
      console.log("Boundary: status and metadata sync do not move object bytes or replace the local SQLite index.");
      for (const table of status.tables) {
        console.log(`  ${table.table}: ${table.rows}`);
      }
    });

  storage
    .command("push")
    .description("Push local files metadata to PostgreSQL")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: StorageCommandOptions) => {
      try {
        const results = await pushStorageChanges(parseStorageTables(opts.tables));
        if (useJson(opts)) printJson(results);
        else printResults(results);
      } catch (error) {
        if (useJson(opts)) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  storage
    .command("pull")
    .description("Pull PostgreSQL files metadata into the local database")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: StorageCommandOptions) => {
      try {
        const results = await pullStorageChanges(parseStorageTables(opts.tables));
        if (useJson(opts)) printJson(results);
        else printResults(results);
      } catch (error) {
        if (useJson(opts)) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  storage
    .command("import-google-drive")
    .description("Push local Google Drive metadata and apply canonical S3 object mapping to PostgreSQL")
    .option("--mapping-file <path>", "Canonical object mapping JSONL file", DEFAULT_GOOGLE_DRIVE_CANONICAL_MAPPING_PATH)
    .option("--json", "Output as JSON")
    .action(async (opts: StorageCommandOptions) => {
      try {
        const result = await importGoogleDriveMetadata(opts.mappingFile || DEFAULT_GOOGLE_DRIVE_CANONICAL_MAPPING_PATH);
        if (useJson(opts)) {
          printJson(result);
          return;
        }

        console.log(chalk.bold("Push"));
        printResults(result.push);
        console.log(chalk.bold("Canonical Google Drive mapping"));
        const mapping = result.mapping;
        const line = `${mapping.rowsApplied}/${mapping.rowsRead} row(s) mapped`;
        console.log(mapping.errors.length > 0 || mapping.rowsMissingInPostgres > 0 ? chalk.yellow(line) : chalk.green(line));
        if (mapping.rowsMissingInPostgres > 0) console.error(chalk.yellow(`  ${mapping.rowsMissingInPostgres} row(s) missing in Postgres`));
        for (const error of mapping.errors) console.error(chalk.red(`  ${error}`));
        if (mapping.errors.length > 0 || mapping.rowsMissingInPostgres > 0) process.exitCode = 1;
      } catch (error) {
        if (useJson(opts)) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  storage
    .command("sync")
    .description("Push local metadata, then pull remote metadata")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: StorageCommandOptions) => {
      try {
        const result = await syncStorageChanges(parseStorageTables(opts.tables));
        if (useJson(opts)) {
          printJson(result);
          return;
        }
        console.log(chalk.bold("Push"));
        printResults(result.push);
        console.log(chalk.bold("Pull"));
        printResults(result.pull);
      } catch (error) {
        if (useJson(opts)) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  storage
    .command("migrate")
    .description("Apply PostgreSQL metadata migrations")
    .option("--connection-string <url>", "PostgreSQL connection string")
    .option("--json", "Output as JSON")
    .action(async (opts: StorageCommandOptions) => {
      try {
        const { applyPgMigrations } = await import("../db/pg-migrate.js");
        const result = await applyPgMigrations(opts.connectionString || getStorageConnectionString("files"));
        if (useJson(opts)) {
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
        if (useJson(opts)) printJson({ error: error instanceof Error ? error.message : String(error) });
        else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
