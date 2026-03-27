import type { EvalRun, Verdict } from "../types/index.js";

// ─── Terminal reporter ────────────────────────────────────────────────────────

const PASS  = "\x1b[32m✓ PASS\x1b[0m";
const FAIL  = "\x1b[31m✗ FAIL\x1b[0m";
const UNKNOWN = "\x1b[33m? UNKNOWN\x1b[0m";
const ERROR = "\x1b[31m⚠ ERROR\x1b[0m";

function verdictLabel(v: Verdict, error?: string): string {
  if (error) return ERROR;
  if (v === "PASS") return PASS;
  if (v === "FAIL") return FAIL;
  return UNKNOWN;
}

export function printTerminalReport(run: EvalRun): void {
  const { results, stats } = run;

  console.log(`\n\x1b[1mEval run: ${run.id.slice(0, 8)}\x1b[0m  dataset: ${run.dataset}`);
  console.log(`${"─".repeat(72)}`);

  for (const r of results) {
    const label = verdictLabel(r.verdict, r.error);
    const time  = `${r.durationMs}ms`;
    const cost  = r.costUsd ? ` $${r.costUsd.toFixed(4)}` : "";
    const passK = r.passRate !== undefined ? ` pass^k=${(r.passRate * 100).toFixed(0)}%` : "";
    console.log(`  ${label}  ${r.caseId.padEnd(30)} ${time.padStart(8)}${cost}${passK}`);

    if (r.error) {
      console.log(`         \x1b[31m${r.error}\x1b[0m`);
    } else if (r.verdict !== "PASS") {
      // Show first failed assertion
      const failed = r.assertionResults.find((a) => !a.passed && a.reason !== "Skipped — earlier assertion failed");
      if (failed) console.log(`         assertion: ${failed.reason}`);
      // Show judge reasoning on fail/unknown
      if (r.judgeResult) console.log(`         judge: ${r.judgeResult.reasoning.slice(0, 120)}`);
    }
  }

  console.log(`${"─".repeat(72)}`);
  const pct = (stats.passRate * 100).toFixed(1);
  const color = stats.passRate === 1 ? "\x1b[32m" : stats.passRate >= 0.8 ? "\x1b[33m" : "\x1b[31m";
  console.log(
    `  ${color}${stats.passed}/${stats.total} passed (${pct}%)\x1b[0m` +
    (stats.failed   ? `  \x1b[31m${stats.failed} failed\x1b[0m` : "") +
    (stats.unknown  ? `  \x1b[33m${stats.unknown} unknown\x1b[0m` : "") +
    (stats.errors   ? `  \x1b[31m${stats.errors} errors\x1b[0m` : "") +
    `  ${(stats.totalDurationMs / 1000).toFixed(1)}s` +
    (stats.totalCostUsd ? `  $${stats.totalCostUsd.toFixed(4)}` : "")
  );
  console.log();
}

// ─── JSON reporter ────────────────────────────────────────────────────────────

export function toJson(run: EvalRun): string {
  return JSON.stringify(run, null, 2);
}

// ─── Markdown reporter ────────────────────────────────────────────────────────

