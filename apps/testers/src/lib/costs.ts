import chalk from "chalk";
import { listRuns, getResultsByRun, getScenario } from "../store/index.js";
import type { Result } from "../types/index.js";
import { loadConfig } from "./config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CostSummary {
  period: string;
  totalCostCents: number;
  totalTokens: number;
  runCount: number;
  byModel: Record<string, { costCents: number; tokens: number; runs: number }>;
  byScenario: Array<{ scenarioId: string; name: string; costCents: number; tokens: number; runs: number }>;
  avgCostPerRun: number;
  estimatedMonthlyCents: number;
}

export interface BudgetConfig {
  maxPerRunCents: number;
  maxPerDayCents: number;
  warnAtPercent: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Period = "day" | "week" | "month" | "all";

/** Epoch-ms lower bound for a period, or null for "all" (no lower bound). */
function periodCutoffMs(period: Period): number | null {
  const nowMs = Date.now();
  switch (period) {
    case "day": {
      const d = new Date(nowMs);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    case "week":
      return nowMs - 7 * 86_400_000;
    case "month":
      return nowMs - 30 * 86_400_000;
    case "all":
      return null;
  }
}

/**
 * Collect every result (across the store's runs, optionally scoped to a project)
 * that falls within the requested period. Routes entirely through the Store so
 * cloud mode reads the cloud dataset, not on-box SQLite.
 */
async function collectResults(projectId: string | undefined, period: Period): Promise<Result[]> {
  const cutoff = periodCutoffMs(period);
  const runs = await listRuns(projectId ? { projectId } : undefined);
  const out: Result[] = [];
  for (const run of runs) {
    const results = await getResultsByRun(run.id);
    for (const r of results) {
      if (cutoff !== null) {
        const t = Date.parse(r.createdAt);
        if (Number.isFinite(t) && t < cutoff) continue;
      }
      out.push(r);
    }
  }
  return out;
}

/** Resolve scenario display names once, cached across a single aggregation. */
async function resolveScenarioNames(scenarioIds: Iterable<string>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(scenarioIds)) {
    const scenario = await getScenario(id);
    names.set(id, scenario?.name ?? id);
  }
  return names;
}

function getPeriodDays(period: "day" | "week" | "month" | "all"): number {
  switch (period) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
    case "all":
      return 30; // default extrapolation base for "all"
  }
}

function loadBudgetConfig(): BudgetConfig {
  const config = loadConfig() as unknown as Record<string, unknown>;
  const budget = (config as unknown as { budget?: Partial<BudgetConfig> }).budget;
  return {
    maxPerRunCents: budget?.maxPerRunCents ?? 50,
    maxPerDayCents: budget?.maxPerDayCents ?? 500,
    warnAtPercent: budget?.warnAtPercent ?? 0.80,
  };
}

// ─── Core Functions ─────────────────────────────────────────────────────────

export async function getCostSummary(options?: {
  projectId?: string;
  period?: "day" | "week" | "month" | "all";
}): Promise<CostSummary> {
  const period = options?.period ?? "month";
  const results = await collectResults(options?.projectId, period);

  let totalCostCents = 0;
  let totalTokens = 0;
  const runIds = new Set<string>();

  const byModel: Record<string, { costCents: number; tokens: number; runs: Set<string> }> = {};
  const byScenarioAgg = new Map<string, { costCents: number; tokens: number; runs: Set<string> }>();

  for (const r of results) {
    totalCostCents += r.costCents;
    totalTokens += r.tokensUsed;
    runIds.add(r.runId);

    const m = (byModel[r.model] ??= { costCents: 0, tokens: 0, runs: new Set() });
    m.costCents += r.costCents;
    m.tokens += r.tokensUsed;
    m.runs.add(r.runId);

    let s = byScenarioAgg.get(r.scenarioId);
    if (!s) {
      s = { costCents: 0, tokens: 0, runs: new Set() };
      byScenarioAgg.set(r.scenarioId, s);
    }
    s.costCents += r.costCents;
    s.tokens += r.tokensUsed;
    s.runs.add(r.runId);
  }

  const byModelOut: Record<string, { costCents: number; tokens: number; runs: number }> = {};
  for (const [model, data] of Object.entries(byModel)) {
    byModelOut[model] = { costCents: data.costCents, tokens: data.tokens, runs: data.runs.size };
  }

  const names = await resolveScenarioNames(byScenarioAgg.keys());
  const byScenario = [...byScenarioAgg.entries()]
    .map(([scenarioId, data]) => ({
      scenarioId,
      name: names.get(scenarioId) ?? scenarioId,
      costCents: data.costCents,
      tokens: data.tokens,
      runs: data.runs.size,
    }))
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 10);

  const runCount = runIds.size;
  const avgCostPerRun = runCount > 0 ? totalCostCents / runCount : 0;
  const periodDays = getPeriodDays(period);
  const estimatedMonthlyCents = periodDays > 0 ? (totalCostCents / periodDays) * 30 : 0;

  return {
    period,
    totalCostCents,
    totalTokens,
    runCount,
    byModel: byModelOut,
    byScenario,
    avgCostPerRun,
    estimatedMonthlyCents,
  };
}

