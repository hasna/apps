#!/usr/bin/env bun

import { Command } from "commander";
import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { readFileSync, writeFileSync } from "fs";
import {
  addServer,
  removeServer,
  listServers,
  getServer,
  enableServer,
  disableServer,
  getToolCounts,
  setServerEnv,
  unsetServerEnv,
  updateServer,
  cloneServer,
} from "../lib/registry.js";
import type { McpSource } from "../types.js";
import { diagnoseServer } from "../lib/doctor.js";
import { searchRegistry, installFromRegistry } from "../lib/remote.js";
import { listAwesomeServers } from "../lib/finder.js";
import {
  listSources,
  getSource,
  addSource,
  removeSource,
  enableSource,
  disableSource,
  findServers,
  searchSource,
  clearCache,
} from "../lib/sources.js";
import { installToAgents } from "../lib/install.js";
import type { AgentTarget } from "../lib/install.js";
import {
  connectToServer,
  connectAllEnabled,
  listAllTools,
  callTool,
  disconnectAll,
} from "../lib/proxy.js";
import { getCachedTools } from "../lib/registry.js";
import { closeDb, getDb, getAdapter } from "../lib/db.js";
import {
  addMachine,
  getMachine as getRegisteredMachine,
  listMachines,
  removeMachine as removeRegisteredMachine,
  seedDefaultMachines,
  updateMachine as updateRegisteredMachine,
} from "../lib/machines.js";
import { listHasnaMcpCatalog, runFleetHealthCheck, runFleetInstall } from "../lib/fleet.js";
import {
  getProviderProfile,
  installProviderProfile,
  listProviderProfiles,
  searchProviderProfiles,
} from "../lib/provider-profiles.js";
import * as readline from "readline";
import { startMcpServer } from "../mcp/index.js";
import { startServer } from "../server/serve.js";
import { App } from "./components/App.js";
import { readPackageVersion } from "../lib/version.js";
import type {
  FleetHealthReport,
  FleetInstallReport,
  HasnaMcpCatalogEntry,
  MachineArch,
  MachineEntry,
  MachineInstaller,
  MachinePlatform,
} from "../types.js";

const VERSION = (() => {
  return readPackageVersion(import.meta.url);
})();

const MACHINE_PLATFORMS = ["linux", "darwin", "unknown"] as const;
const MACHINE_ARCHES = ["arm64", "x64", "unknown"] as const;
const MACHINE_INSTALLERS = ["auto", "bun", "npm"] as const;
const FLEET_INSTALL_MODES = ["missing", "missing-or-outdated", "all"] as const;

function printProviderProfile(profile: ReturnType<typeof listProviderProfiles>[number]): void {
  const status = profile.enabled ? chalk.green("enabled") : chalk.red("disabled");
  console.log(`  ${chalk.bold(profile.displayName)} ${chalk.dim(`[${profile.id}]`)} — ${chalk.dim(profile.transport)} — ${status}`);
  if (profile.description) console.log(`    ${chalk.dim(profile.description)}`);
  if (profile.endpoint) console.log(`    ${chalk.cyan(profile.endpoint)}`);
  if (profile.authMetadata.bearerToken === "optional") {
    console.log(`    ${chalk.dim("Auth: OAuth with optional bearer token/API key support")}`);
  } else if (profile.authMetadata.pkce || profile.authMetadata.dynamicClientRegistration) {
    const parts = [
      profile.authMetadata.oauthVersion ? `OAuth ${profile.authMetadata.oauthVersion}` : "OAuth",
      profile.authMetadata.pkce ? "PKCE" : null,
      profile.authMetadata.dynamicClientRegistration ? "dynamic client registration" : null,
    ].filter(Boolean);
    console.log(`    ${chalk.dim(`Auth: ${parts.join(", ")}`)}`);
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseIntegerOption(value: string, label: string, { min = 0, max }: { min?: number; max?: number } = {}): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new Error(`${label} must be an integer${max !== undefined ? ` between ${min} and ${max}` : ` >= ${min}`}`);
  }
  return parsed;
}

