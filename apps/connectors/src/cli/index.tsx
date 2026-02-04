#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { App } from "./components/App.js";
import {
  CONNECTORS,
  CATEGORIES,
  getConnectorsByCategory,
  searchConnectors,
} from "../lib/registry.js";
import {
  installConnector,
  getInstalledConnectors,
  removeConnector,
} from "../lib/installer.js";

const program = new Command();

program
  .name("connectors")
  .description("Install API connectors for your project")
  .version("0.0.1");

// Interactive mode (default)
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive connector browser")
  .action(() => {
    render(<App />);
  });

// Install command
program
  .command("install")
  .alias("add")
  .argument("[connectors...]", "Connectors to install")
  .option("-o, --overwrite", "Overwrite existing connectors", false)
  .description("Install one or more connectors")
  .action((connectors: string[], options) => {
    if (connectors.length === 0) {
      // No connectors specified, launch interactive mode
      render(<App />);
      return;
    }

    // Non-interactive install
    console.log(chalk.bold("\nInstalling connectors...\n"));

    for (const name of connectors) {
      const result = installConnector(name, { overwrite: options.overwrite });
      if (result.success) {
        console.log(chalk.green(`✓ ${name}`));
      } else {
        console.log(chalk.red(`✗ ${name}: ${result.error}`));
      }
    }

    console.log(chalk.dim("\nConnectors installed to .connectors/"));
  });

// List command
program
  .command("list")
  .alias("ls")
  .option("-c, --category <category>", "Filter by category")
  .option("-a, --all", "Show all available connectors", false)
  .option("-i, --installed", "Show only installed connectors", false)
  .description("List available or installed connectors")
  .action((options) => {
    if (options.installed) {
      const installed = getInstalledConnectors();
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
        console.log(chalk.red(`Unknown category: ${options.category}`));
        console.log(chalk.dim(`Available: ${CATEGORIES.join(", ")}`));
        return;
      }
      const connectors = getConnectorsByCategory(category);
      console.log(chalk.bold(`\n${category} (${connectors.length}):\n`));
      for (const c of connectors) {
        console.log(`  ${chalk.cyan(c.name)} - ${c.description}`);
      }
      return;
    }

    // Show all by category
    console.log(chalk.bold(`\nAvailable connectors (${CONNECTORS.length}):\n`));
    for (const category of CATEGORIES) {
      const connectors = getConnectorsByCategory(category);
      console.log(chalk.bold(`${category} (${connectors.length}):`));
      for (const c of connectors) {
        console.log(`  ${chalk.cyan(c.name)} - ${c.description}`);
      }
      console.log();
    }
  });

// Search command
program
  .command("search")
  .argument("<query>", "Search term")
  .description("Search for connectors")
  .action((query: string) => {
    const results = searchConnectors(query);
    if (results.length === 0) {
      console.log(chalk.dim(`No connectors found for "${query}"`));
      return;
    }
    console.log(chalk.bold(`\nFound ${results.length} connector(s):\n`));
    for (const c of results) {
      console.log(
        `  ${chalk.cyan(c.name)} ${chalk.dim(`[${c.category}]`)}`
      );
      console.log(`    ${c.description}`);
    }
  });

// Remove command
program
  .command("remove")
  .alias("rm")
  .argument("<connector>", "Connector to remove")
  .description("Remove an installed connector")
  .action((connector: string) => {
    const removed = removeConnector(connector);
    if (removed) {
      console.log(chalk.green(`✓ Removed ${connector}`));
    } else {
      console.log(chalk.red(`✗ ${connector} is not installed`));
    }
  });

// Categories command
program
  .command("categories")
  .description("List all categories")
  .action(() => {
    console.log(chalk.bold("\nCategories:\n"));
    for (const category of CATEGORIES) {
      const count = getConnectorsByCategory(category).length;
      console.log(`  ${category} (${count})`);
    }
  });

program.parse();
