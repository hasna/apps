import type { Command } from "commander";
import chalk from "chalk";
import { getStorageStatus } from "../db/storage.js";
import { saveLocalFeedback } from "../db/feedback.js";
import {
  CONTACTS_REMOTE_ENV,
  CONTACTS_REMOTE_TABLES,
  ContactsRemoteSyncError,
  getRemoteStatus,
  getRemoteDatabaseUrl,
  pullRemote,
  pushRemote,
  syncRemote,
  type SyncResult,
} from "../db/remote-sync.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printStorageStatus(json: boolean | undefined): void {
  const status = {
    mode: "local-first" as const,
    local: getStorageStatus(),
    remote: getRemoteStatus(),
  };
  if (json) {
    printJson(status);
    return;
  }

  console.log(`Mode: ${status.mode}`);
  console.log(`Scope: ${chalk.gray("contacts-owned local SQLite with optional PostgreSQL sync")}`);
  console.log(`Database: ${status.local.db_path}`);
  console.log(`Remote sync: ${status.remote.configured ? chalk.green("configured") : chalk.yellow("not configured")}`);
  for (const table of status.local.tables) {
    const value = table.ok
      ? String(table.rows)
      : chalk.red(table.error ?? "unavailable");
    console.log(`  ${table.table}: ${value}`);
  }
}

function cloudStatus() {
  const remote = getRemoteStatus();
  return {
    service: "contacts",
    mode: "local-first",
    remote_sync: {
      configured: Boolean(getRemoteDatabaseUrl()),
      env: CONTACTS_REMOTE_ENV,
      default_tables: remote.default_tables,
      sensitive_tables: remote.sensitive_tables,
      tables: CONTACTS_REMOTE_TABLES,
      sync: remote.sync,
      reason: getRemoteDatabaseUrl()
        ? "Contacts uses repo-owned PostgreSQL sync; the deprecated shared cloud runtime is not used."
        : "Set a contacts-owned PostgreSQL URL to enable sync; the deprecated shared cloud runtime is not used.",
    },
    storage: getStorageStatus(),
  };
}

function parseTables(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((table) => table.trim()).filter(Boolean);
}

function printSyncResults(results: SyncResult[], label: string): void {
  const total = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  for (const result of results) {
    const errors = result.errors.length > 0 ? ` (${result.errors.join("; ")})` : "";
    console.log(`  ${result.table}: ${result.rowsWritten}/${result.rowsRead} rows ${label}${errors}`);
  }
  console.log(`Done. ${total} rows ${label}.`);
}

async function runSyncAction(
  action: () => Promise<SyncResult[] | { pull: SyncResult[]; push: SyncResult[] }>,
  json: boolean | undefined,
  label: "pushed" | "pulled" | "synced",
): Promise<void> {
  try {
    const result = await action();
    if (json) {
      printJson(result);
      return;
    }

    if ("pull" in result) {
      printSyncResults(result.pull, "pulled");
      printSyncResults(result.push, "pushed");
    } else {
      printSyncResults(result, label);
    }
  } catch (error) {
    const payload = {
      ok: false,
      service: "contacts",
      mode: "local-first",
      error: error instanceof Error ? error.message : String(error),
      env: CONTACTS_REMOTE_ENV,
      results: error instanceof ContactsRemoteSyncError ? error.results : undefined,
    };
    if (json) printJson(payload);
    else console.error(payload.error);
    process.exitCode = 1;
  }
}

function addSyncCommands(command: Command): void {
  command
    .command("push")
    .description("Push local contacts data to contacts-owned PostgreSQL storage")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      await runSyncAction(() => pushRemote({ tables: parseTables(opts.tables) }), opts.json, "pushed");
    });

  command
    .command("pull")
    .description("Pull contacts data from contacts-owned PostgreSQL storage")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      await runSyncAction(() => pullRemote({ tables: parseTables(opts.tables) }), opts.json, "pulled");
    });

  command
    .command("sync")
    .description("Bidirectional contacts sync: pull then push")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      await runSyncAction(() => syncRemote({ tables: parseTables(opts.tables) }), opts.json, "synced");
    });
}

function registerCloudCompatibilityCommands(program: Command): void {
  const cloud = program
    .command("cloud")
    .description("Compatibility commands for contacts-owned storage");

  cloud
    .command("status")
    .description("Show contacts storage status and remote sync availability")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const status = cloudStatus();
      if (opts.json) {
        printJson(status);
        return;
      }

      console.log(`Mode: ${status.mode}`);
      console.log(`Service: ${status.service}`);
      console.log(`Remote sync: ${status.remote_sync.configured ? chalk.green("configured") : chalk.yellow("not configured")}`);
      console.log(`Reason: ${status.remote_sync.reason}`);
      console.log(`Database: ${status.storage.db_path}`);
    });

  cloud
    .command("push")
    .description("Compatibility alias for contacts storage push")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      await runSyncAction(() => pushRemote({ tables: parseTables(opts.tables) }), opts.json, "pushed");
    });

  cloud
    .command("pull")
    .description("Compatibility alias for contacts storage pull")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      await runSyncAction(() => pullRemote({ tables: parseTables(opts.tables) }), opts.json, "pulled");
    });

  cloud
    .command("sync")
    .description("Compatibility alias for contacts storage sync")
    .option("--tables <tables>", "Comma-separated table names")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      await runSyncAction(() => syncRemote({ tables: parseTables(opts.tables) }), opts.json, "synced");
    });

  cloud
    .command("feedback")
    .description("Save feedback locally")
    .requiredOption("--message <msg>", "Feedback message")
    .option("--email <email>", "Contact email")
    .option("--json", "Output as JSON")
    .action((opts: { message: string; email?: string; json?: boolean }) => {
      const result = saveLocalFeedback({ message: opts.message, email: opts.email, category: "general" });
      if (opts.json) {
        printJson(result);
        return;
      }
      console.log(`Feedback saved locally (id: ${result.id})`);
    });
}

export function registerStorageCommands(program: Command): void {
  const storage = program
    .command("storage")
    .description("Inspect contacts-owned local storage");

  storage
    .command("status")
    .description("Show local contacts database storage status")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      printStorageStatus(opts.json);
    });

  addSyncCommands(storage);
  registerCloudCompatibilityCommands(program);
}
