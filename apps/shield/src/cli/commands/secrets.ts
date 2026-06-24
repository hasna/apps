import type { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import {
  scanSecretExposure,
  filterSecretExposureBySeverity,
  summarizeSecretExposure,
} from "../../lib/secret-exposure.js";
import { SEVERITY_ORDER, Severity, type FindingInput } from "../../types/index.js";
import { parseSeverity } from "../helpers.js";
import { DEFAULT_COMPACT_LIMIT, parseLimitOption, truncateText } from "../../lib/output.js";

type SecretCommandFormat = "terminal" | "json";

function parseSecretCommandFormat(value: string): SecretCommandFormat {
  const normalized = value.toLowerCase();
  if (normalized === "terminal" || normalized === "json") return normalized;
  throw new Error(`Invalid --format '${value}'. Allowed values: terminal, json`);
}

function formatFinding(finding: FindingInput): string {
  const location = finding.column ? `${finding.file}:${finding.line}:${finding.column}` : `${finding.file}:${finding.line}`;
  return `  [${finding.severity}] ${location} ${truncateText(finding.message)}`;
}

function printTerminalSummary(
  scanPath: string,
  findings: FindingInput[],
  failThreshold: Severity,
  enabledSources: string[],
  options: { limit: number; verbose?: boolean },
): void {
  const summary = {
    critical: findings.filter((finding) => finding.severity === Severity.Critical).length,
    high: findings.filter((finding) => finding.severity === Severity.High).length,
    medium: findings.filter((finding) => finding.severity === Severity.Medium).length,
    low: findings.filter((finding) => finding.severity === Severity.Low).length,
    info: findings.filter((finding) => finding.severity === Severity.Info).length,
  };

  console.log(chalk.bold("\n  Secret Exposure Scan\n"));
  console.log(chalk.gray(`  Path: ${scanPath}`));
  console.log(chalk.gray(`  Sources: ${enabledSources.join(", ")}`));
  console.log(chalk.gray(`  Fail threshold: ${failThreshold}\n`));

  if (findings.length === 0) {
    console.log(chalk.green("  No secret exposure findings detected.\n"));
    return;
  }

  console.log(
    chalk.red(
      `  Found ${findings.length} finding(s): critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, info=${summary.info}\n`,
    ),
  );

  const visible = options.verbose ? findings : findings.slice(0, options.limit);
  const hidden = findings.length - visible.length;

  for (const finding of visible) {
    const color =
      finding.severity === Severity.Critical ? chalk.red :
        finding.severity === Severity.High ? chalk.magenta :
          finding.severity === Severity.Medium ? chalk.yellow :
            finding.severity === Severity.Low ? chalk.blue :
              chalk.gray;

    console.log(color(formatFinding(finding)));
    if (options.verbose && finding.code_snippet) {
      console.log(chalk.gray(`      ${finding.code_snippet.trim()}`));
    }
  }
  if (hidden > 0) {
    console.log(chalk.gray(`\n  ${hidden} more finding(s) hidden. Use --verbose or --limit ${findings.length} for details.`));
  } else if (!options.verbose) {
    console.log(chalk.gray("\n  Use --verbose to include snippets."));
  }
  console.log();
}

export function registerSecretsCommand(program: Command): void {
  program
    .command("secrets")
    .description("Scan repo files, git history, running processes, and tmux panes for exposed secrets")
    .argument("[path]", "Path to scan", ".")
    .option("--format <format>", "Output format (terminal/json)", "terminal")
    .option("-j, --json", "Shortcut for --format json")
    .option("--severity <level>", "Minimum severity threshold to display", "info")
    .option("--fail-on <level>", "Exit non-zero when findings meet or exceed this severity", "high")
    .option("--limit <n>", `Max findings to show in terminal output (default ${DEFAULT_COMPACT_LIMIT})`)
    .option("--verbose", "Show full terminal finding details, including snippets")
    .option("--no-git-history", "Skip git history scanning")
    .option("--no-processes", "Skip running process environment scanning")
    .option("--no-tmux", "Skip tmux metadata/history scanning")
    .option("--repo-only", "Only scan repository files and git history")
    .action(async (pathArg: string, options) => {
      const scanPath = resolve(pathArg);
      if (!existsSync(scanPath)) {
        console.error(chalk.red(`\n  Path does not exist: ${scanPath}\n`));
        process.exit(1);
      }

      try {
        const format = options.json ? "json" : parseSecretCommandFormat(options.format);
        const severityThreshold = parseSeverity(options.severity);
        const failThreshold = parseSeverity(options.failOn);
        const displayLimit = parseLimitOption(options.limit, "--limit", DEFAULT_COMPACT_LIMIT);
        const includeProcesses = options.repoOnly ? false : options.processes;
        const includeTmux = options.repoOnly ? false : options.tmux;

        const result = await scanSecretExposure({
          path: scanPath,
          include_git_history: options.gitHistory,
          include_processes: includeProcesses,
          include_tmux: includeTmux,
        });

        const filtered = filterSecretExposureBySeverity(result.findings, severityThreshold);
        const enabledSources = [
          "files",
          options.gitHistory ? "git-history" : null,
          includeProcesses ? "processes" : null,
          includeTmux ? "tmux" : null,
        ].filter(Boolean) as string[];

        if (format === "json") {
          const jsonFindings = options.limit === undefined ? filtered : filtered.slice(0, displayLimit);
          console.log(JSON.stringify({
            path: result.path,
            enabled_sources: enabledSources,
            severity_threshold: severityThreshold,
            fail_on: failThreshold,
            summary: summarizeSecretExposure(filtered),
            findings: jsonFindings,
            count: filtered.length,
            shown: jsonFindings.length,
          }, null, 2));
        } else {
          printTerminalSummary(result.path, filtered, failThreshold, enabledSources, {
            limit: displayLimit,
            verbose: Boolean(options.verbose),
          });
        }

        const failOrder = SEVERITY_ORDER[failThreshold];
        if (result.findings.some((finding) => SEVERITY_ORDER[finding.severity] <= failOrder)) {
          process.exit(1);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  Secret exposure scan failed: ${errMsg}\n`));
        process.exit(1);
      }
    });
}
