import type { Command } from "commander";
import chalk from "chalk";
import { getStorageStatus } from "../db/storage.js";
import { saveLocalFeedback } from "../db/feedback.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printStorageStatus(json: boolean | undefined): void {
  const status = getStorageStatus();
  if (json) {
    printJson(status);
    return;
  }

  console.log(`Mode: ${status.mode}`);
  console.log(`Scope: ${chalk.gray("local-only contacts storage")}`);
  console.log(`Database: ${status.db_path}`);
  for (const table of status.tables) {
    const value = table.ok
      ? String(table.rows)
      : chalk.red(table.error ?? "unavailable");
    console.log(`  ${table.table}: ${value}`);
  }
}

function cloudStatus() {
  return {
    service: "contacts",
    mode: "local",
    remote_sync: {
      configured: false,
      reason: "Contacts no longer uses the deprecated shared cloud runtime. Use contacts-owned storage until repo-native remote sync is configured.",
    },
    storage: getStorageStatus(),
  };
}

function printUnsupportedCloudSync(operation: "push" | "pull", json: boolean | undefined): void {
  const payload = {
    ok: false,
    operation,
    service: "contacts",
    mode: "local",
    error: "Repo-native contacts remote sync is not configured in this package yet.",
    next: "Use `contacts storage status` to inspect local data.",
  };
  if (json) printJson(payload);
  else console.error(payload.error);
  process.exitCode = 1;
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
      console.log(`Remote sync: ${chalk.yellow("not configured")}`);
      console.log(`Reason: ${status.remote_sync.reason}`);
      console.log(`Database: ${status.storage.db_path}`);
    });

  cloud
    .command("push")
    .description("Report remote push availability")
    .option("--tables <tables>", "Accepted for compatibility; remote sync is not configured")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      printUnsupportedCloudSync("push", opts.json);
    });

  cloud
    .command("pull")
    .description("Report remote pull availability")
    .option("--tables <tables>", "Accepted for compatibility; remote sync is not configured")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      printUnsupportedCloudSync("pull", opts.json);
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

  registerCloudCompatibilityCommands(program);
}
