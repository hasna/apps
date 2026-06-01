import { runHealthScan, type HealthScanOptions, type HealthScanSummary } from "./health-scan.js";
import { runSmoke, type SmokeResult } from "./smoke.js";

export type QuickQaScanner = NonNullable<HealthScanOptions["scanners"]>[number];
export type QuickQaSkipTarget = QuickQaScanner | "smoke";
export type QuickQaStatus = "passed" | "warn" | "failed";

export const DEFAULT_QUICK_QA_SCANNERS: QuickQaScanner[] = [
  "console",
  "network",
  "links",
  "performance",
];

const QUICK_QA_SKIP_ALIASES: Record<string, QuickQaSkipTarget> = {
  console: "console",
  network: "network",
  links: "links",
  link: "links",
  perf: "performance",
  performance: "performance",
  injection: "injection",
  pii: "pii",
  a11y: "a11y",
  accessibility: "a11y",
  smoke: "smoke",
};

export interface QuickQaSelection {
  scanners: QuickQaScanner[];
  includeSmoke: boolean;
  skipped: QuickQaSkipTarget[];
}

export interface QuickQaOptions {
  url: string;
  pages?: string[];
  projectId?: string;
  headed?: boolean;
  timeoutMs?: number;
  maxPages?: number;
  scanners?: QuickQaScanner[];
  includeSmoke?: boolean;
  model?: string;
  wcagLevel?: "A" | "AA" | "AAA";
}

export interface QuickQaCheckSummary {
  name: "health" | "smoke";
  status: QuickQaStatus | "skipped";
  issues: number;
  actionableIssues: number;
  detail: string;
}

export interface QuickQaResult {
  url: string;
  status: QuickQaStatus;
  durationMs: number;
  health: HealthScanSummary;
  smoke: SmokeResult | null;
  checks: QuickQaCheckSummary[];
  issueCounts: {
    total: number;
    actionable: number;
    health: number;
    smoke: number;
  };
}

export function normalizeQuickQaWcagLevel(value: unknown): "A" | "AA" | "AAA" {
  if (value === undefined || value === true) return "AA";
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "A" || normalized === "AA" || normalized === "AAA") return normalized;
  throw new Error(`Invalid WCAG level: ${String(value)}. Use A, AA, or AAA.`);
}

export function resolveQuickQaSelection(options: {
  skip?: string[];
  includeA11y?: boolean;
  includeSmoke?: boolean;
  scanners?: QuickQaScanner[];
} = {}): QuickQaSelection {
  const skipped = new Set<QuickQaSkipTarget>();

  for (const raw of options.skip ?? []) {
    const key = raw.trim().toLowerCase();
    const normalized = QUICK_QA_SKIP_ALIASES[key];
    if (!normalized) {
      throw new Error(`Unknown quick-qa check "${raw}". Use console, network, links, perf, smoke, or a11y.`);
    }
    skipped.add(normalized);
  }

  const baseScanners = options.scanners ?? DEFAULT_QUICK_QA_SCANNERS;
  const scanners = baseScanners.filter((scanner) => !skipped.has(scanner));

  if (options.includeA11y && !skipped.has("a11y") && !scanners.includes("a11y")) {
    scanners.push("a11y");
  }

  return {
    scanners,
    includeSmoke: options.includeSmoke !== false && !skipped.has("smoke"),
    skipped: Array.from(skipped),
  };
}

export async function runQuickQa(options: QuickQaOptions): Promise<QuickQaResult> {
  const start = Date.now();
  const health = await runHealthScan({
    url: options.url,
    pages: options.pages,
    projectId: options.projectId,
    headed: options.headed,
    timeoutMs: options.timeoutMs,
    scanners: options.scanners ?? DEFAULT_QUICK_QA_SCANNERS,
    maxPages: options.maxPages,
    wcagLevel: options.wcagLevel,
  });

  const smoke = options.includeSmoke === false
    ? null
    : await runSmoke({
      url: options.url,
      model: options.model,
      headed: options.headed,
      timeout: options.timeoutMs,
      projectId: options.projectId,
    });

  return buildQuickQaResult({
    url: options.url,
    health,
    smoke,
    durationMs: Date.now() - start,
  });
}

