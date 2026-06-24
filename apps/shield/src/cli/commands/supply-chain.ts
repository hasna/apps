import type { Command } from "commander";
import chalk from "chalk";
import {
  getDb, listAdvisories, searchAdvisories, isVersionAffected, getIOCsForAdvisory, getAdvisory,
} from "../../db/index.js";
import { seedAdvisories } from "../../data/advisories.js";
import { DEFAULT_ADVISORY_LIMIT, parseLimitOption, truncateText } from "../../lib/output.js";

type AdvisoryRecord = ReturnType<typeof listAdvisories>[number];

function advisoryColor(severity: string): (text: string) => string {
  return severity === "critical" ? chalk.red : severity === "high" ? chalk.magenta : chalk.yellow;
}

function printAdvisoryRow(advisory: AdvisoryRecord): void {
  const line = [
    advisory.id.slice(0, 8).padEnd(8),
    advisory.severity.padEnd(8),
    truncateText(advisory.package_name, 20).padEnd(20),
    truncateText(advisory.title, 80),
  ].join("  ");
  console.log(advisoryColor(advisory.severity)(`  ${line}`));
}

function printAdvisoryDetails(advisory: AdvisoryRecord): void {
  const color = advisoryColor(advisory.severity);
  console.log();
  console.log(chalk.bold(color(`  [${advisory.severity.toUpperCase()}] ${advisory.title}`)));
  console.log(chalk.gray(`  Package: ${advisory.package_name} (${advisory.ecosystem})`));
  console.log(chalk.gray(`  Affected: ${advisory.affected_versions.join(", ")}`));
  console.log(chalk.green(`  Safe: ${advisory.safe_versions.join(", ") || "none - remove package"}`));
  console.log(chalk.gray(`  Attack: ${advisory.attack_type}${advisory.threat_actor ? ` by ${advisory.threat_actor}` : ""}`));
  console.log(chalk.gray(`  Detected: ${advisory.detected_at}`));
  console.log(chalk.gray(`  ID: ${advisory.id}`));
}

