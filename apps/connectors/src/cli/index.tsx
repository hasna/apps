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
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, relative } from "path";
import { getAuthStatus, getAuthType, saveApiKey, getOAuthStartUrl, getEnvVars, refreshOAuthToken } from "../server/auth.js";
import { TEST_ENDPOINTS } from "../lib/test-endpoints.js";
import { createInterface } from "readline";
import { getConnectorOperations, runConnectorCommand, getConnectorCommandHelp, getConnectorCliPath } from "../lib/runner.js";

// Load versions from connector package.json files
loadConnectorVersions();

const isTTY = process.stdout.isTTY ?? false;

const PRESETS: Record<string, { description: string; connectors: string[] }> = {
  fullstack: { description: "Full-stack web app essentials", connectors: ["stripe", "github", "resend", "anthropic", "figma"] },
  ai: { description: "AI and ML models", connectors: ["anthropic", "openai", "xai", "mistral", "googlegemini", "elevenlabs"] },
  google: { description: "Google Workspace suite", connectors: ["gmail", "googledrive", "googledocs", "googlesheets", "googlecalendar", "googletasks", "googlecontacts"] },
  social: { description: "Social media platforms", connectors: ["x", "reddit", "youtube", "tiktok", "meta", "discord", "substack"] },
  devtools: { description: "Developer tooling", connectors: ["github", "docker", "sentry", "cloudflare", "e2b", "firecrawl"] },
  commerce: { description: "Commerce and finance", connectors: ["stripe", "shopify", "revolut", "mercury", "pandadoc"] },
};

const program = new Command();

