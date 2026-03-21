import chalk from "chalk";
import { getDatabase } from "../db/database.js";
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

function getDateFilter(period: "day" | "week" | "month" | "all"): string {
  switch (period) {
    case "day":
      return "AND r.created_at >= date('now', 'start of day')";
    case "week":
      return "AND r.created_at >= date('now', '-7 days')";
    case "month":
      return "AND r.created_at >= date('now', '-30 days')";
    case "all":
      return "";
  }
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

export function getCostSummary(options?: {
  projectId?: string;
  period?: "day" | "week" | "month" | "all";
}): CostSummary {
  const db = getDatabase();
  const period = options?.period ?? "month";
  const projectId = options?.projectId;
  const dateFilter = getDateFilter(period);

  const projectFilter = projectId ? "AND ru.project_id = ?" : "";
  const projectParams = projectId ? [projectId] : [];

  // Aggregate totals
  const totalsRow = db
    .query(
      `SELECT
        COALESCE(SUM(r.cost_cents), 0) as total_cost,
        COALESCE(SUM(r.tokens_used), 0) as total_tokens,
        COUNT(DISTINCT r.run_id) as run_count
      FROM results r
      JOIN runs ru ON r.run_id = ru.id
      WHERE 1=1 ${dateFilter} ${projectFilter}`
    )
    .get(...projectParams) as { total_cost: number; total_tokens: number; run_count: number };

  // By model breakdown
  const modelRows = db
    .query(
      `SELECT
        r.model,
        COALESCE(SUM(r.cost_cents), 0) as cost_cents,
        COALESCE(SUM(r.tokens_used), 0) as tokens,
        COUNT(DISTINCT r.run_id) as runs
      FROM results r
      JOIN runs ru ON r.run_id = ru.id
      WHERE 1=1 ${dateFilter} ${projectFilter}
      GROUP BY r.model
      ORDER BY cost_cents DESC`
    )
    .all(...projectParams) as Array<{ model: string; cost_cents: number; tokens: number; runs: number }>;

  const byModel: Record<string, { costCents: number; tokens: number; runs: number }> = {};
  for (const row of modelRows) {
    byModel[row.model] = {
      costCents: row.cost_cents,
      tokens: row.tokens,
      runs: row.runs,
    };
  }

  // By scenario breakdown (top 10 by cost)
  const scenarioRows = db
    .query(
      `SELECT
        r.scenario_id,
        COALESCE(s.name, r.scenario_id) as name,
        COALESCE(SUM(r.cost_cents), 0) as cost_cents,
        COALESCE(SUM(r.tokens_used), 0) as tokens,
        COUNT(DISTINCT r.run_id) as runs
      FROM results r
      JOIN runs ru ON r.run_id = ru.id
      LEFT JOIN scenarios s ON r.scenario_id = s.id
      WHERE 1=1 ${dateFilter} ${projectFilter}
      GROUP BY r.scenario_id
      ORDER BY cost_cents DESC
      LIMIT 10`
    )
    .all(...projectParams) as Array<{ scenario_id: string; name: string; cost_cents: number; tokens: number; runs: number }>;

  const byScenario = scenarioRows.map((row) => ({
    scenarioId: row.scenario_id,
    name: row.name,
    costCents: row.cost_cents,
    tokens: row.tokens,
    runs: row.runs,
  }));

  const runCount = totalsRow.run_count;
  const avgCostPerRun = runCount > 0 ? totalsRow.total_cost / runCount : 0;
  const periodDays = getPeriodDays(period);
  const estimatedMonthlyCents = periodDays > 0 ? (totalsRow.total_cost / periodDays) * 30 : 0;

  return {
    period,
    totalCostCents: totalsRow.total_cost,
    totalTokens: totalsRow.total_tokens,
    runCount,
    byModel,
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

export function getCostsByScenario(options?: {
  projectId?: string;
  period?: "day" | "week" | "month" | "all";
}): ScenarioCostRow[] {
  const db = getDatabase();
  const period = options?.period ?? "month";
  const projectId = options?.projectId;
  const dateFilter = getDateFilter(period);
  const projectFilter = projectId ? "AND ru.project_id = ?" : "";
  const projectParams = projectId ? [projectId] : [];

  const rows = db
    .query(
      `SELECT
        r.scenario_id,
        COALESCE(s.name, r.scenario_id) as name,
        COUNT(DISTINCT r.run_id) as run_count,
        COALESCE(SUM(r.cost_cents), 0) as total_cost_cents
      FROM results r
      JOIN runs ru ON r.run_id = ru.id
      LEFT JOIN scenarios s ON r.scenario_id = s.id
      WHERE 1=1 ${dateFilter} ${projectFilter}
      GROUP BY r.scenario_id
      ORDER BY total_cost_cents DESC`
    )
    .all(...projectParams) as Array<{
      scenario_id: string;
      name: string;
      run_count: number;
      total_cost_cents: number;
    }>;

  return rows.map((row) => ({
    scenarioId: row.scenario_id,
    name: row.name,
    runCount: row.run_count,
    totalCostCents: row.total_cost_cents,
    avgCostPerRunCents: row.run_count > 0 ? row.total_cost_cents / row.run_count : 0,
  }));
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

export function checkBudget(estimatedCostCents: number): { allowed: boolean; warning?: string } {
  const budget = loadBudgetConfig();

  // Check per-run limit
  if (estimatedCostCents > budget.maxPerRunCents) {
    return {
      allowed: false,
      warning: `Estimated cost (${formatDollars(estimatedCostCents)}) exceeds per-run limit (${formatDollars(budget.maxPerRunCents)})`,
    };
  }

  // Check daily limit
  const todaySummary = getCostSummary({ period: "day" });
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
