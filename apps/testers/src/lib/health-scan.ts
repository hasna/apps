import { scanConsoleErrors } from "./scanners/console.js";
import { scanNetworkErrors } from "./scanners/network.js";
import { scanBrokenLinks } from "./scanners/links.js";
import { scanPerformance } from "./scanners/performance.js";
import { scanInjection } from "./scanners/injection.js";
import { scanPiiEndpoint } from "./scanners/pii-scanner.js";
import { scanA11y } from "./scanners/a11y.js";
import { upsertScanIssue, setScanIssueTodoTaskId } from "../db/scan-issues.js";
import {
  reportTesterIssueReportsToTodos,
  TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
  type TesterIssueKind,
  type TesterIssueReportV1,
} from "./todos-connector.js";
import type { ScanResult, ScanIssue } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthScanOptions {
  url: string;
  pages?: string[];
  projectId?: string;
  headed?: boolean;
  timeoutMs?: number;
  scanners?: ("console" | "network" | "links" | "performance" | "injection" | "pii" | "a11y")[];
  wcagLevel?: "A" | "AA" | "AAA";
  injectionEndpoint?: string;
  injectionInputField?: string;
  maxPages?: number;
  // PII scanner options
  piiEndpoint?: string;
  piiSeedPii?: string[];
  piiInputField?: string;
}

