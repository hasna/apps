#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "./helpers.js";
import { registerTaskCommands } from "./commands/task-commands.js";
import { registerPlanTemplateCommands } from "./commands/plan-template-commands.js";
import { registerProjectCommands } from "./commands/project-commands.js";
import { registerAgentCommands } from "./commands/agent-commands.js";
import { registerConfigServeCommands } from "./commands/config-serve-commands.js";
import { registerQueryCommands } from "./commands/query-commands.js";
import { registerCloudCommands } from "./commands/cloud-commands.js";
import { registerMcpHooksCommands } from "./commands/mcp-hooks-commands.js";
import { registerDispatchCommands } from "./commands/dispatch.js";
import { registerMachineCommands } from "./commands/machines.js";

const program = new Command();

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .version(getPackageVersion())
  .option("--project <path>", "Project path")
  .option("-j, --json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

// Register command modules
registerTaskCommands(program);
registerPlanTemplateCommands(program);
registerProjectCommands(program);
registerAgentCommands(program);
registerConfigServeCommands(program);
registerQueryCommands(program);
registerCloudCommands(program);
registerMcpHooksCommands(program);
registerDispatchCommands(program);
registerMachineCommands(program);

program.parse();
