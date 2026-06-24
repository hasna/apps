import type { EvalResult, EvalRun, Verdict } from "../types/index.js";
import { redactRunSecrets } from "./redaction.js";

// ─── Terminal reporter ────────────────────────────────────────────────────────

export const DEFAULT_RESULT_LIMIT = 20;
const DEFAULT_TEXT_LIMIT = 160;

const PASS  = "\x1b[32m✓ PASS\x1b[0m";
const FAIL  = "\x1b[31m✗ FAIL\x1b[0m";
const UNKNOWN = "\x1b[33m? UNKNOWN\x1b[0m";
const ERROR = "\x1b[31m⚠ ERROR\x1b[0m";

export interface ReportDisplayOptions {
  limit?: number;
  verbose?: boolean;
  detailHint?: string;
  jsonHint?: string;
}

export interface RunListDisplayOptions {
  total?: number;
  cursor?: number;
  limit?: number;
  nextCursor?: number | null;
  detailCommand?: string;
}

export interface RunSummary {
  id: string;
  shortId: string;
  createdAt: string;
  dataset: string;
  total: number;
  passed: number;
  failed: number;
  unknown: number;
  errors: number;
  passRate: number;
  durationMs: number;
  costUsd: number;
}

export function parseDisplayLimit(value: unknown, fallback = DEFAULT_RESULT_LIMIT): number {
  const raw = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.floor(raw);
}

export function truncateDisplayText(value: string | undefined, max = DEFAULT_TEXT_LIMIT): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function verdictLabel(v: Verdict, error?: string): string {
  if (error) return ERROR;
  if (v === "PASS") return PASS;
  if (v === "FAIL") return FAIL;
  return UNKNOWN;
}

function verdictText(v: Verdict, error?: string): string {
  if (error) return "ERROR";
  return v;
}

function selectResults(results: EvalResult[], options: ReportDisplayOptions = {}): EvalResult[] {
  const limit = parseDisplayLimit(options.limit);
  if (options.verbose || results.length <= limit) return results;

  const important = results.filter((r) => r.error || r.verdict !== "PASS");
  const selected = important.slice(0, limit);
  const selectedIds = new Set(selected.map((r) => r.caseId));
  if (selected.length < limit) {
    for (const r of results) {
      if (selected.length >= limit) break;
      if (!selectedIds.has(r.caseId)) selected.push(r);
    }
  }
  return selected;
}

function firstFailedAssertion(result: EvalResult): string | undefined {
  return result.assertionResults
    .find((a) => !a.passed && a.reason !== "Skipped — earlier assertion failed")
    ?.reason;
}

function formatRunStats(run: EvalRun): string {
  const { stats } = run;
  const pct = (stats.passRate * 100).toFixed(1);
  return `${stats.passed}/${stats.total} passed (${pct}%)` +
    (stats.failed ? `, ${stats.failed} failed` : "") +
    (stats.unknown ? `, ${stats.unknown} unknown` : "") +
    (stats.errors ? `, ${stats.errors} errors` : "") +
    `, ${(stats.totalDurationMs / 1000).toFixed(1)}s` +
    (stats.totalCostUsd ? `, $${stats.totalCostUsd.toFixed(4)}` : "");
}

function printResultDetail(result: EvalResult, verbose: boolean): void {
  const max = verbose ? 1000 : DEFAULT_TEXT_LIMIT;
  if (result.error) {
    console.log(`         \x1b[31m${truncateDisplayText(result.error, max)}\x1b[0m`);
    return;
  }

  if (result.verdict === "PASS") return;

  const failed = firstFailedAssertion(result);
  if (failed) console.log(`         assertion: ${truncateDisplayText(failed, max)}`);
  if (result.judgeResult) console.log(`         judge: ${truncateDisplayText(result.judgeResult.reasoning, max)}`);
}

function formatResultDetail(result: EvalResult, verbose: boolean): string[] {
  const max = verbose ? 1000 : DEFAULT_TEXT_LIMIT;
  if (result.error) return [`    error: ${truncateDisplayText(result.error, max)}`];
  if (result.verdict === "PASS") return [];

  const lines: string[] = [];
  const failed = firstFailedAssertion(result);
  if (failed) lines.push(`    assertion: ${truncateDisplayText(failed, max)}`);
  if (result.judgeResult) lines.push(`    judge: ${truncateDisplayText(result.judgeResult.reasoning, max)}`);
  return lines;
}

function disclosureHint(options: ReportDisplayOptions): string {
  const hints = [
    options.detailHint ?? "use --verbose for all rows",
    "use --limit <n> to change the compact row count",
    options.jsonHint ?? "use --json for full machine-readable data",
  ];
  return hints.join("; ");
}

