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
  getConnectorPath,
  connectorExists,
  removeConnector,
  getConnectorDocs,
} from "../lib/installer.js";
import { readdirSync, existsSync, statSync } from "fs";
import { join, relative } from "path";
import { getAuthStatus, getAuthType, saveApiKey, getOAuthStartUrl, getEnvVars } from "../server/auth.js";
import { createInterface } from "readline";

// Load versions from connector package.json files
loadConnectorVersions();

const isTTY = process.stdout.isTTY ?? false;

const program = new Command();

program
  .name("connectors")
  .description("Install API connectors for your project")
  .version("0.2.4");

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

// Recursively list all files in a directory, returning relative paths
function listFilesRecursive(dir: string, base: string = dir): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listFilesRecursive(fullPath, base));
    } else {
      files.push(relative(base, fullPath));
    }
  }
  return files;
}

// Install command
program
  .command("install")
  .alias("add")
  .argument("[connectors...]", "Connectors to install")
  .option("-o, --overwrite", "Overwrite existing connectors", false)
  .option("-d, --dry-run", "Preview what would be installed without making changes", false)
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

    // Dry-run mode: preview without modifying filesystem
    if (options.dryRun) {
      const installed = getInstalledConnectors();
      const destDir = join(process.cwd(), ".connectors");
      const actions: Array<{
        connector: string;
        action: "install" | "overwrite" | "skip" | "error";
        reason?: string;
        sourcePath?: string;
        destPath?: string;
        files?: string[];
        importLine?: string;
      }> = [];

      for (const name of connectors) {
        // Validate connector name
        if (!/^[a-z0-9-]+$/.test(name)) {
          actions.push({ connector: name, action: "error", reason: `Invalid connector name '${name}'` });
          continue;
        }

        const meta = getConnector(name);
        if (!meta) {
          actions.push({ connector: name, action: "error", reason: `Connector '${name}' not found in registry` });
          continue;
        }

        if (!connectorExists(name)) {
          actions.push({ connector: name, action: "error", reason: `Connector '${name}' source files not found` });
          continue;
        }

        const connectorDirName = name.startsWith("connect-") ? name : `connect-${name}`;
        const sourcePath = getConnectorPath(name);
        const destPath = join(destDir, connectorDirName);
        const alreadyInstalled = installed.includes(name);
        const files = listFilesRecursive(sourcePath);
        const importLine = `export * as ${name} from './${connectorDirName}/src/index.js';`;

        if (alreadyInstalled && !options.overwrite) {
          actions.push({
            connector: name,
            action: "skip",
            reason: "Already installed. Use --overwrite to replace.",
            sourcePath,
            destPath,
          });
        } else {
          actions.push({
            connector: name,
            action: alreadyInstalled ? "overwrite" : "install",
            sourcePath,
            destPath,
            files,
            importLine,
          });
        }
      }

      // JSON output
      if (options.json) {
        console.log(JSON.stringify({ dryRun: true, actions }, null, 2));
        process.exit(actions.every((a) => a.action !== "error") ? 0 : 1);
        return;
      }

      // Human-readable output
      console.log(chalk.bold("\nDry run — no changes will be made\n"));

      for (const a of actions) {
        if (a.action === "error") {
          console.log(chalk.red(`  ✗ ${a.connector}: ${a.reason}`));
          continue;
        }

        if (a.action === "skip") {
          console.log(chalk.yellow(`  ⊘ ${a.connector}: ${a.reason}`));
          continue;
        }

        const actionLabel = a.action === "overwrite"
          ? chalk.yellow("overwrite")
          : chalk.green("install");
        console.log(`  ${actionLabel} ${chalk.cyan(a.connector)}`);
        console.log(chalk.dim(`    source: ${a.sourcePath}`));
        console.log(chalk.dim(`    dest:   ${a.destPath}`));

        if (a.files && a.files.length > 0) {
          console.log(chalk.dim(`    files (${a.files.length}):`));
          for (const f of a.files) {
            console.log(chalk.dim(`      ${f}`));
          }
        }

        if (a.importLine) {
          console.log(`    ${chalk.dim("index.ts:")} ${a.importLine}`);
        }
        console.log();
      }

      const installCount = actions.filter((a) => a.action === "install").length;
      const overwriteCount = actions.filter((a) => a.action === "overwrite").length;
      const skipCount = actions.filter((a) => a.action === "skip").length;
      const errorCount = actions.filter((a) => a.action === "error").length;
      const parts: string[] = [];
      if (installCount) parts.push(chalk.green(`${installCount} to install`));
      if (overwriteCount) parts.push(chalk.yellow(`${overwriteCount} to overwrite`));
      if (skipCount) parts.push(chalk.yellow(`${skipCount} skipped`));
      if (errorCount) parts.push(chalk.red(`${errorCount} failed`));
      console.log(`  ${chalk.bold("Summary:")} ${parts.join(", ")}`);
      console.log(chalk.dim("\n  Run without --dry-run to apply.\n"));
      process.exit(errorCount > 0 ? 1 : 0);
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
    const succeeded: string[] = [];
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`✓ ${result.connector}`));
        succeeded.push(result.connector);
      } else {
        console.log(chalk.red(`✗ ${result.connector}: ${result.error}`));
      }
    }

    if (succeeded.length > 0) {
      console.log(chalk.bold("\nNext steps:"));
      const importNames = succeeded.join(", ");
      console.log(chalk.dim(`  1. Import:  `) + `import { ${importNames} } from './.connectors'`);
      console.log(chalk.dim(`  2. Set key: `) + `connectors docs ${succeeded[0]}` + chalk.dim(` (see env vars)`));
      console.log(chalk.dim(`  3. Explore: `) + `connectors serve` + chalk.dim(` (dashboard for auth management)`));
    }
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

      if (installed.length === 0) {
        if (options.json) {
          console.log(JSON.stringify([]));
        } else {
          console.log(chalk.dim("No connectors installed"));
        }
        return;
      }

      const statuses = installed.map((name) => {
        const meta = getConnector(name);
        const auth = getAuthStatus(name);

        // Compute expiry label for OAuth connectors
        let expiryLabel: string | null = null;
        let expired = false;
        if (auth.type === "oauth" && auth.tokenExpiry) {
          const remaining = auth.tokenExpiry - Date.now();
          if (remaining <= 0) {
            expiryLabel = "Expired";
            expired = true;
          } else {
            const minutes = Math.floor(remaining / 60_000);
            if (minutes < 60) {
              expiryLabel = `Expires ${minutes}m`;
            } else {
              const hours = Math.floor(minutes / 60);
              expiryLabel = `Expires ${hours}h`;
            }
          }
        }

        return {
          name,
          category: meta?.category || "Unknown",
          authType: auth.type,
          configured: auth.configured,
          expired,
          expiryLabel,
          tokenExpiry: auth.tokenExpiry || null,
          hasRefreshToken: auth.hasRefreshToken || false,
        };
      });

      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
        return;
      }

      // Compute column widths
      const nameWidth = Math.max(6, ...statuses.map((s) => s.name.length)) + 2;
      const catWidth = Math.max(10, ...statuses.map((s) => s.category.length)) + 2;
      const authWidth = 10;

      console.log(chalk.bold(`\nInstalled connectors (${installed.length}):\n`));

      // Header
      console.log(
        `  ${chalk.dim("Name".padEnd(nameWidth))}` +
        `${chalk.dim("Category".padEnd(catWidth))}` +
        `${chalk.dim("Auth Type".padEnd(authWidth))}` +
        `${chalk.dim("Status")}`
      );
      console.log(chalk.dim(`  ${"─".repeat(nameWidth + catWidth + authWidth + 24)}`));

      for (const s of statuses) {
        const authTypeLabel =
          s.authType === "oauth" ? "OAuth" :
          s.authType === "apikey" ? "API Key" :
          "Bearer";

        let statusLabel: string;
        if (s.configured && s.expired) {
          statusLabel = chalk.yellow("⚠ Token expired");
        } else if (s.configured) {
          statusLabel = chalk.green("✓ Configured");
        } else {
          statusLabel = chalk.red("✗ Needs auth");
        }

        // Append expiry info for configured OAuth connectors
        let expiryStr = "";
        if (s.expiryLabel && s.configured && !s.expired) {
          expiryStr = `   ${chalk.dim(s.expiryLabel)}`;
        }

        console.log(
          `  ${chalk.cyan(s.name.padEnd(nameWidth))}` +
          `${s.category.padEnd(catWidth)}` +
          `${authTypeLabel.padEnd(authWidth)}` +
          `${statusLabel}${expiryStr}`
        );
      }

      console.log();
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

