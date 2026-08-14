process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createResult, getResult, listResults, updateResult, getResultsByRun } from "./results.js";
import { createRun } from "./runs.js";
import { createScenario } from "./scenarios.js";

function createTestRunAndScenario() {
  const scenario = createScenario({ name: "Test Scenario", description: "Desc", steps: ["step1", "step2", "step3"] });
  const run = createRun({ url: "http://localhost:3000", model: "claude-haiku-4-5-20251001" });
  return { run, scenario };
}

describe("results", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createResult", () => {
    test("creates a result with correct fields", () => {
      const { run, scenario } = createTestRunAndScenario();
      const result = createResult({
        runId: run.id,
        scenarioId: scenario.id,
        model: "claude-haiku-4-5-20251001",
        stepsTotal: 3,
      });

      expect(result.id).toBeDefined();
      expect(result.runId).toBe(run.id);
      expect(result.scenarioId).toBe(scenario.id);
      expect(result.model).toBe("claude-haiku-4-5-20251001");
      expect(result.stepsTotal).toBe(3);
      expect(result.status).toBe("skipped");
      expect(result.stepsCompleted).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(result.costCents).toBe(0);
      expect(result.reasoning).toBeNull();
      expect(result.error).toBeNull();
      expect(result.createdAt).toBeDefined();
    });

    test("creates multiple results for the same run", () => {
      const { run, scenario } = createTestRunAndScenario();
      const scenario2 = createScenario({ name: "Test 2", description: "Desc 2" });

      const r1 = createResult({ runId: run.id, scenarioId: scenario.id, model: "model-a", stepsTotal: 3 });
      const r2 = createResult({ runId: run.id, scenarioId: scenario2.id, model: "model-a", stepsTotal: 5 });

      expect(r1.id).not.toBe(r2.id);
      expect(r1.stepsTotal).toBe(3);
      expect(r2.stepsTotal).toBe(5);
    });
  });

  describe("getResult", () => {
    test("gets a result by full ID", () => {
      const { run, scenario } = createTestRunAndScenario();
      const created = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 2 });

      const found = getResult(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("gets a result by partial ID", () => {
      const { run, scenario } = createTestRunAndScenario();
      const created = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 2 });

      const partial = created.id.slice(0, 8);
      const found = getResult(partial);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("returns null for non-existent result", () => {
      const found = getResult("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listResults", () => {
    test("lists results by run ID", () => {
      const { run, scenario } = createTestRunAndScenario();
      const scenario2 = createScenario({ name: "Test 2", description: "D2" });

      createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 2 });
      createResult({ runId: run.id, scenarioId: scenario2.id, model: "model", stepsTotal: 3 });

      const results = listResults(run.id);
      expect(results.length).toBe(2);
    });

    test("returns empty array for run with no results", () => {
      const run = createRun({ url: "http://localhost:3000", model: "model" });
      const results = listResults(run.id);
      expect(results).toEqual([]);
    });

    test("does not return results from other runs", () => {
      const scenario = createScenario({ name: "Test", description: "D" });
      const run1 = createRun({ url: "http://localhost:3000", model: "model" });
      const run2 = createRun({ url: "http://localhost:3001", model: "model" });

      createResult({ runId: run1.id, scenarioId: scenario.id, model: "model", stepsTotal: 2 });
      createResult({ runId: run2.id, scenarioId: scenario.id, model: "model", stepsTotal: 2 });

      const results1 = listResults(run1.id);
      expect(results1.length).toBe(1);
      expect(results1[0]!.runId).toBe(run1.id);
    });
  });

  describe("updateResult", () => {
    test("updates status", () => {
      const { run, scenario } = createTestRunAndScenario();
      const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 3 });

      const updated = updateResult(result.id, { status: "passed" });
      expect(updated.status).toBe("passed");
    });

    test("updates reasoning and error", () => {
      const { run, scenario } = createTestRunAndScenario();
      const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 3 });

      const updated = updateResult(result.id, {
        status: "failed",
        reasoning: "Button was not clickable",
        error: "Element not found: #submit-btn",
      });

      expect(updated.status).toBe("failed");
      expect(updated.reasoning).toBe("Button was not clickable");
      expect(updated.error).toBe("Element not found: #submit-btn");
    });

    test("updates token usage and cost", () => {
      const { run, scenario } = createTestRunAndScenario();
      const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 3 });

      const updated = updateResult(result.id, {
        tokensUsed: 1500,
        costCents: 0.45,
      });

      expect(updated.tokensUsed).toBe(1500);
      expect(updated.costCents).toBe(0.45);
    });

    test("updates steps completed and duration", () => {
      const { run, scenario } = createTestRunAndScenario();
      const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 3 });

      const updated = updateResult(result.id, {
        stepsCompleted: 2,
        durationMs: 5000,
      });

      expect(updated.stepsCompleted).toBe(2);
      expect(updated.durationMs).toBe(5000);
    });

    test("throws error for non-existent result", () => {
      expect(() => {
        updateResult("nonexistent", { status: "passed" });
      }).toThrow("Result not found");
    });

    test("returns existing result when no updates provided", () => {
      const { run, scenario } = createTestRunAndScenario();
      const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 3 });

      const same = updateResult(result.id, {});
      expect(same.id).toBe(result.id);
      expect(same.status).toBe("skipped");
    });
  });

  describe("getResultsByRun", () => {
    test("returns same results as listResults", () => {
      const { run, scenario } = createTestRunAndScenario();
      createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 2 });

      const fromList = listResults(run.id);
      const fromGetBy = getResultsByRun(run.id);

      expect(fromList.length).toBe(fromGetBy.length);
      expect(fromList[0]!.id).toBe(fromGetBy[0]!.id);
    });

    test("returns empty array for run with no results", () => {
      const results = getResultsByRun("nonexistent-run-id");
      expect(results).toEqual([]);
    });
  });
});
