import type { Command } from "commander";
import chalk from "chalk";
import {
  getDb, listAdvisories, searchAdvisories, isVersionAffected, getIOCsForAdvisory,
} from "../../db/index.js";
import { seedAdvisories } from "../../data/advisories.js";

function parseNonNegativeInt(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flagName} '${value}'. Expected a non-negative integer.`);
  }
  return parsed;
}

export function registerSupplyChainCommands(program: Command): void {
  // check-package <name> [version]
  program
    .command("check-package")
    .description("Check if a package is safe or compromised")
    .argument("<name>", "Package name (e.g. axios, litellm)")
    .argument("[version]", "Specific version to check")
    .option("--ecosystem <eco>", "Ecosystem: npm, pypi, github-actions", "npm")
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
            console.log(chalk.yellow(`\n  IOCs (${iocs.length}):`));
            for (const ioc of iocs) {
              console.log(chalk.gray(`    [${ioc.type}] ${ioc.value}${ioc.context ? ` — ${ioc.context}` : ""}`));
            }
          }
          console.log();
          process.exit(1);
        } else {
          console.log(chalk.green(`\n  SAFE: ${name}@${version} — no known advisories.\n`));
        }
      } else {
        const advisories = searchAdvisories(name).filter((a) => a.ecosystem === options.ecosystem);
        if (advisories.length > 0) {
          console.log(chalk.yellow(`\n  ${name} has ${advisories.length} advisory(ies):\n`));
          for (const a of advisories) {
            const color = a.severity === "critical" ? chalk.red : a.severity === "high" ? chalk.magenta : chalk.yellow;
            console.log(color(`  [${a.severity}] ${a.title}`));
            console.log(chalk.gray(`    Affected: ${a.affected_versions.join(", ")}`));
            console.log(chalk.green(`    Safe: ${a.safe_versions.join(", ") || "none"}`));
            console.log();
          }
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
    .option("--limit <n>", "Max advisories to return", "50")
    .option("--offset <n>", "Skip first N advisories", "0")
    .action(async (options) => {
      try {
        getDb();
        try { seedAdvisories(); } catch {}

        const limit = parseNonNegativeInt(options.limit, "--limit");
        const offset = parseNonNegativeInt(options.offset, "--offset");

        const advisories = options.search
          ? searchAdvisories(options.search).slice(offset, offset + limit)
          : listAdvisories({ ecosystem: options.ecosystem, severity: options.severity, limit, offset });

        if (advisories.length === 0) {
          console.log(chalk.yellow("\n  No advisories found.\n"));
          return;
        }

        console.log(chalk.bold(`\n  Supply Chain Advisories (${advisories.length})\n`));
        console.log(chalk.gray(`  Showing results offset=${offset}, limit=${limit}`));
        console.log(chalk.gray("  " + "\u2500".repeat(70)));

        for (const a of advisories) {
          const color = a.severity === "critical" ? chalk.red : a.severity === "high" ? chalk.magenta : chalk.yellow;
          console.log();
          console.log(color.bold(`  [${a.severity.toUpperCase()}] ${a.title}`));
          console.log(chalk.gray(`  Package: ${a.package_name} (${a.ecosystem})`));
          console.log(chalk.gray(`  Affected: ${a.affected_versions.join(", ")}`));
          console.log(chalk.green(`  Safe: ${a.safe_versions.join(", ") || "none — remove package"}`));
          console.log(chalk.gray(`  Attack: ${a.attack_type}${a.threat_actor ? ` by ${a.threat_actor}` : ""}`));
          console.log(chalk.gray(`  Detected: ${a.detected_at}`));
          console.log(chalk.gray(`  ID: ${a.id}`));
        }
        console.log();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  ${errMsg}\n`));
        process.exit(1);
      }
    });
}
