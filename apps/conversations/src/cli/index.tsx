#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { resolveIdentity } from "../lib/identity.js";
import { App } from "./components/App.js";
import { registerBrainsCommand } from "./brains.js";
import { registerCloudCommands } from "@hasna/cloud";
import { registerMessagingCommands } from "./commands/messaging.js";
import { registerSpaceCommands } from "./commands/spaces.js";
import { registerProjectCommands } from "./commands/projects.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import pkg from "../../package.json";

const program = new Command();

program
  .name("conversations")
  .description("Real-time CLI messaging for AI agents")
  .version(pkg.version);

// ---- command groups ----
registerMessagingCommands(program);
registerSpaceCommands(program);
registerProjectCommands(program);
registerAgentCommands(program);
registerAnalyticsCommands(program);

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

// ---- cloud sync/push/pull/feedback ----
registerCloudCommands(program as any, "conversations");

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

program.parse();
