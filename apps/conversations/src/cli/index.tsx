#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
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
import { registerTmuxCommands } from "./commands/tmux.js";
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

// ---- cloud sync/push/pull/feedback ----
registerCloudCommands(program as any, "conversations");

// ---- cloud migrate ----
{
  const cloudCmd = program.commands.find((c: any) => c.name() === "cloud");
  if (cloudCmd) {
    cloudCmd
      .command("migrate")
      .description("Run PostgreSQL migrations against the configured RDS instance")
      .option("--dry-run", "Print SQL without executing")
      .action(async (opts) => {
        try {
          const { getCloudConfig, getConnectionString, PgAdapterAsync } = await import("@hasna/cloud");
          const { PG_MIGRATIONS } = await import("../lib/pg-migrations.js");
          const config = getCloudConfig();
          if (config.mode === "local") {
            console.error(chalk.red("Error: cloud mode not configured. Set RDS credentials first."));
            process.exit(1);
          }
          if (opts.dryRun) {
            console.log(chalk.dim("-- Dry run: SQL that would be executed --\n"));
            for (const sql of PG_MIGRATIONS) console.log(sql);
            return;
          }
          const pg = new PgAdapterAsync(getConnectionString("conversations"));
          for (let i = 0; i < PG_MIGRATIONS.length; i++) {
            process.stdout.write(chalk.dim(`Running migration ${i + 1}/${PG_MIGRATIONS.length}...`));
            await pg.run(PG_MIGRATIONS[i]);
            console.log(chalk.green(" done"));
          }
          await pg.close();
          console.log(chalk.green("✓ All migrations applied."));
        } catch (e: any) {
          console.error(chalk.red(`Migration failed: ${e?.message ?? e}`));
          process.exit(1);
        }
      });
  }
}

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