// ─── Run Cost Estimator ──────────────────────────────────────────────────────

/**
 * Estimated cost per scenario in cents based on model.
 * These are conservative upper estimates per single scenario run.
 */
const COST_PER_SCENARIO_CENTS: Record<string, number> = {
  // Anthropic
  "haiku": 5,
  "sonnet": 30,
  "opus": 150,
  "claude-haiku": 5,
  "claude-sonnet": 30,
  "claude-opus": 150,
  // OpenAI
  "gpt-4o-mini": 3,
  "gpt-4o": 25,
  // Google
  "gemini-2.0-flash": 2,
  "gemini-1.5-pro": 20,
  // Cerebras
  "llama-3.1-8b": 1,
  "llama-3.3-70b": 3,
};

function modelToCostKey(model: string): number {
  // Exact match first
  const exact = COST_PER_SCENARIO_CENTS[model];
  if (exact !== undefined) return exact;

  // Partial match (model names like "claude-haiku-4-5-20251001")
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return COST_PER_SCENARIO_CENTS["opus"]!;
  if (lower.includes("sonnet")) return COST_PER_SCENARIO_CENTS["sonnet"]!;
  if (lower.includes("haiku")) return COST_PER_SCENARIO_CENTS["haiku"]!;
  if (lower.includes("gpt-4o-mini")) return COST_PER_SCENARIO_CENTS["gpt-4o-mini"]!;
  if (lower.includes("gpt-4o")) return COST_PER_SCENARIO_CENTS["gpt-4o"]!;
  if (lower.includes("gemini-2.0-flash") || lower.includes("gemini-flash")) return COST_PER_SCENARIO_CENTS["gemini-2.0-flash"]!;
  if (lower.includes("gemini-1.5-pro") || lower.includes("gemini-pro")) return COST_PER_SCENARIO_CENTS["gemini-1.5-pro"]!;
  if (lower.includes("llama-3.3") || lower.includes("llama3.3")) return COST_PER_SCENARIO_CENTS["llama-3.3-70b"]!;
  if (lower.includes("llama")) return COST_PER_SCENARIO_CENTS["llama-3.1-8b"]!;

  // Default fallback
  return 10;
}

/**
 * Estimate the total cost in cents for running a batch of scenarios.
 * scenarioCount × costPerScenario × samples
 */
export function estimateRunCostCents(scenarioCount: number, model: string, samples = 1): number {
  const costPerScenario = modelToCostKey(model);
  return scenarioCount * costPerScenario * Math.max(1, samples);
}

// ─── By-Scenario Cost Breakdown ──────────────────────────────────────────────

export interface ScenarioCostRow {
  scenarioId: string;
  name: string;
  runCount: number;
  totalCostCents: number;
  avgCostPerRunCents: number;
}

export async function getCostsByScenario(options?: {
  projectId?: string;
  period?: "day" | "week" | "month" | "all";
}): Promise<ScenarioCostRow[]> {
  const period = options?.period ?? "month";
  const results = await collectResults(options?.projectId, period);

  const agg = new Map<string, { totalCostCents: number; runs: Set<string> }>();
  for (const r of results) {
    let a = agg.get(r.scenarioId);
    if (!a) {
      a = { totalCostCents: 0, runs: new Set() };
      agg.set(r.scenarioId, a);
    }
    a.totalCostCents += r.costCents;
    a.runs.add(r.runId);
  }

  const names = await resolveScenarioNames(agg.keys());
  return [...agg.entries()]
    .map(([scenarioId, a]) => ({
      scenarioId,
      name: names.get(scenarioId) ?? scenarioId,
      runCount: a.runs.size,
      totalCostCents: a.totalCostCents,
      avgCostPerRunCents: a.runs.size > 0 ? a.totalCostCents / a.runs.size : 0,
    }))
    .sort((a, b) => b.totalCostCents - a.totalCostCents);
}

