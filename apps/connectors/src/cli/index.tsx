#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { App } from "./components/App.js";
import {
  CONNECTORS,
  CATEGORIES,
  getConnector,
  getConnectorsByCategory,
  searchConnectors,
  loadConnectorVersions,
} from "../lib/registry.js";
import {
  installConnector,
  installConnectors,
  getInstalledConnectors,
  removeConnector,
  getConnectorDocs,
} from "../lib/installer.js";

// Load versions from connector package.json files
loadConnectorVersions();

const isTTY = process.stdout.isTTY ?? false;

const program = new Command();

program
  .name("connectors")
  .description("Install API connectors for your project")
  .version("0.1.0");

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

// Install command
program
  .command("install")
  .alias("add")
  .argument("[connectors...]", "Connectors to install")
  .option("-o, --overwrite", "Overwrite existing connectors", false)
  .option("--json", "Output results as JSON", false)
  .description("Install one or more connectors")
  .action((connectors: string[], options) => {
    if (connectors.length === 0) {
      if (!isTTY) {
        console.error("Error: specify connectors to install. Example: connectors install figma stripe");
        process.exit(1);
      }
      render(<App />);
      return;
    }

    const results = connectors.map((name) =>
      installConnector(name, { overwrite: options.overwrite })
    );

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.every((r) => r.success) ? 0 : 1);
      return;
    }

    console.log(chalk.bold("\nInstalling connectors...\n"));
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`✓ ${result.connector}`));
      } else {
        console.log(chalk.red(`✗ ${result.connector}: ${result.error}`));
      }
    }
    console.log(chalk.dim("\nConnectors installed to .connectors/"));
    process.exit(results.every((r) => r.success) ? 0 : 1);
  });