program
  .name("connectors")
  .description("Install API connectors for your project")
  .version("0.5.7")
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
  .option("-c, --category <category>", "Install all connectors in a category")
  .option("--preset <preset>", "Install a preset bundle (e.g. ai, fullstack, google)")
  .option("--json", "Output results as JSON", false)
  .description("Install one or more connectors")
  .action((connectors: string[], options) => {
    // Resolve --category to connector names
    if (options.category) {
      const category = CATEGORIES.find(c => c.toLowerCase() === options.category.toLowerCase());
      if (!category) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Unknown category: ${options.category}. Available: ${CATEGORIES.join(", ")}` }));
        } else {
          console.log(chalk.red(`Unknown category: ${options.category}`));
          console.log(chalk.dim(`Available: ${CATEGORIES.join(", ")}`));
        }
        process.exit(1);
        return;
      }
      const categoryConnectors = getConnectorsByCategory(category).map(c => c.name);
      connectors.push(...categoryConnectors);
    }

    // Resolve --preset to connector names
    if (options.preset) {
      const preset = PRESETS[options.preset.toLowerCase()];
      if (!preset) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Unknown preset: ${options.preset}. Available: ${Object.keys(PRESETS).join(", ")}` }));
        } else {
          console.log(chalk.red(`Unknown preset: ${options.preset}`));
          console.log(chalk.dim(`Available: ${Object.keys(PRESETS).join(", ")}`));
        }
        process.exit(1);
        return;
      }
      connectors.push(...preset.connectors);
    }

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
  .option("-b, --brief", "Output only connector names", false)
  .option("--json", "Output as JSON", false)
  .description("List available or installed connectors")
  .action((options) => {
    // --brief: output only connector names
    if (options.brief) {
      if (options.installed) {
        const installed = getInstalledConnectors();
        if (options.json) {
          console.log(JSON.stringify(installed));
        } else {
          for (const name of installed) console.log(name);
        }
      } else if (options.category) {
        const category = CATEGORIES.find(c => c.toLowerCase() === options.category.toLowerCase());
        if (!category) { console.error(`Unknown category: ${options.category}`); process.exit(1); return; }
        const names = getConnectorsByCategory(category).map(c => c.name);
        if (options.json) { console.log(JSON.stringify(names)); } else { for (const n of names) console.log(n); }
      } else {
        const names = CONNECTORS.map(c => c.name);
        if (options.json) { console.log(JSON.stringify(names)); } else { for (const n of names) console.log(n); }
      }
      return;
    }

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
        console.log(JSON.stringify({ error: `Connector '${connector}' not found. Run 'connectors list' to see available connectors.` }));
        process.exit(1);
      }
      console.log(chalk.red(`Connector '${connector}' not found`));
      console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${connector}' to search.`));
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
        console.log(JSON.stringify({ error: `Connector '${connector}' not found. Run 'connectors list' to see available connectors.` }));
      } else {
        console.log(chalk.red(`Connector '${connector}' not found`));
        console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${connector}' to search.`));
      }
      process.exit(1);
      return;
    }

    const docs = getConnectorDocs(connector);
    if (!docs) {
      if (options.json) {
        console.log(JSON.stringify({ error: `No documentation found for '${connector}'. The connector may not be installed yet. Run 'connectors install ${connector}' first.` }));
      } else {
        console.log(chalk.red(`No documentation found for '${connector}'`));
        console.log(chalk.dim(`The connector may not be installed yet. Run 'connectors install ${connector}' first.`));
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
      console.log(chalk.dim(`Run 'connectors install ${connector}' to install it, or 'connectors list --installed' to see installed connectors.`));
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
          console.log(chalk.dim(`Run 'connectors install ${notInstalled[0]}' to install, or 'connectors list --installed' to see installed connectors.`));
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
  .description("Show auth status of all configured connectors (project + global)")
  .action((options: { json: boolean }) => {
    const installed = getInstalledConnectors();
    const configDir = join(homedir(), ".connectors");
    const seen = new Set<string>();

    type StatusEntry = {
      name: string;
      authType: string;
      configured: boolean;
      profile: string;
      expired: boolean;
      expiryLabel: string | null;
      tokenExpiry: number | null;
      hasRefreshToken: boolean;
      source: "project" | "global";
    };

    const allStatuses: StatusEntry[] = [];

    // Helper: build a status entry for a connector
    function buildStatusEntry(name: string, source: "project" | "global"): StatusEntry {
      const auth = getAuthStatus(name);

      // Read current profile
      const connectorName = name.startsWith("connect-") ? name : `connect-${name}`;
      const currentProfileFile = join(configDir, connectorName, "current_profile");
      let profile = "default";
      if (existsSync(currentProfileFile)) {
        try { profile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
      }

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
        authType: auth.type,
        configured: auth.configured,
        profile,
        expired,
        expiryLabel,
        tokenExpiry: auth.tokenExpiry || null,
        hasRefreshToken: auth.hasRefreshToken || false,
        source,
      };
    }

    // 1. Project-installed connectors
    for (const name of installed) {
      seen.add(name);
      allStatuses.push(buildStatusEntry(name, "project"));
    }

    // 2. Global connectors from ~/.connectors/connect-*
    if (existsSync(configDir)) {
      try {
        const globalDirs = readdirSync(configDir).filter((f: string) => {
          if (!f.startsWith("connect-")) return false;
          try { return statSync(join(configDir, f)).isDirectory(); } catch { return false; }
        });

        for (const dir of globalDirs) {
          const name = dir.replace("connect-", "");
          if (seen.has(name)) continue;
          seen.add(name);
          allStatuses.push(buildStatusEntry(name, "global"));
        }
      } catch {
        // ignore read errors on ~/.connectors
      }
    }

    if (allStatuses.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ configured: [], unconfigured: [], summary: { total: 0, configured: 0, unconfigured: 0 } }, null, 2));
      } else {
        console.log(chalk.dim("No connectors found. Run: connectors install <name>"));
      }
      return;
    }

    // Group by configured vs unconfigured
    const configuredList = allStatuses.filter((s) => s.configured);
    const unconfiguredList = allStatuses.filter((s) => !s.configured);

    if (options.json) {
      console.log(JSON.stringify({
        configured: configuredList,
        unconfigured: unconfiguredList,
        summary: {
          total: allStatuses.length,
          configured: configuredList.length,
          unconfigured: unconfiguredList.length,
        },
      }, null, 2));
      return;
    }

    // Compute column widths across all entries
    const nameWidth = Math.max(6, ...allStatuses.map((s) => s.name.length)) + 2;
    const authWidth = 10;
    const profileWidth = Math.max(8, ...allStatuses.map((s) => s.profile.length)) + 2;

    // Helper: print a row
    function printRow(s: StatusEntry) {
      const authTypeLabel =
        s.authType === "oauth" ? "OAuth" :
        s.authType === "apikey" ? "API Key" :
        "Bearer";

      let statusLabel: string;
      if (s.configured && s.expired) {
        statusLabel = chalk.yellow("expired");
      } else if (s.configured) {
        statusLabel = chalk.green("yes");
      } else {
        statusLabel = chalk.red("no");
      }

      const profileLabel = s.profile.padEnd(profileWidth);

      // Expiry column for OAuth
      let expiryStr = "";
      if (s.authType === "oauth") {
        if (s.expired) {
          expiryStr = chalk.yellow("Expired");
        } else if (s.expiryLabel && s.configured) {
          expiryStr = chalk.dim(s.expiryLabel);
        } else {
          expiryStr = chalk.dim("-");
        }
      } else {
        expiryStr = chalk.dim("-");
      }

      const sourceLabel = s.source === "global" ? chalk.dim(" (global)") : "";

      console.log(
        `  ${chalk.cyan(s.name.padEnd(nameWidth))}` +
        `${authTypeLabel.padEnd(authWidth)}` +
        `${statusLabel.padEnd(16)}` +
        `${profileLabel}` +
        `${expiryStr}${sourceLabel}`
      );
    }

    // Header
    function printHeader() {
      console.log(
        `  ${chalk.dim("Name".padEnd(nameWidth))}` +
        `${chalk.dim("Auth".padEnd(authWidth))}` +
        `${chalk.dim("Configured".padEnd(16))}` +
        `${chalk.dim("Profile".padEnd(profileWidth))}` +
        `${chalk.dim("Expiry")}`
      );
      console.log(chalk.dim(`  ${"─".repeat(nameWidth + authWidth + 16 + profileWidth + 12)}`));
    }

    console.log(chalk.bold("\nConnector Status\n"));

    // Configured section
    if (configuredList.length > 0) {
      console.log(chalk.green.bold(`  Configured (${configuredList.length})\n`));
      printHeader();
      for (const s of configuredList) {
        printRow(s);
      }
      console.log();
    }

    // Unconfigured section
    if (unconfiguredList.length > 0) {
      console.log(chalk.red.bold(`  Unconfigured (${unconfiguredList.length})\n`));
      printHeader();
      for (const s of unconfiguredList) {
        printRow(s);
      }
      console.log();
    }

    // Summary
    console.log(chalk.dim(`  Total: ${allStatuses.length}  |  Configured: ${configuredList.length}  |  Unconfigured: ${unconfiguredList.length}`));
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
        console.log(JSON.stringify({ error: `Connector '${connector}' not found. Run 'connectors list' to see available connectors.` }));
      } else {
        console.log(chalk.red(`Connector '${connector}' not found`));
        console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${connector}' to search.`));
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
        const port = 19426; // Fixed port — OAuth redirect URIs must match
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
          field: options.field || "apiKey",
        }));
      } else {
        console.log(chalk.green(`✓ Saved ${options.field || "apiKey"} for ${meta.displayName}`));
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

// Export command — backup all connector credentials
const SENSITIVE_FIELDS = new Set([
  "clientsecret", "client_secret",
  "accesstoken", "access_token",
  "refreshtoken", "refresh_token",
  "apikey", "api_key",
  "apitoken", "api_token",
  "secret", "secretkey", "secret_key",
  "bearertoken", "bearer_token",
  "token", "password", "passwd",
  "private_key", "privatekey",
]);

function redactValue(value: string): string {
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••" + value.slice(-4);
}

function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(key.toLowerCase()) && typeof value === "string") {
        result[key] = redactValue(value);
      } else if (typeof value === "object" && value !== null) {
        result[key] = redactSecrets(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

program
  .command("export")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .option("--include-secrets", "Include secrets in plaintext (dangerous — use only for backup/restore)")
  .description("Export all connector credentials as JSON backup")
  .action((options: { output?: string; includeSecrets?: boolean }) => {
    const connectDir = join(homedir(), ".connectors");
    const result: Record<string, { credentials?: unknown; profiles: Record<string, unknown> }> = {};

    if (existsSync(connectDir)) {
      for (const entry of readdirSync(connectDir)) {
        const entryPath = join(connectDir, entry);
        if (!statSync(entryPath).isDirectory() || !entry.startsWith("connect-")) continue;
        const connectorName = entry.replace(/^connect-/, "");

        // Read root-level credentials.json (OAuth client credentials shared across profiles)
        let credentials: unknown = undefined;
        const credentialsPath = join(entryPath, "credentials.json");
        if (existsSync(credentialsPath)) {
          try { credentials = JSON.parse(readFileSync(credentialsPath, "utf-8")); } catch {}
        }

        const profilesDir = join(entryPath, "profiles");
        if (!existsSync(profilesDir) && !credentials) continue;

        const profiles: Record<string, unknown> = {};
        if (existsSync(profilesDir)) {
          for (const pEntry of readdirSync(profilesDir)) {
            const pPath = join(profilesDir, pEntry);
            if (statSync(pPath).isFile() && pEntry.endsWith(".json")) {
              try { profiles[pEntry.replace(/\.json$/, "")] = JSON.parse(readFileSync(pPath, "utf-8")); } catch {}
            } else if (statSync(pPath).isDirectory()) {
              const configPath = join(pPath, "config.json");
              const tokensPath = join(pPath, "tokens.json");
              let merged: Record<string, unknown> = {};
              if (existsSync(configPath)) {
                try { merged = { ...merged, ...JSON.parse(readFileSync(configPath, "utf-8")) }; } catch {}
              }
              if (existsSync(tokensPath)) {
                try { merged = { ...merged, ...JSON.parse(readFileSync(tokensPath, "utf-8")) }; } catch {}
              }
              if (Object.keys(merged).length > 0) profiles[pEntry] = merged;
            }
          }
        }

        const connectorData: { credentials?: unknown; profiles: Record<string, unknown> } = { profiles };
        if (credentials) connectorData.credentials = credentials;
        if (Object.keys(profiles).length > 0 || credentials) result[connectorName] = connectorData;
      }
    }

    const exportPayload = options.includeSecrets
      ? { connectors: result, exportedAt: new Date().toISOString() }
      : { connectors: redactSecrets(result) as typeof result, exportedAt: new Date().toISOString(), redacted: true };

    if (!options.includeSecrets) {
      console.error(chalk.yellow("⚠ Secrets are redacted by default. Use --include-secrets for a full backup (e.g., for restore)."));
    }

    const exportData = JSON.stringify(exportPayload, null, 2);

    if (options.output) {
      writeFileSync(options.output, exportData);
      console.log(chalk.green(`✓ Exported to ${options.output}`));
    } else {
      console.log(exportData);
    }
  });

// Import command — restore connector credentials from backup
program
  .command("import")
  .argument("<file>", "JSON backup file to import (use - for stdin)")
  .option("--json", "Output as JSON", false)
  .description("Import connector credentials from a JSON backup")
  .action(async (file: string, options: { json: boolean }) => {
    let raw: string;
    if (file === "-") {
      // Read from stdin
      const chunks: string[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk.toString());
      raw = chunks.join("");
    } else {
      if (!existsSync(file)) {
        if (options.json) { console.log(JSON.stringify({ error: `File not found: ${file}` })); }
        else { console.log(chalk.red(`File not found: ${file}`)); }
        process.exit(1);
        return;
      }
      raw = readFileSync(file, "utf-8");
    }

    let data: { connectors: Record<string, { credentials?: unknown; profiles: Record<string, unknown> }> };
    try { data = JSON.parse(raw); } catch {
      if (options.json) { console.log(JSON.stringify({ error: "Invalid JSON" })); }
      else { console.log(chalk.red("Invalid JSON in import file")); }
      process.exit(1);
      return;
    }

    if (!data.connectors || typeof data.connectors !== "object") {
      if (options.json) { console.log(JSON.stringify({ error: "Invalid format: missing 'connectors' object" })); }
      else { console.log(chalk.red("Invalid format: missing 'connectors' object")); }
      process.exit(1);
      return;
    }

    const connectDir = join(homedir(), ".connectors");
    let imported = 0;

    for (const [connectorName, connData] of Object.entries(data.connectors)) {
      if (!/^[a-z0-9-]+$/.test(connectorName)) continue;

      const connectorDir = join(connectDir, `connect-${connectorName}`);

      // Restore credentials.json at connector root
      if (connData.credentials && typeof connData.credentials === "object") {
        mkdirSync(connectorDir, { recursive: true });
        writeFileSync(join(connectorDir, "credentials.json"), JSON.stringify(connData.credentials, null, 2));
        imported++;
      }

      if (!connData.profiles || typeof connData.profiles !== "object") continue;

      const profilesDir = join(connectorDir, "profiles");
      for (const [profileName, config] of Object.entries(connData.profiles)) {
        if (!config || typeof config !== "object") continue;
        mkdirSync(profilesDir, { recursive: true });
        writeFileSync(join(profilesDir, `${profileName}.json`), JSON.stringify(config, null, 2));
        imported++;
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ success: true, imported }));
    } else {
      console.log(chalk.green(`✓ Imported ${imported} profile(s)`));
    }
  });

