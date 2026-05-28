#!/usr/bin/env bun
import { Command } from "commander";
import { App } from "./components/App.js";
import { registerBrainsCommand } from "./brains.js";
import { registerProfileCommands } from "./commands/profile.js";
import { registerPrefsCommands } from "./commands/prefs.js";
import { registerTemplateCommands } from "./commands/template.js";
import { registerKitsCommands } from "./commands/kits.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerContextCommands } from "./commands/context.js";
import { registerMiscCommands } from "./commands/misc.js";
import { registerExtractCommand } from "./commands/extract.js";

const program = new Command();

program
  .name("styles")
  .description("Open Styles — design style management for AI coding agents")
  .version("0.0.1");

// Register all command groups from separate modules
registerMiscCommands(program);
registerContextCommands(program);
registerProfileCommands(program);
registerPrefsCommands(program);
registerHealthCommand(program);
registerTemplateCommands(program);
registerKitsCommands(program);
registerExtractCommand(program);
registerBrainsCommand(program);

program.parse(process.argv);
