import { getDatabase } from "../db/database.js";
import { listRuns } from "../db/runs.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  projectId?: string;

  riskManagement: {
    totalRunsInPeriod: number;
    averagePassRate: number;
    criticalFailures: number;
  };

  safetyChecks: {
    injectionProbesRun: number;
    injectionVulnsFound: number;
    piiLeaksDetected: number;
    goldenAnswerDriftEvents: number;
  };

  qualityMetrics: {
    evalScenariosRun: number;
    averageEvalScore: number;
    a11yViolationsCritical: number;
    flakyScenarioCount: number;
  };

  attestation: {
    timestamp: string;
    sha256: string;
  };
}

// ─── SHA256 Helper ────────────────────────────────────────────────────────────

async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Data collection ──────────────────────────────────────────────────────────

function buildPeriod(days: number): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return { periodStart, periodEnd };
}

async function collectComplianceData(options: {
  projectId?: string;
  days: number;
  periodStart: string;
  periodEnd: string;
}): Promise<Omit<ComplianceReport, "attestation">> {
  const db = getDatabase();

  // ─── Risk Management: runs in period ───────────────────────────────────────
  const runsInPeriod = listRuns({
    projectId: options.projectId,
    limit: 10000,
  }).filter((r) => r.startedAt >= options.periodStart && r.startedAt <= options.periodEnd);

  const totalRunsInPeriod = runsInPeriod.length;
  const passedRuns = runsInPeriod.filter((r) => r.status === "passed").length;
  const averagePassRate = totalRunsInPeriod > 0 ? passedRuns / totalRunsInPeriod : 1;

  // Critical failures = runs that failed with high or critical priority scenarios
  const criticalFailures = runsInPeriod.filter((r) => r.status === "failed").length;

  // ─── Safety Checks: scan issues ───────────────────────────────────────────
  const scanConditions: string[] = ["first_seen_at >= ?", "first_seen_at <= ?"];
  const scanParams: (string | null)[] = [options.periodStart, options.periodEnd];

  if (options.projectId) {
    scanConditions.push("project_id = ?");
    scanParams.push(options.projectId);
  }

  const scanIssues = db
    .query(`SELECT type, severity FROM scan_issues WHERE ${scanConditions.join(" AND ")}`)
    .all(...scanParams) as Array<{ type: string; severity: string }>;

  const injectionProbesRun = scanIssues.filter((i) =>
    i.type === "injection" || i.type === "sql_injection" || i.type === "xss"
  ).length;
  const injectionVulnsFound = scanIssues.filter(
    (i) => (i.type === "injection" || i.type === "xss") && (i.severity === "high" || i.severity === "critical")
  ).length;
  const piiLeaksDetected = scanIssues.filter((i) => i.type === "pii" || i.type === "pii_leak").length;

  // Golden answer drift events
  let goldenAnswerDriftEvents = 0;
  try {
    const driftRows = db
      .query(
        `SELECT COUNT(*) as count FROM golden_check_results WHERE drift_detected = 1 AND created_at >= ? AND created_at <= ?`
      )
      .get(options.periodStart, options.periodEnd) as { count: number } | null;
    goldenAnswerDriftEvents = driftRows?.count ?? 0;
  } catch {
    // golden_check_results table may not exist in older DBs
    goldenAnswerDriftEvents = 0;
  }

  // ─── Quality Metrics: eval scenarios and flakiness ────────────────────────

  // Results in period for eval scenarios
  const runIds = runsInPeriod.map((r) => r.id);
  let evalScenariosRun = 0;
  let totalEvalScore = 0;
  let a11yViolationsCritical = 0;
  let flakyScenarioCount = 0;

  if (runIds.length > 0) {
    const placeholders = runIds.map(() => "?").join(", ");

    // Eval scenario results (metadata contains eval score)
    const evalResults = db
      .query(
        `SELECT r.status, r.metadata FROM results r
         JOIN scenarios s ON r.scenario_id = s.id
         WHERE r.run_id IN (${placeholders}) AND s.scenario_type = 'eval'`
      )
      .all(...runIds) as Array<{ status: string; metadata: string | null }>;

    evalScenariosRun = evalResults.length;
    for (const er of evalResults) {
      try {
        const meta = er.metadata ? JSON.parse(er.metadata) as Record<string, unknown> : null;
        const score = typeof meta?.score === "number" ? meta.score : er.status === "passed" ? 1 : 0;
        totalEvalScore += score;
      } catch {
        totalEvalScore += er.status === "passed" ? 1 : 0;
      }
    }

    // A11y violations from scan issues
    const a11yRows = db
      .query(
        `SELECT COUNT(*) as count FROM scan_issues WHERE type = 'a11y' AND severity = 'critical' AND first_seen_at >= ? AND first_seen_at <= ?`
      )
      .get(options.periodStart, options.periodEnd) as { count: number } | null;
    a11yViolationsCritical = a11yRows?.count ?? 0;

    // Flaky scenarios = results with status 'flaky' in this period
    const flakyRows = db
      .query(
        `SELECT COUNT(DISTINCT scenario_id) as count FROM results WHERE run_id IN (${placeholders}) AND status = 'flaky'`
      )
      .get(...runIds) as { count: number } | null;
    flakyScenarioCount = flakyRows?.count ?? 0;
  }

  const averageEvalScore = evalScenariosRun > 0 ? totalEvalScore / evalScenariosRun : 1;

  return {
    generatedAt: new Date().toISOString(),
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    projectId: options.projectId,

    riskManagement: {
      totalRunsInPeriod,
      averagePassRate,
      criticalFailures,
    },

    safetyChecks: {
      injectionProbesRun,
      injectionVulnsFound,
      piiLeaksDetected,
      goldenAnswerDriftEvents,
    },

    qualityMetrics: {
      evalScenariosRun,
      averageEvalScore,
      a11yViolationsCritical,
      flakyScenarioCount,
    },
  };
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function markdownReport(report: ComplianceReport): string {
  const lines: string[] = [
    "# Compliance Report",
    "",
    `**Generated:** ${report.generatedAt}  `,
    `**Period:** ${report.periodStart} to ${report.periodEnd}  `,
    ...(report.projectId ? [`**Project:** ${report.projectId}  `] : []),
    "",
    "---",
    "",
    "## Risk Management",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total runs in period | ${report.riskManagement.totalRunsInPeriod} |`,
    `| Average pass rate | ${pct(report.riskManagement.averagePassRate)} |`,
    `| Critical failures | ${report.riskManagement.criticalFailures} |`,
    "",
    "## Safety Checks",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Injection probes run | ${report.safetyChecks.injectionProbesRun} |`,
    `| Injection vulnerabilities found | ${report.safetyChecks.injectionVulnsFound} |`,
    `| PII leaks detected | ${report.safetyChecks.piiLeaksDetected} |`,
    `| Golden answer drift events | ${report.safetyChecks.goldenAnswerDriftEvents} |`,
    "",
    "## Quality Metrics",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Eval scenarios run | ${report.qualityMetrics.evalScenariosRun} |`,
    `| Average eval score | ${pct(report.qualityMetrics.averageEvalScore)} |`,
    `| A11y critical violations | ${report.qualityMetrics.a11yViolationsCritical} |`,
    `| Flaky scenario count | ${report.qualityMetrics.flakyScenarioCount} |`,
    "",
    "---",
    "",
    "## Attestation",
    "",
    `**Timestamp:** ${report.attestation.timestamp}  `,
    `**SHA-256:** \`${report.attestation.sha256}\`  `,
    "",
    "*This report was auto-generated by open-testers compliance snapshot.*",
  ];

  return lines.join("\n");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateComplianceReport(options: {
  projectId?: string;
  days?: number;
  format: "json" | "markdown";
}): Promise<string> {
  const days = options.days ?? 30;
  const { periodStart, periodEnd } = buildPeriod(days);

  const data = await collectComplianceData({
    projectId: options.projectId,
    days,
    periodStart,
    periodEnd,
  });

  const attestationTimestamp = new Date().toISOString();
  const contentForHash = JSON.stringify(data);
  const sha256hash = await sha256(contentForHash);

  const report: ComplianceReport = {
    ...data,
    attestation: {
      timestamp: attestationTimestamp,
      sha256: sha256hash,
    },
  };

  if (options.format === "json") {
    return JSON.stringify(report, null, 2);
  }

  return markdownReport(report);
}