// Auth-import command — migrate tokens from ~/.connect/ to ~/.connectors/
program
  .command("auth-import")
  .option("--json", "Output as JSON", false)
  .option("-d, --dry-run", "Preview what would be imported without copying", false)
  .option("--force", "Overwrite existing files in ~/.connectors/", false)
  .description("Migrate auth tokens from ~/.connect/ to ~/.connectors/")
  .action((options: { json: boolean; dryRun: boolean; force: boolean }) => {
    const oldBase = join(homedir(), ".connect");
    const newBase = join(homedir(), ".connectors");

    if (!existsSync(oldBase)) {
      if (options.json) {
        console.log(JSON.stringify({ imported: [], skipped: [], error: null, message: "No ~/.connect/ directory found" }));
      } else {
        console.log(chalk.dim("No ~/.connect/ directory found. Nothing to import."));
      }
      return;
    }

    // Find all connect-* directories in ~/.connect/
    const entries = readdirSync(oldBase).filter((name) => {
      if (!name.startsWith("connect-")) return false;
      try { return statSync(join(oldBase, name)).isDirectory(); } catch { return false; }
    });

    if (entries.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ imported: [], skipped: [], message: "No connect-* directories found in ~/.connect/" }));
      } else {
        console.log(chalk.dim("No connect-* directories found in ~/.connect/. Nothing to import."));
      }
      return;
    }

    const imported: Array<{ connector: string; files: string[] }> = [];
    const skipped: Array<{ connector: string; files: string[] }> = [];

    for (const dirName of entries) {
      const oldDir = join(oldBase, dirName);
      const newDir = join(newBase, dirName);
      const connectorName = dirName.replace(/^connect-/, "");

      // Collect all files recursively from the old directory
      const allFiles = listFilesRecursive(oldDir);

      // Filter to auth-related files
      const authFiles = allFiles.filter((f) => {
        return f === "credentials.json"
          || f === "config.json"
          || f === "tokens.json"
          || f === "current_profile"
          || f.startsWith("profiles/") || f.startsWith("profiles\\");
      });

      if (authFiles.length === 0) continue;

      const copiedFiles: string[] = [];
      const skippedFiles: string[] = [];

      for (const relFile of authFiles) {
        const srcPath = join(oldDir, relFile);
        const destPath = join(newDir, relFile);

        if (existsSync(destPath) && !options.force) {
          skippedFiles.push(relFile);
          continue;
        }

        if (!options.dryRun) {
          // Ensure parent directory exists
          const parentDir = join(destPath, "..");
          mkdirSync(parentDir, { recursive: true });
          // Copy file contents
          const content = readFileSync(srcPath);
          writeFileSync(destPath, content);
        }
        copiedFiles.push(relFile);
      }

      if (copiedFiles.length > 0) {
        imported.push({ connector: connectorName, files: copiedFiles });
      }
      if (skippedFiles.length > 0) {
        skipped.push({ connector: connectorName, files: skippedFiles });
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ dryRun: options.dryRun, force: options.force, imported, skipped }, null, 2));
      return;
    }

    if (options.dryRun) {
      console.log(chalk.bold("\nDry run — no changes will be made\n"));
    } else {
      console.log(chalk.bold("\nAuth Import Results\n"));
    }

    for (const entry of imported) {
      console.log(`  ${chalk.green("✓")} ${chalk.cyan(entry.connector)}`);
      for (const f of entry.files) {
        console.log(chalk.dim(`      ${options.dryRun ? "would copy" : "copied"}: ${f}`));
      }
    }

    for (const entry of skipped) {
      console.log(`  ${chalk.yellow("⊘")} ${chalk.cyan(entry.connector)}`);
      for (const f of entry.files) {
        console.log(chalk.dim(`      skipped (exists): ${f}`));
      }
    }

    if (imported.length === 0 && skipped.length === 0) {
      console.log(chalk.dim("  No auth files found to import."));
    }

    // Summary
    const totalCopied = imported.reduce((sum, e) => sum + e.files.length, 0);
    const totalSkipped = skipped.reduce((sum, e) => sum + e.files.length, 0);
    const parts: string[] = [];
    if (totalCopied > 0) parts.push(chalk.green(`${totalCopied} file${totalCopied !== 1 ? "s" : ""} ${options.dryRun ? "to copy" : "copied"}`));
    if (totalSkipped > 0) parts.push(chalk.yellow(`${totalSkipped} skipped`));
    if (parts.length > 0) {
      console.log(`\n  ${chalk.bold("Summary:")} ${parts.join(", ")}`);
    }

    if (options.dryRun) {
      console.log(chalk.dim("\n  Run without --dry-run to apply.\n"));
    } else {
      console.log();
    }
  });