export interface HealthScanSummary {
  url: string;
  scannedAt: string;
  durationMs: number;
  totalIssues: number;
  newIssues: number;
  regressedIssues: number;
  existingIssues: number;
  results: ScanResult[];
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runHealthScan(options: HealthScanOptions): Promise<HealthScanSummary> {
  const {
    url,
    pages,
    projectId,
    headed = false,
    timeoutMs = 15000,
    scanners = ["console", "network", "links"],
    maxPages = 20,
  } = options;

  const start = Date.now();
  const results: ScanResult[] = [];

  if (scanners.includes("console")) {
    results.push(await scanConsoleErrors({ url, pages, headed, timeoutMs }));
  }
  if (scanners.includes("network")) {
    results.push(await scanNetworkErrors({ url, pages, headed, timeoutMs }));
  }
  if (scanners.includes("links")) {
    results.push(await scanBrokenLinks({ url, maxPages, headed, timeoutMs }));
  }
  if (scanners.includes("performance")) {
    results.push(await scanPerformance({ url, pages, headed, timeoutMs }));
  }
  if (scanners.includes("injection")) {
    const injResult = await scanInjection({
      url,
      endpoint: options.injectionEndpoint,
      inputField: options.injectionInputField,
      headed,
      timeoutMs,
    });
    results.push(injResult);
  }
  if (scanners.includes("pii")) {
    const piiResult = await scanPiiEndpoint({
      url,
      endpoint: options.piiEndpoint,
      inputField: options.piiInputField,
      seedPii: options.piiSeedPii,
      timeoutMs,
    });
    results.push(piiResult);
  }
  if (scanners.includes("a11y")) {
    const a11yResult = await scanA11y({
      url,
      pages,
      wcagLevel: options.wcagLevel ?? "AA",
      headed,
      timeoutMs,
    });
    results.push(a11yResult);
  }

  // Deduplicate and persist all issues
  const allIssues = results.flatMap((r) => r.issues);
  let newCount = 0;
  let regressedCount = 0;
  let existingCount = 0;

  const newAndRegressed: Array<{ issue: ScanIssue; persistedId: string; fingerprint: string }> = [];

  for (const issue of allIssues) {
    const { issue: persisted, outcome } = upsertScanIssue(issue, projectId);
    if (outcome === "new") { newCount++; newAndRegressed.push({ issue, persistedId: persisted.id, fingerprint: persisted.fingerprint }); }
    else if (outcome === "regressed") { regressedCount++; newAndRegressed.push({ issue, persistedId: persisted.id, fingerprint: persisted.fingerprint }); }
    else existingCount++;
  }

  // Auto-create todo tasks for new/regressed issues
  await createTodoTasksForIssues(newAndRegressed, url, projectId);

  // Post to conversations space
  await notifyHealthScan(url, { new: newCount, regressed: regressedCount, existing: existingCount, total: allIssues.length });

  return {
    url,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    totalIssues: allIssues.length,
    newIssues: newCount,
    regressedIssues: regressedCount,
    existingIssues: existingCount,
    results,
  };
}

// ─── Todo task creation ───────────────────────────────────────────────────────

async function createTodoTasksForIssues(
  items: Array<{ issue: ScanIssue; persistedId: string; fingerprint: string }>,
  url: string,
  projectId?: string,
): Promise<void> {
  const todosProjectId = process.env["TESTERS_TODOS_PROJECT_ID"];
  if (!todosProjectId || items.length === 0) return;

  const reports = items.map(({ issue, persistedId, fingerprint }) => scanIssueToTesterIssueReport(issue, persistedId, fingerprint, url, projectId));
  const result = reportTesterIssueReportsToTodos({
    reports,
    projectId: todosProjectId,
    defaultPriority: "medium",
    apply: true,
  });

  for (const item of result.items) {
    const persistedId = typeof item.report?.metadata?.["scan_issue_id"] === "string"
      ? item.report.metadata["scan_issue_id"]
      : null;
    if (persistedId && item.task?.id) {
      setScanIssueTodoTaskId(persistedId, item.task.id);
    }
  }
}

function scanKind(issueType: string): TesterIssueKind {
  if (issueType.includes("console")) return "console_error";
  if (issueType.includes("network")) return "network_error";
  if (issueType.includes("link")) return "broken_link";
  if (issueType.includes("a11y") || issueType.includes("accessibility")) return "accessibility";
  if (issueType.includes("performance")) return "performance";
  if (issueType.includes("injection") || issueType.includes("pii")) return "security";
  return "unknown";
}

function scanIssueToTesterIssueReport(
  issue: ScanIssue,
  persistedId: string,
  fingerprint: string,
  url: string,
  projectId?: string,
): TesterIssueReportV1 {
  return {
    schema_version: TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
    fingerprint: `scan:${fingerprint}`,
    title: `[scan] ${issue.type.replace(/_/g, " ")}: ${issue.message.slice(0, 100)}`,
    summary: `Health scan detected a ${issue.type.replace(/_/g, " ")} issue.`,
    kind: scanKind(issue.type),
    severity: issue.severity,
    source: {
      tool: "testers",
      project_id: projectId,
      url,
      page_url: issue.pageUrl,
    },
    target: { url: issue.pageUrl },
    failure: {
      message: issue.message,
      reasoning: issue.detail ? JSON.stringify(issue.detail).slice(0, 1500) : undefined,
    },
    labels: ["scan", issue.type, "auto-created"],
    metadata: {
      scan_issue_id: persistedId,
      scan_issue_type: issue.type,
    },
    occurred_at: new Date().toISOString(),
  };
}

// ─── Conversations notification ───────────────────────────────────────────────

async function notifyHealthScan(
  url: string,
  counts: { new: number; regressed: number; existing: number; total: number },
): Promise<void> {
  const baseUrl = process.env["TESTERS_CONVERSATIONS_URL"];
  const space = process.env["TESTERS_CONVERSATIONS_SPACE"];
  if (!baseUrl || !space) return;
  if (counts.new === 0 && counts.regressed === 0) return; // nothing to report

  const icon = counts.new + counts.regressed > 0 ? "🚨" : "✅";
  const message = [
    `${icon} **Health scan** — ${url}`,
    ``,
    `**New issues:** ${counts.new}`,
    `**Regressed:** ${counts.regressed}`,
    `**Known (skipped):** ${counts.existing}`,
    `**Total found:** ${counts.total}`,
  ].join("\n");

  try {
    await fetch(`${baseUrl.replace(/\/$/, "")}/api/spaces/${encodeURIComponent(space)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, from: "testers-health-scan" }),
    });
  } catch { /* never throw */ }
}
