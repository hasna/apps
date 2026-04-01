#!/usr/bin/env bun
import { program } from "commander";
import { registerCloudCommands } from "@hasna/cloud";
import { registerCoreCommands } from "./commands/core.js";
import { registerCrmCommands } from "./commands/crm.js";
import { registerAdvancedCommands } from "./commands/advanced.js";
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
registerCloudCommands(program, "contacts");

program.parse(process.argv);
