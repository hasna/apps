process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createStepResult, updateStepResult, listStepResults, getStepResult } from "./step-results.js";
import { createRun } from "./runs.js";
import { createScenario, createResult } from "../db/scenarios.js";
import { createResult as createResultFromResults } from "../db/results.js";

describe("step_results", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createStepResult", () => {
    test("creates a step result with correct fields", () => {
      const run = createRun({ url: "http://test.example", model: "quick" });
      const scenario = createScenario({ name: "Step test", description: "Test step results" });
      const result = createResultFromResults({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 3 });

      const stepResult = createStepResult({
        resultId: result.id,
        stepNumber: 1,
        action: "navigate",
        toolName: "navigate",
        toolInput: { url: "http://example.com" },
        thinking: "Going to the page",
      });

      expect(stepResult.id).toBeDefined();
      expect(stepResult.resultId).toBe(result.id);
      expect(stepResult.stepNumber).toBe(1);
      expect(stepResult.action).toBe("navigate");
      expect(stepResult.status).toBe("running");
      expect(stepResult.toolName).toBe("navigate");
      expect(stepResult.toolInput).toEqual({ url: "http://example.com" });
      expect(stepResult.thinking).toBe("Going to the page");
      expect(stepResult.durationMs).toBeNull();
    });
  });

  describe("updateStepResult", () => {
    test("updates step result status and tool result", () => {
      const run = createRun({ url: "http://test.example", model: "quick" });
      const scenario = createScenario({ name: "Update test", description: "Test updates" });
      const result = createResultFromResults({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 2 });
      const step = createStepResult({ resultId: result.id, stepNumber: 1, action: "click" });

      expect(step.status).toBe("running");

      const updated = updateStepResult(step.id, {
        status: "passed",
        toolResult: "Clicked the submit button successfully",
        durationMs: 1234,
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("passed");
      expect(updated!.toolResult).toBe("Clicked the submit button successfully");
      expect(updated!.durationMs).toBe(1234);
    });

    test("returns null for non-existent step", () => {
      const updated = updateStepResult("nonexistent", { status: "passed" });
      expect(updated).toBeNull();
    });
  });

  describe("listStepResults", () => {
    test("lists step results in order", () => {
      const run = createRun({ url: "http://test.example", model: "quick" });
      const scenario = createScenario({ name: "List test", description: "Test listing" });
      const result = createResultFromResults({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 3 });

      createStepResult({ resultId: result.id, stepNumber: 2, action: "type" });
      createStepResult({ resultId: result.id, stepNumber: 1, action: "navigate" });
      createStepResult({ resultId: result.id, stepNumber: 3, action: "assert" });

      const steps = listStepResults(result.id);
      expect(steps).toHaveLength(3);
      expect(steps[0].stepNumber).toBe(1);
      expect(steps[1].stepNumber).toBe(2);
      expect(steps[2].stepNumber).toBe(3);
    });
  });

  describe("getStepResult", () => {
    test("gets step result by id", () => {
      const run = createRun({ url: "http://test.example", model: "quick" });
      const scenario = createScenario({ name: "Get test", description: "Test getting" });
      const result = createResultFromResults({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
      const step = createStepResult({ resultId: result.id, stepNumber: 1, action: "check" });

      const found = getStepResult(step.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(step.id);
    });
  });
});
