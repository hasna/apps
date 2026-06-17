#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerCloudCommands } from "@hasna/cloud";
import { registerEventsCommands } from "@hasna/events/commander";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
const program = new Command();
program.name("browser").description("@hasna/browser — general-purpose browser agent CLI").version(pkg.version);

// Register all command groups
import { register as registerBrowse } from "./commands/browse.js";
import { register as registerSession } from "./commands/session.js";
import { register as registerScript } from "./commands/script.js";
import { register as registerTools } from "./commands/tools.js";
import { register as registerExtension } from "./commands/extension.js";

registerBrowse(program);
registerSession(program);
registerScript(program);
registerTools(program);
registerExtension(program);
registerCloudCommands(program, "browser");
registerEventsCommands(program, { source: "browser" });

try {
  await program.parseAsync(process.argv);
} finally {
  const { closeAllSessions } = await import("../lib/session.js");
  await closeAllSessions();
}
