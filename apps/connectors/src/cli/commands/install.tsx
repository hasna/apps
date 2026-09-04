import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import {
  CATEGORIES,
  getConnectorsByCategory,
  getConnector,
} from "../../lib/registry.js";
import {
  installConnector,
  getInstalledConnectors,
  getConnectorPath,
  connectorExists,
} from "../../lib/installer.js";
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { createInterface } from "readline";
import { App } from "../components/App.js";
import { truncateText } from "../../lib/compact-output.js";

export const isTTY = process.stdout.isTTY ?? false;

export const PRESETS: Record<string, { description: string; connectors: string[] }> = {
  fullstack: { description: "Full-stack web app essentials", connectors: ["stripe", "github", "resend", "anthropic", "figma"] },
  ai: { description: "AI and ML models", connectors: ["anthropic", "openai", "xai", "mistral", "googlegemini", "elevenlabs"] },
  google: { description: "Google Workspace suite", connectors: ["gmail", "googledrive", "googledocs", "googlesheets", "googlecalendar", "googletasks", "googlecontacts"] },
  social: { description: "Social media platforms", connectors: ["x", "reddit", "youtube", "tiktok", "twitch", "meta", "discord", "substack"] },
  devtools: { description: "Developer tooling", connectors: ["github", "docker", "sentry", "cloudflare", "e2b", "firecrawl"] },
  commerce: { description: "Commerce and finance", connectors: ["stripe", "shopify", "revolut", "mercury", "pandadoc"] },
};

// Recursively list all files in a directory, returning relative paths
export function listFilesRecursive(dir: string, base: string = dir): string[] {
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

export function registerCommands(program: Command): void {
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
    .option("-v, --verbose", "Show full dry-run file lists", false)
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
        const connectorsDir = join(process.cwd(), ".connectors");
        const manifestPath = join(connectorsDir, "manifest.json");
        const indexPath = join(connectorsDir, "index.ts");
        const actions: Array<{
          connector: string;
          action: "install" | "overwrite" | "skip" | "error";
          reason?: string;
          sourcePath?: string;
          manifestPath?: string;
          indexPath?: string;
          files?: string[];
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

          const sourcePath = getConnectorPath(name);
          const alreadyInstalled = installed.includes(name);
          const files = listFilesRecursive(sourcePath);

          if (alreadyInstalled && !options.overwrite) {
            actions.push({
              connector: name,
              action: "skip",
              reason: "Already enabled. Use --overwrite to refresh the project manifest.",
              sourcePath,
              manifestPath,
              indexPath,
            });
          } else {
            actions.push({
              connector: name,
              action: alreadyInstalled ? "overwrite" : "install",
              sourcePath,
              manifestPath,
              indexPath,
              files,
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
          console.log(chalk.dim(`    manifest: ${a.manifestPath}`));
          console.log(chalk.dim(`    index:    ${a.indexPath}`));

          if (a.files && a.files.length > 0) {
            const visibleFiles = options.verbose ? a.files : a.files.slice(0, 12);
            console.log(chalk.dim(`    packaged runtime files (${a.files.length}):`));
            for (const f of visibleFiles) {
              console.log(chalk.dim(`      ${truncateText(f, 120)}`));
            }
            if (!options.verbose && a.files.length > visibleFiles.length) {
              console.log(chalk.dim(`      ... ${a.files.length - visibleFiles.length} more files (use --verbose)`));
            }
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
        console.log(chalk.dim(`  1. Run:     `) + `connectors run ${succeeded[0]} --help`);
        console.log(chalk.dim(`  2. Set key: `) + `connectors docs ${succeeded[0]}` + chalk.dim(` (see env vars and auth flow)`));
        console.log(chalk.dim(`  3. Explore: `) + `connectors serve` + chalk.dim(` (local OAuth + API server)`));
      }
      process.exit(results.every((r) => r.success) ? 0 : 1);
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
}