// Upgrade command — check for and install latest version
program
  .command("upgrade")
  .alias("self-update")
  .option("--check", "Only check for updates, don't install", false)
  .option("--json", "Output as JSON", false)
  .description("Check for updates and upgrade to the latest version")
  .action(async (options: { check: boolean; json: boolean }) => {
    const currentVersion = program.version() as string;

    try {
      const res = await fetch("https://registry.npmjs.org/@hasna/connectors/latest");
      if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
      const data = await res.json() as { version: string };
      const latestVersion = data.version;
      const isUpToDate = currentVersion === latestVersion;

      if (options.json) {
        console.log(JSON.stringify({ current: currentVersion, latest: latestVersion, upToDate: isUpToDate }));
        if (options.check) { process.exit(isUpToDate ? 0 : 1); return; }
      } else {
        console.log(`\n  Current: ${chalk.cyan(currentVersion)}`);
        console.log(`  Latest:  ${chalk.cyan(latestVersion)}`);
        if (isUpToDate) {
          console.log(chalk.green("\n  Already up to date!\n"));
          process.exit(0);
          return;
        }
        console.log(chalk.yellow(`\n  Update available: ${currentVersion} → ${latestVersion}`));
      }

      if (options.check) {
        if (!options.json) console.log(chalk.dim(`\n  Run 'connectors upgrade' to install.\n`));
        process.exit(isUpToDate ? 0 : 1);
        return;
      }

      // Detect package manager and run upgrade
      if (!options.json) console.log(chalk.dim(`\n  Upgrading...`));
      const { execSync } = await import("child_process");
      try {
        execSync(`bun install -g @hasna/connectors@${latestVersion}`, { stdio: options.json ? "pipe" : "inherit" });
      } catch {
        try {
          execSync(`npm install -g @hasna/connectors@${latestVersion}`, { stdio: options.json ? "pipe" : "inherit" });
        } catch (e) {
          if (options.json) {
            console.log(JSON.stringify({ error: "Failed to upgrade. Try manually: bun install -g @hasna/connectors@latest" }));
          } else {
            console.log(chalk.red(`\n  Failed to upgrade. Try manually:`));
            console.log(chalk.dim(`  bun install -g @hasna/connectors@latest\n`));
          }
          process.exit(1);
          return;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ upgraded: true, from: currentVersion, to: latestVersion }));
      } else {
        console.log(chalk.green(`\n  Upgraded to ${latestVersion}!\n`));
      }
    } catch (e) {
      if (options.json) {
        console.log(JSON.stringify({ error: e instanceof Error ? e.message : "Failed to check for updates" }));
      } else {
        console.log(chalk.red(`\n  Failed to check for updates: ${e instanceof Error ? e.message : e}\n`));
      }
      process.exit(1);
    }
  });

