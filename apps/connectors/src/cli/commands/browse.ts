import { Command } from "commander";
import chalk from "chalk";
import {
  CONNECTORS,
  CATEGORIES,
  getConnector,
  getConnectorsByCategory,
  searchConnectors,
} from "../../lib/registry.js";
import {
  getInstalledConnectors,
  getConnectorDocs,
  removeConnector,
} from "../../lib/installer.js";
import { getAuthStatus } from "../../server/auth.js";

export function registerCommands(program: Command): void {
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
    .option("--limit <n>", "Max results", "20")
    .description("Search for connectors (ranked with fuzzy matching)")
    .action((query: string, options: { json: boolean; limit: string }) => {
      const installed = getInstalledConnectors();
      const { getPromotedConnectors } = require("../../db/promotions.js");
      const { getUsageMap } = require("../../db/usage.js");
      const results = searchConnectors(query, {
        installed,
        promoted: getPromotedConnectors(),
        usage: getUsageMap(),
        limit: parseInt(options.limit),
      });

      if (options.json) {
        console.log(JSON.stringify(results.map((c) => ({ name: c.name, displayName: c.displayName, version: c.version, category: c.category, description: c.description, score: c.score, badges: c.badges, matchReasons: c.matchReasons }))));
        return;
      }

      if (results.length === 0) {
        console.log(chalk.dim(`No connectors found for "${query}"`));
        return;
      }
      console.log(chalk.bold(`\nFound ${results.length} connector(s):\n`));
      console.log(`  ${chalk.dim("Name".padEnd(22))}${chalk.dim("Score".padEnd(7))}${chalk.dim("Category".padEnd(20))}${chalk.dim("Description")}`);
      console.log(chalk.dim(`  ${"─".repeat(75)}`));
      for (const c of results) {
        const badges = c.badges.map((b: string) => b === "installed" ? chalk.green("[INS]") : b === "hot" ? chalk.red("[HOT]") : b === "promoted" ? chalk.yellow("[PRO]") : "").join(" ");
        const badgeStr = badges ? " " + badges : "";
        console.log(`  ${chalk.cyan(c.name.padEnd(22))}${String(c.score).padEnd(7)}${chalk.dim(c.category.padEnd(20))}${c.description}${badgeStr}`);
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

      const { startServer } = await import("../../server/serve.js");
      await startServer(port, { open: options.open });
    });
}