// Update command — refresh installed connectors from the package
program
  .command("update")
  .argument("[connectors...]", "Specific connectors to update (default: all installed)")
  .description("Update installed connectors to the latest version from the package")
  .option("-a, --all", "Update all without prompting", false)
  .option("--json", "Output as JSON", false)
  .action(async (connectors: string[], options: { all: boolean; json: boolean }) => {
    const installed = getInstalledConnectors();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ updated: [] }));
      } else {
        console.log(chalk.dim("No connectors installed. Run: connectors install <name>"));
      }
      return;
    }

    // Determine which connectors to update
    let toUpdate: string[];

    if (connectors.length > 0) {
      // Specific connectors requested — validate they are installed
      const notInstalled = connectors.filter((name) => !installed.includes(name));
      if (notInstalled.length > 0) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Not installed: ${notInstalled.join(", ")}` }));
        } else {
          console.log(chalk.red(`Not installed: ${notInstalled.join(", ")}`));
          console.log(chalk.dim("Installed connectors: " + installed.join(", ")));
        }
        process.exit(1);
        return;
      }
      toUpdate = connectors;
    } else if (options.all || !isTTY) {
      // --all flag or non-TTY: update everything
      toUpdate = installed;
    } else {
      // Interactive TTY: prompt for confirmation
      console.log(chalk.bold(`\nInstalled connectors (${installed.length}):\n`));
      for (const name of installed) {
        console.log(`  ${chalk.cyan(name)}`);
      }
      console.log();

      const confirmed = await new Promise<boolean>((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(`  Update all ${installed.length} connector(s)? (y/N) `, (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
        });
      });

      if (!confirmed) {
        console.log(chalk.dim("\n  Aborted. Use 'connectors update <name1> <name2>' to update specific connectors.\n"));
        process.exit(0);
        return;
      }
      toUpdate = installed;
    }

    const results = toUpdate.map((name) =>
      installConnector(name, { overwrite: true })
    );

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.every((r) => r.success) ? 0 : 1);
      return;
    }

    console.log(chalk.bold(`\nUpdating ${toUpdate.length} connector(s)...\n`));
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`✓ ${result.connector}`));
      } else {
        console.log(chalk.red(`✗ ${result.connector}: ${result.error}`));
      }
    }
    process.exit(results.every((r) => r.success) ? 0 : 1);
  });

// Status command — show auth status of installed connectors
program
  .command("status")
  .option("--json", "Output as JSON", false)
  .description("Show auth status of installed connectors")
  .action((options: { json: boolean }) => {
    const installed = getInstalledConnectors();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log(chalk.dim("No connectors installed. Run: connectors install <name>"));
      }
      return;
    }

    const statuses = installed.map((name) => {
      const meta = getConnector(name);
      const auth = getAuthStatus(name);

      // Compute expiry label for OAuth connectors
      let expiryLabel: string | null = null;
      let expired = false;
      if (auth.type === "oauth" && auth.tokenExpiry) {
        const remaining = auth.tokenExpiry - Date.now();
        if (remaining <= 0) {
          expiryLabel = "Expired";
          expired = true;
        } else {
          const minutes = Math.floor(remaining / 60_000);
          if (minutes < 60) {
            expiryLabel = `Expires ${minutes}m`;
          } else {
            const hours = Math.floor(minutes / 60);
            expiryLabel = `Expires ${hours}h`;
          }
        }
      }

      return {
        name,
        category: meta?.category || "Unknown",
        authType: auth.type,
        configured: auth.configured,
        expired,
        expiryLabel,
        tokenExpiry: auth.tokenExpiry || null,
        hasRefreshToken: auth.hasRefreshToken || false,
      };
    });

    if (options.json) {
      console.log(JSON.stringify(statuses, null, 2));
      return;
    }

    // Compute column widths
    const nameWidth = Math.max(6, ...statuses.map((s) => s.name.length)) + 2;
    const catWidth = Math.max(10, ...statuses.map((s) => s.category.length)) + 2;
    const authWidth = 10;

    console.log(chalk.bold("\nConnector Status\n"));

    // Header
    console.log(
      `  ${chalk.dim("Name".padEnd(nameWidth))}` +
      `${chalk.dim("Category".padEnd(catWidth))}` +
      `${chalk.dim("Auth Type".padEnd(authWidth))}` +
      `${chalk.dim("Status")}`
    );
    console.log(chalk.dim(`  ${"─".repeat(nameWidth + catWidth + authWidth + 24)}`));

    for (const s of statuses) {
      const authTypeLabel =
        s.authType === "oauth" ? "OAuth" :
        s.authType === "apikey" ? "API Key" :
        "Bearer";

      let statusLabel: string;
      if (s.configured && s.expired) {
        statusLabel = chalk.yellow("⚠ Token expired");
      } else if (s.configured) {
        statusLabel = chalk.green("✓ Configured");
      } else {
        statusLabel = chalk.red("✗ Not configured");
      }

      // Append expiry info for configured OAuth connectors
      let expiryStr = "";
      if (s.expiryLabel && s.configured && !s.expired) {
        expiryStr = `   ${chalk.dim(s.expiryLabel)}`;
      }

      console.log(
        `  ${chalk.cyan(s.name.padEnd(nameWidth))}` +
        `${s.category.padEnd(catWidth)}` +
        `${authTypeLabel.padEnd(authWidth)}` +
        `${statusLabel}${expiryStr}`
      );
    }

    console.log();
  });

// Doctor command — health check for all installed connectors
program
  .command("doctor")
  .option("--json", "Output as JSON", false)
  .description("Check all installed connectors for issues and output a health report")
  .action((options: { json: boolean }) => {
    const installed = getInstalledConnectors();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ connectors: [], summary: { healthy: 0, warnings: 0, errors: 0 } }));
      } else {
        console.log(chalk.dim("No connectors installed. Run: connectors install <name>"));
      }
      return;
    }

    const ONE_HOUR = 60 * 60 * 1000;

    const results = installed.map((name) => {
      const meta = getConnector(name);
      const auth = getAuthStatus(name);
      const issues: string[] = [];
      const suggestions: string[] = [];
      let level: "healthy" | "warning" | "error" = "healthy";

      if (!auth.configured) {
        level = "error";
        issues.push("Not configured");
        if (auth.type === "oauth") {
          suggestions.push(`Run 'connectors serve' and authenticate ${name} via OAuth`);
        } else {
          suggestions.push(`Run 'connectors auth ${name}' to configure`);
        }
      } else if (auth.type === "oauth" && auth.tokenExpiry) {
        const remaining = auth.tokenExpiry - Date.now();
        if (remaining <= 0) {
          level = "error";
          issues.push("Token expired");
          if (auth.hasRefreshToken) {
            suggestions.push(`Run 'connectors serve' and refresh the token for ${name}`);
          } else {
            suggestions.push(`Run 'connectors serve' and re-authenticate ${name} via OAuth`);
          }
        } else if (remaining < ONE_HOUR) {
          level = "warning";
          const minutes = Math.floor(remaining / 60_000);
          issues.push(`Token expiring soon (${minutes}m remaining)`);
          suggestions.push(`Refresh the token for ${name} before it expires`);
        }
      }

      // Check for partially configured multi-field connectors
      if (auth.configured && auth.envVarTotalCount > 1 && auth.envVarSetCount < auth.envVarTotalCount) {
        if (level === "healthy") level = "warning";
        issues.push(`Partially configured (${auth.envVarSetCount}/${auth.envVarTotalCount} env vars set)`);
        const missingVars = auth.envVars.filter((v) => !v.set).map((v) => v.variable);
        suggestions.push(`Set missing env vars: ${missingVars.join(", ")}`);
      }

      return {
        name,
        displayName: meta?.displayName || name,
        category: meta?.category || "Unknown",
        authType: auth.type,
        level,
        issues,
        suggestions,
      };
    });

    const summary = {
      healthy: results.filter((r) => r.level === "healthy").length,
      warnings: results.filter((r) => r.level === "warning").length,
      errors: results.filter((r) => r.level === "error").length,
    };

    if (options.json) {
      console.log(JSON.stringify({ connectors: results, summary }, null, 2));
      process.exit(summary.errors > 0 ? 1 : 0);
      return;
    }

    console.log(chalk.bold("\nConnector Health Report\n"));

    for (const r of results) {
      let icon: string;
      if (r.level === "healthy") {
        icon = chalk.green("✓");
      } else if (r.level === "warning") {
        icon = chalk.yellow("⚠");
      } else {
        icon = chalk.red("✗");
      }

      const nameStr = r.level === "healthy"
        ? chalk.green(r.name)
        : r.level === "warning"
          ? chalk.yellow(r.name)
          : chalk.red(r.name);

      if (r.issues.length === 0) {
        console.log(`  ${icon} ${nameStr} — ${chalk.green("healthy")}`);
      } else {
        console.log(`  ${icon} ${nameStr} — ${r.issues.join(", ")}`);
        for (const suggestion of r.suggestions) {
          console.log(chalk.dim(`      → ${suggestion}`));
        }
      }
    }

    // Summary
    const parts: string[] = [];
    if (summary.healthy > 0) parts.push(chalk.green(`${summary.healthy} healthy`));
    if (summary.warnings > 0) parts.push(chalk.yellow(`${summary.warnings} warning${summary.warnings !== 1 ? "s" : ""}`));
    if (summary.errors > 0) parts.push(chalk.red(`${summary.errors} error${summary.errors !== 1 ? "s" : ""}`));

    console.log(`\n  ${chalk.bold("Summary:")} ${parts.join(", ")}`);

    if (summary.errors > 0 || summary.warnings > 0) {
      console.log(chalk.dim("\n  Run 'connectors auth <name>' to configure individual connectors."));
      console.log(chalk.dim("  Run 'connectors serve' to manage auth via the dashboard.\n"));
    } else {
      console.log(chalk.green("\n  All connectors are healthy!\n"));
    }

    process.exit(summary.errors > 0 ? 1 : 0);
  });

// Auth command — configure connector authentication from CLI
program
  .command("auth")
  .argument("<connector>", "Connector name to configure auth for")
  .option("-k, --key <value>", "API key or bearer token value (non-interactive)")
  .option("-f, --field <field>", "Which field to set (for multi-field connectors)")
  .option("--json", "Output as JSON", false)
  .description("Configure authentication for a connector")
  .action(async (connector: string, options: { key?: string; field?: string; json: boolean }) => {
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

    const authType = getAuthType(connector);
    const statusBefore = getAuthStatus(connector);

    // Show current status
    if (!options.json) {
      const statusLabel = statusBefore.configured
        ? chalk.green("configured")
        : chalk.red("not configured");
      console.log(chalk.bold(`\n${meta.displayName} — Auth Configuration\n`));
      console.log(`  Auth type: ${authType === "oauth" ? "OAuth" : authType === "apikey" ? "API Key" : "Bearer Token"}`);
      console.log(`  Status:    ${statusLabel}`);

      const envVars = getEnvVars(connector);
      if (envVars.length > 0) {
        console.log(`  Fields:    ${envVars.map((v) => v.variable).join(", ")}`);
      }
      console.log();
    }

    // Handle OAuth connectors
    if (authType === "oauth") {
      if (options.json) {
        console.log(JSON.stringify({
          connector,
          authType: "oauth",
          message: "OAuth connectors require browser-based authentication. Use 'connectors serve' or pass --key to set tokens manually.",
        }));
        process.exit(0);
        return;
      }

      // Start a temporary dashboard server and open OAuth URL
      console.log(chalk.yellow("OAuth connectors require browser-based authentication."));
      console.log();

      try {
        const port = 19426 + Math.floor(Math.random() * 1000);
        const { startServer } = await import("../server/serve.js");

        console.log(chalk.dim(`Starting temporary server on port ${port}...`));
        // startServer registers its own SIGINT handler and calls process.exit
        await startServer(port, { open: false });

        const oauthUrl = `http://localhost:${port}/oauth/${connector}/start`;
        console.log(chalk.bold(`\nOpen this URL to authenticate:\n`));
        console.log(`  ${chalk.cyan(oauthUrl)}\n`);

        // Try to open the browser
        try {
          const { exec } = await import("child_process");
          const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          exec(`${openCmd} "${oauthUrl}"`);
          console.log(chalk.dim("Browser opened. Complete the OAuth flow, then press Ctrl+C to stop the server."));
        } catch {
          console.log(chalk.dim("Open the URL above in your browser to complete authentication."));
        }

        console.log(chalk.dim("Press Ctrl+C when done.\n"));

        // Keep the process alive — startServer's SIGINT handler will exit
        await new Promise<void>(() => {});
      } catch (err) {
        console.log(chalk.red(`Failed to start OAuth flow: ${err}`));
        console.log(chalk.dim("Try 'connectors serve' to use the full dashboard instead."));
        process.exit(1);
      }
      return;
    }

    // Handle API key / Bearer token connectors
    if (options.key) {
      // Non-interactive: save directly
      saveApiKey(connector, options.key, options.field || undefined);
      const statusAfter = getAuthStatus(connector);

      if (options.json) {
        console.log(JSON.stringify({
          connector,
          authType,
          configured: statusAfter.configured,
          field: options.field || null,
        }));
      } else {
        console.log(chalk.green(`✓ API key saved for ${meta.displayName}`));
        if (options.field) {
          console.log(chalk.dim(`  Field: ${options.field}`));
        }
      }
      process.exit(0);
      return;
    }

    // Interactive: prompt for the key
    if (!isTTY) {
      if (options.json) {
        console.log(JSON.stringify({ error: "Interactive mode requires a TTY. Use --key flag." }));
      } else {
        console.log(chalk.red("Interactive mode requires a TTY. Use --key <value> to set non-interactively."));
      }
      process.exit(1);
      return;
    }

    const envVars = getEnvVars(connector);
    const fieldLabel = options.field
      ? options.field
      : envVars.length > 0
        ? envVars[0].variable
        : "API Key";

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Mask input with asterisks
    const key = await new Promise<string>((resolve) => {
      let input = "";
      process.stdout.write(`  Enter ${fieldLabel}: `);

      // Switch to raw mode for masking
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.setEncoding("utf-8");

      const onData = (ch: string) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r" || c === "\u0004") {
          // Enter or Ctrl+D
          process.stdout.write("\n");
          process.stdin.removeListener("data", onData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.pause();
          rl.close();
          resolve(input);
        } else if (c === "\u0003") {
          // Ctrl+C
          process.stdout.write("\n");
          rl.close();
          process.exit(0);
        } else if (c === "\u007f" || c === "\b") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += c;
          process.stdout.write("*");
        }
      };

      process.stdin.on("data", onData);
    });

    if (!key.trim()) {
      console.log(chalk.red("\n  No key provided. Aborting."));
      process.exit(1);
      return;
    }

    saveApiKey(connector, key.trim(), options.field || undefined);
    const statusAfter = getAuthStatus(connector);

    console.log(chalk.green(`\n✓ API key saved for ${meta.displayName}`));
    if (statusAfter.configured) {
      console.log(chalk.green(`  Status: configured`));
    }
    process.exit(0);
  });