// Completions command — output shell completion scripts
program
  .command("completions")
  .argument("<shell>", "Shell type: bash, zsh, or fish")
  .description("Output shell completion script")
  .action((shell: string) => {
    const commands = ["interactive", "install", "list", "search", "info", "docs", "remove", "categories", "serve", "update", "status", "doctor", "auth", "init", "export", "import", "upgrade", "completions"];
    const connectorNames = CONNECTORS.map(c => c.name);
    const categoryNames = CATEGORIES.map(c => `"${c}"`);

    if (shell === "zsh") {
      console.log(`#compdef connectors
_connectors() {
  local -a commands connectors categories
  commands=(${commands.join(" ")})
  connectors=(${connectorNames.join(" ")})
  categories=(${categoryNames.map(c => c.replace(/"/g, '\\"')).join(" ")})

  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif (( CURRENT == 3 )); then
    case "\${words[2]}" in
      install|add|info|docs|remove|rm|auth)
        _describe 'connector' connectors ;;
      search) _message 'search query' ;;
      list|ls) _arguments '--category[Filter by category]:category:(${CATEGORIES.join(" ").replace(/&/g, "\\&")})' '--installed' '--json' '--brief' ;;
      *) ;;
    esac
  fi
}
compdef _connectors connectors`);
    } else if (shell === "bash") {
      console.log(`_connectors() {
  local cur prev commands connectors
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${commands.join(" ")}"
  connectors="${connectorNames.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  elif [[ \${COMP_CWORD} -eq 2 ]]; then
    case "\${prev}" in
      install|add|info|docs|remove|rm|auth)
        COMPREPLY=( $(compgen -W "\${connectors}" -- "\${cur}") ) ;;
    esac
  fi
}
complete -F _connectors connectors`);
    } else if (shell === "fish") {
      let script = `# Fish completions for connectors\n`;
      for (const cmd of commands) {
        script += `complete -c connectors -n "__fish_use_subcommand" -a "${cmd}"\n`;
      }
      script += `# Connector names for install/info/docs/remove/auth\n`;
      for (const name of connectorNames) {
        script += `complete -c connectors -n "__fish_seen_subcommand_from install add info docs remove rm auth" -a "${name}"\n`;
      }
      console.log(script);
    } else {
      console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
      process.exit(1);
    }
  });

// Env command — generate .env.example from installed connectors
program
  .command("env")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .option("--json", "Output as JSON", false)
  .description("Generate .env.example from installed connectors' required env vars")
  .action((options: { output?: string; json: boolean }) => {
    const installed = getInstalledConnectors();
    if (installed.length === 0) {
      if (options.json) { console.log(JSON.stringify({ vars: [], connectors: [] })); }
      else { console.log(chalk.dim("No connectors installed. Run: connectors install <name>")); }
      return;
    }

    const vars: Array<{ variable: string; description: string; connector: string }> = [];
    const seen = new Set<string>();

    for (const name of installed) {
      const docs = getConnectorDocs(name);
      if (!docs?.envVars) continue;
      for (const v of docs.envVars) {
        if (!seen.has(v.variable)) {
          seen.add(v.variable);
          vars.push({ variable: v.variable, description: v.description, connector: name });
        }
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ vars, connectors: installed }, null, 2));
      return;
    }

    const lines: string[] = [
      "# Environment Variables",
      `# Generated by connectors env (${installed.length} installed connectors)`,
      "#",
    ];

    let lastConnector = "";
    for (const v of vars) {
      if (v.connector !== lastConnector) {
        lines.push("");
        lines.push(`# ${v.connector}`);
        lastConnector = v.connector;
      }
      if (v.description) lines.push(`# ${v.description}`);
      lines.push(`${v.variable}=`);
    }

    const output = lines.join("\n") + "\n";

    if (options.output) {
      writeFileSync(options.output, output);
      console.log(chalk.green(`✓ Written to ${options.output} (${vars.length} variables)`));
    } else {
      console.log(output);
    }
  });

// Presets command — list available connector presets
program
  .command("presets")
  .option("--json", "Output as JSON", false)
  .description("List available connector preset bundles")
  .action((options: { json: boolean }) => {
    if (options.json) {
      console.log(JSON.stringify(Object.entries(PRESETS).map(([name, p]) => ({
        name,
        description: p.description,
        connectors: p.connectors,
        count: p.connectors.length,
      })), null, 2));
      return;
    }

    console.log(chalk.bold("\nAvailable presets:\n"));
    for (const [name, preset] of Object.entries(PRESETS)) {
      console.log(`  ${chalk.cyan(name.padEnd(12))} ${preset.description}`);
      console.log(chalk.dim(`  ${"".padEnd(12)} ${preset.connectors.join(", ")}`));
      console.log();
    }
    console.log(chalk.dim(`  Install with: connectors install --preset <name>\n`));
  });

// Whoami command — show current setup summary
program
  .command("whoami")
  .option("--json", "Output as JSON", false)
  .description("Show current setup: config dir, installed connectors, auth status")
  .action((options: { json: boolean }) => {
    const configDir = join(homedir(), ".connectors");
    const installed = getInstalledConnectors();
    const version = "0.3.1";

    let configured = 0;
    let unconfigured = 0;
    const connectorDetails: Array<{ name: string; configured: boolean; authType: string; profile: string; source: "project" | "global" }> = [];
    const seen = new Set<string>();

    // Project-installed connectors
    for (const name of installed) {
      seen.add(name);
      const auth = getAuthStatus(name);
      if (auth.configured) configured++;
      else unconfigured++;

      // Read current profile
      const connectorConfigDir = join(configDir, name.startsWith("connect-") ? name : `connect-${name}`);
      const currentProfileFile = join(connectorConfigDir, "current_profile");
      let profile = "default";
      if (existsSync(currentProfileFile)) {
        try { profile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
      }

      connectorDetails.push({ name, configured: auth.configured, authType: auth.type, profile, source: "project" });
    }

    // Globally configured connectors from ~/.connectors/connect-*
    if (existsSync(configDir)) {
      try {
        const globalDirs = readdirSync(configDir).filter((f: string) => {
          if (!f.startsWith("connect-")) return false;
          try { return statSync(join(configDir, f)).isDirectory(); } catch { return false; }
        });

        for (const dir of globalDirs) {
          const name = dir.replace("connect-", "");
          if (seen.has(name)) continue;

          const auth = getAuthStatus(name);
          if (!auth.configured) continue; // Only show globally configured ones

          seen.add(name);
          configured++;

          const currentProfileFile = join(configDir, dir, "current_profile");
          let profile = "default";
          if (existsSync(currentProfileFile)) {
            try { profile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
          }

          connectorDetails.push({ name, configured: true, authType: auth.type, profile, source: "global" });
        }
      } catch {
        // ignore read errors on ~/.connectors
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        version,
        configDir,
        configDirExists: existsSync(configDir),
        installed: installed.length,
        configured,
        unconfigured,
        connectors: connectorDetails,
      }, null, 2));
      return;
    }

    console.log(chalk.bold("\nConnectors Setup\n"));
    console.log(`  Version:      ${chalk.cyan(version)}`);
    console.log(`  Config:       ${configDir}${existsSync(configDir) ? "" : chalk.dim(" (not created yet)")}`);
    console.log(`  Installed:    ${installed.length} connector${installed.length !== 1 ? "s" : ""}`);
    console.log(`  Configured:   ${chalk.green(String(configured))} ready, ${unconfigured > 0 ? chalk.red(String(unconfigured)) : chalk.dim("0")} need auth`);

    const projectConnectors = connectorDetails.filter(c => c.source === "project");
    const globalConnectors = connectorDetails.filter(c => c.source === "global");

    if (projectConnectors.length > 0) {
      console.log(chalk.bold("\n  Project Connectors:\n"));
      const nameWidth = Math.max(10, ...projectConnectors.map(c => c.name.length)) + 2;
      for (const c of projectConnectors) {
        const status = c.configured ? chalk.green("✓") : chalk.red("✗");
        const profileLabel = c.profile !== "default" ? chalk.dim(` [${c.profile}]`) : "";
        console.log(`    ${status} ${chalk.cyan(c.name.padEnd(nameWidth))}${c.authType.padEnd(8)}${profileLabel}`);
      }
    }

    if (globalConnectors.length > 0) {
      console.log(chalk.bold("\n  Global Connectors") + chalk.dim(" (~/.connectors)") + chalk.bold(":\n"));
      const nameWidth = Math.max(10, ...globalConnectors.map(c => c.name.length)) + 2;
      for (const c of globalConnectors) {
        const status = c.configured ? chalk.green("✓") : chalk.red("✗");
        const profileLabel = c.profile !== "default" ? chalk.dim(` [${c.profile}]`) : "";
        console.log(`    ${status} ${chalk.cyan(c.name.padEnd(nameWidth))}${c.authType.padEnd(8)}${profileLabel}`);
      }
    }

    if (connectorDetails.length === 0) {
      console.log(chalk.dim("\n  No connectors installed or configured."));
    }

    console.log();
  });

