import type { Command } from "commander";
import { registerPlanCommands } from "./plan-commands.js";
import { registerTemplateCommands } from "./template-commands.js";

export function registerPlanTemplateCommands(program: Command) {
  registerPlanCommands(program);
  registerTemplateCommands(program);
}
