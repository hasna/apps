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
import {
  DEFAULT_COMPACT_LIMIT,
  firstNonEmptyLines,
  pageItems,
  parseNonNegativeInt,
  truncateText,
} from "../../lib/compact-output.js";

type ListOptions = {
  category?: string;
  all: boolean;
  installed: boolean;
  brief: boolean;
  limit?: string;
  offset?: string;
  cursor?: string;
  json: boolean;
  verbose: boolean;
};

function printConnectorRows(connectors: typeof CONNECTORS, options: { includeCategory?: boolean; verbose?: boolean } = {}) {
  const nameWidth = 22;
  const versionWidth = 10;
  const categoryWidth = options.includeCategory ? 22 : 0;
  const descWidth = options.verbose ? 160 : 80;

  const categoryHeader = options.includeCategory ? chalk.dim("Category".padEnd(categoryWidth)) : "";
  console.log(
    `  ${chalk.dim("Name".padEnd(nameWidth))}` +
    `${chalk.dim("Version".padEnd(versionWidth))}` +
    categoryHeader +
    `${chalk.dim("Description")}`
  );
  console.log(chalk.dim(`  ${"-".repeat(nameWidth + versionWidth + categoryWidth + 40)}`));

  for (const c of connectors) {
    const description = options.verbose ? c.description : truncateText(c.description, descWidth);
    const category = options.includeCategory ? chalk.dim(c.category.padEnd(categoryWidth)) : "";
    console.log(
      `  ${chalk.cyan(c.name.padEnd(nameWidth))}` +
      `${chalk.dim((c.version || "-").padEnd(versionWidth))}` +
      category +
      description
    );
  }
}

function printPaginationHint(command: string, total: number, nextOffset: number | null, detailHint = true) {
  const parts = [
    nextOffset !== null ? `${command} --cursor ${nextOffset}` : null,
    detailHint ? "connectors info <name>" : null,
    `${command} --verbose`,
    `${command} --json`,
  ].filter(Boolean);

  if (parts.length > 0) {
    console.log(chalk.dim(`\n  More detail: ${parts.join(" | ")}`));
  }
  if (nextOffset !== null) {
    console.log(chalk.dim(`  Showing a compact page of ${total} total results.`));
  }
}