export function formatCostsByScenarioTerminal(rows: ScenarioCostRow[], period: string): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`  Cost by Scenario (${period})`));
  lines.push("");

  if (rows.length === 0) {
    lines.push(chalk.dim("  No cost data found."));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`  ${"Scenario".padEnd(40)} ${"Runs".padEnd(8)} ${"Total Cost".padEnd(14)} Avg/Run`);
  lines.push(`  ${"─".repeat(40)} ${"─".repeat(8)} ${"─".repeat(14)} ${"─".repeat(10)}`);

  for (const row of rows) {
    const label = row.name.length > 38 ? row.name.slice(0, 35) + "..." : row.name;
    lines.push(
      `  ${label.padEnd(40)} ${String(row.runCount).padEnd(8)} ${formatDollars(row.totalCostCents).padEnd(14)} ${formatDollars(row.avgCostPerRunCents)}`
    );
  }

  lines.push("");
  return lines.join("\n");
}

export async function checkBudget(estimatedCostCents: number): Promise<{ allowed: boolean; warning?: string }> {
  const budget = loadBudgetConfig();

  // Check per-run limit
  if (estimatedCostCents > budget.maxPerRunCents) {
    return {
      allowed: false,
      warning: `Estimated cost (${formatDollars(estimatedCostCents)}) exceeds per-run limit (${formatDollars(budget.maxPerRunCents)})`,
    };
  }

  // Check daily limit
  const todaySummary = await getCostSummary({ period: "day" });
  const projectedDaily = todaySummary.totalCostCents + estimatedCostCents;

  if (projectedDaily > budget.maxPerDayCents) {
    return {
      allowed: false,
      warning: `Daily spending (${formatDollars(todaySummary.totalCostCents)}) + this run (${formatDollars(estimatedCostCents)}) would exceed daily limit (${formatDollars(budget.maxPerDayCents)})`,
    };
  }

  // Check warning threshold
  if (projectedDaily > budget.maxPerDayCents * budget.warnAtPercent) {
    return {
      allowed: true,
      warning: `Approaching daily limit: ${formatDollars(projectedDaily)} of ${formatDollars(budget.maxPerDayCents)} (${Math.round((projectedDaily / budget.maxPerDayCents) * 100)}%)`,
    };
  }

  return { allowed: true };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function formatCostsTerminal(summary: CostSummary): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`  Cost Summary (${summary.period})`));
  lines.push("");
  lines.push(`  Total:     ${chalk.yellow(formatDollars(summary.totalCostCents))} (${formatTokens(summary.totalTokens)} tokens across ${summary.runCount} runs)`);
  lines.push(`  Avg/run:   ${chalk.yellow(formatDollars(summary.avgCostPerRun))}`);
  lines.push(`  Est/month: ${chalk.yellow(formatDollars(summary.estimatedMonthlyCents))}`);

  // Model breakdown
  const modelEntries = Object.entries(summary.byModel);
  if (modelEntries.length > 0) {
    lines.push("");
    lines.push(chalk.bold("  By Model"));
    lines.push(`  ${"Model".padEnd(40)} ${"Cost".padEnd(12)} ${"Tokens".padEnd(12)} Runs`);
    lines.push(`  ${"─".repeat(40)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(6)}`);
    for (const [model, data] of modelEntries) {
      lines.push(
        `  ${model.padEnd(40)} ${formatDollars(data.costCents).padEnd(12)} ${formatTokens(data.tokens).padEnd(12)} ${data.runs}`
      );
    }
  }

  // Top scenarios by cost (sorted descending — already ordered by SQL)
  if (summary.byScenario.length > 0) {
    lines.push("");
    lines.push(chalk.bold("  Scenarios by Cost (most expensive first)"));
    lines.push(`  ${"Scenario".padEnd(40)} ${"Total Cost".padEnd(12)} ${"Avg/Run".padEnd(12)} ${"Runs".padEnd(6)} Tokens`);
    lines.push(`  ${"─".repeat(40)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(6)} ${"─".repeat(10)}`);
    for (const s of summary.byScenario) {
      const label = s.name.length > 38 ? s.name.slice(0, 35) + "..." : s.name;
      const avgPerRun = s.runs > 0 ? s.costCents / s.runs : 0;
      lines.push(
        `  ${label.padEnd(40)} ${formatDollars(s.costCents).padEnd(12)} ${formatDollars(avgPerRun).padEnd(12)} ${String(s.runs).padEnd(6)} ${formatTokens(s.tokens)}`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function formatCostsJSON(summary: CostSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function formatCostsCsv(summary: CostSummary): string {
  const lines: string[] = [];
  lines.push("scenario,runs,total_cost_cents,avg_cost_cents,tokens");
  for (const s of summary.byScenario) {
    const avgCostCents = s.runs > 0 ? s.costCents / s.runs : 0;
    const name = s.name.includes(",") ? `"${s.name.replace(/"/g, '""')}"` : s.name;
    lines.push(`${name},${s.runs},${s.costCents},${avgCostCents.toFixed(2)},${s.tokens}`);
  }
  return lines.join("\n");
}
