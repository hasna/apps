#!/usr/bin/env bun
import { program } from "commander";
import { registerCloudCommands } from "@hasna/cloud";
import { registerCoreCommands } from "./commands/core.js";
import { registerCrmCommands } from "./commands/crm.js";
import { registerAdvancedCommands } from "./commands/advanced.js";

program
  .name("contacts")
  .description("Open Contacts — contact management for AI coding agents")
  .version("0.6.8");

registerCoreCommands(program);
registerCrmCommands(program);
registerAdvancedCommands(program);
registerCloudCommands(program, "contacts");

program.parse(process.argv);
