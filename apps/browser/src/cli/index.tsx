#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerStorageCommands } from "./commands/storage.js";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
const program = new Command();
program.name("browser").description("@hasna/browser — general-purpose browser agent CLI").version(pkg.version);

// Register all command groups
import { register as registerBrowse } from "./commands/browse.js";
import { register as registerSession } from "./commands/session.js";
import { register as registerTools } from "./commands/tools.js";
import { register as registerExtension } from "./commands/extension.js";
import { register as registerKernel } from "./commands/kernel.js";
import { register as registerWorkflow } from "./commands/workflow.js";

async function registerSharedEvents(program: Command): Promise<void> {
  try {
    const specifier = "@hasna/events/commander";
    const events = await import(specifier) as {
      registerEventsCommands?: (program: Command, options: { source: string }) => void;
    };
    events.registerEventsCommands?.(program, { source: "browser" });
  } catch (error) {
    process.stderr.write(`[browser] shared events commands unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

registerBrowse(program);
registerSession(program);
registerTools(program);
registerExtension(program);
registerKernel(program);
registerWorkflow(program);
registerStorageCommands(program);
await registerSharedEvents(program);

try {
  await program.parseAsync(process.argv);
} finally {
  const { closeAllSessions } = await import("../lib/session.js");
  await closeAllSessions();
}
