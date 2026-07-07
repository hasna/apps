#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { EventsClient, sanitizeChannelsForOutput } from "@hasna/events";
import { registerEventsCommands } from "@hasna/events/commander";
import _pkg from "../../package.json" with { type: "json" };
import { loadConnectorVersions } from "../lib/registry.js";
import { App } from "./components/App.js";
import { isTTY } from "./commands/install.js";
import { registerCommands as registerInstallCommands } from "./commands/install.js";
import { registerCommands as registerBrowseCommands } from "./commands/browse.js";
import { registerCommands as registerStatusCommands } from "./commands/status.js";
import { registerCommands as registerAuthCommands } from "./commands/auth.js";
import { registerCommands as registerMiscCommands } from "./commands/misc.js";
import { registerCommands as registerOpsCommands } from "./commands/ops.js";
import { registerCommands as registerSystemCommands } from "./commands/system.js";
import { registerCommands as registerSyncCommands } from "./commands/sync.js";

// Load versions from connector package.json files
loadConnectorVersions();

const program = new Command();

program
  .name("connectors")
  .description("Install API connectors for your project")
  .version(_pkg.version)
  .enablePositionalOptions();

// Interactive mode (default)
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive connector browser")
  .action(() => {
    if (!isTTY) {
      // Non-interactive fallback: show help
      console.log("Non-interactive environment detected. Use a subcommand:\n");
      console.log("  connectors list              List all available connectors");
      console.log("  connectors list --json        List as JSON (for AI agents)");
      console.log("  connectors search <query>     Search connectors");
      console.log("  connectors install <names...> Install connectors");
      console.log("  connectors remove <name>      Remove a connector");
      console.log("  connectors info <name>        Show connector details");
      console.log("  connectors categories         List categories");
      console.log("\nRun 'connectors --help' for full usage.");
      process.exit(0);
    }
    render(<App />);
  });

// Register all command modules
registerInstallCommands(program);
registerBrowseCommands(program);
registerStatusCommands(program);
registerAuthCommands(program);
registerMiscCommands(program);
registerOpsCommands(program);
registerSystemCommands(program);
registerSyncCommands(program);
registerEventsCommands(program, { source: "connectors" });
registerWebhooksCompatibilityCommand(program);

program.parse();

function registerWebhooksCompatibilityCommand(program: Command) {
  if (program.commands.some((command) => command.name() === "webhooks")) {
    return;
  }

  const webhooks = program.command("webhooks").description("Manage webhook event channels");

  webhooks
    .command("list")
    .description("List webhook channels")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const client = new EventsClient();
      const channels = sanitizeChannelsForOutput(
        (await client.listChannels()).filter((channel) => channel.transport === "webhook")
      );

      if (opts.json) {
        console.log(JSON.stringify(channels, null, 2));
        return;
      }

      if (channels.length === 0) {
        console.log("No webhook channels configured.");
        return;
      }

      for (const channel of channels) {
        console.log(`${channel.id}\t${channel.name || ""}\t${channel.enabled ? "enabled" : "disabled"}`);
      }
    });
}