export function toMarkdown(run: EvalRun): string {
  const { results, stats } = run;
  const date = new Date(run.createdAt).toISOString().split("T")[0];
  const pct = (stats.passRate * 100).toFixed(1);

  const lines: string[] = [
    `# Eval Report`,
    ``,
    `**Run ID:** \`${run.id.slice(0, 8)}\`  `,
    `**Dataset:** \`${run.dataset}\`  `,
    `**Date:** ${date}  `,
    `**Score:** ${stats.passed}/${stats.total} passed (${pct}%)  `,
    `**Duration:** ${(stats.totalDurationMs / 1000).toFixed(1)}s  `,
    ...(stats.totalCostUsd ? [`**Cost:** $${stats.totalCostUsd.toFixed(4)}  `] : []),
    ``,
    `## Results`,
    ``,
    `| Case | Verdict | Duration | Cost | Notes |`,
    `|------|---------|----------|------|-------|`,
  ];

  for (const r of results) {
    const verdict = r.error ? "⚠ ERROR" : r.verdict === "PASS" ? "✅ PASS" : r.verdict === "FAIL" ? "❌ FAIL" : "❓ UNKNOWN";
    const cost = r.costUsd ? `$${r.costUsd.toFixed(4)}` : "—";
    const passK = r.passRate !== undefined ? ` pass^k=${(r.passRate * 100).toFixed(0)}%` : "";
    const notes = r.error
      ? r.error.slice(0, 60)
      : r.judgeResult?.reasoning?.slice(0, 80) ?? passK ?? "—";
    lines.push(`| \`${r.caseId}\` | ${verdict} | ${r.durationMs}ms | ${cost} | ${notes.replace(/\|/g, "\\|")} |`);
  }

  // Failures section
  const failures = results.filter((r) => r.verdict !== "PASS" || r.error);
  if (failures.length > 0) {
    lines.push(``, `## Failures`, ``);
    for (const r of failures) {
      lines.push(`### \`${r.caseId}\``);
      lines.push(`**Verdict:** ${r.verdict}  `);
      if (r.error) lines.push(`**Error:** ${r.error}  `);
      const failed = r.assertionResults.find((a) => !a.passed && a.reason !== "Skipped — earlier assertion failed");
      if (failed) lines.push(`**Assertion:** ${failed.reason}  `);
      if (r.judgeResult) {
        lines.push(`**Judge reasoning:**`);
        lines.push(`> ${r.judgeResult.reasoning.replace(/\n/g, "\n> ")}`);
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

// ─── Compare two runs ─────────────────────────────────────────────────────────

export interface RunDiff {
  regressions: Array<{ caseId: string; before: Verdict; after: Verdict }>;
  improvements: Array<{ caseId: string; before: Verdict; after: Verdict }>;
  scoreDelta: number;
  passRateDelta: number;
}

export function compareRuns(before: EvalRun, after: EvalRun): RunDiff {
  const beforeMap = new Map(before.results.map((r) => [r.caseId, r]));
  const afterMap  = new Map(after.results.map((r) => [r.caseId, r]));

  const regressions: RunDiff["regressions"] = [];
  const improvements: RunDiff["improvements"] = [];

  for (const [caseId, afterResult] of afterMap) {
    const beforeResult = beforeMap.get(caseId);
    if (!beforeResult) continue;
    if (beforeResult.verdict === "PASS" && afterResult.verdict !== "PASS") {
      regressions.push({ caseId, before: beforeResult.verdict, after: afterResult.verdict });
    } else if (beforeResult.verdict !== "PASS" && afterResult.verdict === "PASS") {
      improvements.push({ caseId, before: beforeResult.verdict, after: afterResult.verdict });
    }
  }

  return {
    regressions,
    improvements,
    scoreDelta: after.stats.passed - before.stats.passed,
    passRateDelta: after.stats.passRate - before.stats.passRate,
  };
}

export function printDiffReport(diff: RunDiff): void {
  if (diff.regressions.length === 0 && diff.improvements.length === 0) {
    console.log("\x1b[32m  No changes between runs.\x1b[0m");
    return;
  }
  for (const r of diff.regressions) {
    console.log(`  \x1b[31m↓ REGRESSION\x1b[0m  ${r.caseId}  ${r.before} → ${r.after}`);
  }
  for (const i of diff.improvements) {
    console.log(`  \x1b[32m↑ IMPROVEMENT\x1b[0m ${i.caseId}  ${i.before} → ${i.after}`);
  }
  const delta = diff.passRateDelta * 100;
  const color = delta >= 0 ? "\x1b[32m" : "\x1b[31m";
  console.log(`\n  Score delta: ${color}${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%\x1b[0m`);
}