// Init command — guided onboarding for picking and installing connectors
program
  .command("init")
  .option("--json", "Output categories and connectors as JSON (non-interactive)", false)
  .description("Guided onboarding: pick categories, choose connectors, install them")
  .action(async (options: { json: boolean }) => {
    // JSON mode: dump categories with their connectors and exit
    if (options.json) {
      const data = CATEGORIES.map((category) => ({
        name: category,
        connectors: getConnectorsByCategory(category).map((c) => ({
          name: c.name,
          displayName: c.displayName,
          description: c.description,
          version: c.version || null,
        })),
      }));
      console.log(JSON.stringify(data, null, 2));
      process.exit(0);
      return;
    }

    // Interactive mode requires TTY
    if (!isTTY) {
      console.error("Interactive mode requires a TTY. Use --json for non-interactive output.");
      process.exit(1);
      return;
    }

    // Helper: prompt user and return trimmed answer
    function ask(question: string): Promise<string> {
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    }

    // Welcome
    console.log();
    console.log(chalk.bold("Welcome to Connectors!"));
    console.log(chalk.dim("Let's get you set up with the API connectors you need.\n"));

    // Step 1: Show categories with counts
    console.log(chalk.bold("Available categories:\n"));
    const categoryList = CATEGORIES.map((cat) => ({
      name: cat,
      connectors: getConnectorsByCategory(cat),
    }));
    for (let i = 0; i < categoryList.length; i++) {
      const c = categoryList[i];
      console.log(`  ${chalk.cyan(String(i + 1).padStart(2))}. ${c.name} ${chalk.dim(`(${c.connectors.length} connectors)`)}`);
    }
    console.log();

    // Step 2: Ask user to pick categories
    const catAnswer = await ask(
      chalk.bold("Pick categories") + chalk.dim(" (comma-separated numbers, e.g. 1,3,5): ")
    );

    if (!catAnswer) {
      console.log(chalk.dim("\nNo categories selected. Exiting.\n"));
      process.exit(0);
      return;
    }

    const catIndices = catAnswer
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < categoryList.length);

    if (catIndices.length === 0) {
      console.log(chalk.red("\nNo valid categories selected. Exiting.\n"));
      process.exit(1);
      return;
    }

    // Gather connectors from selected categories (deduplicated)
    const selectedCategories = catIndices.map((i) => categoryList[i]);
    const seen = new Set<string>();
    const connectorPool: Array<{ name: string; displayName: string; description: string; category: string }> = [];
    for (const cat of selectedCategories) {
      for (const c of cat.connectors) {
        if (!seen.has(c.name)) {
          seen.add(c.name);
          connectorPool.push({
            name: c.name,
            displayName: c.displayName,
            description: c.description,
            category: cat.name,
          });
        }
      }
    }

    // Step 3: Show connectors in selected categories
    console.log();
    console.log(chalk.bold(`Connectors in ${selectedCategories.map((c) => c.name).join(", ")}:\n`));

    const nameWidth = Math.max(12, ...connectorPool.map((c) => c.name.length)) + 2;
    for (let i = 0; i < connectorPool.length; i++) {
      const c = connectorPool[i];
      console.log(
        `  ${chalk.cyan(String(i + 1).padStart(3))}. ${c.name.padEnd(nameWidth)}${chalk.dim(c.description)}`
      );
    }
    console.log();

    // Step 4: Ask which connectors to install
    const connAnswer = await ask(
      chalk.bold("Install which connectors?") + chalk.dim(" (comma-separated numbers, or 'all'): ")
    );

    if (!connAnswer) {
      console.log(chalk.dim("\nNo connectors selected. Exiting.\n"));
      process.exit(0);
      return;
    }

    let toInstall: string[];
    if (connAnswer.toLowerCase() === "all") {
      toInstall = connectorPool.map((c) => c.name);
    } else {
      const connIndices = connAnswer
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < connectorPool.length);

      if (connIndices.length === 0) {
        console.log(chalk.red("\nNo valid connectors selected. Exiting.\n"));
        process.exit(1);
        return;
      }
      toInstall = connIndices.map((i) => connectorPool[i].name);
    }

    // Step 5: Install
    console.log(chalk.bold(`\nInstalling ${toInstall.length} connector(s)...\n`));

    const results = toInstall.map((name) => installConnector(name, { overwrite: false }));
    const succeeded: string[] = [];
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`  ✓ ${result.connector}`));
        succeeded.push(result.connector);
      } else {
        console.log(chalk.red(`  ✗ ${result.connector}: ${result.error}`));
      }
    }

    // Step 6: Next steps
    if (succeeded.length > 0) {
      console.log(chalk.bold("\nNext steps:\n"));
      console.log(`  ${chalk.dim("1.")} Import in your code:`);
      console.log(`     ${chalk.cyan(`import { ${succeeded.slice(0, 3).join(", ")}${succeeded.length > 3 ? ", ..." : ""} } from './.connectors'`)}`);
      console.log();
      console.log(`  ${chalk.dim("2.")} Configure authentication:`);
      console.log(`     ${chalk.cyan("connectors auth <name>")}  ${chalk.dim("— set API keys interactively")}`);
      console.log(`     ${chalk.cyan("connectors serve")}        ${chalk.dim("— open dashboard for OAuth setup")}`);
      console.log();
      console.log(`  ${chalk.dim("3.")} Check connector docs:`);
      console.log(`     ${chalk.cyan(`connectors docs ${succeeded[0]}`)}  ${chalk.dim("— see auth & env var details")}`);
      console.log();
      console.log(`  ${chalk.dim("4.")} Verify everything works:`);
      console.log(`     ${chalk.cyan("connectors doctor")}       ${chalk.dim("— health check all connectors")}`);
    }
    console.log();

    process.exit(results.every((r) => r.success) ? 0 : 1);
  });

program.parse();
