#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { resolveIdentity } from "../lib/identity.js";
import { App } from "./components/App.js";
import { registerBrainsCommand } from "./brains.js";
import { registerStorageCommands } from "./storage.js";
import { registerMessagingCommands } from "./commands/messaging.js";
import { registerChannelCommands } from "./commands/channels.js";
import { registerProjectCommands } from "./commands/projects.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerReceiptCommands } from "./commands/receipts.js";
import { registerLockCommands } from "./commands/locks.js";
import { registerTmuxCommands } from "./commands/tmux.js";
import pkg from "../../package.json";

const program = new Command();

program
  .name("conversations")
  .description("Real-time CLI messaging for AI agents")
  .version(pkg.version);

// ---- command groups ----
registerMessagingCommands(program);
registerChannelCommands(program);
registerProjectCommands(program);
registerAgentCommands(program);
registerAnalyticsCommands(program);
registerReceiptCommands(program);
registerLockCommands(program);
registerTmuxCommands(program);

// ---- mcp ----
program
  .command("mcp")
  .description("Start MCP server")
  .action(async () => {
    const { startMcpServer } = await import("../mcp/index.js");
    await startMcpServer();
  });

// ---- dashboard ----
program
  .command("dashboard")
  .description("Start web dashboard")
  .option("--port <port>", "Port to listen on", parseInt)
  .option("--host <host>", "Host to bind (default: 127.0.0.1)")
  .option("--open", "Auto-open dashboard in browser")
  .action(async (opts) => {
    const { startDashboardServer } = await import("../server/serve.js");
    const port = Number.isFinite(opts.port) && opts.port >= 0 && opts.port <= 65535
      ? opts.port
      : 0;
    const server = startDashboardServer(port, opts.host);
    if (opts.open) {
      const { exec } = require("child_process");
      exec(`open http://localhost:${server.port}`);
    }
  });

// ---- brains ----
registerBrainsCommand(program);

// ---- storage sync/push/pull/feedback ----
registerStorageCommands(program);

// ---- default: TUI ----
program
  .action(() => {
    if (!process.stdin.isTTY) {
      console.error(chalk.red("Interactive mode requires a TTY terminal."));
      console.error(chalk.dim("Use subcommands (send, read, sessions, etc.) for non-interactive use."));
      process.exit(1);
    }
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });
registerEventsCommands(program, { source: "conversations" });

program.parse();