export function registerSupplyChainCommands(program: Command): void {
  // check-package <name> [version]
  program
    .command("check-package")
    .description("Check if a package is safe or compromised")
    .argument("<name>", "Package name (e.g. axios, litellm)")
    .argument("[version]", "Specific version to check")
    .option("--ecosystem <eco>", "Ecosystem: npm, pypi, github-actions", "npm")
    .option("--limit <n>", `Max advisories to show without a version (default ${DEFAULT_ADVISORY_LIMIT})`)
    .option("--offset <n>", "Skip first N advisories when checking by package name", "0")
    .option("--verbose", "Show all IOCs and advisory fields")
    .action(async (name: string, version: string | undefined, options) => {
      getDb();
      try { seedAdvisories(); } catch {}

      if (version) {
        const advisory = isVersionAffected(name, options.ecosystem, version);
        if (advisory) {
          const iocs = getIOCsForAdvisory(advisory.id);
          console.log(chalk.red.bold(`\n  COMPROMISED: ${name}@${version}\n`));
          console.log(chalk.red(`  ${advisory.title}`));
          console.log(chalk.gray(`  Attack: ${advisory.attack_type}`));
          if (advisory.threat_actor) console.log(chalk.gray(`  Threat actor: ${advisory.threat_actor}`));
          console.log(chalk.green(`  Safe versions: ${advisory.safe_versions.join(", ") || "none — remove package"}`));
          console.log(chalk.gray(`  Detected: ${advisory.detected_at}`));
          if (iocs.length > 0) {
            const visibleIocs = options.verbose ? iocs : iocs.slice(0, 5);
            console.log(chalk.yellow(`\n  IOCs (${visibleIocs.length}/${iocs.length}):`));
            for (const ioc of visibleIocs) {
              console.log(chalk.gray(`    [${ioc.type}] ${ioc.value}${ioc.context ? ` — ${ioc.context}` : ""}`));
            }
            if (iocs.length > visibleIocs.length) {
              console.log(chalk.gray(`    ${iocs.length - visibleIocs.length} more hidden. Use --verbose for all IOCs.`));
            }
          }
          console.log();
          process.exit(1);
        } else {
          console.log(chalk.green(`\n  SAFE: ${name}@${version} — no known advisories.\n`));
        }
      } else {
        const limit = parseLimitOption(options.limit, "--limit", DEFAULT_ADVISORY_LIMIT);
        const offset = parseLimitOption(options.offset, "--offset", 0, Number.MAX_SAFE_INTEGER);
        const advisories = searchAdvisories(name).filter((a) => a.ecosystem === options.ecosystem);
        if (advisories.length > 0) {
          const page = advisories.slice(offset, offset + limit + 1);
          const visible = page.slice(0, limit);
          const hasMore = page.length > visible.length;

          console.log(chalk.yellow(`\n  ${name} has ${advisories.length} advisory(ies); showing ${visible.length}${hasMore ? "+" : ""}.\n`));
          if (!options.verbose) {
            console.log(chalk.gray("  ID        Severity  Package               Title"));
            console.log(chalk.gray("  " + "-".repeat(70)));
          }
          for (const a of visible) {
            if (options.verbose) printAdvisoryDetails(a);
            else printAdvisoryRow(a);
          }
          if (hasMore) {
            console.log(chalk.gray(`\n  More advisories available. Use --offset ${offset + visible.length}, --limit, --verbose, or shield advisory <id> for details.`));
          }
          console.log(chalk.gray("\n  Use --verbose for affected/safe versions or shield advisory <id> for IOCs."));
          console.log();
        } else {
          console.log(chalk.green(`\n  SAFE: ${name} — no known advisories.\n`));
        }
      }
    });

  // advisories
  program
    .command("advisories")
    .description("List known supply chain attack advisories")
    .option("--ecosystem <eco>", "Filter by ecosystem")
    .option("--severity <level>", "Filter by severity")
    .option("--search <query>", "Search advisories")
    .option("--limit <n>", `Max advisories to return (default ${DEFAULT_ADVISORY_LIMIT})`)
    .option("--offset <n>", "Skip first N advisories", "0")
    .option("--verbose", "Show full multi-line advisory details")
    .option("--json", "Output full advisory records as JSON")
    .action(async (options) => {
      try {
        getDb();
        try { seedAdvisories(); } catch {}

        const limit = parseLimitOption(options.limit, "--limit", DEFAULT_ADVISORY_LIMIT);
        const offset = parseLimitOption(options.offset, "--offset", 0, Number.MAX_SAFE_INTEGER);

        const queryLimit = options.json ? limit : limit + 1;
        const advisories = options.search
          ? searchAdvisories(options.search).slice(offset, offset + queryLimit)
          : listAdvisories({ ecosystem: options.ecosystem, severity: options.severity, limit: queryLimit, offset });

        if (advisories.length === 0) {
          console.log(chalk.yellow("\n  No advisories found.\n"));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify({ advisories, count: advisories.length, limit, offset }, null, 2));
          return;
        }

        const visible = advisories.slice(0, limit);
        const hasMore = advisories.length > visible.length;

        console.log(chalk.bold(`\n  Supply Chain Advisories (showing ${visible.length}${hasMore ? "+" : ""})\n`));
        console.log(chalk.gray(`  Showing results offset=${offset}, limit=${limit}`));
        console.log(chalk.gray("  " + "\u2500".repeat(70)));
        if (!options.verbose) {
          console.log(chalk.gray("  ID        Severity  Package               Title"));
          console.log(chalk.gray("  " + "-".repeat(70)));
        }

        for (const a of visible) {
          if (options.verbose) printAdvisoryDetails(a);
          else printAdvisoryRow(a);
        }
        if (hasMore) {
          console.log(chalk.gray(`\n  More advisories available. Use --offset ${offset + visible.length}, --verbose, --json, or shield advisory <id> for details.`));
        }
        console.log(chalk.gray("\n  Use --verbose for details, --json for full records, or shield advisory <id> for one advisory."));
        console.log();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  ${errMsg}\n`));
        process.exit(1);
      }
    });

  program
    .command("advisory")
    .description("Show one supply chain advisory with IOCs")
    .argument("<id>", "Advisory ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, options) => {
      try {
        getDb();
        try { seedAdvisories(); } catch {}
        const advisory = getAdvisory(id);
        if (!advisory) {
          console.error(chalk.red(`\n  Advisory not found: ${id}\n`));
          process.exit(1);
        }
        const iocs = getIOCsForAdvisory(advisory.id);
        if (options.json) {
          console.log(JSON.stringify({ ...advisory, iocs }, null, 2));
          return;
        }
        printAdvisoryDetails(advisory);
        if (iocs.length > 0) {
          console.log(chalk.yellow(`\n  IOCs (${iocs.length})`));
          for (const ioc of iocs) {
            console.log(chalk.gray(`    [${ioc.type}] ${ioc.value}${ioc.context ? ` - ${ioc.context}` : ""}`));
          }
        }
        console.log();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  ${errMsg}\n`));
        process.exit(1);
      }
    });
}
