import {
  listRuns,
  getResultsByRun,
  listScenarios,
  listScanIssues,
  listGoldenAnswers,
  listGoldenCheckResults,
} from "../store/index.js";

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
    criticalIssues: number;
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
  const { projectId, periodStart, periodEnd } = options;

  // ─── Risk Management: runs in period ───────────────────────────────────────
  const allRuns = await listRuns({ projectId, limit: 10000 });
  const runsInPeriod = allRuns.filter(
    (r) => r.startedAt >= periodStart && r.startedAt <= periodEnd,
  );

  const totalRunsInPeriod = runsInPeriod.length;
  const passedRuns = runsInPeriod.filter((r) => r.status === "passed").length;
  const averagePassRate = totalRunsInPeriod > 0 ? passedRuns / totalRunsInPeriod : 1;
  const criticalFailures = runsInPeriod.filter((r) => r.status === "failed").length;

  // ─── Safety Checks: scan issues ───────────────────────────────────────────
  const scanIssues = (await listScanIssues({ projectId })).filter(
    (i) => i.firstSeenAt >= periodStart && i.firstSeenAt <= periodEnd,
  );

  const injectionProbesRun = scanIssues.filter((i) => i.type === "injection").length;
  const injectionVulnsFound = scanIssues.filter(
    (i) => i.type === "injection" && (i.severity === "high" || i.severity === "critical"),
  ).length;
  const piiLeaksDetected = scanIssues.filter((i) => i.type === "pii_leak").length;

  // Golden answer drift events in period
  const goldenAnswers = await listGoldenAnswers({ projectId });
  let goldenAnswerDriftEvents = 0;
  for (const golden of goldenAnswers) {
    const checks = await listGoldenCheckResults(golden.id, { since: periodStart });
    goldenAnswerDriftEvents += checks.filter(
      (c) => c.driftDetected && c.createdAt <= periodEnd,
    ).length;
  }

  // ─── Quality Metrics: eval scenarios and flakiness ────────────────────────
  const evalScenarioIds = new Set(
    (await listScenarios({ projectId }))
      .filter((s) => s.scenarioType === "eval")
      .map((s) => s.id),
  );

  let evalScenariosRun = 0;
  let totalEvalScore = 0;
  const flakyScenarioIds = new Set<string>();

  for (const run of runsInPeriod) {
    const results = await getResultsByRun(run.id);
    for (const result of results) {
      if (result.status === "flaky") flakyScenarioIds.add(result.scenarioId);
      if (!evalScenarioIds.has(result.scenarioId)) continue;
      evalScenariosRun += 1;
      const score = result.metadata?.score;
      totalEvalScore +=
        typeof score === "number" ? score : result.status === "passed" ? 1 : 0;
    }
  }

  const averageEvalScore = evalScenariosRun > 0 ? totalEvalScore / evalScenariosRun : 1;
  const criticalIssues = scanIssues.filter((i) => i.severity === "critical").length;

  return {
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    projectId,

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
      criticalIssues,
      flakyScenarioCount: flakyScenarioIds.size,
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
    `| Critical issues | ${report.qualityMetrics.criticalIssues} |`,
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
