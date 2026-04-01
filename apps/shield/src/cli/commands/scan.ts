import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import chalk from "chalk";
import { ScanStatus, Severity, type Finding } from "../../types/index.js";
import {
  getDb, createScan, completeScan, updateScanStatus, createFinding,
} from "../../db/index.js";
import { runScanner, getScanner } from "../../scanners/index.js";
import { isLLMAvailable, analyzeFinding as llmAnalyzeFinding } from "../../llm/index.js";
import { getReporter } from "../../reporters/index.js";
import { loadConfig } from "../../lib/index.js";
import {
  parseFormat, parseSeverity, resolveScannerTypes, filterBySeverity,
  ensureProject, getCodeContext,
} from "../helpers.js";

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Run security scan on a directory")
    .argument("[path]", "Path to scan", ".")
    .option("--quick", "Quick scan (secrets + dependencies only)")
    .option("--scanner <type>", "Run specific scanner only")
    .option("--format <format>", "Output format (terminal/json/sarif)", "terminal")
    .option("--severity <level>", "Minimum severity threshold", "info")
    .option("--llm", "Enable LLM analysis of findings")
    .option("--no-cache", "Skip LLM cache")
    .action(async (path: string, options) => {
      const scanPath = resolve(path);
      if (!existsSync(scanPath)) {
        console.error(chalk.red(`Path does not exist: ${scanPath}`));
        process.exit(1);
      }

      const config = loadConfig(scanPath);
      const format = parseFormat(options.format);
      const severityThreshold = parseSeverity(options.severity);
      const scannerTypes = resolveScannerTypes(options.scanner, options.quick, config);
      const useLLM = options.llm || config.llm_analyze;

      getDb();
      const project = ensureProject(scanPath);
      const scan = createScan(project.id, scannerTypes);
      updateScanStatus(scan.id, ScanStatus.Running);

      console.log(chalk.bold(`\n  Scanning ${chalk.cyan(scanPath)}...`));
      console.log(chalk.gray(`  Scanners: ${scannerTypes.join(", ")}`));

      const startTime = Date.now();

      try {
        let findingInputs: any[] = [];

        if (scannerTypes.length === 1) {
          findingInputs = await runScanner(scannerTypes[0], scanPath, {
            ignore_patterns: config.ignore_patterns,
          });
        } else {
          const results = await Promise.allSettled(
            scannerTypes.map((type) => {
              const scanner = getScanner(type);
              if (!scanner) return Promise.resolve([]);
              return scanner.scan(scanPath, { ignore_patterns: config.ignore_patterns });
            }),
          );
          for (const result of results) {
            if (result.status === "fulfilled") findingInputs.push(...result.value);
            else console.error(chalk.yellow(`  Warning: scanner failed - ${result.reason}`));
          }
        }

        const storedFindings: Finding[] = [];
        for (const input of findingInputs) {
          storedFindings.push(createFinding(scan.id, input));
        }
        completeScan(scan.id, storedFindings.length);

        if (useLLM && isLLMAvailable() && storedFindings.length > 0) {
          console.log(chalk.gray(`  Running LLM analysis on ${storedFindings.length} findings (5 concurrent)...`));
          const BATCH_SIZE = 5;
          let analyzed = 0;
          for (let i = 0; i < storedFindings.length; i += BATCH_SIZE) {
            const batch = storedFindings.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
              batch.map(async (finding) => {
                const codeContext = getCodeContext(resolve(scanPath, finding.file), finding.line);
                const analysis = await llmAnalyzeFinding(finding, codeContext);
                if (analysis) finding.llm_exploitability = analysis.exploitability;
                analyzed++;
              }),
            );
            process.stdout.write(chalk.gray(`\r  Analyzed ${analyzed}/${storedFindings.length} findings`));
          }
          console.log();
        } else if (useLLM && !isLLMAvailable()) {
          console.log(chalk.yellow("  LLM analysis requested but CEREBRAS_API_KEY is not set. Skipping."));
        }

        console.log(chalk.gray(`  Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`));

        const filtered = filterBySeverity(storedFindings, severityThreshold);
        const reporter = getReporter(format);
        const output = reporter.report(filtered, { ...scan, status: ScanStatus.Completed });
        if (typeof output === "string") console.log(output);

        if (filtered.some((f) => f.severity === Severity.Critical || f.severity === Severity.High)) {
          process.exit(1);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        updateScanStatus(scan.id, ScanStatus.Failed, undefined, errMsg);
        console.error(chalk.red(`  Scan failed: ${errMsg}`));
        process.exit(1);
      }
    });
}