export function registerCommands(program: Command): void {
  // List command
  program
    .command("list")
    .alias("ls")
    .option("-c, --category <category>", "Filter by category")
    .option("-a, --all", "Show all available connectors", false)
    .option("-i, --installed", "Show only installed connectors", false)
    .option("-b, --brief", "Output only connector names", false)
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Skip first N results")
    .option("--cursor <n>", "Cursor returned by compact output (same as --offset)")
    .option("--json", "Output as JSON", false)
    .option("-v, --verbose", "Show full human output instead of compact pages", false)
    .description("List available or installed connectors")
    .action((options: ListOptions) => {
      const parsedLimit = parseNonNegativeInt(options.limit, "--limit");
      const parsedOffset = parseNonNegativeInt(options.offset, "--offset");
      const parsedCursor = parseNonNegativeInt(options.cursor, "--cursor");
      if (parsedLimit.error || parsedOffset.error || parsedCursor.error) {
        const error = parsedLimit.error || parsedOffset.error || parsedCursor.error || "Invalid pagination options";
        if (options.json) {
          console.log(JSON.stringify({ error }));
        } else {
          console.log(chalk.red(error));
        }
        process.exit(1);
        return;
      }
      const limit = parsedLimit.value;
      const offset = parsedCursor.value ?? parsedOffset.value ?? 0;
      const jsonLimit = limit === undefined ? undefined : Math.max(1, Math.floor(limit));
      const page = <T>(items: T[]): T[] => {
        if (jsonLimit === undefined) return items.slice(offset);
        return items.slice(offset, offset + jsonLimit);
      };

      // --brief: output only connector names
      if (options.brief) {
        if (options.installed) {
          const installed = page(getInstalledConnectors());
          if (options.json) {
            console.log(JSON.stringify(installed));
          } else {
            for (const name of installed) console.log(name);
          }
        } else if (options.category) {
          const requestedCategory = options.category;
          const category = CATEGORIES.find(c => c.toLowerCase() === requestedCategory.toLowerCase());
          if (!category) { console.error(`Unknown category: ${requestedCategory}`); process.exit(1); return; }
          const names = page(getConnectorsByCategory(category).map(c => c.name));
          if (options.json) { console.log(JSON.stringify(names)); } else { for (const n of names) console.log(n); }
        } else {
          const names = page(CONNECTORS.map(c => c.name));
          if (options.json) { console.log(JSON.stringify(names)); } else { for (const n of names) console.log(n); }
        }
        return;
      }

      if (options.installed) {
        const installedSource = getInstalledConnectors();
        const installedPage = pageItems(installedSource, {
          offset,
          limit: limit ?? (options.verbose || options.all ? undefined : DEFAULT_COMPACT_LIMIT),
        });
        const installed = options.json ? page(installedSource) : installedPage.items;

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

        const installedTitle = installedPage.limit === null
          ? `Installed connectors (${installedSource.length})`
          : `Installed connectors (showing ${installed.length} of ${installedSource.length})`;
        console.log(chalk.bold(`\n${installedTitle}:\n`));

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
        printPaginationHint("connectors list --installed", installedSource.length, installedPage.nextOffset);
        return;
      }

      if (options.category) {
        const requestedCategory = options.category;
        const category = CATEGORIES.find(
          (c) => c.toLowerCase() === requestedCategory.toLowerCase()
        );
        if (!category) {
          if (options.json) {
            console.log(JSON.stringify({ error: `Unknown category: ${requestedCategory}` }));
            process.exit(1);
          }
          console.log(chalk.red(`Unknown category: ${requestedCategory}`));
          console.log(chalk.dim(`Available: ${CATEGORIES.join(", ")}`));
          return;
        }
        const connectors = getConnectorsByCategory(category);
        const humanPage = pageItems(connectors, {
          offset,
          limit: limit ?? (options.verbose || options.all ? undefined : DEFAULT_COMPACT_LIMIT),
        });
        const pagedConnectors = options.json ? page(connectors) : humanPage.items;
        if (options.json) {
          console.log(JSON.stringify(pagedConnectors));
          return;
        }
        const title = humanPage.limit === null
          ? `${category} (${connectors.length})`
          : `${category} (showing ${pagedConnectors.length} of ${connectors.length})`;
        console.log(chalk.bold(`\n${title}:\n`));
        printConnectorRows(pagedConnectors, { verbose: options.verbose });
        printPaginationHint(`connectors list --category "${category}"`, connectors.length, humanPage.nextOffset);
        return;
      }

      // Show all
      if (options.json) {
        console.log(JSON.stringify(page(CONNECTORS)));
        return;
      }

      if (options.limit || options.offset || options.cursor || !options.all) {
        const humanPage = pageItems(CONNECTORS, {
          offset,
          limit: limit ?? (options.verbose || options.all ? undefined : DEFAULT_COMPACT_LIMIT),
        });
        const connectors = humanPage.items;
        const title = humanPage.limit === null
          ? `Available connectors (${CONNECTORS.length})`
          : `Available connectors (showing ${connectors.length} of ${CONNECTORS.length})`;
        console.log(chalk.bold(`\n${title}:\n`));
        printConnectorRows(connectors, { includeCategory: true, verbose: options.verbose });
        printPaginationHint("connectors list", CONNECTORS.length, humanPage.nextOffset);
        return;
      }

      console.log(chalk.bold(`\nAvailable connectors (${CONNECTORS.length}):\n`));
      for (const category of CATEGORIES) {
        const connectors = getConnectorsByCategory(category);
        console.log(chalk.bold(`${category} (${connectors.length}):`));
        printConnectorRows(connectors, { verbose: true });
        console.log();
      }
    });

  // Search command
  program
    .command("search")
    .argument("<query>", "Search term")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Max results", "20")
    .option("-v, --verbose", "Show match details and full descriptions", false)
    .description("Search for connectors (ranked with fuzzy matching)")
    .action((query: string, options: { json: boolean; limit: string; verbose: boolean }) => {
      const parsedLimit = parseNonNegativeInt(options.limit, "--limit");
      if (parsedLimit.error || parsedLimit.value === undefined) {
        const error = parsedLimit.error || "Invalid --limit value";
        if (options.json) {
          console.log(JSON.stringify({ error }));
        } else {
          console.log(chalk.red(error));
        }
        process.exit(1);
        return;
      }
      const installed = getInstalledConnectors();
      const { getPromotedConnectors } = require("../../db/promotions.js");
      const { getUsageMap } = require("../../db/usage.js");
      const results = searchConnectors(query, {
        installed,
        promoted: getPromotedConnectors(),
        usage: getUsageMap(),
        limit: parsedLimit.value,
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
      console.log(chalk.dim(`  ${"-".repeat(75)}`));
      for (const c of results) {
        const badges = c.badges.map((b: string) => b === "installed" ? chalk.green("[INS]") : b === "hot" ? chalk.red("[HOT]") : b === "promoted" ? chalk.yellow("[PRO]") : "").join(" ");
        const badgeStr = badges ? " " + badges : "";
        const description = options.verbose ? c.description : truncateText(c.description, 72);
        const reasons = options.verbose && c.matchReasons.length > 0
          ? chalk.dim(` matches: ${c.matchReasons.join(", ")}`)
          : "";
        console.log(`  ${chalk.cyan(c.name.padEnd(22))}${String(c.score).padEnd(7)}${chalk.dim(c.category.padEnd(20))}${description}${badgeStr}${reasons}`);
      }
      console.log(chalk.dim(`\n  More detail: connectors info <name> | connectors search "${query}" --verbose | connectors search "${query}" --json`));
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
    .option("--essential", "Show auth and env vars only (no full docs)", false)
    .option("-v, --verbose", "Show full parsed documentation sections", false)
    .description("Show connector documentation (auth, env vars, API, CLI commands)")
    .action((connector: string, options: { json: boolean; raw: boolean; essential: boolean; verbose: boolean }) => {
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

      if (options.essential) {
        if (options.json) {
          console.log(JSON.stringify({ name: meta.name, auth: docs.auth, envVars: docs.envVars }, null, 2));
        } else {
          console.log(chalk.bold(`\n${meta.displayName} — Auth & Env Vars`));
          console.log(chalk.dim("─".repeat(50)));
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
          console.log();
        }
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

      if (!options.verbose) {
        console.log(chalk.bold(`\n${meta.displayName} - Documentation Summary`));
        console.log(chalk.dim("-".repeat(50)));
        console.log(`  Name:        ${chalk.cyan(meta.name)}`);
        console.log(`  Version:     ${meta.version || "-"}`);
        console.log(`  Category:    ${meta.category}`);
        console.log(`  Description: ${truncateText(meta.description, 100)}`);

        const overview = firstNonEmptyLines(docs.overview, 1, 100);
        if (overview.length > 0) {
          console.log(chalk.bold("\nOverview"));
          console.log(`  ${overview[0]}`);
        }

        const authLines = firstNonEmptyLines(docs.auth, 4, 100);
        if (authLines.length > 0) {
          console.log(chalk.bold("\nAuthentication"));
          for (const line of authLines) console.log(`  ${line}`);
        }

        if (docs.envVars.length > 0) {
          const visible = docs.envVars.slice(0, 8);
          console.log(chalk.bold("\nEnvironment Variables"));
          for (const v of visible) {
            console.log(`  ${chalk.cyan(v.variable.padEnd(30))}${truncateText(v.description, 80)}`);
          }
          if (docs.envVars.length > visible.length) {
            console.log(chalk.dim(`  ... ${docs.envVars.length - visible.length} more env vars`));
          }
        }

        const commandLines = firstNonEmptyLines(docs.cliCommands, 8, 100);
        if (commandLines.length > 0) {
          console.log(chalk.bold("\nCLI Commands"));
          for (const line of commandLines) console.log(`  ${line}`);
        }

        const storageLines = firstNonEmptyLines(docs.dataStorage, 2, 100);
        if (storageLines.length > 0) {
          console.log(chalk.bold("\nData Storage"));
          for (const line of storageLines) console.log(`  ${line}`);
        }

        console.log(chalk.dim(`\n  More detail: connectors docs ${connector} --verbose | connectors docs ${connector} --raw | connectors docs ${connector} --json`));
        console.log();
        return;
      }

      // Human-readable full parsed output
      console.log(chalk.bold(`\n${meta.displayName} — Documentation`));
      console.log(chalk.dim("-".repeat(50)));

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

  // Serve command — local API + OAuth server for connector auth
  program
    .command("serve")
    .option("-p, --port <port>", "Port to run the server on", "9876")
    .description("Start local API + OAuth server for connector auth")
    .action(async (options: { port: string }) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.log(chalk.red("Invalid port number"));
        process.exit(1);
        return;
      }

      console.log(chalk.bold("\nStarting Connectors API + OAuth server...\n"));

      const { startServer } = await import("../../server/serve.js");
      await startServer(port);
    });
}
