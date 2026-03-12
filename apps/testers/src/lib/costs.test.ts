process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { createScenario } from "../db/scenarios.js";
import { createRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import { getCostSummary, checkBudget, formatCostsJSON } from "./costs.js";

describe("costs", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  function seedCostData() {
    const s1 = createScenario({ name: "Login test", description: "Test login" });
    const s2 = createScenario({ name: "Signup test", description: "Test signup" });

    const run1 = createRun({ url: "http://localhost:3000", model: "claude-haiku" });
    const run2 = createRun({ url: "http://localhost:3000", model: "claude-sonnet" });

    const r1 = createResult({ runId: run1.id, scenarioId: s1.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r1.id, { status: "passed", costCents: 10, tokensUsed: 1000, durationMs: 100 });

    const r2 = createResult({ runId: run1.id, scenarioId: s2.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r2.id, { status: "passed", costCents: 15, tokensUsed: 1500, durationMs: 200 });

    const r3 = createResult({ runId: run2.id, scenarioId: s1.id, model: "claude-sonnet", stepsTotal: 3 });
    updateResult(r3.id, { status: "failed", costCents: 25, tokensUsed: 2500, durationMs: 300 });

    return { s1, s2, run1, run2 };
  }

  describe("getCostSummary", () => {
    test("returns correct totals", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });

      expect(summary.totalCostCents).toBe(50); // 10 + 15 + 25
      expect(summary.totalTokens).toBe(5000); // 1000 + 1500 + 2500
      expect(summary.runCount).toBe(2);
    });

    test("returns correct average cost per run", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });

      expect(summary.avgCostPerRun).toBe(25); // 50 / 2
    });

    test("returns correct model breakdown", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });

      expect(summary.byModel["claude-haiku"]).toBeDefined();
      expect(summary.byModel["claude-haiku"]!.costCents).toBe(25); // 10 + 15
      expect(summary.byModel["claude-haiku"]!.tokens).toBe(2500); // 1000 + 1500

      expect(summary.byModel["claude-sonnet"]).toBeDefined();
      expect(summary.byModel["claude-sonnet"]!.costCents).toBe(25);
      expect(summary.byModel["claude-sonnet"]!.tokens).toBe(2500);
    });

    test("returns correct scenario breakdown", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });

      expect(summary.byScenario.length).toBe(2);
      const loginScenario = summary.byScenario.find((s) => s.name === "Login test");
      expect(loginScenario).toBeDefined();
      expect(loginScenario!.costCents).toBe(35); // 10 + 25
    });

    test("returns zeros when no data exists", () => {
      const summary = getCostSummary({ period: "all" });

      expect(summary.totalCostCents).toBe(0);
      expect(summary.totalTokens).toBe(0);
      expect(summary.runCount).toBe(0);
      expect(summary.avgCostPerRun).toBe(0);
    });

    test("with period filter defaults to month", () => {
      seedCostData();
      const summary = getCostSummary();

      // Data was just inserted so it should appear in "month" period
      expect(summary.period).toBe("month");
      expect(summary.totalCostCents).toBe(50);
    });

    test("calculates estimated monthly cost", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });

      // period "all" uses 30 days as extrapolation base
      expect(summary.estimatedMonthlyCents).toBe((50 / 30) * 30);
    });
  });

  describe("checkBudget", () => {
    test("allows within budget", () => {
      const result = checkBudget(10); // default maxPerRunCents is 50
      expect(result.allowed).toBe(true);
    });

    test("rejects when exceeding per-run limit", () => {
      const result = checkBudget(100); // exceeds default 50 per run
      expect(result.allowed).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("per-run limit");
    });

    test("returns no warning when well within budget", () => {
      const result = checkBudget(1);
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeUndefined();
    });
  });

  describe("formatCostsJSON", () => {
    test("returns valid JSON string", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });
      const json = formatCostsJSON(summary);
      const parsed = JSON.parse(json);

      expect(parsed.totalCostCents).toBe(50);
      expect(parsed.totalTokens).toBe(5000);
      expect(parsed.runCount).toBe(2);
      expect(parsed.period).toBe("all");
    });

    test("includes all summary fields in JSON", () => {
      seedCostData();
      const summary = getCostSummary({ period: "all" });
      const parsed = JSON.parse(formatCostsJSON(summary));

      expect(parsed.byModel).toBeDefined();
      expect(parsed.byScenario).toBeDefined();
      expect(parsed.avgCostPerRun).toBeDefined();
      expect(parsed.estimatedMonthlyCents).toBeDefined();
    });
  });
});
