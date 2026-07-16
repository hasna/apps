import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import chalk from "chalk";
import { ScanStatus, Severity, ReportFormat, type Finding } from "../../types/index.js";
import {
  getDb, createScan, completeScan, updateScanStatus, createFinding,
} from "../../db/index.js";
import { runScanner, getScanner } from "../../scanners/index.js";
import { isLLMAvailable, analyzeFinding as llmAnalyzeFinding } from "../../llm/index.js";
import { getReporter } from "../../reporters/index.js";
import { loadConfig } from "../../lib/index.js";
import { isCredentialFinding, sanitizeLocationForOutput } from "../../lib/finding-safety.js";
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
    .option("--git-history", "Explicitly include the sensitive git-history scanner", false)
    .option("--no-git-history", "Compatibility flag; git history is disabled by default")
    .option("--system", "Explicitly include host/system IOC locations outside the requested path", false)
    .option("--no-system", "Compatibility flag; host/system inspection is disabled by default")
    .option("--format <format>", "Output format (terminal/json/sarif)", "terminal")
    .option("--severity <level>", "Minimum severity threshold", "info")
    .option("--llm", "Enable LLM analysis of findings")
    .option("--no-cache", "Skip LLM cache")
    .action(async (path: string, options) => {
      const scanPath = resolve(path);
      if (!existsSync(scanPath)) {
        console.error(chalk.red("Requested scan path does not exist"));
        process.exit(1);
      }

      try {
        const config = loadConfig(scanPath);
        const format = parseFormat(options.format);
        const severityThreshold = parseSeverity(options.severity);
        const scannerTypes = resolveScannerTypes(
          options.scanner,
          options.quick,
          config,
          options.gitHistory === true,
        );
        const useLLM = options.llm || config.llm_analyze;

        getDb();
        const project = ensureProject(scanPath);
        const scan = createScan(project.id, scannerTypes);
        updateScanStatus(scan.id, ScanStatus.Running);

        // Use stderr for progress when format is JSON/SARIF so stdout is clean
        const isStructuredOutput = format !== ReportFormat.Terminal;
        const log = isStructuredOutput
          ? (msg: string) => process.stderr.write(msg + "\n")
          : console.log;

        log(chalk.bold(`\n  Scanning ${chalk.cyan(sanitizeLocationForOutput(scanPath))}...`));
        log(chalk.gray(`  Scanners: ${scannerTypes.join(", ")}`));

        const startTime = Date.now();
        let findingInputs: any[] = [];

        if (scannerTypes.length === 1) {
          findingInputs = await runScanner(scannerTypes[0], scanPath, {
            ignore_patterns: config.ignore_patterns,
            include_git_history: options.gitHistory === true,
            include_system: options.system === true,
          });
        } else {
          const results = await Promise.all(
            scannerTypes.map((type) => {
              const scanner = getScanner(type);
              if (!scanner) throw new Error(`Scanner not found: ${type}`);
              return scanner.scan(scanPath, {
                ignore_patterns: config.ignore_patterns,
                include_git_history: options.gitHistory === true,
                include_system: options.system === true,
              });
            }),
          );
          findingInputs = results.flat();
        }

        const storedFindings: Finding[] = [];
        for (const input of findingInputs) {
          storedFindings.push(createFinding(scan.id, input));
        }
        completeScan(scan.id, storedFindings.length);

        if (useLLM && isLLMAvailable() && storedFindings.length > 0) {
          log(chalk.gray(`  Running LLM analysis on ${storedFindings.length} findings (5 concurrent)...`));
          const BATCH_SIZE = 5;
          let analyzed = 0;
          for (let i = 0; i < storedFindings.length; i += BATCH_SIZE) {
            const batch = storedFindings.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
              batch.map(async (finding) => {
                if (isCredentialFinding(finding)) {
                  analyzed++;
                  return;
                }
                const codeContext = getCodeContext(resolve(scanPath, finding.file), finding.line);
                const analysis = await llmAnalyzeFinding(finding, codeContext);
                if (analysis) finding.llm_exploitability = analysis.exploitability;
                analyzed++;
              }),
            );
            (isStructuredOutput ? process.stderr : process.stdout).write(
              chalk.gray(`\r  Analyzed ${analyzed}/${storedFindings.length} findings`)
            );
          }
          log("");
        } else if (useLLM && !isLLMAvailable()) {
          log(chalk.yellow("  LLM analysis requested but CEREBRAS_API_KEY is not set. Skipping."));
        }

        log(chalk.gray(`  Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`));

        const filtered = filterBySeverity(storedFindings, severityThreshold);
        const reporter = getReporter(format);
        const output = reporter.report(filtered, { ...scan, status: ScanStatus.Completed });
        if (typeof output === "string") console.log(output);

        if (filtered.some((f) => f.severity === Severity.Critical || f.severity === Severity.High)) {
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red("\n  Scan failed. Details were withheld to protect scanned source context.\n"));
        process.exit(1);
      }
    });
}
