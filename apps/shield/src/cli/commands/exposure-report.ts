import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { Command } from "commander";
import {
  sanitizeLocationForOutput,
  sanitizeTextForBoundary,
  sanitizeValueForBoundary,
} from "../../lib/finding-safety.js";
import { scanSecretExposure } from "../../lib/secret-exposure.js";
import { ScannerType, type FindingInput } from "../../types/index.js";

export type ExposureSourceStatus = "available" | "unavailable" | "not-requested";

export interface ExposureReportFinding {
  kind: string;
  location: {
    source: "filesystem" | "git-history" | "github-alerts";
    path: string;
    line: number;
  };
  maskedExcerpt: string;
}

export interface ExposureReport {
  schemaVersion: 1;
  report: "shield-exposure-report";
  sources: {
    filesystem: ExposureSourceStatus;
    gitHistory: ExposureSourceStatus;
    githubAlerts: ExposureSourceStatus;
  };
  summary: {
    total: number;
    filesystem: number;
    gitHistory: number;
    githubAlerts: number;
  };
  findings: ExposureReportFinding[];
}

export interface ExposureReportOptions {
  workspace: string;
  history?: boolean;
  githubAlerts?: boolean;
}

export interface ReportWriters {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

const defaultWriters: ReportWriters = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function hasGitHistory(workspace: string): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspace,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
  }
}

function findingPath(workspace: string, finding: FindingInput): string {
  const path = isAbsolute(finding.file) ? relative(workspace, finding.file) : finding.file;
  const normalized = path.replaceAll("\\", "/") || ".";
  return sanitizeLocationForOutput(normalized.startsWith("../") ? "[OUTSIDE-WORKSPACE]" : normalized);
}

function toReportFinding(workspace: string, finding: FindingInput): ExposureReportFinding {
  const source = finding.scanner_type === ScannerType.GitHistory ? "git-history" : "filesystem";
  const kind = sanitizeTextForBoundary(finding.rule_id.replace(/^git-/, ""), 128);
  return {
    kind,
    location: {
      source,
      path: findingPath(workspace, finding),
      line: Math.max(1, finding.line),
    },
    maskedExcerpt: `[MASKED ${kind}]`,
  };
}

function compareFindings(left: ExposureReportFinding, right: ExposureReportFinding): number {
  return left.location.source.localeCompare(right.location.source)
    || left.location.path.localeCompare(right.location.path)
    || left.location.line - right.location.line
    || left.kind.localeCompare(right.kind);
}

export async function buildExposureReport(options: ExposureReportOptions): Promise<ExposureReport> {
  const workspace = resolve(options.workspace);
  const historyAvailable = options.history === true && hasGitHistory(workspace);
  const exposure = await scanSecretExposure({
    path: workspace,
    include_git_history: historyAvailable,
    include_processes: false,
    include_tmux: false,
  });
  const findings = exposure.findings.map((finding) => toReportFinding(workspace, finding)).sort(compareFindings);
  const filesystem = findings.filter((finding) => finding.location.source === "filesystem").length;
  const gitHistory = findings.filter((finding) => finding.location.source === "git-history").length;

  return sanitizeValueForBoundary({
    schemaVersion: 1,
    report: "shield-exposure-report",
    sources: {
      filesystem: "available",
      gitHistory: options.history === true
        ? historyAvailable ? "available" : "unavailable"
        : "not-requested",
      githubAlerts: options.githubAlerts === true ? "unavailable" : "not-requested",
    },
    summary: {
      total: findings.length,
      filesystem,
      gitHistory,
      githubAlerts: 0,
    },
    findings,
  } satisfies ExposureReport);
}

export function formatExposureReportJson(report: ExposureReport): string {
  return `${JSON.stringify(sanitizeValueForBoundary(report), null, 2)}\n`;
}

function markdownCell(value: string | number): string {
  return sanitizeTextForBoundary(String(value), 512).replaceAll("|", "\\|");
}

export function formatExposureReportMarkdown(report: ExposureReport): string {
  const safe = sanitizeValueForBoundary(report);
  const lines = [
    "# Shield Exposure Report",
    "",
    "## Sources",
    "",
    "| Source | Status |",
    "| --- | --- |",
    `| Filesystem | ${safe.sources.filesystem} |`,
    `| Git history | ${safe.sources.gitHistory} |`,
    `| GitHub alerts | ${safe.sources.githubAlerts} |`,
    "",
    `Findings: ${safe.summary.total}`,
    "",
    "| Kind | Source | Location | Masked excerpt |",
    "| --- | --- | --- | --- |",
    ...safe.findings.map((finding) =>
      `| ${markdownCell(finding.kind)} | ${finding.location.source} | ${markdownCell(`${finding.location.path}:${finding.location.line}`)} | ${markdownCell(finding.maskedExcerpt)} |`),
    "",
  ];
  return lines.join("\n");
}

export function registerExposureReportCommand(
  program: Command,
  writers: ReportWriters = defaultWriters,
): void {
  program
    .command("exposure-report")
    .description("Produce a deterministic, redacted secret exposure triage report")
    .requiredOption("--workspace <path>", "Workspace to scan")
    .option("--history", "Include repository git history", false)
    .option("--github-alerts", "Include GitHub alerts when available", false)
    .option("--redact", "Mask all finding excerpts (always enforced)", false)
    .option("--json", "Output JSON", false)
    .option("--markdown", "Output Markdown", false)
    .action(async (options: {
      workspace: string;
      history: boolean;
      githubAlerts: boolean;
      redact: boolean;
      json: boolean;
      markdown: boolean;
    }) => {
      try {
        const report = await buildExposureReport(options);
        writers.stdout(options.markdown
          ? formatExposureReportMarkdown(report)
          : formatExposureReportJson(report));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writers.stderr(`${sanitizeTextForBoundary(message)}\n`);
        process.exitCode = 1;
      }
    });
}
