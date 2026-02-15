#!/usr/bin/env bun

import { Command } from "commander";
import React from "react";
import { render } from "ink";
import chalk from "chalk";
import {
  addServer,
  removeServer,
  listServers,
  getServer,
  enableServer,
  disableServer,
} from "../lib/registry.js";
import { searchRegistry, installFromRegistry } from "../lib/remote.js";
import {
  connectToServer,
  connectAllEnabled,
  listAllTools,
  callTool,
  disconnectAll,
} from "../lib/proxy.js";
import { getCachedTools } from "../lib/registry.js";
import { closeDb } from "../lib/db.js";
import { startMcpServer } from "../mcp/index.js";
import { startServer } from "../server/serve.js";
import { App } from "./components/App.js";

const program = new Command();

program
  .name("mcps")
  .description("Meta-MCP registry & CLI — discover, manage, and proxy MCP servers")
  .version("0.0.1")
  .enablePositionalOptions();

// --- list ---
program
  .command("list")
  .description("List registered MCP servers")
  .action(() => {
    const servers = listServers();
    if (servers.length === 0) {
      console.log(chalk.dim("No servers registered. Use `mcps add` or `mcps search` to get started."));
      closeDb();
      return;
    }
    for (const s of servers) {
      const status = s.enabled ? chalk.green("enabled") : chalk.red("disabled");
      const cached = getCachedTools(s.id);
      const toolCount = cached.length > 0 ? chalk.dim(` (${cached.length} tools)`) : "";
      console.log(`  ${chalk.bold(s.name)} ${chalk.dim(`[${s.id}]`)} — ${status}${toolCount}`);
      if (s.description) console.log(`    ${chalk.dim(s.description)}`);
      console.log(`    ${chalk.dim(`${s.command} ${s.args.join(" ")}`)}`);
    }
    closeDb();
  });

// --- search ---
program
  .command("search")
  .argument("<query>", "Search query")
  .description("Search official MCP registry")
  .action(async (query: string) => {
    console.log(chalk.dim(`Searching registry for "${query}"...`));
    try {
      const results = await searchRegistry(query);
      if (results.length === 0) {
        console.log(chalk.dim("No servers found."));
        return;
      }
      for (const s of results) {
        console.log(`  ${chalk.bold(s.name)} ${chalk.dim(`[${s.id}]`)}`);
        if (s.description) console.log(`    ${chalk.dim(s.description)}`);
        const pkg = s.packages?.[0];
        if (pkg) console.log(`    ${chalk.dim(`${pkg.registryType}: ${pkg.identifier}`)}`);
      }
      console.log(chalk.dim(`\n${results.length} result(s). Use \`mcps add --from-registry <id>\` to install.`));
    } catch (err) {
      console.error(chalk.red(`Search failed: ${(err as Error).message}`));
      process.exit(1);
    }
    closeDb();
  });

// --- add ---
program
  .command("add")
  .passThroughOptions()
  .argument("[command]", "Command to run the MCP server")
  .argument("[args...]", "Arguments for the command")
  .option("--name <name>", "Display name for the server")
  .option("--description <desc>", "Description")
  .option("--from-registry <id>", "Install from official registry by ID")
  .option("--transport <type>", "Transport type: stdio, sse, streamable-http", "stdio")
  .option("--url <url>", "URL for remote transports")
  .option("--env <pairs...>", "Environment variables as KEY=VALUE pairs")
  .description("Add a local MCP server")
  .action(async (command: string | undefined, args: string[], opts) => {
    try {
      if (opts.fromRegistry) {
        console.log(chalk.dim(`Installing "${opts.fromRegistry}" from registry...`));
        const server = await installFromRegistry(opts.fromRegistry);
        console.log(chalk.green(`Added server: ${server.name} [${server.id}]`));
        console.log(chalk.dim(`  ${server.command} ${server.args.join(" ")}`));
        closeDb();
        return;
      }

      if (!command) {
        console.error(chalk.red("Error: command is required (or use --from-registry)"));
        process.exit(1);
      }

      const envMap: Record<string, string> = {};
      if (opts.env) {
        for (const pair of opts.env) {
          const [key, ...rest] = pair.split("=");
          envMap[key] = rest.join("=");
        }
      }

      const server = addServer({
        name: opts.name,
        description: opts.description,
        command,
        args,
        transport: opts.transport,
        url: opts.url,
        env: envMap,
      });

      console.log(chalk.green(`Added server: ${server.name} [${server.id}]`));
      console.log(chalk.dim(`  ${server.command} ${server.args.join(" ")}`));
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint")) {
        console.error(chalk.red("A server with that ID already exists."));
      } else {
        console.error(chalk.red(`Failed to add server: ${err.message}`));
      }
      process.exit(1);
    }
    closeDb();
  });

