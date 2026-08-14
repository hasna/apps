import type { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import {
  filterFleetPackageLeaksBySeverity,
  scanFleetPackageLeaks,
} from "../../lib/fleet-package-leak.js";
import { SEVERITY_ORDER, Severity, type FindingInput } from "../../types/index.js";
import { parseSeverity } from "../helpers.js";

type FleetPackageFormat = "terminal" | "json";

function parseFormat(value: string): FleetPackageFormat {
  const normalized = value.toLowerCase();
  if (normalized === "terminal" || normalized === "json") return normalized;
  throw new Error(`Invalid --format '${value}'. Allowed values: terminal, json`);
}

function printFinding(finding: FindingInput): string {
  const location = finding.column ? `${finding.file}:${finding.line}:${finding.column}` : `${finding.file}:${finding.line}`;
  return `  [${finding.severity}] ${location} ${finding.rule_id}: ${finding.message}`;
}

function printTerminal(path: string, findings: FindingInput[], failThreshold: Severity): void {
  console.log(chalk.bold("\n  Fleet Package Leak Scan\n"));
  console.log(chalk.gray(`  Path: ${path}`));
  console.log(chalk.gray(`  Fail threshold: ${failThreshold}\n`));

  if (findings.length === 0) {
    console.log(chalk.green("  No fleet package leaks detected.\n"));
    return;
  }

  console.log(chalk.red(`  Found ${findings.length} finding(s):\n`));
  for (const finding of findings) {
    console.log(printFinding(finding));
  }
  console.log();
}

export function registerFleetPackageCommand(program: Command): void {
  program
    .command("fleet-package")
    .description("Scan public package/source content for private fleet data leaks")
    .argument("[path]", "Path to scan", ".")
    .option("--format <format>", "Output format (terminal/json)", "terminal")
    .option("-j, --json", "Shortcut for --format json")
    .option("--severity <level>", "Minimum severity threshold to display", "info")
    .option("--fail-on <level>", "Exit non-zero when findings meet or exceed this severity", "high")
    .action((pathArg: string, options) => {
      const scanPath = resolve(pathArg);
      if (!existsSync(scanPath)) {
        console.error(chalk.red(`\n  Path does not exist: ${scanPath}\n`));
        process.exit(1);
      }

      try {
        const format = options.json ? "json" : parseFormat(options.format);
        const severityThreshold = parseSeverity(options.severity);
        const failThreshold = parseSeverity(options.failOn);
        const result = scanFleetPackageLeaks({ path: scanPath });
        const filtered = filterFleetPackageLeaksBySeverity(result.findings, severityThreshold);

        if (format === "json") {
          console.log(JSON.stringify({
            path: result.path,
            severity_threshold: severityThreshold,
            fail_on: failThreshold,
            summary: result.summary,
            safety: result.safety,
            findings: filtered,
          }, null, 2));
        } else {
          printTerminal(result.path, filtered, failThreshold);
        }

        const failOrder = SEVERITY_ORDER[failThreshold];
        if (result.findings.some((finding) => SEVERITY_ORDER[finding.severity] <= failOrder)) {
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  Fleet package scan failed: ${message}\n`));
        process.exit(1);
      }
    });
}
