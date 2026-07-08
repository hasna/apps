import type { Command } from "commander";
import chalk from "chalk";
import { getStorageStatus } from "../db/storage.js";
import { saveLocalFeedback } from "../db/feedback.js";
import { resolveClientTransport } from "../cloud/http-storage.js";

// Storage/cloud inspection commands.
//
// The forbidden client-side Postgres-DSN sync path (contacts storage/cloud
// push|pull|sync over HASNA_CONTACTS_DATABASE_URL) has been removed: clients
// NEVER hold the raw RDS DSN. Cloud reads/writes flow through the ApiStore
// (HTTPS /v1 + bearer key) selected by resolveClientTransport. These commands
// are read-only status plus local feedback capture.

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Client-flip transport status WITHOUT exposing any secret value. */
function transportStatus() {
  const resolution = resolveClientTransport("contacts");
  return {
    transport: resolution.transport,
    mode: resolution.mode,
    mode_source: resolution.modeSource,
    api_base_url: resolution.baseUrl,
    api_key_present: resolution.apiKeyPresent,
    misconfigured: resolution.misconfigured,
    warning: resolution.warning,
  };
}

function printStorageStatus(json: boolean | undefined): void {
  const transport = transportStatus();
  const status = {
    transport,
    local: getStorageStatus(),
  };
  if (json) {
    printJson(status);
    return;
  }

  console.log(`Transport: ${transport.transport === "cloud-http" ? chalk.green("cloud-http (self_hosted)") : chalk.cyan("local")}`);
  console.log(`Mode: ${transport.mode} ${chalk.gray(`(${transport.mode_source})`)}`);
  if (transport.api_base_url) console.log(`API: ${transport.api_base_url}`);
  console.log(`API key: ${transport.api_key_present ? chalk.green("present") : chalk.gray("not set")}`);
  console.log(`Database: ${status.local.db_path}`);
  for (const table of status.local.tables) {
    const value = table.ok ? String(table.rows) : chalk.red(table.error ?? "unavailable");
    console.log(`  ${table.table}: ${value}`);
  }
}

function cloudStatus() {
  return {
    service: "contacts",
    transport: transportStatus(),
    storage: getStorageStatus(),
  };
}

export function registerStorageCommands(program: Command): void {
  const storage = program
    .command("storage")
    .description("Inspect contacts storage transport and local database");

  storage
    .command("status")
    .description("Show storage transport (local vs cloud-http) and local database status")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      printStorageStatus(opts.json);
    });

  const cloud = program
    .command("cloud")
    .description("Inspect contacts cloud (self_hosted) transport status");

  cloud
    .command("status")
    .description("Show contacts cloud transport status")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const status = cloudStatus();
      if (opts.json) {
        printJson(status);
        return;
      }
      console.log(`Service: ${status.service}`);
      console.log(`Transport: ${status.transport.transport}`);
      console.log(`Mode: ${status.transport.mode} ${chalk.gray(`(${status.transport.mode_source})`)}`);
      if (status.transport.api_base_url) console.log(`API: ${status.transport.api_base_url}`);
      console.log(`API key: ${status.transport.api_key_present ? chalk.green("present") : chalk.gray("not set")}`);
      console.log(`Database: ${status.storage.db_path}`);
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
