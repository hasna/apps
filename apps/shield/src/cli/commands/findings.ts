import type { Command } from "commander";
import chalk from "chalk";
import { getDb, listScans, listFindings } from "../../db/index.js";
import { getReporter } from "../../reporters/index.js";
import { parseFormat, parseSeverity, parseScannerType } from "../helpers.js";
import { DEFAULT_COMPACT_LIMIT, parseLimitOption } from "../../lib/output.js";

export function registerFindingsCommand(program: Command): void {
  program
    .command("findings")
    .description("List security findings")
    .option("--severity <level>", "Filter by severity")
    .option("--scanner <type>", "Filter by scanner type")
    .option("--file <path>", "Filter by file")
    .option("--format <format>", "Output format", "terminal")
    .option("--limit <n>", `Max findings to fetch/show (terminal default ${DEFAULT_COMPACT_LIMIT}, JSON default 100)`)
    .option("--offset <n>", "Skip N findings", "0")
    .option("--verbose", "Show full terminal finding details, including snippets and LLM explanations")
    .option("--suppressed", "Include suppressed findings")
    .action(async (options) => {
      try {
        const format = parseFormat(options.format);
        const severity = options.severity ? parseSeverity(options.severity) : undefined;
        const scannerType = options.scanner ? parseScannerType(options.scanner) : undefined;
        const offset = parseLimitOption(options.offset, "--offset", 0, Number.MAX_SAFE_INTEGER);
        const explicitLimit = options.limit !== undefined
          ? parseLimitOption(options.limit, "--limit", DEFAULT_COMPACT_LIMIT)
          : undefined;
        const queryLimit = format === "terminal"
          ? (explicitLimit ?? 100) + (options.verbose ? 0 : 1)
          : explicitLimit ?? 100;

        getDb();
        const scans = listScans(undefined, 1);
        if (scans.length === 0) {
          console.log(chalk.yellow("\n  No scans found. Run `shield scan` first.\n"));
          return;
        }

        const latestScan = scans[0];

        const findings = listFindings({
          scan_id: latestScan.id,
          severity,
          scanner_type: scannerType,
          file: options.file,
          suppressed: options.suppressed ? undefined : false,
          limit: queryLimit,
          offset,
        });

        if (findings.length === 0) {
          console.log(chalk.green("\n  No findings match the specified filters.\n"));
          return;
        }

        const reporter = getReporter(format);
        const output = reporter.report(findings, latestScan, {
          limit: explicitLimit ?? DEFAULT_COMPACT_LIMIT,
          offset,
          verbose: Boolean(options.verbose),
        });
        if (typeof output === "string") console.log(output);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  ${errMsg}\n`));
        process.exit(1);
      }
    });
}