// --- remove ---
program
  .command("remove")
  .argument("<id>", "Server ID to remove")
  .description("Remove a registered server")
  .action((id: string) => {
    const server = getServer(id);
    if (!server) {
      console.error(chalk.red(`Server "${id}" not found.`));
      process.exit(1);
    }
    removeServer(id);
    console.log(chalk.green(`Removed server: ${server.name} [${id}]`));
    closeDb();
  });

// --- enable ---
program
  .command("enable")
  .argument("<id>", "Server ID to enable")
  .description("Enable a server")
  .action((id: string) => {
    const server = getServer(id);
    if (!server) {
      console.error(chalk.red(`Server "${id}" not found.`));
      process.exit(1);
    }
    enableServer(id);
    console.log(chalk.green(`Enabled server: ${server.name}`));
    closeDb();
  });

// --- disable ---
program
  .command("disable")
  .argument("<id>", "Server ID to disable")
  .description("Disable a server")
  .action((id: string) => {
    const server = getServer(id);
    if (!server) {
      console.error(chalk.red(`Server "${id}" not found.`));
      process.exit(1);
    }
    disableServer(id);
    console.log(chalk.yellow(`Disabled server: ${server.name}`));
    closeDb();
  });

// --- tools ---
program
  .command("tools")
  .argument("[server-id]", "Optional server ID to filter by")
  .description("List tools (all or per server)")
  .option("--connect", "Connect to servers to fetch live tools")
  .action(async (serverId: string | undefined, opts) => {
    if (opts.connect) {
      console.log(chalk.dim("Connecting to enabled servers..."));
      await connectAllEnabled();
      const tools = listAllTools();
      if (tools.length === 0) {
        console.log(chalk.dim("No tools available."));
      } else {
        for (const t of tools) {
          console.log(`  ${chalk.bold(t.name)}`);
          if (t.description) console.log(`    ${chalk.dim(t.description)}`);
        }
        console.log(chalk.dim(`\n${tools.length} tool(s) available.`));
      }
      await disconnectAll();
    } else if (serverId) {
      const cached = getCachedTools(serverId);
      if (cached.length === 0) {
        console.log(chalk.dim(`No cached tools for "${serverId}". Use --connect to fetch live tools.`));
      } else {
        for (const t of cached) {
          console.log(`  ${chalk.bold(t.name)}`);
          if (t.description) console.log(`    ${chalk.dim(t.description)}`);
        }
      }
    } else {
      const servers = listServers();
      let total = 0;
      for (const s of servers) {
        const cached = getCachedTools(s.id);
        if (cached.length > 0) {
          console.log(chalk.bold(`\n${s.name} [${s.id}]:`));
          for (const t of cached) {
            console.log(`  ${chalk.bold(t.name)}`);
            if (t.description) console.log(`    ${chalk.dim(t.description)}`);
          }
          total += cached.length;
        }
      }
      if (total === 0) {
        console.log(chalk.dim("No cached tools. Use `mcps tools --connect` to fetch from servers."));
      } else {
        console.log(chalk.dim(`\n${total} tool(s) total.`));
      }
    }
    closeDb();
  });

