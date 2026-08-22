import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../db/database.js";
import { createWorkspace } from "../db/workspaces.js";
import {
  BudgetExceededError,
  assertProjectBudgets,
  assertProjectBudgetsAfterSpend,
  createProjectBudget,
  estimateProjectCostUsd,
  getProjectBudgetStatuses,
  normalizeProjectUsage,
  recordProjectSpend,
} from "./budget.js";

describe("project budgets", () => {
  afterEach(() => {
    closeDatabase();
    delete process.env["HASNA_PROJECTS_DB_PATH"];
  });

  test("tracks remaining money and tokens for project budgets", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-budget-store-"));
    process.env["HASNA_PROJECTS_DB_PATH"] = join(root, "projects.db");
    const project = createWorkspace({ name: "Budgeted App", slug: "budgeted-app", kind: "project" });
    const budget = createProjectBudget({
      scope_type: "project",
      scope_id: project.id,
      window: "lifetime",
      mode: "hard",
      max_usd: 0.25,
      max_total_tokens: 100,
    });

    recordProjectSpend({
      workspace_id: project.id,
      run_id: "run_test",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      usd: 0.05,
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25,
    });

    const [status] = getProjectBudgetStatuses({ workspace_id: project.id });
    expect(status?.budget.id).toBe(budget.id);
    expect(status?.spent.usd).toBe(0.05);
    expect(status?.spent.total_tokens).toBe(25);
    expect(status?.remaining.usd).toBe(0.2);
    expect(status?.remaining.total_tokens).toBe(75);
  });

  test("throws before work starts when a hard budget is exhausted", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-budget-block-"));
    process.env["HASNA_PROJECTS_DB_PATH"] = join(root, "projects.db");
    const project = createWorkspace({ name: "Blocked App", slug: "blocked-app", kind: "project" });
    createProjectBudget({
      scope_type: "project",
      scope_id: project.id,
      window: "lifetime",
      mode: "hard",
      max_total_tokens: 2,
      max_usd: 0.01,
    });
    recordProjectSpend({
      workspace_id: project.id,
      run_id: "run_one",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      usd: 0.0001,
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    });

    expect(() => assertProjectBudgets({ workspace_id: project.id })).toThrow(BudgetExceededError);
  });

  test("fails closed for hard USD budgets when model pricing is unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-budget-unknown-cost-"));
    process.env["HASNA_PROJECTS_DB_PATH"] = join(root, "projects.db");
    const project = createWorkspace({ name: "Unpriced App", slug: "unpriced-app", kind: "project" });
    createProjectBudget({
      scope_type: "project",
      scope_id: project.id,
      window: "lifetime",
      mode: "hard",
      max_usd: 0.01,
    });

    const usage = normalizeProjectUsage({ inputTokens: 2, outputTokens: 1 });
    const usd = estimateProjectCostUsd(usage, "unknown/model");
    expect(usd).toBeUndefined();
    recordProjectSpend({
      workspace_id: project.id,
      run_id: "run_unknown_cost",
      provider: "openrouter",
      model: "unknown/model",
      usd,
      cost_unknown: usd === undefined,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
    });

    const [status] = getProjectBudgetStatuses({ workspace_id: project.id });
    expect(status?.spent.unknown_cost_events).toBe(1);
    expect(status?.warnings.join("\n")).toContain("USD budget cannot be verified");
    expect(() => assertProjectBudgetsAfterSpend({ workspace_id: project.id })).toThrow(BudgetExceededError);
  });

  test("window start parses reset_at as the zoneless UTC instant it was stored as", () => {
    const prevTz = process.env["TZ"];
    process.env["TZ"] = "Europe/Bucharest";
    try {
      const root = mkdtempSync(join(tmpdir(), "projects-budget-window-"));
      process.env["HASNA_PROJECTS_DB_PATH"] = join(root, "projects.db");
      const project = createWorkspace({ name: "Windowed App", slug: "windowed-app", kind: "project" });
      const budget = createProjectBudget({
        scope_type: "project",
        scope_id: project.id,
        window: "lifetime",
        mode: "hard",
        max_total_tokens: 100,
      });
      const db = getDatabase();
      db.run("UPDATE project_budgets SET reset_at = ? WHERE id = ?", ["2026-08-22 15:00:00.123", budget.id]);
      const insertSpend = (id: string, createdAt: string, totalTokens: number) => {
        db.run(
          `INSERT INTO project_budget_spend (id, workspace_id, run_id, provider, model, usd, input_tokens, output_tokens, total_tokens, metadata, created_at)
           VALUES (?, ?, ?, NULL, NULL, 0, 0, 0, ?, '{}', ?)`,
          [id, project.id, "run_window", totalTokens, createdAt],
        );
      };
      insertSpend("spend_pre_reset", "2026-08-22 14:00:00.000", 10);
      insertSpend("spend_same_second_pre_millis", "2026-08-22 15:00:00.000", 20);
      insertSpend("spend_post_reset", "2026-08-22 16:00:00.000", 30);

      const [status] = getProjectBudgetStatuses({ workspace_id: project.id });
      expect(status?.window_start).toBe("2026-08-22T15:00:00.123Z");
      expect(status?.spent.total_tokens).toBe(30);
    } finally {
      if (prevTz === undefined) delete process.env["TZ"];
      else process.env["TZ"] = prevTz;
    }
  });
});
