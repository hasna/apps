import type { Command } from "commander";
import chalk from "chalk";
import { ScannerType } from "../../types/index.js";
import { getDb, listScans, listFindings } from "../../db/index.js";
import { getReporter } from "../../reporters/index.js";
import { parseFormat, parseSeverity } from "../helpers.js";

export function registerFindingsCommand(program: Command): void {
  program
    .command("findings")
    .description("List security findings")
    .option("--severity <level>", "Filter by severity")
    .option("--scanner <type>", "Filter by scanner type")
    .option("--file <path>", "Filter by file")
    .option("--format <format>", "Output format", "terminal")
    .option("--suppressed", "Include suppressed findings")
    .action(async (options) => {
      getDb();
      const scans = listScans(undefined, 1);
      if (scans.length === 0) {
        console.log(chalk.yellow("\n  No scans found. Run `security scan` first.\n"));
        return;
      }

      const latestScan = scans[0];
      const format = parseFormat(options.format);

      const findings = listFindings({
        scan_id: latestScan.id,
        severity: options.severity ? parseSeverity(options.severity) : undefined,
        scanner_type: options.scanner as ScannerType | undefined,
        file: options.file,
        suppressed: options.suppressed ? undefined : false,
      });

      if (findings.length === 0) {
        console.log(chalk.green("\n  No findings match the specified filters.\n"));
        return;
      }

      const reporter = getReporter(format);
      const output = reporter.report(findings, latestScan);
      if (typeof output === "string") console.log(output);
    });
}
