#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";

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

const [
  { registerTaskCommands },
  { registerPlanTemplateCommands },
  { registerProjectCommands },
  { registerAgentCommands },
  { registerConfigServeCommands },
  { registerQueryCommands },
  { registerMcpHooksCommands },
  { registerDispatchCommands },
  { registerMachineCommands },
  { registerApiKeyCommands },
  { registerEnvironmentSnapshotCommands },
  { registerKnowledgeCommands },
] = await Promise.all([
  import("./commands/task-commands.js"),
  import("./commands/plan-template-commands.js"),
  import("./commands/project-commands.js"),
  import("./commands/agent-commands.js"),
  import("./commands/config-serve-commands.js"),
  import("./commands/query-commands.js"),
  import("./commands/mcp-hooks-commands.js"),
  import("./commands/dispatch.js"),
  import("./commands/machines.js"),
  import("./commands/api-key-commands.js"),
  import("./commands/environment-snapshots.js"),
  import("./commands/knowledge-commands.js"),
]);

registerTaskCommands(program);
registerPlanTemplateCommands(program);
registerProjectCommands(program);
registerAgentCommands(program);
registerConfigServeCommands(program);
registerQueryCommands(program);
registerMcpHooksCommands(program);
registerDispatchCommands(program);
registerMachineCommands(program);
registerApiKeyCommands(program);
registerEnvironmentSnapshotCommands(program);
registerKnowledgeCommands(program);

program.parse();