export function printTerminalReport(run: EvalRun, options: ReportDisplayOptions = {}): void {
  const { results, stats } = run;
  const visibleResults = selectResults(results, options);
  const hidden = results.length - visibleResults.length;
  const verbose = options.verbose === true;

  console.log(`\n\x1b[1mEval run: ${run.id.slice(0, 8)}\x1b[0m  dataset: ${run.dataset}`);
  console.log(`${"─".repeat(72)}`);

  for (const r of visibleResults) {
    const label = verdictLabel(r.verdict, r.error);
    const time  = `${r.durationMs}ms`;
    const cost  = r.costUsd ? ` $${r.costUsd.toFixed(4)}` : "";
    const passK = r.passRate !== undefined ? ` pass^k=${(r.passRate * 100).toFixed(0)}%` : "";
    console.log(`  ${label}  ${truncateDisplayText(r.caseId, 30).padEnd(30)} ${time.padStart(8)}${cost}${passK}`);
    printResultDetail(r, verbose);
  }

  if (hidden > 0) {
    console.log(`  ... ${hidden} more result${hidden === 1 ? "" : "s"} hidden (${disclosureHint(options)}).`);
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

export function summarizeRun(run: EvalRun): RunSummary {
  return {
    id: run.id,
    shortId: run.id.slice(0, 8),
    createdAt: run.createdAt,
    dataset: run.dataset,
    total: run.stats.total,
    passed: run.stats.passed,
    failed: run.stats.failed,
    unknown: run.stats.unknown,
    errors: run.stats.errors,
    passRate: run.stats.passRate,
    durationMs: run.stats.totalDurationMs,
    costUsd: run.stats.totalCostUsd,
  };
}

export function formatRunList(runs: EvalRun[], options: RunListDisplayOptions = {}): string {
  const cursor = options.cursor ?? 0;
  const total = options.total;
  const detailLine = options.detailCommand ?? "Use evals runs show <id> --verbose for details, or evals runs show <id> --json for full data.";
  const lines: string[] = [];

  if (runs.length === 0) {
    lines.push(total && total > 0 ? "No runs on this page." : "No runs found.");
  } else {
    lines.push(
      "ID                                   Date        Score                  Dataset",
      "------------------------------------ ----------  ---------------------  ------------------------------",
    );
  }

  for (const run of runs) {
    const date = run.createdAt.slice(0, 10);
    const score = `${run.stats.passed}/${run.stats.total} (${(run.stats.passRate * 100).toFixed(1)}%)`;
    lines.push(`${run.id.padEnd(36)} ${date}  ${score.padEnd(21)}  ${truncateDisplayText(run.dataset, 30)}`);
  }

  const shown = cursor + runs.length;
  if (total !== undefined) {
    lines.push(`Showing ${Math.min(shown, total)} of ${total} run${total === 1 ? "" : "s"}.`);
  }
  if (options.nextCursor !== null && options.nextCursor !== undefined) {
    lines.push(`Next page: evals runs list --cursor ${options.nextCursor} --limit ${options.limit ?? runs.length}`);
  }
  lines.push(detailLine);
  return lines.join("\n");
}

export function formatRunSummary(run: EvalRun, options: ReportDisplayOptions = {}): string {
  const visibleResults = selectResults(run.results, options);
  const hidden = run.results.length - visibleResults.length;
  const verbose = options.verbose === true;
  const lines = [
    `Run ${run.id.slice(0, 8)} (${run.createdAt.slice(0, 10)})`,
    `Dataset: ${run.dataset}`,
    `Score: ${formatRunStats(run)}`,
  ];

  if (visibleResults.length > 0) {
    lines.push("", `Results (${visibleResults.length}/${run.results.length}, failures first when compact):`);
    for (const r of visibleResults) {
      const time = `${r.durationMs}ms`;
      const cost = r.costUsd ? ` $${r.costUsd.toFixed(4)}` : "";
      const passK = r.passRate !== undefined ? ` pass^k=${(r.passRate * 100).toFixed(0)}%` : "";
      lines.push(`  ${verdictText(r.verdict, r.error).padEnd(7)} ${truncateDisplayText(r.caseId, 36).padEnd(36)} ${time.padStart(8)}${cost}${passK}`);
      lines.push(...formatResultDetail(r, verbose));
    }
  }

  if (hidden > 0) {
    lines.push(`... ${hidden} more result${hidden === 1 ? "" : "s"} hidden (${disclosureHint(options)}).`);
  }

  return lines.join("\n");
}

// ─── JSON reporter ────────────────────────────────────────────────────────────

export function toJson(run: EvalRun): string {
  return JSON.stringify(redactRunSecrets(run), null, 2);
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

export interface DiffDisplayOptions {
  limit?: number;
  verbose?: boolean;
  hint?: string;
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

export function printDiffReport(diff: RunDiff, options: DiffDisplayOptions = {}): void {
  if (diff.regressions.length === 0 && diff.improvements.length === 0) {
    console.log("\x1b[32m  No changes between runs.\x1b[0m");
    return;
  }

  const limit = parseDisplayLimit(options.limit);
  const totalChanges = diff.regressions.length + diff.improvements.length;
  let shown = 0;

  for (const r of diff.regressions) {
    if (!options.verbose && shown >= limit) break;
    const caseId = options.verbose ? r.caseId : truncateDisplayText(r.caseId, 48);
    console.log(`  \x1b[31m↓ REGRESSION\x1b[0m  ${caseId}  ${r.before} → ${r.after}`);
    shown++;
  }
  for (const i of diff.improvements) {
    if (!options.verbose && shown >= limit) break;
    const caseId = options.verbose ? i.caseId : truncateDisplayText(i.caseId, 48);
    console.log(`  \x1b[32m↑ IMPROVEMENT\x1b[0m ${caseId}  ${i.before} → ${i.after}`);
    shown++;
  }

  const hidden = totalChanges - shown;
  if (hidden > 0) {
    console.log(`  ... ${hidden} more change${hidden === 1 ? "" : "s"} hidden (${options.hint ?? "use --verbose or --limit <n>"}).`);
  }

  const delta = diff.passRateDelta * 100;
  const color = delta >= 0 ? "\x1b[32m" : "\x1b[31m";
  console.log(`\n  Score delta: ${color}${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%\x1b[0m`);
}
