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
import { registerCoreCommands } from "./commands/core.js";
import { registerCrmCommands } from "./commands/crm.js";
import { registerAdvancedCommands } from "./commands/advanced.js";
import { registerAudienceCommands } from "./commands/audience.js";
import { registerStorageCommands } from "./storage.js";
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
registerWebhookCommands?.(program, { source: "contacts" });
registerEventCommands(program, { source: "contacts", eventsCommandName: "hasna-events" });


program.parse(process.argv);