function parseChoice<T extends string>(value: string | undefined, label: string, choices: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if ((choices as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${label} must be one of: ${choices.join(", ")}`);
}

function formatMachineTarget(machine: MachineEntry): string {
  const userPrefix = machine.username ? `${machine.username}@` : "";
  return `${userPrefix}${machine.host}:${machine.port}`;
}

function renderMachines(machines: MachineEntry[]): void {
  if (machines.length === 0) {
    console.log(chalk.dim("No machines registered. Use `mcps machines add` or `mcps machines seed-defaults`."));
    return;
  }

  for (const machine of machines) {
    const status = machine.enabled ? chalk.green("enabled") : chalk.red("disabled");
    const runtime = `${machine.platform}/${machine.arch}`;
    console.log(`  ${chalk.bold(machine.name)} ${chalk.dim(`[${machine.id}]`)} — ${status}`);
    console.log(`    ${chalk.dim(`${formatMachineTarget(machine)} · installer=${machine.installer} · ${runtime}`)}`);
    if (machine.last_seen_at) console.log(`    ${chalk.dim(`last seen: ${machine.last_seen_at}`)}`);
    if (machine.last_error) console.log(`    ${chalk.red(machine.last_error)}`);
  }
}

function renderCatalog(entries: HasnaMcpCatalogEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.dim("No @hasna MCP packages found."));
    return;
  }

  for (const entry of entries) {
    const binLabel = entry.mcpBin ? chalk.dim(`bin=${entry.mcpBin}`) : chalk.yellow("no MCP bin");
    console.log(`  ${chalk.bold(entry.name)} ${chalk.dim(`@${entry.version}`)} ${binLabel}`);
    if (entry.description) console.log(`    ${chalk.dim(entry.description)}`);
  }
}

function renderFleetHealth(reports: FleetHealthReport[]): void {
  if (reports.length === 0) {
    console.log(chalk.dim("No machines selected."));
    return;
  }

  for (const report of reports) {
    console.log(`  ${chalk.bold(report.machine.name)} ${chalk.dim(`[${report.machine.id}]`)} — ${chalk.dim(formatMachineTarget(report.machine))}`);
    if (report.error) {
      console.log(`    ${chalk.red(report.error)}`);
      continue;
    }

    console.log(
      `    ${chalk.dim(
        `${report.runtime.platform}/${report.runtime.arch} · current=${report.summary.current} · missing=${report.summary.missing} · outdated=${report.summary.outdated} · unresponsive=${report.summary.unresponsive}`,
      )}`,
    );

    for (const pkg of report.packages) {
      const driftColor =
        pkg.drift === "current" ? chalk.green : pkg.drift === "missing" ? chalk.red : chalk.yellow;
      const handshakeLabel =
        pkg.handshakeOk === null ? chalk.dim("n/a") : pkg.handshakeOk ? chalk.green("ok") : chalk.red("failed");
      const installed = pkg.installedVersion ?? "missing";
      console.log(
        `    ${driftColor(pkg.drift.padEnd(8))} ${pkg.packageName} ${chalk.dim(`${installed} -> ${pkg.latestVersion} · handshake=${handshakeLabel}`)}`,
      );
      if (pkg.handshakeError) console.log(`      ${chalk.red(pkg.handshakeError)}`);
    }
  }
}

function renderFleetInstall(reports: FleetInstallReport[]): void {
  if (reports.length === 0) {
    console.log(chalk.dim("No machines selected."));
    return;
  }

  for (const report of reports) {
    const installerLabel = report.installer ? chalk.dim(`installer=${report.installer}`) : chalk.dim("installer=none");
    console.log(`  ${chalk.bold(report.machine.name)} ${chalk.dim(`[${report.machine.id}]`)} ${installerLabel}`);
    if (report.error) {
      console.log(`    ${chalk.red(report.error)}`);
      continue;
    }

    if (report.attempted === 0) {
      console.log(`    ${chalk.dim("Nothing to install.")}`);
      continue;
    }

    for (const result of report.results) {
      const icon = result.success ? chalk.green("✓") : chalk.red("✗");
      console.log(`    ${icon} ${result.packageName}@${result.requestedVersion}`);
      if (!result.success && result.stderr.trim()) {
        console.log(`      ${chalk.red(result.stderr.trim())}`);
      }
    }
  }
}

const program = new Command();

program
  .name("mcps")
  .description("Meta-MCP registry & CLI — discover, manage, and proxy MCP servers")
  .version(VERSION)
  .enablePositionalOptions();

// --- list ---
program
  .command("list")
  .description("List registered MCP servers")
  .option("--json", "Output as JSON")
  .option("--verbose", "Show detailed info including health, command, and transport")
  .action((opts) => {
    const servers = listServers();
    if (opts.json) {
      const toolCounts = getToolCounts();
      console.log(JSON.stringify(servers.map(s => ({ ...s, toolCount: toolCounts.get(s.id) ?? 0 })), null, 2));
      closeDb();
      return;
    }
    if (servers.length === 0) {
      console.log(chalk.dim("No servers registered. Use `mcps add` or `mcps search` to get started."));
      closeDb();
      return;
    }
    const toolCounts = getToolCounts();
    for (const s of servers) {
      const status = s.enabled ? chalk.green("enabled") : chalk.red("disabled");
      const cachedCount = toolCounts.get(s.id) ?? 0;
      const toolCount = cachedCount > 0 ? chalk.dim(` (${cachedCount} tools)`) : "";
      const errorWarning = s.last_error ? chalk.red(" ⚠") : "";
      console.log(`  ${chalk.bold(s.name)} ${chalk.dim(`[${s.id}]`)} — ${status}${toolCount}${errorWarning}`);
      if (s.description) console.log(`    ${chalk.dim(s.description)}`);
      if (opts.verbose) {
        console.log(`    Command:   ${chalk.dim(`${s.command} ${s.args.join(" ")}`)}`);
        console.log(`    Transport: ${chalk.dim(s.transport)}`);
        const now = Date.now();
        if (s.last_connected_at) {
          const connectedAt = new Date(s.last_connected_at).getTime();
          const daysDiff = Math.floor((now - connectedAt) / (1000 * 60 * 60 * 24));
          const connectedLabel = daysDiff === 0 ? "today" : daysDiff === 1 ? "1 day ago" : `${daysDiff} days ago`;
          const connectedColor = !s.last_error && daysDiff < 7 ? chalk.green : chalk.yellow;
          console.log(`    Connected: ${connectedColor(connectedLabel)}`);
        } else {
          console.log(`    Connected: ${chalk.dim("never")}`);
        }
        if (s.last_error) {
          console.log(`    Error:     ${chalk.red(s.last_error)}`);
        }
        // Health icon
        const hasError = !!s.last_error;
        const daysSinceConnect = s.last_connected_at
          ? Math.floor((Date.now() - new Date(s.last_connected_at).getTime()) / (1000 * 60 * 60 * 24))
          : Infinity;
        const healthIcon = hasError
          ? chalk.red("✗ unhealthy")
          : daysSinceConnect < 7
          ? chalk.green("✓ healthy")
          : chalk.yellow("⚠ stale");
        console.log(`    Health:    ${healthIcon}`);
      } else {
        console.log(`    ${chalk.dim(`${s.command} ${s.args.join(" ")}`)}`);
      }
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
    } finally {
      closeDb();
    }
  });

// --- providers ---
const providersCmd = program.command("providers").description("Discover and install curated MCP provider profiles");

providersCmd
  .command("list")
  .description("List curated provider profiles")
  .option("--json", "Output as JSON")
  .option("--enabled-only", "Only include enabled profiles")
  .action((opts) => {
    const profiles = listProviderProfiles({ enabledOnly: opts.enabledOnly === true });
    if (opts.json) {
      printJson(profiles);
      closeDb();
      return;
    }
    if (profiles.length === 0) {
      console.log(chalk.dim("No curated provider profiles available."));
      closeDb();
      return;
    }
    for (const profile of profiles) printProviderProfile(profile);
    closeDb();
  });

providersCmd
  .command("search")
  .argument("<query>", "Search query")
  .description("Search curated provider profiles")
  .option("--json", "Output as JSON")
  .option("--enabled-only", "Only include enabled profiles")
  .action((query: string, opts) => {
    const profiles = searchProviderProfiles(query, { enabledOnly: opts.enabledOnly === true });
    if (opts.json) {
      printJson(profiles);
      closeDb();
      return;
    }
    if (profiles.length === 0) {
      console.log(chalk.dim("No curated provider profiles found."));
      closeDb();
      return;
    }
    for (const profile of profiles) printProviderProfile(profile);
    console.log(chalk.dim(`\n${profiles.length} provider profile(s). Use \`mcps providers install <id>\` to register one.`));
    closeDb();
  });