export function buildQuickQaResult(input: {
  url: string;
  health: HealthScanSummary;
  smoke: SmokeResult | null;
  durationMs: number;
}): QuickQaResult {
  const healthActionable = input.health.newIssues + input.health.regressedIssues;
  const smokeIssues = input.smoke?.issuesFound.length ?? 0;
  const smokeActionable = input.smoke?.issuesFound.filter((issue) =>
    issue.severity === "critical" || issue.severity === "high"
  ).length ?? 0;
  const smokeStatusFailed = input.smoke ? input.smoke.result.status !== "passed" : false;
  const smokeFailureCount = smokeStatusFailed && smokeActionable === 0 ? 1 : 0;

  const actionable = healthActionable + smokeActionable + smokeFailureCount;
  const total = input.health.totalIssues + smokeIssues;
  const status: QuickQaStatus = actionable > 0
    ? "failed"
    : total > 0
      ? "warn"
      : "passed";

  const checks: QuickQaCheckSummary[] = [
    {
      name: "health",
      status: healthActionable > 0 ? "failed" : input.health.totalIssues > 0 ? "warn" : "passed",
      issues: input.health.totalIssues,
      actionableIssues: healthActionable,
      detail: `${input.health.newIssues} new, ${input.health.regressedIssues} regressed, ${input.health.existingIssues} known`,
    },
  ];

  if (input.smoke) {
    checks.push({
      name: "smoke",
      status: smokeStatusFailed || smokeActionable > 0 ? "failed" : smokeIssues > 0 ? "warn" : "passed",
      issues: smokeIssues,
      actionableIssues: smokeActionable + smokeFailureCount,
      detail: `${input.smoke.pagesVisited} pages visited, scenario ${input.smoke.result.status}`,
    });
  } else {
    checks.push({
      name: "smoke",
      status: "skipped",
      issues: 0,
      actionableIssues: 0,
      detail: "disabled for this run",
    });
  }

  return {
    url: input.url,
    status,
    durationMs: input.durationMs,
    health: input.health,
    smoke: input.smoke,
    checks,
    issueCounts: {
      total,
      actionable,
      health: input.health.totalIssues,
      smoke: smokeIssues,
    },
  };
}

export function getQuickQaExitCode(result: QuickQaResult): number {
  return result.status === "failed" ? 1 : 0;
}

export function formatQuickQaReport(result: QuickQaResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`\x1b[1m  Quick QA Report \x1b[2m- ${result.url}\x1b[0m`);
  lines.push(`  ${"-".repeat(60)}`);
  lines.push("");
  lines.push(`  Status:          ${formatStatus(result.status)}`);
  lines.push(`  Total issues:    \x1b[1m${result.issueCounts.total}\x1b[0m`);
  lines.push(`  Actionable:      ${result.issueCounts.actionable > 0 ? `\x1b[31m${result.issueCounts.actionable}\x1b[0m` : "\x1b[32m0\x1b[0m"}`);
  lines.push(`  Duration:        ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`  ${check.name.padEnd(8)} ${formatStatus(check.status)}  ${check.detail}`);
  }

  const healthIssues = result.health.results.flatMap((scan) => scan.issues);
  if (healthIssues.length > 0) {
    lines.push("");
    lines.push("\x1b[1m  Health scan issues\x1b[0m");
    for (const issue of healthIssues.slice(0, 12)) {
      lines.push(`    - ${issue.severity.toUpperCase()} ${issue.message}`);
      lines.push(`      \x1b[2m${issue.pageUrl}\x1b[0m`);
    }
    if (healthIssues.length > 12) {
      lines.push(`    - ${healthIssues.length - 12} more issue(s) omitted`);
    }
  }

  if (result.smoke?.issuesFound.length) {
    lines.push("");
    lines.push("\x1b[1m  Smoke issues\x1b[0m");
    for (const issue of result.smoke.issuesFound.slice(0, 12)) {
      const suffix = issue.url ? ` \x1b[2m(${issue.url})\x1b[0m` : "";
      lines.push(`    - ${issue.severity.toUpperCase()} ${issue.description}${suffix}`);
    }
    if (result.smoke.issuesFound.length > 12) {
      lines.push(`    - ${result.smoke.issuesFound.length - 12} more issue(s) omitted`);
    }
  }

  lines.push("");
  lines.push(`  ${"-".repeat(60)}`);
  lines.push(`  Verdict: ${formatStatus(result.status)}`);
  lines.push("");
  return lines.join("\n");
}

function formatStatus(status: QuickQaStatus | "skipped"): string {
  if (status === "passed") return "\x1b[32m\x1b[1mPASS\x1b[0m";
  if (status === "warn") return "\x1b[33m\x1b[1mWARN\x1b[0m";
  if (status === "failed") return "\x1b[31m\x1b[1mFAIL\x1b[0m";
  return "\x1b[2mSKIPPED\x1b[0m";
}
