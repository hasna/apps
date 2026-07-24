#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { resolveIdentity } from "../lib/identity.js";
import { isCloudStore } from "../lib/store/index.js";
import { HasnaHttpError } from "../lib/contracts-client/index.js";
import { App } from "./components/App.js";
import { registerBrainsCommand } from "./brains.js";
import { registerMessagingCommands } from "./commands/messaging.js";
import { registerChannelCommands } from "./commands/channels.js";
import { registerProjectCommands } from "./commands/projects.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerReceiptCommands } from "./commands/receipts.js";
import { registerLockCommands } from "./commands/locks.js";
import { registerTmuxCommands } from "./commands/tmux.js";
import { registerAdminCommands } from "./commands/admin.js";
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
registerAdminCommands(program);

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

// ---- default: TUI ----
// The interactive TUI reads/writes the on-box SQLite domain helpers directly
// (real-time polling). That is the local Store's own backing, so it is correct
// in `local` mode. In api mode (self_hosted/cloud) rendering it would silently
// show/mutate the LOCAL db instead of the cloud API — the split-brain bug this
// architecture forbids. So in cloud mode we refuse and route the operator to the
// Store-backed subcommands instead of quietly serving stale local data.
program
  .action(() => {
    if (isCloudStore()) {
      console.error(chalk.red("The interactive TUI is local-mode only."));
      console.error(chalk.dim("This client is in api mode (HASNA_CONVERSATIONS_API_URL/_API_KEY set)."));
      console.error(chalk.dim("Use the routed subcommands (send, read, sessions, channels, etc.) which talk to the cloud API."));
      process.exit(1);
    }
    if (!process.stdin.isTTY) {
      console.error(chalk.red("Interactive mode requires a TTY terminal."));
      console.error(chalk.dim("Use subcommands (send, read, sessions, etc.) for non-interactive use."));
      process.exit(1);
    }
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });
registerEventsCommands(program, { source: "conversations" });

// ---- top-level error handling ----
// Commander actions are async; `program.parse()` returns before they settle, so a
// rejected action would otherwise surface as an unhandled rejection with a raw
// (minified) stack trace. Route every failure through one clean formatter instead.
function reportCliError(err: unknown): never {
  if (err instanceof HasnaHttpError) {
    const body = err.body as { error?: string; message?: string } | undefined;
    const detail = body?.error || body?.message;
    console.error(chalk.red(`Request failed: ${err.method} ${err.path} -> ${err.status}`));
    if (detail) console.error(chalk.dim(detail));
    if (err.status === 404) {
      console.error(
        chalk.dim("The cloud API did not recognize this route. Ensure the server is up to date."),
      );
    }
    process.exit(1);
  }
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

process.on("unhandledRejection", reportCliError);

program.parseAsync().catch(reportCliError);
