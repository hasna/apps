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

  // Top scenarios by cost
  if (summary.byScenario.length > 0) {
    lines.push("");
    lines.push(chalk.bold("  Top Scenarios by Cost"));
    lines.push(`  ${"Scenario".padEnd(40)} ${"Cost".padEnd(12)} ${"Tokens".padEnd(12)} Runs`);
    lines.push(`  ${"─".repeat(40)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(6)}`);
    for (const s of summary.byScenario) {
      const label = s.name.length > 38 ? s.name.slice(0, 35) + "..." : s.name;
      lines.push(
        `  ${label.padEnd(40)} ${formatDollars(s.costCents).padEnd(12)} ${formatTokens(s.tokens).padEnd(12)} ${s.runs}`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function formatCostsJSON(summary: CostSummary): string {
  return JSON.stringify(summary, null, 2);
}