// Test command — verify API credentials by making a real request
program
  .command("test")
  .argument("[connector]", "Connector to test (default: all installed)")
  .option("--json", "Output as JSON", false)
  .option("--timeout <ms>", "Request timeout in milliseconds", "10000")
  .description("Verify API credentials by making a real request to the connector's API")
  .action(async (connector: string | undefined, options: { json: boolean; timeout: string }) => {
    const timeout = parseInt(options.timeout, 10) || 10000;
    const installed = getInstalledConnectors();

    let toTest: string[];
    if (connector) {
      if (!getConnector(connector)) {
        if (options.json) { console.log(JSON.stringify({ error: `Connector '${connector}' not found. Run 'connectors list' to see available connectors.` })); }
        else {
          console.log(chalk.red(`Connector '${connector}' not found`));
          console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${connector}' to search.`));
        }
        process.exit(1);
        return;
      }
      toTest = [connector];
    } else {
      if (installed.length === 0) {
        if (options.json) { console.log(JSON.stringify({ results: [], tested: 0 })); }
        else { console.log(chalk.dim("No connectors installed. Run: connectors install <name>")); }
        return;
      }
      toTest = installed;
    }

    if (!options.json) console.log(chalk.bold("\nTesting connector credentials...\n"));

    const results: Array<{ name: string; status: "pass" | "fail" | "skip" | "no-key"; message: string; ms?: number }> = [];

    for (const name of toTest) {
      const auth = getAuthStatus(name);
      const endpoint = TEST_ENDPOINTS[name];

      if (!auth.configured) {
        results.push({ name, status: "no-key", message: `No credentials configured. Run 'connectors auth ${name}' or 'connectors setup ${name} --key <your-key>'` });
        if (!options.json) console.log(`  ${chalk.dim("○")} ${chalk.dim(name)} — ${chalk.dim(`no credentials configured — run 'connectors auth ${name}'`)}`);
        continue;
      }

      if (!endpoint) {
        results.push({ name, status: "skip", message: `No test endpoint defined. Run 'connectors ops ${name}' to see available operations` });
        if (!options.json) console.log(`  ${chalk.dim("○")} ${chalk.dim(name)} — ${chalk.dim(`no test endpoint — run 'connectors ops ${name}' to see operations`)}`);
        continue;
      }

      // Get the API key or OAuth access token
      const docs = getConnectorDocs(name);
      const envVars = docs?.envVars || [];
      let apiKey: string | undefined;

      // Try env vars first
      for (const v of envVars) {
        if (process.env[v.variable]) {
          apiKey = process.env[v.variable];
          break;
        }
      }

      // Try profile config if no env var
      if (!apiKey) {
        const connectorConfigDir = join(homedir(), ".connectors", name.startsWith("connect-") ? name : `connect-${name}`);

        // Determine current profile
        let currentProfile = "default";
        const currentProfileFile = join(connectorConfigDir, "current_profile");
        if (existsSync(currentProfileFile)) {
          try { currentProfile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
        }

        // Try OAuth tokens first (profiles/<name>/tokens.json) — refresh if expired
        const tokensFile = join(connectorConfigDir, "profiles", currentProfile, "tokens.json");
        if (existsSync(tokensFile)) {
          try {
            const tokens = JSON.parse(readFileSync(tokensFile, "utf-8"));
            const isExpired = tokens.expiresAt && Date.now() >= tokens.expiresAt - 60000;
            if (isExpired && tokens.refreshToken) {
              // Attempt auto-refresh before test
              try {
                const refreshed = await refreshOAuthToken(name);
                apiKey = refreshed.accessToken;
                if (!options.json) console.log(`  ${chalk.dim("↻")} ${chalk.dim(name)} — ${chalk.dim("token refreshed")}`);
              } catch {
                // Refresh failed, use existing token
                if (tokens.accessToken) apiKey = tokens.accessToken;
              }
            } else if (tokens.accessToken) {
              apiKey = tokens.accessToken;
            }
          } catch {}
        }

        // Try flat profile config (profiles/<name>.json)
        if (!apiKey) {
          const profileFile = join(connectorConfigDir, "profiles", `${currentProfile}.json`);
          if (existsSync(profileFile)) {
            try {
              const config = JSON.parse(readFileSync(profileFile, "utf-8"));
              apiKey = Object.values(config).find((v): v is string => typeof v === "string" && v.length > 0) as string | undefined;
            } catch {}
          }
        }

        // Try directory profile config (profiles/<name>/config.json)
        if (!apiKey) {
          const profileDirConfig = join(connectorConfigDir, "profiles", currentProfile, "config.json");
          if (existsSync(profileDirConfig)) {
            try {
              const config = JSON.parse(readFileSync(profileDirConfig, "utf-8"));
              apiKey = Object.values(config).find((v): v is string => typeof v === "string" && v.length > 0) as string | undefined;
            } catch {}
          }
        }
      }

      if (!apiKey) {
        results.push({ name, status: "no-key", message: "Credentials configured but could not extract key" });
        if (!options.json) console.log(`  ${chalk.yellow("⚠")} ${chalk.yellow(name)} — ${chalk.dim("could not extract key")}`);
        continue;
      }

      // Build the test URL — some connectors use query param auth
      let testUrl = endpoint.url;
      const QUERY_PARAM_AUTH: Record<string, string> = {
        googlegemini: "key",
        googlemaps: "key",
        openweathermap: "appid",
      };
      if (QUERY_PARAM_AUTH[name]) {
        const sep = testUrl.includes("?") ? "&" : "?";
        testUrl = `${testUrl}${sep}${QUERY_PARAM_AUTH[name]}=${encodeURIComponent(apiKey)}`;
      }

      // Make the test request
      const start = Date.now();
      try {
        const body = endpoint.method === "POST"
          ? JSON.stringify(endpoint.body ?? { query: "test", num_results: 1 })
          : undefined;
        const res = await fetch(testUrl, {
          method: endpoint.method || "GET",
          headers: endpoint.headers(apiKey),
          body,
          signal: AbortSignal.timeout(timeout),
        });
        const ms = Date.now() - start;
        const successCodes = endpoint.successCodes || [200];

        if (successCodes.includes(res.status) || (res.status >= 200 && res.status < 300)) {
          results.push({ name, status: "pass", message: `OK (${res.status})`, ms });
          if (!options.json) console.log(`  ${chalk.green("✓")} ${chalk.green(name)} — ${chalk.dim(`${res.status} OK`)} ${chalk.dim(`(${ms}ms)`)}`);
        } else {
          const body = await res.text().catch(() => "");
          const msg = res.status === 401 ? `Invalid or expired credentials. Run 'connectors auth ${name}' to reconfigure` : `HTTP ${res.status}`;
          results.push({ name, status: "fail", message: msg, ms });
          if (!options.json) console.log(`  ${chalk.red("✗")} ${chalk.red(name)} — ${chalk.red(res.status === 401 ? "Invalid or expired credentials" : `HTTP ${res.status}`)} ${chalk.dim(`(${ms}ms)`)}`);
          if (!options.json && res.status === 401) console.log(chalk.dim(`      → Run 'connectors auth ${name}' to reconfigure credentials`));
        }
      } catch (e) {
        const ms = Date.now() - start;
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ name, status: "fail", message: msg, ms });
        if (!options.json) console.log(`  ${chalk.red("✗")} ${chalk.red(name)} — ${chalk.red(msg)}`);
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ results, tested: results.length, passed: results.filter(r => r.status === "pass").length }, null, 2));
    } else {
      const passed = results.filter(r => r.status === "pass").length;
      const failed = results.filter(r => r.status === "fail").length;
      const skipped = results.filter(r => r.status === "skip" || r.status === "no-key").length;
      console.log();
      const parts: string[] = [];
      if (passed > 0) parts.push(chalk.green(`${passed} passed`));
      if (failed > 0) parts.push(chalk.red(`${failed} failed`));
      if (skipped > 0) parts.push(chalk.dim(`${skipped} skipped`));
      console.log(`  ${parts.join(", ")}\n`);
    }

    process.exit(results.some(r => r.status === "fail") ? 1 : 0);
  });

