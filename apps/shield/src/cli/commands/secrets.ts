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

type SecretCommandFormat = "terminal" | "json";

export interface SecretExposureSourceFlags {
  filesOnly?: boolean;
  repoOnly?: boolean;
  gitHistory?: boolean;
  processes?: boolean;
  tmux?: boolean;
}

export function resolveSecretExposureSources(options: SecretExposureSourceFlags): {
  include_git_history: boolean;
  include_processes: boolean;
  include_tmux: boolean;
} {
  const filesOnly = options.filesOnly === true;
  const liveSourcesAllowed = !filesOnly && options.repoOnly !== true;

  return {
    include_git_history: !filesOnly && options.gitHistory === true,
    include_processes: liveSourcesAllowed && options.processes === true,
    include_tmux: liveSourcesAllowed && options.tmux === true,
  };
}

function parseSecretCommandFormat(value: string): SecretCommandFormat {
  const normalized = value.toLowerCase();
  if (normalized === "terminal" || normalized === "json") return normalized;
  throw new Error(`Invalid --format '${value}'. Allowed values: terminal, json`);
}

function formatFinding(finding: FindingInput): string {
  const location = finding.column ? `${finding.file}:${finding.line}:${finding.column}` : `${finding.file}:${finding.line}`;
  return `  [${finding.severity}] ${location} ${finding.message}`;
}

function redactFinding(finding: FindingInput): FindingInput {
  return {
    rule_id: finding.rule_id,
    scanner_type: finding.scanner_type,
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    end_line: finding.end_line,
    message: finding.message.replace(/: [A-Za-z0-9+/=_-]{8,}\.\.\./g, " redacted."),
  };
}

function printTerminalSummary(
  scanPath: string,
  findings: FindingInput[],
  failThreshold: Severity,
  enabledSources: string[],
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

  for (const finding of findings) {
    const color =
      finding.severity === Severity.Critical ? chalk.red :
        finding.severity === Severity.High ? chalk.magenta :
          finding.severity === Severity.Medium ? chalk.yellow :
            finding.severity === Severity.Low ? chalk.blue :
              chalk.gray;

    console.log(color(formatFinding(finding)));
  }
  console.log();
}

export function registerSecretsCommand(program: Command): void {
  program
    .command("secrets")
    .description("Scan repository files for exposed secrets; ambient and historical sources require explicit opt-in")
    .argument("[path]", "Path to scan", ".")
    .option("--format <format>", "Output format (terminal/json)", "terminal")
    .option("-j, --json", "Shortcut for --format json")
    .option("--severity <level>", "Minimum severity threshold to display", "info")
    .option("--fail-on <level>", "Exit non-zero when findings meet or exceed this severity", "high")
    .option("--git-history", "Also scan git history (explicit opt-in)", false)
    .option("--processes", "Also inspect running process command/environment snapshots (sensitive explicit opt-in)", false)
    .option("--tmux", "Also inspect tmux metadata/history (sensitive explicit opt-in)", false)
    .option("--no-git-history", "Compatibility flag; git history is disabled by default")
    .option("--no-processes", "Compatibility flag; process inspection is disabled by default")
    .option("--no-tmux", "Compatibility flag; tmux inspection is disabled by default")
    .option("--files-only", "Force file-only scanning even when ambient-source flags are present")
    .option("--repo-only", "Disable live process and tmux sources; git history still requires --git-history")
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
        const sources = resolveSecretExposureSources(options);

        const result = await scanSecretExposure({
          path: scanPath,
          ...sources,
        });

        const filtered = filterSecretExposureBySeverity(result.findings, severityThreshold).map(redactFinding);
        const enabledSources = [
          "files",
          sources.include_git_history ? "git-history" : null,
          sources.include_processes ? "processes" : null,
          sources.include_tmux ? "tmux" : null,
        ].filter(Boolean) as string[];

        if (format === "json") {
          console.log(JSON.stringify({
            path: result.path,
            enabled_sources: enabledSources,
            severity_threshold: severityThreshold,
            fail_on: failThreshold,
            summary: summarizeSecretExposure(filtered),
            findings: filtered,
          }, null, 2));
        } else {
          printTerminalSummary(result.path, filtered, failThreshold, enabledSources);
        }

        const failOrder = SEVERITY_ORDER[failThreshold];
        if (result.findings.some((finding) => SEVERITY_ORDER[finding.severity] <= failOrder)) {
          process.exit(1);
        }
      } catch {
        console.error(chalk.red("\n  Secret exposure scan failed. Details were withheld to protect scanned source context.\n"));
        process.exit(1);
      }
    });
}