providersCmd
  .command("info")
  .argument("<id>", "Provider profile ID")
  .description("Show a curated provider profile")
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    const profile = getProviderProfile(id);
    if (!profile) {
      console.error(chalk.red(`Provider profile "${id}" not found.`));
      closeDb();
      process.exit(1);
    }
    if (opts.json) {
      printJson(profile);
      closeDb();
      return;
    }
    printProviderProfile(profile);
    if (profile.fallbackEndpoints.length > 0) {
      console.log(chalk.bold("    Fallback endpoints:"));
      for (const fallback of profile.fallbackEndpoints) {
        console.log(`      ${fallback.transport}: ${chalk.cyan(fallback.url)}`);
      }
    }
    if (profile.docsUrl) console.log(`    Docs: ${chalk.cyan(profile.docsUrl)}`);
    closeDb();
  });

providersCmd
  .command("install")
  .argument("<id>", "Provider profile ID")
  .description("Register a curated provider profile as an MCP server")
  .option("--name <name>", "Override registered server name")
  .option("--fallback", "Install the stdio fallback command instead of direct remote transport")
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    try {
      const server = installProviderProfile(id, {
        name: opts.name,
        useFallback: opts.fallback === true,
      });
      if (opts.json) {
        printJson(server);
      } else {
        console.log(chalk.green(`Installed provider profile: ${server.name} [${server.id}]`));
        console.log(chalk.dim(`  Transport: ${server.transport}`));
        if (server.url) console.log(chalk.dim(`  URL: ${server.url}`));
      }
      closeDb();
    } catch (err) {
      console.error(chalk.red(`Failed to install provider profile: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    }
  });

async function promptReadline(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

function detectSourceType(url: string): McpSource["type"] | null {
  if (url.includes("raw.githubusercontent.com") || url.endsWith(".md")) return "awesome-list";
  if (url.includes("registry.npmjs.org")) return "npm-search";
  if (url.includes("api.github.com/search")) return "github-topic";
  if (url.includes("/v0/servers") || url.includes("/servers")) return "mcp-registry";
  return null;
}

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
  .option("--wizard", "Interactive setup wizard")
  .option("--force", "Register even if duplicate command exists")
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

      if (opts.wizard) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const transport = (await promptReadline(rl, "Transport [stdio/sse/http] (default: stdio): ")) || "stdio";
        const wizardCommand = await promptReadline(rl, "Command (e.g. npx, node, bunx): ");
        if (!wizardCommand) {
          console.error(chalk.red("Command is required"));
          rl.close();
          closeDb();
          process.exit(1);
        }
        const argsStr = await promptReadline(rl, "Arguments (space-separated, e.g. -y @pkg/name): ");
        const wizardArgs = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
        const wizardName = await promptReadline(rl, "Display name (optional, press enter to skip): ");
        const wizardDescription = await promptReadline(rl, "Description (optional): ");

        const env: Record<string, string> = {};
        console.log(chalk.dim("Add env vars (KEY=VALUE). Press enter with empty key to skip."));
        while (true) {
          const pair = await promptReadline(rl, "  Env var (KEY=VALUE or empty to done): ");
          if (!pair.trim()) break;
          const eqIdx = pair.indexOf("=");
          if (eqIdx > 0) env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        }

        rl.close();

        console.log(chalk.bold("\nServer to add:"));
        console.log(`  Command:   ${wizardCommand} ${wizardArgs.join(" ")}`);
        console.log(`  Transport: ${transport}`);
        if (wizardName) console.log(`  Name:      ${wizardName}`);
        if (Object.keys(env).length) console.log(`  Env:       ${Object.keys(env).join(", ")}`);
        const confirm = await new Promise<string>(resolve => {
          const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl2.question(chalk.bold("Add this server? [Y/n]: "), ans => { rl2.close(); resolve(ans); });
        });
        if (confirm.toLowerCase() === "n") {
          console.log("Aborted.");
          closeDb();
          return;
        }

        const server = addServer({
          command: wizardCommand,
          args: wizardArgs,
          name: wizardName || undefined,
          description: wizardDescription || undefined,
          transport: transport as any,
          env,
        });
        console.log(chalk.green(`Added: ${server.name} [${server.id}]`));
        closeDb();
        return;
      }

      if (!command) {
        console.error(chalk.red("Error: command is required (or use --from-registry or --wizard)"));
        closeDb();
        process.exit(1);
      }

      // Duplicate check
      const existing = listServers();
      const duplicate = existing.find(s => s.command === command && JSON.stringify(s.args) === JSON.stringify(args));
      if (duplicate) {
        console.log(chalk.yellow(`Warning: server "${duplicate.name}" [${duplicate.id}] already uses this command.`));
        if (!opts.force) {
          console.log(chalk.dim("Use --force to register anyway."));
          closeDb();
          return;
        }
      }

      const envMap: Record<string, string> = {};
      if (opts.env) {
        for (const pair of opts.env) {
          const [key, ...rest] = pair.split("=");
          if (!key) continue;
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
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

// --- update-server ---
program
  .command("update-server")
  .argument("<id>", "Server ID to update")
  .description("Update fields of a registered server")
  .option("--name <name>", "New display name")
  .option("--description <desc>", "New description")
  .option("--command <cmd>", "New command")
  .option("--args <args...>", "New args list")
  .option("--transport <type>", "New transport type")
  .option("--url <url>", "New URL")
  .action((id: string, opts) => {
    const server = getServer(id);
    if (!server) {
      console.error(chalk.red(`Server "${id}" not found.`));
      closeDb();
      process.exit(1);
    }
    const fields: Parameters<typeof updateServer>[1] = {};
    if (opts.name !== undefined) fields.name = opts.name;
    if (opts.description !== undefined) fields.description = opts.description;
    if (opts.command !== undefined) fields.command = opts.command;
    if (opts.args !== undefined) fields.args = opts.args as string[];
    if (opts.transport !== undefined) fields.transport = opts.transport;
    if (opts.url !== undefined) fields.url = opts.url;
    const updated = updateServer(id, fields);
    console.log(chalk.green(`Updated server: ${updated.name} [${updated.id}]`));
    closeDb();
  });

// --- clone ---
program
  .command("clone")
  .argument("<id>", "Server ID to clone")
  .argument("<new-name>", "Name for the cloned server")
  .description("Clone a server with a new name")
  .action((id: string, newName: string) => {
    try {
      const cloned = cloneServer(id, newName);
      console.log(chalk.green(`Cloned server: ${cloned.name} [${cloned.id}]`));
      console.log(chalk.dim(`  ${cloned.command} ${cloned.args.join(" ")}`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      closeDb();
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
      closeDb();
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
      closeDb();
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
      closeDb();
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

    let exitCode = 0;
    try {
      console.log(chalk.dim(`Connecting to servers...`));
      await connectAllEnabled();
      console.log(chalk.dim(`Calling ${tool}...`));
      const result = await callTool(tool, args);
      for (const c of result.content) {
        console.log(c.text);
      }
    } catch (err) {
      console.error(chalk.red(`Call failed: ${(err as Error).message}`));
      exitCode = 1;
    }
    await disconnectAll().catch(() => undefined);
    closeDb();
    if (exitCode !== 0) process.exit(exitCode);
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
      closeDb();
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
  .option("--json", "Output as JSON")
  .action((opts) => {
    const servers = listServers();
    const enabled = servers.filter((s) => s.enabled).length;
    const disabled = servers.length - enabled;
    const toolCounts = getToolCounts();
    let totalTools = 0;
    for (const s of servers) totalTools += toolCounts.get(s.id) ?? 0;

    if (opts.json) {
      console.log(JSON.stringify({ total: servers.length, enabled, disabled, totalTools }, null, 2));
      closeDb();
      return;
    }

    console.log(chalk.bold("Registry Status"));
    console.log(`  Servers:  ${servers.length} (${chalk.green(`${enabled} enabled`)}, ${chalk.red(`${disabled} disabled`)})`);
    console.log(`  Tools:    ${totalTools} (cached)`);
    closeDb();
  });

// --- doctor ---
program
  .command("doctor")
  .argument("[id]", "Server ID to check (omit to check all)")
  .description("Diagnose server health — checks PATH, env vars, connectivity")
  .option("--fix", "Attempt to fix issues automatically")
  .action(async (id: string | undefined, opts) => {
    const { execFileSync: execFileSync2 } = await import("child_process");
    const servers = id ? [getServer(id)].filter(Boolean) : listServers();
    if (servers.length === 0) {
      console.log(chalk.dim(id ? `Server "${id}" not found.` : "No servers registered."));
      closeDb();
      return;
    }

    let allHealthy = true;
    for (const server of servers) {
      console.log(chalk.bold(`\n${server!.name} [${server!.id}]`));
      const report = await diagnoseServer(server!);
      for (const check of report.checks) {
        const icon = check.pass ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${icon} ${check.name}: ${chalk.dim(check.message)}`);
        if (!check.pass && opts.fix && check.fixable && check.fixHint) {
          console.log(chalk.dim(`  Attempting fix: ${check.fixHint}`));
          try {
            execFileSync2("npm", ["install", "-g", check.fixHint.replace("npm install -g ", "")], { stdio: "inherit" });
            console.log(chalk.green(`  Fixed!`));
          } catch {
            console.log(chalk.red(`  Fix failed`));
          }
        }
      }
      if (!report.healthy) allHealthy = false;
    }

    console.log("");
    if (allHealthy) {
      console.log(chalk.green("All checks passed."));
    } else {
      console.log(chalk.red("Some checks failed. Fix issues above."));
    }
    closeDb();
  });

