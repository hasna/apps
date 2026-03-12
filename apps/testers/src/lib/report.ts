import { readFileSync, existsSync } from "fs";
import { getRun, listRuns } from "../db/runs.js";
import { getResultsByRun } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { getScenario } from "../db/scenarios.js";
import type { Result, Screenshot } from "../types/index.js";

export function imageToBase64(filePath: string): string {
  if (!filePath || !existsSync(filePath)) return "";
  try {
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch {
    return "";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function formatCost(cents: number): string {
  if (cents < 1) return `$${(cents / 100).toFixed(4)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    passed: { bg: "#22c55e", text: "#000" },
    failed: { bg: "#ef4444", text: "#fff" },
    error: { bg: "#eab308", text: "#000" },
    skipped: { bg: "#6b7280", text: "#fff" },
  };
  const c = colors[status] ?? { bg: "#6b7280", text: "#fff" };
  const label = status.toUpperCase();
  return `<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:700;background:${c.bg};color:${c.text};letter-spacing:0.5px;">${label}</span>`;
}

function renderScreenshots(screenshots: Screenshot[]): string {
  if (screenshots.length === 0) return "";

  let html = `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;">`;

  for (let i = 0; i < screenshots.length; i++) {
    const ss = screenshots[i]!;
    const dataUri = imageToBase64(ss.filePath);
    const checkId = `ss-${ss.id}`;

    if (dataUri) {
      html += `
        <div style="flex:0 0 auto;">
          <input type="checkbox" id="${checkId}" style="display:none;" />
          <label for="${checkId}" style="cursor:pointer;">
            <img src="${dataUri}" alt="Step ${ss.stepNumber}: ${escapeHtml(ss.action)}"
              style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid #262626;display:block;" />
          </label>
          <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:1000;display:none;align-items:center;justify-content:center;">
            <label for="${checkId}" style="position:absolute;top:0;left:0;width:100%;height:100%;cursor:pointer;"></label>
            <img src="${dataUri}" alt="Step ${ss.stepNumber}: ${escapeHtml(ss.action)}"
              style="max-width:600px;max-height:90vh;border-radius:8px;position:relative;z-index:1001;" />
          </div>
          <div style="font-size:11px;color:#888;margin-top:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${ss.stepNumber}. ${escapeHtml(ss.action)}
          </div>
        </div>`;
    } else {
      html += `
        <div style="flex:0 0 auto;width:200px;height:150px;background:#1a1a1a;border:1px dashed #333;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#555;font-size:12px;">
          Screenshot not found
          <div style="font-size:11px;color:#888;margin-top:4px;">${ss.stepNumber}. ${escapeHtml(ss.action)}</div>
        </div>`;
    }
  }

  html += `</div>`;
  return html;
}

export function generateHtmlReport(runId: string): string {
  const run = getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const results = getResultsByRun(run.id);

  // Gather screenshots and scenario names per result
  const resultData: Array<{
    result: Result;
    scenarioName: string;
    scenarioShortId: string;
    screenshots: Screenshot[];
  }> = [];

  for (const result of results) {
    const screenshots = listScreenshots(result.id);
    const scenario = getScenario(result.scenarioId);
    resultData.push({
      result,
      scenarioName: scenario?.name ?? "Unknown Scenario",
      scenarioShortId: scenario?.shortId ?? result.scenarioId.slice(0, 8),
      screenshots,
    });
  }

  // Totals
  const passedCount = results.filter((r) => r.status === "passed").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const totalCount = results.length;
  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  const totalCostCents = results.reduce((sum, r) => sum + r.costCents, 0);
  const totalDurationMs = run.finishedAt && run.startedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : results.reduce((sum, r) => sum + r.durationMs, 0);

  const generatedAt = new Date().toISOString();

  // Build result cards
  let resultCards = "";
  for (const { result, scenarioName, scenarioShortId, screenshots } of resultData) {
    resultCards += `
      <div style="background:#141414;border:1px solid #262626;border-radius:8px;padding:20px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          ${statusBadge(result.status)}
          <span style="font-size:16px;font-weight:600;color:#e5e5e5;">${escapeHtml(scenarioName)}</span>
          <span style="font-size:12px;color:#666;font-family:monospace;">${escapeHtml(scenarioShortId)}</span>
        </div>

        ${result.reasoning ? `<div style="color:#a3a3a3;font-size:14px;line-height:1.6;margin-bottom:12px;padding:12px;background:#0d0d0d;border-radius:6px;border-left:3px solid #333;">${escapeHtml(result.reasoning)}</div>` : ""}

        ${result.error ? `<div style="color:#ef4444;font-size:13px;margin-bottom:12px;padding:12px;background:#1a0a0a;border-radius:6px;border-left:3px solid #ef4444;font-family:monospace;">${escapeHtml(result.error)}</div>` : ""}

        <div style="display:flex;gap:24px;font-size:13px;color:#888;">
          <span>Duration: <span style="color:#d4d4d4;">${formatDuration(result.durationMs)}</span></span>
          <span>Steps: <span style="color:#d4d4d4;">${result.stepsCompleted}/${result.stepsTotal}</span></span>
          <span>Tokens: <span style="color:#d4d4d4;">${result.tokensUsed.toLocaleString()}</span></span>
          <span>Cost: <span style="color:#d4d4d4;">${formatCost(result.costCents)}</span></span>
          <span>Model: <span style="color:#d4d4d4;">${escapeHtml(result.model)}</span></span>
        </div>

        ${renderScreenshots(screenshots)}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Test Report - ${escapeHtml(run.id.slice(0, 8))}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e5e5e5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px; }
    .container { max-width: 960px; margin: 0 auto; }
    input[type="checkbox"]:checked ~ div:last-of-type { display: flex !important; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div style="margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:700;margin-bottom:8px;color:#fff;">Test Report</h1>
      <div style="display:flex;flex-wrap:wrap;gap:24px;font-size:14px;color:#888;">
        <span>Run: <span style="color:#d4d4d4;font-family:monospace;">${escapeHtml(run.id.slice(0, 8))}</span></span>
        <span>URL: <a href="${escapeHtml(run.url)}" style="color:#60a5fa;text-decoration:none;">${escapeHtml(run.url)}</a></span>
        <span>Model: <span style="color:#d4d4d4;">${escapeHtml(run.model)}</span></span>
        <span>Date: <span style="color:#d4d4d4;">${escapeHtml(run.startedAt)}</span></span>
        <span>Duration: <span style="color:#d4d4d4;">${formatDuration(totalDurationMs)}</span></span>
        <span>Status: ${statusBadge(run.status)}</span>
      </div>
    </div>

    <!-- Summary Bar -->
    <div style="display:flex;gap:16px;margin-bottom:32px;">
      <div style="flex:1;background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#e5e5e5;">${totalCount}</div>
        <div style="font-size:12px;color:#888;margin-top:4px;">TOTAL</div>
      </div>
      <div style="flex:1;background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#22c55e;">${passedCount}</div>
        <div style="font-size:12px;color:#888;margin-top:4px;">PASSED</div>
      </div>
      <div style="flex:1;background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#ef4444;">${failedCount}</div>
        <div style="font-size:12px;color:#888;margin-top:4px;">FAILED</div>
      </div>
      ${errorCount > 0 ? `
      <div style="flex:1;background:#141414;border:1px solid #262626;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#eab308;">${errorCount}</div>
        <div style="font-size:12px;color:#888;margin-top:4px;">ERRORS</div>
      </div>` : ""}
    </div>

    <!-- Results -->
    ${resultCards}

    <!-- Footer -->
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #262626;display:flex;justify-content:space-between;font-size:13px;color:#666;">
      <div>
        Total tokens: ${totalTokens.toLocaleString()} | Total cost: ${formatCost(totalCostCents)}
      </div>
      <div>
        Generated: ${escapeHtml(generatedAt)}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function generateLatestReport(): string {
  const runs = listRuns({ limit: 1 });
  if (runs.length === 0) throw new Error("No runs found");
  return generateHtmlReport(runs[0]!.id);
}
