import type { Command } from "commander";
import {
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
  type SyncResult,
} from "../db/storage-sync.js";
import { DEFAULT_ROW_LIMIT, parseCursor, parseLimit } from "./output.js";

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
    const errors = result.errors.length > 0 ? ` (${result.errors.join("; ")})` : "";
    console.log(`  ${result.table}: ${result.rowsWritten}/${result.rowsRead} rows ${label}${errors}`);
  }
  console.log(`Done. ${total} rows ${label}.`);
}

export function registerStorageCommands(program: Command): void {
  const storageCmd = program.command("storage").description("Storage sync commands");

  storageCmd
    .command("status")
    .description("Show storage config and local sync state")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show all local sync history rows", false)
    .option("-n, --limit <n>", "Number of sync history rows to show", String(DEFAULT_ROW_LIMIT))
    .option("--cursor <n>", "Zero-based sync history offset", "0")
    .action((opts: { json?: boolean; verbose?: boolean; limit?: string; cursor?: string }) => {
      const info = getStorageStatus();
      if (opts.json) {
        printJson(info);
        return;
      }
      console.log(`Storage configured: ${info.configured ? "yes" : "no"}`);
      console.log(`Mode: ${info.mode} | Active env: ${info.activeEnv ?? "none"} | Service: ${info.service}`);
      console.log(`Tables: ${info.tables.length} (${info.tables.join(", ")})`);
      if (info.sync.length === 0) console.log("Sync: no local sync history");
      const cursor = parseCursor(opts.cursor);
      const limit = opts.verbose ? info.sync.length : parseLimit(opts.limit);
      const visible = opts.verbose ? info.sync : info.sync.slice(cursor, cursor + limit);
      for (const entry of visible) {
        console.log(`  ${entry.table_name} ${entry.direction}: ${entry.last_synced_at ?? "never"}`);
      }
      if (!opts.verbose && info.sync.length > cursor + visible.length) {
        console.log(`More sync history available: use --cursor ${cursor + visible.length} --limit ${limit} or --verbose.`);
      }
      console.log("Full storage state: use `computer storage status --json`.");
    });

  storageCmd
    .command("push")
    .description("Push local computer data to storage PostgreSQL")
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
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  storageCmd
    .command("pull")
    .description("Pull computer data from storage PostgreSQL to local SQLite")
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
        console.error(error instanceof Error ? error.message : String(error));
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
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
