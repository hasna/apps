import { scanConsoleErrors } from "./scanners/console.js";
import { scanNetworkErrors } from "./scanners/network.js";
import { scanBrokenLinks } from "./scanners/links.js";
import { scanPerformance } from "./scanners/performance.js";
import { scanInjection } from "./scanners/injection.js";
import { scanPiiEndpoint } from "./scanners/pii-scanner.js";
import { upsertScanIssue, setScanIssueTodoTaskId } from "../db/scan-issues.js";
import { connectToTodos } from "./todos-connector.js";
import type { ScanResult, ScanIssue } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthScanOptions {
  url: string;
  pages?: string[];
  projectId?: string;
  headed?: boolean;
  timeoutMs?: number;
  scanners?: ("console" | "network" | "links" | "performance" | "injection" | "pii")[];
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

  // Deduplicate and persist all issues
  const allIssues = results.flatMap((r) => r.issues);
  let newCount = 0;
  let regressedCount = 0;
  let existingCount = 0;

  const newAndRegressed: Array<{ issue: ScanIssue; persistedId: string }> = [];

  for (const issue of allIssues) {
    const { issue: persisted, outcome } = upsertScanIssue(issue, projectId);
    if (outcome === "new") { newCount++; newAndRegressed.push({ issue, persistedId: persisted.id }); }
    else if (outcome === "regressed") { regressedCount++; newAndRegressed.push({ issue, persistedId: persisted.id }); }
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
  items: Array<{ issue: ScanIssue; persistedId: string }>,
  url: string,
  _projectId?: string,
): Promise<void> {
  const todosProjectId = process.env["TESTERS_TODOS_PROJECT_ID"];
  if (!todosProjectId || items.length === 0) return;

  let db: ReturnType<typeof connectToTodos> | null = null;
  try {
    db = connectToTodos();
  } catch {
    return;
  }

  try {
    for (const { issue, persistedId } of items) {
      const title = `BUG: [scan] ${issue.type.replace(/_/g, " ")}: ${issue.message.slice(0, 80)}`;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const description = [
        `Health scan detected a ${issue.type.replace(/_/g, " ")} issue.`,
        ``,
        `**URL:** ${url}`,
        `**Page:** ${issue.pageUrl}`,
        `**Severity:** ${issue.severity}`,
        `**Message:** ${issue.message}`,
        issue.detail ? `**Detail:**\n\`\`\`json\n${JSON.stringify(issue.detail, null, 2)}\n\`\`\`` : null,
      ].filter(Boolean).join("\n");

      try {
        db.query(`
          INSERT INTO tasks (id, short_id, title, description, status, priority, tags, project_id, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?, ?)
        `).run(
          id, `SCAN-${id.slice(0, 6)}`,
          title, description, issue.severity,
          JSON.stringify(["bug", "scan", issue.type, "auto-created"]),
          todosProjectId, now, now,
        );
        setScanIssueTodoTaskId(persistedId, id);
      } catch { /* skip duplicates */ }
    }
  } finally {
    db.close();
  }
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