// List command
program
  .command("list")
  .alias("ls")
  .option("-c, --category <category>", "Filter by category")
  .option("-a, --all", "Show all available connectors", false)
  .option("-i, --installed", "Show only installed connectors", false)
  .option("--json", "Output as JSON", false)
  .description("List available or installed connectors")
  .action((options) => {
    if (options.installed) {
      const installed = getInstalledConnectors();
      if (options.json) {
        console.log(JSON.stringify(installed));
        return;
      }
      if (installed.length === 0) {
        console.log(chalk.dim("No connectors installed"));
        return;
      }
      console.log(chalk.bold(`\nInstalled connectors (${installed.length}):\n`));
      for (const name of installed) {
        console.log(`  ${name}`);
      }
      return;
    }

    if (options.category) {
      const category = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!category) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Unknown category: ${options.category}` }));
          process.exit(1);
        }
        console.log(chalk.red(`Unknown category: ${options.category}`));
        console.log(chalk.dim(`Available: ${CATEGORIES.join(", ")}`));
        return;
      }
      const connectors = getConnectorsByCategory(category);
      if (options.json) {
        console.log(JSON.stringify(connectors));
        return;
      }
      console.log(chalk.bold(`\n${category} (${connectors.length}):\n`));
      console.log(`  ${chalk.dim("Name".padEnd(20))}${chalk.dim("Version".padEnd(10))}${chalk.dim("Description")}`);
      console.log(chalk.dim(`  ${"─".repeat(60)}`));
      for (const c of connectors) {
        console.log(`  ${chalk.cyan(c.name.padEnd(20))}${chalk.dim((c.version || "-").padEnd(10))}${c.description}`);
      }
      return;
    }

    // Show all
    if (options.json) {
      console.log(JSON.stringify(CONNECTORS));
      return;
    }

    console.log(chalk.bold(`\nAvailable connectors (${CONNECTORS.length}):\n`));
    for (const category of CATEGORIES) {
      const connectors = getConnectorsByCategory(category);
      console.log(chalk.bold(`${category} (${connectors.length}):`));
      console.log(`  ${chalk.dim("Name".padEnd(20))}${chalk.dim("Version".padEnd(10))}${chalk.dim("Description")}`);
      console.log(chalk.dim(`  ${"─".repeat(60)}`));
      for (const c of connectors) {
        console.log(`  ${chalk.cyan(c.name.padEnd(20))}${chalk.dim((c.version || "-").padEnd(10))}${c.description}`);
      }
      console.log();
    }
  });

// Search command
program
  .command("search")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .description("Search for connectors")
  .action((query: string, options: { json: boolean }) => {
    const results = searchConnectors(query);

    if (options.json) {
      console.log(JSON.stringify(results));
      return;
    }

    if (results.length === 0) {
      console.log(chalk.dim(`No connectors found for "${query}"`));
      return;
    }
    console.log(chalk.bold(`\nFound ${results.length} connector(s):\n`));
    console.log(`  ${chalk.dim("Name".padEnd(20))}${chalk.dim("Version".padEnd(10))}${chalk.dim("Category".padEnd(20))}${chalk.dim("Description")}`);
    console.log(chalk.dim(`  ${"─".repeat(70)}`));
    for (const c of results) {
      console.log(`  ${chalk.cyan(c.name.padEnd(20))}${chalk.dim((c.version || "-").padEnd(10))}${chalk.dim(c.category.padEnd(20))}${c.description}`);
    }
  });

// Info command - detailed info about a single connector
program
  .command("info")
  .argument("<connector>", "Connector name")
  .option("--json", "Output as JSON", false)
  .description("Show detailed info about a connector")
  .action((connector: string, options: { json: boolean }) => {
    const meta = getConnector(connector);

    if (!meta) {
      if (options.json) {
        console.log(JSON.stringify({ error: `Connector '${connector}' not found` }));
        process.exit(1);
      }
      console.log(chalk.red(`Connector '${connector}' not found`));
      process.exit(1);
      return;
    }

    const installed = getInstalledConnectors();
    const isInstalled = installed.includes(meta.name);

    if (options.json) {
      console.log(JSON.stringify({ ...meta, installed: isInstalled }));
      return;
    }

    console.log(chalk.bold(`\n${meta.displayName}`));
    console.log(chalk.dim(`${"─".repeat(40)}`));
    console.log(`  Name:        ${chalk.cyan(meta.name)}`);
    console.log(`  Version:     ${meta.version || "-"}`);
    console.log(`  Category:    ${meta.category}`);
    console.log(`  Description: ${meta.description}`);
    console.log(`  Tags:        ${meta.tags.join(", ")}`);
    console.log(`  Installed:   ${isInstalled ? chalk.green("yes") : "no"}`);
    console.log(`  Package:     @hasna/connect-${meta.name}`);
  });

// Docs command - show connector documentation
program
  .command("docs")
  .argument("<connector>", "Connector name")
  .option("--json", "Output as structured JSON", false)
  .option("--raw", "Output raw markdown", false)
  .description("Show connector documentation (auth, env vars, API, CLI commands)")
  .action((connector: string, options: { json: boolean; raw: boolean }) => {
    const meta = getConnector(connector);
    if (!meta) {
      if (options.json) {
        console.log(JSON.stringify({ error: `Connector '${connector}' not found` }));
      } else {
        console.log(chalk.red(`Connector '${connector}' not found`));
      }
      process.exit(1);
      return;
    }

    const docs = getConnectorDocs(connector);
    if (!docs) {
      if (options.json) {
        console.log(JSON.stringify({ error: `No documentation found for '${connector}'` }));
      } else {
        console.log(chalk.red(`No documentation found for '${connector}'`));
      }
      process.exit(1);
      return;
    }

    if (options.raw) {
      console.log(docs.raw);
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({
        name: meta.name,
        displayName: meta.displayName,
        version: meta.version,
        category: meta.category,
        description: meta.description,
        overview: docs.overview,
        auth: docs.auth,
        envVars: docs.envVars,
        cliCommands: docs.cliCommands,
        dataStorage: docs.dataStorage,
      }, null, 2));
      return;
    }

    // Human-readable output
    console.log(chalk.bold(`\n${meta.displayName} — Documentation`));
    console.log(chalk.dim("─".repeat(50)));

    if (docs.overview) {
      console.log(chalk.bold("\nOverview"));
      console.log(`  ${docs.overview.split("\n")[0]}`);
    }

    if (docs.auth) {
      console.log(chalk.bold("\nAuthentication"));
      for (const line of docs.auth.split("\n").filter(Boolean)) {
        console.log(`  ${line}`);
      }
    }

    if (docs.envVars.length > 0) {
      console.log(chalk.bold("\nEnvironment Variables"));
      for (const v of docs.envVars) {
        console.log(`  ${chalk.cyan(v.variable.padEnd(30))}${v.description}`);
      }
    }

    if (docs.cliCommands) {
      console.log(chalk.bold("\nCLI Commands"));
      for (const line of docs.cliCommands.split("\n")) {
        console.log(`  ${line}`);
      }
    }

    if (docs.dataStorage) {
      console.log(chalk.bold("\nData Storage"));
      for (const line of docs.dataStorage.split("\n").filter(Boolean)) {
        console.log(`  ${line}`);
      }
    }

    console.log();
  });

// Remove command
program
  .command("remove")
  .alias("rm")
  .argument("<connector>", "Connector to remove")
  .option("--json", "Output as JSON", false)
  .description("Remove an installed connector")
  .action((connector: string, options: { json: boolean }) => {
    const removed = removeConnector(connector);

    if (options.json) {
      console.log(JSON.stringify({ connector, removed }));
      process.exit(removed ? 0 : 1);
      return;
    }

    if (removed) {
      console.log(chalk.green(`✓ Removed ${connector}`));
    } else {
      console.log(chalk.red(`✗ ${connector} is not installed`));
      process.exit(1);
    }
  });

// Categories command
program
  .command("categories")
  .option("--json", "Output as JSON", false)
  .description("List all categories")
  .action((options: { json: boolean }) => {
    if (options.json) {
      const data = CATEGORIES.map((category) => ({
        name: category,
        count: getConnectorsByCategory(category).length,
      }));
      console.log(JSON.stringify(data));
      return;
    }

    console.log(chalk.bold("\nCategories:\n"));
    for (const category of CATEGORIES) {
      const count = getConnectorsByCategory(category).length;
      console.log(`  ${category} (${count})`);
    }
  });

// Serve command — local dashboard for auth management
program
  .command("serve")
  .alias("dashboard")
  .alias("open")
  .option("-p, --port <port>", "Port to run the dashboard on", "19426")
  .option("--open", "Open dashboard in browser (default)", true)
  .option("--no-open", "Don't open browser automatically")
  .description("Start local dashboard for connector auth management")
  .action(async (options: { port: string; open: boolean }) => {
    const port = parseInt(options.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.log(chalk.red("Invalid port number"));
      process.exit(1);
      return;
    }

    console.log(chalk.bold("\nStarting Connectors Dashboard...\n"));

    const { startServer } = await import("../server/serve.js");
    await startServer(port, { open: options.open });
  });

program.parse();
