#!/usr/bin/env bun
import { registerEventCommands, registerWebhookCommands } from "@hasna/events/commander";
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
registerWebhookCommands(program, { source: "contacts" });
registerEventCommands(program, { source: "contacts", eventsCommandName: "hasna-events" });


program.parse(process.argv);