// --- completion ---
program
  .command("completion")
  .argument("<shell>", "Shell type: bash, zsh, fish")
  .description("Generate shell completion script")
  .action((shell: string) => {
    const commands = ["list","search","providers","find","add","remove","enable","disable","info","status","tools","call","doctor","install","machines","fleet","export","import","env","sources","clone","update-server","serve","update","mcp","completion"];

    if (shell === "bash") {
      console.log(`# Add to ~/.bashrc: eval "$(mcps completion bash)"
_mcps_complete() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local cmds="${commands.join(" ")}"
  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$cmds" -- "$cur") )
  fi
}
complete -F _mcps_complete mcps`);
    } else if (shell === "zsh") {
      console.log(`# Add to ~/.zshrc: eval "$(mcps completion zsh)"
_mcps() {
  local -a cmds
  cmds=(${commands.map(c => `'${c}'`).join(" ")})
  _describe 'commands' cmds
}
compdef _mcps mcps`);
    } else if (shell === "fish") {
      const lines = commands.map(c => `complete -c mcps -f -a '${c}'`).join("\n");
      console.log(`# Add to ~/.config/fish/completions/mcps.fish\n${lines}`);
    } else {
      console.error(chalk.red(`Unknown shell: ${shell}. Use bash, zsh, or fish.`));
      process.exit(1);
    }
    closeDb();
  });

// --- serve ---
program
  .command("serve")
  .description("Start the web dashboard")
  .option("--port <port>", "Port to listen on", "19427")
  .option("--host <host>", "Host to bind (default: 127.0.0.1)", "127.0.0.1")
  .option("--no-open", "Don't open browser automatically")
  .action(async (opts) => {
    await startServer(parseInt(opts.port, 10), { open: opts.open, host: opts.host });
  });