// ============================================
// Operations Discovery
// ============================================
program
  .command("ops")
  .description("List available API operations for a connector")
  .argument("<name>", "Connector name (e.g. stripe, gmail)")
  .argument("[command]", "Get detailed help for a specific subcommand")
  .option("--json", "Output as JSON")
  .action(async (name: string, command: string | undefined, options: { json?: boolean }) => {
    const meta = getConnector(name);
    if (!meta) {
      console.error(chalk.red(`Connector '${name}' not found.`));
      console.error(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${name}' to search.`));
      process.exit(1);
    }

    if (!getConnectorCliPath(name)) {
      console.error(chalk.red(`Connector '${name}' does not have a CLI.`));
      console.error(chalk.dim(`Run 'connectors docs ${name}' to see how to use this connector programmatically.`));
      process.exit(1);
    }

    if (command) {
      const help = await getConnectorCommandHelp(name, command);
      if (options.json) {
        console.log(JSON.stringify({ connector: name, command, help }, null, 2));
      } else {
        console.log(chalk.bold(`\n${meta.displayName} → ${command}\n`));
        console.log(help);
      }
      return;
    }

    const ops = await getConnectorOperations(name);

    if (options.json) {
      console.log(JSON.stringify({
        connector: name,
        displayName: meta.displayName,
        commands: ops.commands,
      }, null, 2));
    } else {
      console.log(chalk.bold(`\n${meta.displayName} operations:\n`));
      if (ops.commands.length > 0) {
        for (const cmd of ops.commands) {
          console.log(`  ${chalk.cyan(cmd)}`);
        }
        console.log(chalk.dim(`\n  Run ${chalk.white(`connectors ops ${name} <command>`)} for details`));
        console.log(chalk.dim(`  Run ${chalk.white(`connectors run ${name} <command> [args...]`)} to execute\n`));
      } else {
        console.log(ops.helpText);
      }
    }
  });

// ============================================
// Run Connector Operation
// ============================================
program
  .command("run")
  .description("Execute an API operation on a connector")
  .argument("<name>", "Connector name (e.g. stripe, gmail)")
  .argument("[args...]", "Command arguments (e.g. products list --limit 5)")
  .option("--timeout <ms>", "Timeout in milliseconds", "30000")
  .passThroughOptions()
  .action(async (name: string, args: string[], options: { timeout: string }) => {
    const meta = getConnector(name);
    if (!meta) {
      console.error(chalk.red(`Connector '${name}' not found.`));
      console.error(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${name}' to search.`));
      process.exit(1);
    }

    if (!getConnectorCliPath(name)) {
      console.error(chalk.red(`Connector '${name}' does not have a CLI.`));
      console.error(chalk.dim(`Run 'connectors docs ${name}' to see how to use this connector programmatically.`));
      process.exit(1);
    }

    if (args.length === 0) {
      console.error(chalk.yellow(`No command specified. Run ${chalk.white(`connectors ops ${name}`)} to see available operations.`));
      process.exit(1);
    }

    const result = await runConnectorCommand(name, args, parseInt(options.timeout));

    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }

    process.exit(result.exitCode);
  });

// ============================================
// Setup Command — Install + Auth + Verify
// ============================================
program
  .command("setup")
  .argument("<name>", "Connector name to set up")
  .option("-k, --key <value>", "API key or bearer token value")
  .option("-f, --field <field>", "Which field to set (for multi-field connectors)")
  .option("-o, --overwrite", "Overwrite existing installation", false)
  .option("--json", "Output as JSON", false)
  .description("Install, configure auth, and verify a connector in one step")
  .action(async (name: string, options: { key?: string; field?: string; overwrite: boolean; json: boolean }) => {
    const meta = getConnector(name);
    if (!meta) {
      if (options.json) {
        console.log(JSON.stringify({ error: `Connector '${name}' not found. Run 'connectors list' to see available connectors.` }));
      } else {
        console.log(chalk.red(`Connector '${name}' not found`));
        console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${name}' to search.`));
      }
      process.exit(1);
      return;
    }

    if (!options.json) {
      console.log(chalk.bold(`\nSetting up ${meta.displayName}...\n`));
    }

    // Step 1: Install (if not already installed)
    const installed = getInstalledConnectors();
    const alreadyInstalled = installed.includes(meta.name);
    let installResult: { success: boolean; path?: string; error?: string };

    if (alreadyInstalled && !options.overwrite) {
      installResult = { success: true, path: join(process.cwd(), ".connectors", `connect-${meta.name}`) };
      if (!options.json) {
        console.log(`  ${chalk.green("✓")} Already installed`);
      }
    } else {
      const result = installConnector(name, { overwrite: options.overwrite });
      installResult = { success: result.success, path: result.path, error: result.error };
      if (!options.json) {
        if (result.success) {
          console.log(`  ${chalk.green("✓")} Installed → ${chalk.dim(result.path)}`);
        } else {
          console.log(`  ${chalk.red("✗")} Install failed: ${result.error}`);
          process.exit(1);
          return;
        }
      } else if (!result.success) {
        console.log(JSON.stringify({ error: `Install failed: ${result.error}` }));
        process.exit(1);
        return;
      }
    }

    // Step 2: Configure auth
    const authType = getAuthType(name);
    let authConfigured = false;

    if (authType === "oauth") {
      // OAuth: start server and open browser for auth flow
      if (options.key) {
        // Allow manual token setting even for OAuth connectors
        saveApiKey(name, options.key, options.field || undefined);
        authConfigured = true;
        if (!options.json) {
          console.log(`  ${chalk.green("✓")} Token saved`);
        }
      } else {
        const statusBefore = getAuthStatus(name);
        if (statusBefore.configured) {
          authConfigured = true;
          if (!options.json) {
            console.log(`  ${chalk.green("✓")} OAuth already configured`);
          }
        } else {
          if (options.json) {
            // Can't do OAuth interactively in JSON mode
            const summary = {
              connector: name,
              displayName: meta.displayName,
              installed: installResult.success,
              path: installResult.path,
              authType: "oauth",
              authConfigured: false,
              message: "OAuth requires browser-based authentication. Use 'connectors serve' or pass --key to set tokens manually.",
            };
            console.log(JSON.stringify(summary, null, 2));
            process.exit(0);
            return;
          }

          // Start server and open browser for OAuth
          console.log(`  ${chalk.yellow("⟳")} OAuth authentication required — starting server...`);
          try {
            const port = 19426;
            const { startServer } = await import("../server/serve.js");
            await startServer(port, { open: false });

            const oauthUrl = `http://localhost:${port}/oauth/${name}/start`;
            console.log(`\n  ${chalk.bold("Open this URL to authenticate:")}`);
            console.log(`  ${chalk.cyan(oauthUrl)}\n`);

            try {
              const { exec } = await import("child_process");
              const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
              exec(`${openCmd} "${oauthUrl}"`);
              console.log(chalk.dim("  Browser opened. Complete the OAuth flow, then press Ctrl+C.\n"));
            } catch {
              console.log(chalk.dim("  Open the URL above in your browser.\n"));
            }

            await new Promise<void>(() => {});
          } catch (err) {
            console.log(`  ${chalk.red("✗")} OAuth flow failed: ${err}`);
            console.log(chalk.dim("  Try 'connectors serve' to use the full dashboard."));
          }
          process.exit(0);
          return;
        }
      }
    } else {
      // API Key / Bearer Token
      if (options.key) {
        saveApiKey(name, options.key, options.field || undefined);
        authConfigured = true;
        if (!options.json) {
          console.log(`  ${chalk.green("✓")} ${authType === "bearer" ? "Bearer token" : "API key"} saved`);
        }
      } else {
        const statusBefore = getAuthStatus(name);
        if (statusBefore.configured) {
          authConfigured = true;
          if (!options.json) {
            console.log(`  ${chalk.green("✓")} Auth already configured (${authType === "bearer" ? "bearer token" : "API key"})`);
          }
        } else {
          if (!options.json) {
            console.log(`  ${chalk.yellow("⚠")} No API key provided. Use --key <value> to configure auth.`);
          }
        }
      }
    }

    // Step 3: Verify auth status
    const finalStatus = getAuthStatus(name);

    if (options.json) {
      const summary = {
        connector: name,
        displayName: meta.displayName,
        installed: installResult.success,
        path: installResult.path,
        authType: finalStatus.type,
        authConfigured: finalStatus.configured,
        envVars: finalStatus.envVars,
        tokenExpiry: finalStatus.tokenExpiry,
      };
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log();
      console.log(chalk.bold("  Summary"));
      console.log(`  ├─ Connector: ${meta.displayName}`);
      console.log(`  ├─ Installed: ${chalk.green("yes")}`);
      console.log(`  ├─ Auth type: ${finalStatus.type === "oauth" ? "OAuth" : finalStatus.type === "apikey" ? "API Key" : "Bearer Token"}`);
      console.log(`  └─ Auth:      ${finalStatus.configured ? chalk.green("configured") : chalk.red("not configured")}`);
      console.log();
    }

    process.exit(0);
  });

program.parse();