// --- call ---
program
  .command("call")
  .argument("<tool>", "Tool name (server_id__tool_name)")
  .option("--arg <pairs...>", "Arguments as key=value pairs")
  .option("--json <json>", "Arguments as JSON string")
  .description("Call a tool directly")
  .action(async (tool: string, opts) => {
    let args: Record<string, unknown> = {};

    if (opts.json) {
      try {
        args = JSON.parse(opts.json);
      } catch {
        console.error(chalk.red("Invalid JSON for --json"));
        process.exit(1);
      }
    } else if (opts.arg) {
      for (const pair of opts.arg) {
        const [key, ...rest] = pair.split("=");
        const val = rest.join("=");
        try {
          args[key] = JSON.parse(val);
        } catch {
          args[key] = val;
        }
      }
    }

    try {
      console.log(chalk.dim(`Connecting to servers...`));
      await connectAllEnabled();
      console.log(chalk.dim(`Calling ${tool}...`));
      const result = await callTool(tool, args);
      for (const c of result.content) {
        console.log(c.text);
      }
      await disconnectAll();
    } catch (err) {
      console.error(chalk.red(`Call failed: ${(err as Error).message}`));
      process.exit(1);
    }
    closeDb();
  });

// --- info ---
program
  .command("info")
  .argument("<id>", "Server ID")
  .description("Show server details & tools")
  .action((id: string) => {
    const server = getServer(id);
    if (!server) {
      console.error(chalk.red(`Server "${id}" not found.`));
      process.exit(1);
    }

    console.log(chalk.bold(server.name) + " " + chalk.dim(`[${server.id}]`));
    console.log(`  Status:    ${server.enabled ? chalk.green("enabled") : chalk.red("disabled")}`);
    console.log(`  Source:    ${server.source}`);
    console.log(`  Transport: ${server.transport}`);
    console.log(`  Command:   ${server.command} ${server.args.join(" ")}`);
    if (server.url) console.log(`  URL:       ${server.url}`);
    if (server.description) console.log(`  Desc:      ${server.description}`);
    if (Object.keys(server.env).length > 0) {
      console.log(`  Env:       ${Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    console.log(`  Created:   ${server.created_at}`);
    console.log(`  Updated:   ${server.updated_at}`);

    const cached = getCachedTools(id);
    if (cached.length > 0) {
      console.log(chalk.bold(`\n  Tools (${cached.length}):`));
      for (const t of cached) {
        console.log(`    ${chalk.bold(t.name)}`);
        if (t.description) console.log(`      ${chalk.dim(t.description)}`);
      }
    }
    closeDb();
  });

// --- status ---
program
  .command("status")
  .description("Show registry stats")
  .action(() => {
    const servers = listServers();
    const enabled = servers.filter((s) => s.enabled).length;
    const disabled = servers.length - enabled;
    let totalTools = 0;
    for (const s of servers) {
      totalTools += getCachedTools(s.id).length;
    }

    console.log(chalk.bold("Registry Status"));
    console.log(`  Servers:  ${servers.length} (${chalk.green(`${enabled} enabled`)}, ${chalk.red(`${disabled} disabled`)})`);
    console.log(`  Tools:    ${totalTools} (cached)`);
    closeDb();
  });

// --- serve ---
program
  .command("serve")
  .description("Start the web dashboard")
  .option("--port <port>", "Port to listen on", "19427")
  .option("--no-open", "Don't open browser automatically")
  .action(async (opts) => {
    await startServer(parseInt(opts.port, 10), { open: opts.open });
  });

// --- mcp ---
program
  .command("mcp")
  .description("Start meta-MCP server (stdio)")
  .action(async () => {
    await startMcpServer();
  });

// --- default: TUI ---
program.action(() => {
  render(React.createElement(App));
});

program.parse();
