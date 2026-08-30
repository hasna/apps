import { createRequire } from "node:module";
import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../store/index.js";
import { resolveClientTransport } from "../cloud/http-storage.js";

// Storage/cloud inspection commands.
//
// The forbidden client-side Postgres-DSN sync path (contacts storage/cloud
// push|pull|sync over HASNA_CONTACTS_DATABASE_URL) has been removed: clients
// NEVER hold the raw RDS DSN. Cloud reads/writes flow through the ApiStore
// (HTTPS /v1 + bearer key) selected by resolveClientTransport. These commands
// are read-only status plus feedback capture, and they route EVERYTHING through
// the single Store — no command touches the db/* layer or raw SQLite directly.

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

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

async function printStorageStatus(json: boolean | undefined): Promise<void> {
  const transport = transportStatus();
  const local = await getStore().storageStatus();
  const status = { transport, local };
  if (json) {
    printJson(status);
    return;
  }

  console.log(`Transport: ${transport.transport === "cloud-http" ? chalk.green("cloud-http (self_hosted)") : chalk.cyan("local")}`);
  console.log(`Mode: ${transport.mode} ${chalk.gray(`(${transport.mode_source})`)}`);
  if (transport.api_base_url) console.log(`API: ${transport.api_base_url}`);
  console.log(`API key: ${transport.api_key_present ? chalk.green("present") : chalk.gray("not set")}`);
  if (local) {
    console.log(`Database: ${local.db_path}`);
    for (const table of local.tables) {
      const value = table.ok ? String(table.rows) : chalk.red(table.error ?? "unavailable");
      console.log(`  ${table.table}: ${value}`);
    }
  } else {
    console.log(chalk.gray("Storage: cloud-http (no on-box tables)"));
  }
}

export function registerStorageCommands(program: Command): void {
  const storage = program
    .command("storage")
    .description("Inspect contacts storage transport and local database");

  storage
    .command("status")
    .description("Show storage transport (local vs cloud-http) and local database status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      await printStorageStatus(opts.json);
    });

  const cloud = program
    .command("cloud")
    .description("Inspect contacts cloud (self_hosted) transport status");

  cloud
    .command("status")
    .description("Show contacts cloud transport status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const transport = transportStatus();
      const storageStatus = await getStore().storageStatus();
      const status = { service: "contacts", transport, storage: storageStatus };
      if (opts.json) {
        printJson(status);
        return;
      }
      console.log(`Service: ${status.service}`);
      console.log(`Transport: ${status.transport.transport}`);
      console.log(`Mode: ${status.transport.mode} ${chalk.gray(`(${status.transport.mode_source})`)}`);
      if (status.transport.api_base_url) console.log(`API: ${status.transport.api_base_url}`);
      console.log(`API key: ${status.transport.api_key_present ? chalk.green("present") : chalk.gray("not set")}`);
      console.log(`Database: ${status.storage ? status.storage.db_path : chalk.gray("cloud-http (no on-box database)")}`);
    });

  cloud
    .command("feedback")
    .description("Save contacts feedback through the active storage (local db, or the /v1 API in self_hosted mode)")
    .requiredOption("--message <msg>", "Feedback message")
    .option("--email <email>", "Contact email")
    .option("--json", "Output as JSON")
    .action(async (opts: { message: string; email?: string; json?: boolean }) => {
      const store = getStore();
      await store.saveFeedback(opts.message, opts.email ?? null, "general", pkg.version);
      const result = { saved: true, mode: store.mode };
      if (opts.json) {
        printJson(result);
        return;
      }
      console.log(`Feedback saved (transport: ${store.mode === "api" ? "cloud-http" : "local"})`);
    });
}