// --- update ---
program
  .command("update")
  .description("Update mcps to the latest version")
  .action(async () => {
    const { execFileSync } = await import("child_process");
    const pkg = await import("../../package.json");
    const currentVersion = pkg.version;
    console.log(chalk.dim(`Current version: ${currentVersion}`));
    console.log(chalk.dim("Checking for updates..."));
    try {
      const latest = execFileSync("npm", ["view", "@hasna/mcps", "version"], {
        encoding: "utf-8",
      }).trim();
      if (latest === currentVersion) {
        console.log(chalk.green(`Already on the latest version (${currentVersion}).`));
        return;
      }
      console.log(chalk.dim(`New version available: ${latest}`));
      console.log(chalk.dim("Updating..."));
      execFileSync("bun", ["install", "-g", "@hasna/mcps@latest"], { stdio: "inherit" });
      console.log(chalk.green(`Updated to ${latest}`));
    } catch (err) {
      console.error(chalk.red(`Update failed: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    }
  });

// --- find ---
program
  .command("find")
  .argument("[query]", "Search query (omit to list all from awesome list)")
  .description("Find MCP servers across npm, GitHub, official registry, and awesome lists")
  .option("--source <sources...>", "Source IDs to search (see `mcps sources list`)")
  .option("--limit <n>", "Max results per source", "20")
  .option("--awesome", "List curated servers from punkpeye/awesome-mcp-servers")
  .option("--json", "Output as JSON")
  .option("--install", "After showing results, prompt to select one and install it")
  .option("--yes", "Auto-install without prompting (only when there is exactly 1 result)")
  .option("--no-cache", "Bypass source cache and fetch fresh results")
  .action(async (query: string | undefined, opts) => {
    try {
      if (opts.awesome) {
        console.log(chalk.dim("Fetching curated awesome-mcp-servers list..."));
        const results = await listAwesomeServers();
        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          closeDb();
          return;
        }
        const allSources = listSources();
        const sourceNameMap = new Map(allSources.map((s) => [s.id, s.name]));
        for (const r of results) {
          const sourceName = r.sourceId ? (sourceNameMap.get(r.sourceId) ?? r.source) : r.source;
          console.log(`  ${chalk.bold(r.name)} ${chalk.yellow(`[${sourceName}]`)}`);
          if (r.description) console.log(`    ${chalk.dim(r.description)}`);
          if (r.url) console.log(`    ${chalk.cyan(r.url)}`);
        }
        console.log(chalk.dim(`\n${results.length} servers in awesome list.`));
        closeDb();
        return;
      }

      const q = query || "";
      const sources = opts.source as string[] | undefined;
      const limit = parseInt(opts.limit, 10) || 20;
      const noCache = opts.cache === false;

      if (!q) {
        console.log(chalk.dim("Tip: provide a query to search, or use --awesome to browse the curated list."));
      } else {
        console.log(chalk.dim(`Searching for "${q}" across ${sources ? sources.join(", ") : "all enabled sources"}...`));
      }

      const t0 = Date.now();
      const results = await findServers(q, { sources, limit, noCache });
      const elapsed = Date.now() - t0;

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        closeDb();
        return;
      }

      if (results.length === 0) {
        console.log(chalk.dim("No servers found."));
        closeDb();
        return;
      }

      // Count per source
      const countBySource = new Map<string, number>();
      for (const r of results) {
        const key = r.sourceId ?? r.source;
        countBySource.set(key, (countBySource.get(key) ?? 0) + 1);
      }
      const allSourcesList = listSources();
      const sourceNameMap = new Map(allSourcesList.map((s) => [s.id, s.name]));
      const sourcesUsed = countBySource.size;
      const breakdownParts = Array.from(countBySource.entries())
        .map(([k, n]) => `${sourceNameMap.get(k) ?? k}: ${n}`)
        .join(", ");

      const sourceColors: Record<string, (s: string) => string> = {
        registry: chalk.blue,
        npm: chalk.red,
        awesome: chalk.yellow,
        github: chalk.magenta,
      };

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const sourceName = r.sourceId ? (sourceNameMap.get(r.sourceId) ?? r.source) : r.source;
        const sourceLabel = (sourceColors[r.source] ?? chalk.dim)(`[${sourceName}]`);
        const stars = r.stars ? chalk.dim(` ★${r.stars}`) : "";
        const idx = opts.install ? chalk.dim(`${i + 1}. `) : "  ";
        console.log(`${idx}${chalk.bold(r.name)} ${sourceLabel}${stars}`);
        if (r.description) console.log(`    ${chalk.dim(r.description)}`);
        if (r.installCmd) console.log(`    ${chalk.green(`Install: ${r.installCmd}`)}`);
        else if (r.url) console.log(`    ${chalk.cyan(r.url)}`);
      }

      console.log(
        chalk.dim(
          `\nFound ${results.length} results across ${sourcesUsed} source${sourcesUsed === 1 ? "" : "s"} (${elapsed}ms)`
        )
      );
      if (breakdownParts) console.log(chalk.dim(`  Breakdown: ${breakdownParts}`));
      console.log(chalk.dim(`Use \`mcps add --from-registry <id>\` or \`mcps add npx -y <pkg>\` to install.`));

      if (opts.install) {
        let chosen = results[0];

        if (results.length === 1 && opts.yes) {
          // Auto-install the single result
        } else {
          // Prompt the user to pick
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.cyan(`\nEnter number to install (1-${results.length}), or 0 to cancel: `), resolve);
          });
          rl.close();
          const num = parseInt(answer, 10);
          if (!num || num < 1 || num > results.length) {
            console.log(chalk.dim("Installation cancelled."));
            closeDb();
            return;
          }
          chosen = results[num - 1];
        }

        if (!chosen.npmPackage && !chosen.installCmd) {
          console.log(chalk.yellow(`No install command available for ${chosen.name}, visit ${chosen.url ?? "(no URL)"}`));
          closeDb();
          return;
        }

        const pkg = chosen.npmPackage ?? chosen.installCmd?.replace(/^npx -y /, "");
        if (!pkg) {
          console.log(chalk.yellow(`No install command available for ${chosen.name}, visit ${chosen.url ?? "(no URL)"}`));
          closeDb();
          return;
        }

        console.log(chalk.dim(`Installing ${chosen.name}...`));
        const server = addServer({
          command: "npx",
          args: ["-y", pkg],
          name: chosen.name,
          description: chosen.description,
          transport: "stdio",
        });
        const results2 = installToAgents(server, ["claude", "codex", "gemini"]);
        for (const r of results2) {
          if (r.success) {
            console.log(chalk.green(`  ✓ ${r.agent}`));
          } else {
            console.log(chalk.red(`  ✗ ${r.agent}: ${r.error}`));
          }
        }
        console.log(chalk.green(`\nInstalled ${server.name} [${server.id}]`));
      }
    } catch (err) {
      console.error(chalk.red(`Find failed: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- sources ---
const sourcesCmd = program.command("sources").description("Manage search sources");

sourcesCmd
  .command("list")
  .description("List all search sources")
  .action(() => {
    const sources = listSources();
    if (sources.length === 0) {
      console.log(chalk.dim("No sources configured."));
      closeDb();
      return;
    }
    for (const s of sources) {
      const status = s.enabled ? chalk.green("enabled") : chalk.red("disabled");
      console.log(`  ${chalk.bold(s.name)} ${chalk.dim(`[${s.id}]`)} — ${chalk.dim(s.type)} — ${status}`);
      if (s.description) console.log(`    ${chalk.dim(s.description)}`);
      console.log(`    ${chalk.cyan(s.url)}`);
    }
    closeDb();
  });

sourcesCmd
  .command("add")
  .description("Add a new search source")
  .option("--name <name>", "Source name (required)")
  .option("--type <type>", "Source type: mcp-registry, awesome-list, npm-search, github-topic")
  .option("--url <url>", "Source URL (required)")
  .option("--description <desc>", "Description")
  .option("--test", "Test the source after adding by running a sample search")
  .action(async (opts) => {
    if (!opts.name || !opts.url) {
      console.error(chalk.red("Error: --name and --url are required"));
      closeDb();
      process.exit(1);
    }
    const validTypes = ["mcp-registry", "awesome-list", "npm-search", "github-topic"];
    let sourceType = opts.type as string | undefined;
    if (!sourceType) {
      const detected = detectSourceType(opts.url as string);
      if (detected) {
        console.log(chalk.dim(`Auto-detected type: ${detected}`));
        sourceType = detected;
      } else {
        console.error(chalk.red(`Error: could not auto-detect --type. Please specify one of: ${validTypes.join(", ")}`));
        closeDb();
        process.exit(1);
      }
    }
    if (!validTypes.includes(sourceType)) {
      console.error(chalk.red(`Error: --type must be one of: ${validTypes.join(", ")}`));
      closeDb();
      process.exit(1);
    }
    try {
      const source = addSource({
        name: opts.name,
        type: sourceType as any,
        url: opts.url,
        description: opts.description,
      });
      console.log(chalk.green(`Added source: ${source.name} [${source.id}]`));
      if (opts.test) {
        console.log(chalk.dim("Testing source..."));
        const testResults = await searchSource(source, "");
        console.log(chalk.dim(`  Found ${testResults.length} results`));
        if (testResults.length === 0) console.log(chalk.yellow("  Warning: source returned no results"));
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed to add source: ${err.message}`));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

sourcesCmd
  .command("remove")
  .argument("<id>", "Source ID to remove")
  .description("Remove a search source")
  .action((id: string) => {
    const source = getSource(id);
    if (!source) {
      console.error(chalk.red(`Source "${id}" not found.`));
      closeDb();
      process.exit(1);
    }
    removeSource(id);
    console.log(chalk.green(`Removed source: ${source.name} [${id}]`));
    closeDb();
  });

sourcesCmd
  .command("enable")
  .argument("<id>", "Source ID to enable")
  .description("Enable a search source")
  .action((id: string) => {
    const source = getSource(id);
    if (!source) {
      console.error(chalk.red(`Source "${id}" not found.`));
      closeDb();
      process.exit(1);
    }
    enableSource(id);
    console.log(chalk.green(`Enabled source: ${source.name}`));
    closeDb();
  });

sourcesCmd
  .command("disable")
  .argument("<id>", "Source ID to disable")
  .description("Disable a search source")
  .action((id: string) => {
    const source = getSource(id);
    if (!source) {
      console.error(chalk.red(`Source "${id}" not found.`));
      closeDb();
      process.exit(1);
    }
    disableSource(id);
    console.log(chalk.yellow(`Disabled source: ${source.name}`));
    closeDb();
  });

sourcesCmd
  .command("refresh")
  .argument("[id]", "Source ID to refresh (omit to refresh all)")
  .description("Clear cached results for a source")
  .action((id: string | undefined) => {
    clearCache(id);
    if (id) {
      console.log(chalk.green(`Cleared cache for source: ${id}`));
    } else {
      console.log(chalk.green("Cleared all source caches."));
    }
    closeDb();
  });

sourcesCmd
  .command("test")
  .argument("<id>", "Source ID to test")
  .description("Test a source by running a sample search")
  .action(async (id: string) => {
    const source = getSource(id);
    if (!source) {
      console.error(chalk.red(`Source "${id}" not found.`));
      closeDb();
      process.exit(1);
    }
    console.log(chalk.dim(`Testing source "${source.name}"...`));
    try {
      const results = await searchSource(source, "", true); // noCache=true
      console.log(chalk.green(`✓ Source returned ${results.length} results`));
      if (results.length > 0) {
        console.log(chalk.dim("  Sample results:"));
        for (const r of results.slice(0, 3)) {
          console.log(`    ${chalk.bold(r.name)}: ${chalk.dim(r.description?.slice(0, 60) || "no description")}`);
        }
      }
    } catch (err) {
      console.error(chalk.red(`✗ Source test failed: ${(err as Error).message}`));
    }
    closeDb();
  });

// --- install ---
program
  .command("install")
  .argument("[id]", "Server ID (from `mcps list`) to install into AI agents")
  .description("Install a registered MCP server into Claude Code, Codex, and/or Gemini")
  .option("--claude", "Install to Claude Code")
  .option("--codex", "Install to Codex")
  .option("--gemini", "Install to Gemini")
  .option("--all", "Install to all agents (default if none specified)")
  .option("--to <agents...>", "Agents to install to: claude, codex, gemini")
  .option("--from-registry <id>", "Add from official registry and install in one step")
  .option("--npm <package>", "Add an npm package as a server and install in one step")
  .action(async (id: string | undefined, opts) => {
    // Build target list from --to, individual flags, or --all
    const targets: AgentTarget[] = [];
    if (opts.to) {
      for (const t of opts.to as string[]) {
        if (t === "claude" || t === "codex" || t === "gemini") targets.push(t);
      }
    }
    if (opts.claude && !targets.includes("claude")) targets.push("claude");
    if (opts.codex && !targets.includes("codex")) targets.push("codex");
    if (opts.gemini && !targets.includes("gemini")) targets.push("gemini");
    if (opts.all || targets.length === 0) {
      if (!targets.includes("claude")) targets.push("claude");
      if (!targets.includes("codex")) targets.push("codex");
      if (!targets.includes("gemini")) targets.push("gemini");
    }

    let server;

    if (opts.fromRegistry) {
      console.log(chalk.dim(`Installing "${opts.fromRegistry}" from registry...`));
      try {
        server = await installFromRegistry(opts.fromRegistry);
        console.log(chalk.green(`Added server: ${server.name} [${server.id}]`));
      } catch (err) {
        console.error(chalk.red(`Failed to install from registry: ${(err as Error).message}`));
        closeDb();
        process.exit(1);
      }
    } else if (opts.npm) {
      const pkg = opts.npm as string;
      server = addServer({ command: "npx", args: ["-y", pkg], name: pkg, transport: "stdio" });
      console.log(chalk.green(`Added server: ${server.name} [${server.id}]`));
    } else {
      if (!id) {
        console.error(chalk.red("Error: server ID is required (or use --from-registry or --npm)"));
        closeDb();
        process.exit(1);
      }
      server = getServer(id);
      if (!server) {
        console.error(chalk.red(`Server "${id}" not found. Use \`mcps add\` first.`));
        closeDb();
        process.exit(1);
      }
    }

    console.log(chalk.dim(`Installing "${server.name}" to: ${targets.join(", ")}...`));
    const results = installToAgents(server, targets);

    for (const r of results) {
      if (r.success) {
        console.log(chalk.green(`  ✓ ${r.agent}`));
      } else {
        console.log(chalk.red(`  ✗ ${r.agent}: ${r.error}`));
      }
    }
    closeDb();
  });

// --- machines ---
const machinesCmd = program.command("machines").description("Manage registered machines for fleet operations");

machinesCmd
  .command("list")
  .description("List registered machines")
  .option("-j, --json", "Output as JSON")
  .option("--enabled-only", "Only show enabled machines")
  .action((opts) => {
    const machines = listMachines().filter((machine) => (opts.enabledOnly ? machine.enabled : true));
    if (opts.json) {
      printJson(machines);
      closeDb();
      return;
    }
    renderMachines(machines);
    closeDb();
  });

machinesCmd
  .command("add")
  .description("Register a machine for fleet health checks and installs")
  .requiredOption("--host <host>", "Hostname or SSH target")
  .option("--id <id>", "Stable machine ID")
  .option("--name <name>", "Display name (defaults to host)")
  .option("--username <username>", "SSH username")
  .option("--port <port>", "SSH port", "22")
  .option("--platform <platform>", `Machine platform: ${MACHINE_PLATFORMS.join(", ")}`)
  .option("--arch <arch>", `Machine architecture: ${MACHINE_ARCHES.join(", ")}`)
  .option("--bun-path <path>", "Explicit path to bun on the remote machine")
  .option("--npm-path <path>", "Explicit path to npm on the remote machine")
  .option("--installer <installer>", `Preferred installer: ${MACHINE_INSTALLERS.join(", ")}`)
  .option("--ssh-key-path <path>", "SSH private key path")
  .option("--disabled", "Register the machine but leave it disabled")
  .option("-j, --json", "Output as JSON")
  .action((opts) => {
    try {
      const machine = addMachine({
        id: opts.id,
        name: opts.name,
        host: opts.host,
        username: opts.username,
        port: parseIntegerOption(opts.port, "--port", { min: 1, max: 65535 }),
        platform: parseChoice(opts.platform, "--platform", MACHINE_PLATFORMS) as MachinePlatform | undefined,
        arch: parseChoice(opts.arch, "--arch", MACHINE_ARCHES) as MachineArch | undefined,
        bun_path: opts.bunPath,
        npm_path: opts.npmPath,
        installer: parseChoice(opts.installer, "--installer", MACHINE_INSTALLERS) as MachineInstaller | undefined,
        ssh_key_path: opts.sshKeyPath,
        enabled: !opts.disabled,
      });

      if (opts.json) {
        printJson(machine);
      } else {
        console.log(chalk.green(`Added machine: ${machine.name} [${machine.id}]`));
        console.log(chalk.dim(`  ${formatMachineTarget(machine)} · installer=${machine.installer}`));
      }
    } catch (err) {
      console.error(chalk.red(`Failed to add machine: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

machinesCmd
  .command("remove")
  .argument("<id>", "Machine ID to remove")
  .description("Remove a registered machine")
  .option("--yes", "Confirm removal")
  .option("-j, --json", "Output as JSON")
  .action((id: string, opts) => {
    try {
      const machine = getRegisteredMachine(id);
      if (!machine) throw new Error(`Machine "${id}" not found.`);
      if (!opts.yes) throw new Error("Refusing to remove a machine without --yes");
      removeRegisteredMachine(id);
      if (opts.json) {
        printJson({ removed: true, machine });
      } else {
        console.log(chalk.green(`Removed machine: ${machine.name} [${machine.id}]`));
      }
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

machinesCmd
  .command("enable")
  .argument("<id>", "Machine ID to enable")
  .description("Enable a registered machine for fleet operations")
  .action((id: string) => {
    try {
      const machine = getRegisteredMachine(id);
      if (!machine) throw new Error(`Machine "${id}" not found.`);
      updateRegisteredMachine(id, { enabled: true, last_error: null });
      console.log(chalk.green(`Enabled machine: ${machine.name} [${machine.id}]`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

machinesCmd
  .command("disable")
  .argument("<id>", "Machine ID to disable")
  .description("Disable a registered machine for fleet operations")
  .action((id: string) => {
    try {
      const machine = getRegisteredMachine(id);
      if (!machine) throw new Error(`Machine "${id}" not found.`);
      updateRegisteredMachine(id, { enabled: false });
      console.log(chalk.yellow(`Disabled machine: ${machine.name} [${machine.id}]`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

machinesCmd
  .command("seed-defaults")
  .description("Seed the standard spark/apple machine inventory")
  .option("-j, --json", "Output as JSON")
  .action((opts) => {
    try {
      const machines = seedDefaultMachines();
      if (opts.json) {
        printJson(machines);
      } else {
        console.log(chalk.green(`Seeded ${machines.length} machines.`));
        renderMachines(machines);
      }
    } catch (err) {
      console.error(chalk.red(`Failed to seed default machines: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

// --- fleet ---
const fleetCmd = program.command("fleet").description("Run cross-machine @hasna MCP health checks and installs");

fleetCmd
  .command("catalog")
  .description("List the discovered @hasna MCP package catalog")
  .option("--refresh", "Refresh the npm catalog instead of using cache")
  .option("--package <packages...>", "Filter to specific package names")
  .option("-j, --json", "Output as JSON")
  .action(async (opts) => {
    try {
      const catalog = await listHasnaMcpCatalog({ refresh: opts.refresh });
      const packages = opts.package as string[] | undefined;
      const entries = packages ? catalog.filter((entry) => packages.includes(entry.name)) : catalog;
      if (opts.json) {
        printJson(entries);
      } else {
        renderCatalog(entries);
      }
    } catch (err) {
      console.error(chalk.red(`Catalog lookup failed: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    } finally {
      closeDb();
    }
  });

fleetCmd
  .command("health")
  .alias("doctor")
  .argument("[machineIds...]", "Optional machine IDs to check")
  .description("Run fleet-wide MCP health checks across registered machines")
  .option("--package <packages...>", "Restrict the check to specific @hasna package names")
  .option("--refresh", "Refresh the package catalog before checking")
  .option("--timeout <ms>", "Remote timeout in milliseconds", String(180_000))
  .option("-j, --json", "Output as JSON")
  .action(async (machineIds: string[] | undefined, opts) => {
    try {
      const reports = await runFleetHealthCheck({
        machineIds,
        packages: opts.package,
        refreshCatalog: opts.refresh,
        timeoutMs: parseIntegerOption(opts.timeout, "--timeout", { min: 1_000 }),
      });

      if (opts.json) {
        printJson(reports);
      } else {
        renderFleetHealth(reports);
      }
    } catch (err) {
      console.error(chalk.red(`Fleet health check failed: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    } finally {
      closeDb();
    }
  });

fleetCmd
  .command("install")
  .argument("[machineIds...]", "Optional machine IDs to target")
  .description("Batch-install missing or outdated @hasna MCP packages across machines")
  .option("--package <packages...>", "Restrict installs to specific package names")
  .option("--mode <mode>", `Install mode: ${FLEET_INSTALL_MODES.join(", ")}`, "missing-or-outdated")
  .option("--installer <installer>", `Override installer: ${MACHINE_INSTALLERS.join(", ")}`, "auto")
  .option("--refresh", "Refresh the package catalog before installing")
  .option("--timeout <ms>", "Remote timeout in milliseconds", String(180_000))
  .option("--yes", "Confirm remote installs")
  .option("-j, --json", "Output as JSON")
  .action(async (machineIds: string[] | undefined, opts) => {
    try {
      if (!opts.yes) {
        throw new Error("Refusing to install across remote machines without --yes");
      }

      const reports = await runFleetInstall({
        machineIds,
        packages: opts.package,
        mode: parseChoice(opts.mode, "--mode", FLEET_INSTALL_MODES) ?? "missing-or-outdated",
        installer: parseChoice(opts.installer, "--installer", MACHINE_INSTALLERS) ?? "auto",
        refreshCatalog: opts.refresh,
        timeoutMs: parseIntegerOption(opts.timeout, "--timeout", { min: 1_000 }),
      });

      if (opts.json) {
        printJson(reports);
      } else {
        renderFleetInstall(reports);
      }
    } catch (err) {
      console.error(chalk.red(`Fleet install failed: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- export ---
program
  .command("export")
  .description("Export all servers and sources to a JSON file")
  .option("--file <path>", "Output file path", `${process.env.HOME ?? "~"}/.hasna/mcps/export.json`)
  .option("--stdout", "Write to stdout instead of a file")
  .action((opts) => {
    const servers = listServers();
    const sources = listSources();
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      servers,
      sources,
    };
    const json = JSON.stringify(payload, null, 2);
    if (opts.stdout) {
      console.log(json);
    } else {
      writeFileSync(opts.file, json, "utf-8");
      console.log(chalk.green(`Exported ${servers.length} server(s) and ${sources.length} source(s) to ${opts.file}`));
    }
    closeDb();
  });

// --- import ---
program
  .command("import")
  .argument("<file>", "Path to the export JSON file")
  .description("Import servers and sources from a JSON export file")
  .option("--overwrite", "Overwrite existing entries with matching IDs")
  .action((file: string, opts) => {
    let payload: { version: number; servers: any[]; sources: any[] };
    try {
      payload = JSON.parse(readFileSync(file, "utf-8"));
    } catch (err) {
      console.error(chalk.red(`Failed to read file: ${(err as Error).message}`));
      closeDb();
      process.exit(1);
    }

    if (!Array.isArray(payload.servers) || !Array.isArray(payload.sources)) {
      console.error(chalk.red("Invalid export file format."));
      closeDb();
      process.exit(1);
    }

    const db = getDb();
    const overwrite = opts.overwrite as boolean;
    const orReplace = overwrite ? "OR REPLACE" : "OR IGNORE";

    let serversImported = 0;
    let serversSkipped = 0;
    for (const s of payload.servers) {
      const existing = getServer(s.id);
      if (existing && !overwrite) {
        serversSkipped++;
        continue;
      }
      db.run(
        `INSERT ${orReplace} INTO servers (id, name, description, command, args, env, transport, url, source, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, s.name, s.description, s.command, JSON.stringify(s.args ?? []), JSON.stringify(s.env ?? {}), s.transport, s.url, s.source, s.enabled ? 1 : 0, s.created_at, s.updated_at]
      );
      serversImported++;
    }

    let sourcesImported = 0;
    let sourcesSkipped = 0;
    for (const s of payload.sources) {
      const existing = getSource(s.id);
      if (existing && !overwrite) {
        sourcesSkipped++;
        continue;
      }
      db.run(
        `INSERT ${orReplace} INTO sources (id, name, type, url, description, enabled, created_at) VALUES (?,?,?,?,?,?,?)`,
        [s.id, s.name, s.type, s.url, s.description, s.enabled ? 1 : 0, s.created_at]
      );
      sourcesImported++;
    }

    console.log(chalk.green(`Servers: ${serversImported} imported, ${serversSkipped} skipped.`));
    console.log(chalk.green(`Sources: ${sourcesImported} imported, ${sourcesSkipped} skipped.`));
    closeDb();
  });

// --- env ---
const envCmd = program.command("env").description("Manage server environment variables");

envCmd.command("list").argument("<id>").description("List env vars for a server")
  .action((id: string) => {
    const server = getServer(id);
    if (!server) { console.error(chalk.red(`Server "${id}" not found.`)); closeDb(); process.exit(1); }
    const entries = Object.entries(server.env);
    if (entries.length === 0) { console.log(chalk.dim("No env vars set.")); closeDb(); return; }
    for (const [k, v] of entries) console.log(`  ${chalk.bold(k)}=${chalk.dim(v)}`);
    closeDb();
  });

envCmd.command("set").argument("<id>").argument("<pair>", "KEY=VALUE").description("Set an env var")
  .action((id: string, pair: string) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) { console.error(chalk.red("Format: KEY=VALUE")); closeDb(); process.exit(1); }
    const key = pair.slice(0, eqIdx);
    const value = pair.slice(eqIdx + 1);
    try {
      setServerEnv(id, key, value);
      console.log(chalk.green(`Set ${key} on ${id}`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

envCmd.command("unset").argument("<id>").argument("<key>").description("Remove an env var")
  .action((id: string, key: string) => {
    try {
      unsetServerEnv(id, key);
      console.log(chalk.green(`Unset ${key} on ${id}`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      closeDb();
      process.exit(1);
    }
    closeDb();
  });

// --- mcp ---
program
  .command("mcp")
  .description("Start meta-MCP server (stdio)")
  .action(async () => {
    await startMcpServer();
  });

// --- feedback ---
program
  .command("feedback <message>")
  .description("Send feedback")
  .option("--email <email>", "Contact email")
  .option("--category <category>", "Category: bug, feature, general")
  .action((message: string, opts: { email?: string; category?: string }) => {
    const adapter = getAdapter();
    adapter.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      message, opts.email || null, opts.category || "general", VERSION
    );
    console.log(chalk.green("Feedback saved. Thank you!"));
    closeDb();
  });

// --- default: TUI ---
program.action(() => {
  render(React.createElement(App));
});

program.parse();
