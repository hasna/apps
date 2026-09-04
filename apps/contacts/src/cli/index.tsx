#!/usr/bin/env bun
import * as eventsCommander from "@hasna/events/commander";
const { registerEventCommands } = eventsCommander;
// `registerWebhookCommands` only exists in newer @hasna/events builds. Call it
// defensively so the CLI builds/runs against currently-published versions that
// do not export it yet (no published version exposes it as of events 0.1.13).
const registerWebhookCommands = (eventsCommander as {
  registerWebhookCommands?: (program: unknown, opts: { source: string }) => void;
}).registerWebhookCommands;
import { program } from "commander";
import chalk from "chalk";
import { registerCoreCommands } from "./commands/core.js";
import { registerCrmCommands } from "./commands/crm.js";
import { registerAdvancedCommands } from "./commands/advanced.js";
import { registerAudienceCommands } from "./commands/audience.js";
import { registerStorageCommands } from "./storage.js";
import { registerLegacyCommands } from "./legacy.js";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const pkg = _require("../../package.json") as { version: string };

program
  .name("contacts")
  .description("Open Contacts — contact management for AI coding agents")
  .version(pkg.version);

registerCoreCommands(program);
registerCrmCommands(program);
registerAdvancedCommands(program);
registerAudienceCommands(program);
registerStorageCommands(program);
registerLegacyCommands(program);
registerWebhookCommands?.(program, { source: "contacts" });
registerEventCommands(program, { source: "contacts", eventsCommandName: "hasna-events" });


// A command action that throws (e.g. missing HTTPS configuration or an operation
// the /v1 API does not expose) must fail with a clean,
// legible message and a non-zero exit — never a raw JS stacktrace. Route every
// rejection through one boundary so every client command fails closed consistently.
program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // ApiUnavailableError is the designed loud-failure for API-unsupported ops:
  // present it as a warning (expected), other errors as hard failures.
  const isApiUnavailable =
    err instanceof Error && err.name === "ApiUnavailableError";
  console.error("\n" + (isApiUnavailable ? chalk.yellow(message) : chalk.red(message)) + "\n");
  process.exit(1);
});
