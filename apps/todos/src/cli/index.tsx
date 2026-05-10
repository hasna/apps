#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../lib/package-version.js";
import { isRemoteMode } from "../lib/config.js";
import { registerRemoteCommands } from "./commands/remote-commands.js";

const program = new Command();

function firstCommandArg(args: string[]): string | null {
  const optionsWithValues = new Set(["--project", "--agent", "--session"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") return args[index + 1] ?? null;
    if (arg.startsWith("--")) {
      if (!arg.includes("=") && optionsWithValues.has(arg)) index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
}

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .version(getPackageVersion())
  .option("--project <path>", "Project path")
  .option("-j, --json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

const bootstrapRemoteCommands = new Set(["login", "logout"]);
if (isRemoteMode() || bootstrapRemoteCommands.has(firstCommandArg(process.argv.slice(2)) || "")) {
  registerRemoteCommands(program);
} else {
  const [
    { registerTaskCommands },
    { registerPlanTemplateCommands },
    { registerProjectCommands },
    { registerAgentCommands },
    { registerConfigServeCommands },
    { registerQueryCommands },
    { registerCloudCommands },
    { registerMcpHooksCommands },
    { registerDispatchCommands },
    { registerMachineCommands },
    { registerApiKeyCommands },
  ] = await Promise.all([
    import("./commands/task-commands.js"),
    import("./commands/plan-template-commands.js"),
    import("./commands/project-commands.js"),
    import("./commands/agent-commands.js"),
    import("./commands/config-serve-commands.js"),
    import("./commands/query-commands.js"),
    import("./commands/cloud-commands.js"),
    import("./commands/mcp-hooks-commands.js"),
    import("./commands/dispatch.js"),
    import("./commands/machines.js"),
    import("./commands/api-key-commands.js"),
  ]);

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
  registerApiKeyCommands(program);
}

program.parse();
