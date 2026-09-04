import { Command } from "commander";
import chalk from "chalk";
import { getConnector } from "../../lib/registry.js";
import { getInstalledConnectors } from "../../lib/installer.js";
import { getAuthStatus } from "../../server/auth.js";
import { getConnectorsHome } from "../../db/database.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getConnectorConfigReadDirs, listConfiguredConnectorNames } from "../../lib/connector-resolver.js";
import { DEFAULT_COMPACT_LIMIT, pageItems, parseNonNegativeInt, truncateText } from "../../lib/compact-output.js";

export function registerCommands(program: Command): void {
  // Status command — show auth status of installed connectors
  program
    .command("status")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Limit rows per section in human output")
    .option("--offset <n>", "Skip first N rows per section in human output")
    .option("-v, --verbose", "Show all human rows", false)
    .description("Show auth status of all configured connectors (project + global)")
    .action((options: { json: boolean; limit?: string; offset?: string; verbose: boolean }) => {
      const parsedLimit = parseNonNegativeInt(options.limit, "--limit");
      const parsedOffset = parseNonNegativeInt(options.offset, "--offset");
      if (parsedLimit.error || parsedOffset.error) {
        const error = parsedLimit.error || parsedOffset.error || "Invalid pagination options";
        if (options.json) console.log(JSON.stringify({ error }));
        else console.log(chalk.red(error));
        process.exit(1);
        return;
      }

      const installed = getInstalledConnectors();
      const configDir = getConnectorsHome();
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
        let profile = "default";
        for (const connectorConfigDir of getConnectorConfigReadDirs(name, configDir)) {
          const currentProfileFile = join(connectorConfigDir, "current_profile");
          if (existsSync(currentProfileFile)) {
            try { profile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
            break;
          }
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

      // 2. Globally configured connectors from the shared connector home
      if (existsSync(configDir)) {
        try {
          for (const name of listConfiguredConnectorNames(configDir)) {
            if (name.startsWith("zzztest")) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            allStatuses.push(buildStatusEntry(name, "global"));
          }
        } catch {
          // Ignore read errors in the shared connector home.
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
      const humanLimit = options.verbose ? undefined : (parsedLimit.value ?? DEFAULT_COMPACT_LIMIT);
      const humanOffset = parsedOffset.value ?? 0;

      // Configured section
      if (configuredList.length > 0) {
        const page = pageItems(configuredList, { offset: humanOffset, limit: humanLimit });
        const title = page.limit === null
          ? `  Configured (${configuredList.length})`
          : `  Configured (showing ${page.items.length} of ${configuredList.length})`;
        console.log(chalk.green.bold(`${title}\n`));
        printHeader();
        for (const s of page.items) {
          printRow(s);
        }
        if (page.nextOffset !== null) {
          console.log(chalk.dim(`  More configured rows: connectors status --offset ${page.nextOffset}`));
        }
        console.log();
      }

      // Unconfigured section
      if (unconfiguredList.length > 0) {
        const page = pageItems(unconfiguredList, { offset: humanOffset, limit: humanLimit });
        const title = page.limit === null
          ? `  Unconfigured (${unconfiguredList.length})`
          : `  Unconfigured (showing ${page.items.length} of ${unconfiguredList.length})`;
        console.log(chalk.red.bold(`${title}\n`));
        printHeader();
        for (const s of page.items) {
          printRow(s);
        }
        if (page.nextOffset !== null) {
          console.log(chalk.dim(`  More unconfigured rows: connectors status --offset ${page.nextOffset}`));
        }
        console.log();
      }

      // Summary
      console.log(chalk.dim(`  Total: ${allStatuses.length}  |  Configured: ${configuredList.length}  |  Unconfigured: ${unconfiguredList.length}`));
      console.log(chalk.dim("  More detail: connectors status --verbose | connectors status --json"));
      console.log();
    });

  // Doctor command — health check for all installed connectors
  program
    .command("doctor")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Limit rows in human output")
    .option("--offset <n>", "Skip first N rows in human output")
    .option("-v, --verbose", "Show all human rows and full suggestions", false)
    .description("Check all installed connectors for issues and output a health report")
    .action((options: { json: boolean; limit?: string; offset?: string; verbose: boolean }) => {
      const parsedLimit = parseNonNegativeInt(options.limit, "--limit");
      const parsedOffset = parseNonNegativeInt(options.offset, "--offset");
      if (parsedLimit.error || parsedOffset.error) {
        const error = parsedLimit.error || parsedOffset.error || "Invalid pagination options";
        if (options.json) console.log(JSON.stringify({ error }));
        else console.log(chalk.red(error));
        process.exit(1);
        return;
      }

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
      const page = pageItems(results, {
        offset: parsedOffset.value ?? 0,
        limit: options.verbose ? undefined : (parsedLimit.value ?? DEFAULT_COMPACT_LIMIT),
      });

      for (const r of page.items) {
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
          console.log(`  ${icon} ${nameStr} — ${truncateText(r.issues.join(", "), options.verbose ? 200 : 120)}`);
          const suggestions = options.verbose ? r.suggestions : r.suggestions.slice(0, 2);
          for (const suggestion of suggestions) {
            console.log(chalk.dim(`      -> ${truncateText(suggestion, options.verbose ? 200 : 120)}`));
          }
          if (!options.verbose && r.suggestions.length > suggestions.length) {
            console.log(chalk.dim(`      ... ${r.suggestions.length - suggestions.length} more suggestion(s)`));
          }
        }
      }

      if (page.nextOffset !== null) {
        console.log(chalk.dim(`\n  More rows: connectors doctor --offset ${page.nextOffset}`));
      }

      // Summary
      const parts: string[] = [];
      if (summary.healthy > 0) parts.push(chalk.green(`${summary.healthy} healthy`));
      if (summary.warnings > 0) parts.push(chalk.yellow(`${summary.warnings} warning${summary.warnings !== 1 ? "s" : ""}`));
      if (summary.errors > 0) parts.push(chalk.red(`${summary.errors} error${summary.errors !== 1 ? "s" : ""}`));

      console.log(`\n  ${chalk.bold("Summary:")} ${parts.join(", ")}`);

      if (summary.errors > 0 || summary.warnings > 0) {
        console.log(chalk.dim("\n  Run 'connectors auth <name>' to configure individual connectors."));
        console.log(chalk.dim("  Run 'connectors serve' to manage auth via the local API server.\n"));
      } else {
        console.log(chalk.green("\n  All connectors are healthy!\n"));
      }

      process.exit(summary.errors > 0 ? 1 : 0);
    });
}
