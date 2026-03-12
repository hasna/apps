process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { createScenario } from "../db/scenarios.js";
import { createRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import { diffRuns, formatDiffJSON } from "./diff.js";

describe("diff", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  function setupTwoRunsWithScenarios() {
    const s1 = createScenario({ name: "Login test", description: "Test login" });
    const s2 = createScenario({ name: "Signup test", description: "Test signup" });
    const s3 = createScenario({ name: "Dashboard test", description: "Test dashboard" });

    const run1 = createRun({ url: "http://localhost:3000", model: "claude-haiku" });
    const run2 = createRun({ url: "http://localhost:3000", model: "claude-haiku" });

    // Run 1: s1=passed, s2=failed, s3=passed
    const r1s1 = createResult({ runId: run1.id, scenarioId: s1.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r1s1.id, { status: "passed", durationMs: 100, tokensUsed: 500 });

    const r1s2 = createResult({ runId: run1.id, scenarioId: s2.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r1s2.id, { status: "failed", durationMs: 200, tokensUsed: 600 });

    const r1s3 = createResult({ runId: run1.id, scenarioId: s3.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r1s3.id, { status: "passed", durationMs: 150, tokensUsed: 550 });

    // Run 2: s1=failed (regression), s2=passed (fix), s3=passed (unchanged)
    const r2s1 = createResult({ runId: run2.id, scenarioId: s1.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r2s1.id, { status: "failed", durationMs: 120, tokensUsed: 520 });

    const r2s2 = createResult({ runId: run2.id, scenarioId: s2.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r2s2.id, { status: "passed", durationMs: 180, tokensUsed: 580 });

    const r2s3 = createResult({ runId: run2.id, scenarioId: s3.id, model: "claude-haiku", stepsTotal: 3 });
    updateResult(r2s3.id, { status: "passed", durationMs: 160, tokensUsed: 560 });

    return { run1, run2, s1, s2, s3 };
  }

  describe("diffRuns", () => {
    test("finds regressions (pass to fail)", () => {
      const { run1, run2, s1 } = setupTwoRunsWithScenarios();
      const diff = diffRuns(run1.id, run2.id);

      expect(diff.regressions.length).toBe(1);
      expect(diff.regressions[0]!.scenarioId).toBe(s1.id);
      expect(diff.regressions[0]!.status1).toBe("passed");
      expect(diff.regressions[0]!.status2).toBe("failed");
    });

    test("finds fixes (fail to pass)", () => {
      const { run1, run2, s2 } = setupTwoRunsWithScenarios();
      const diff = diffRuns(run1.id, run2.id);

      expect(diff.fixes.length).toBe(1);
      expect(diff.fixes[0]!.scenarioId).toBe(s2.id);
      expect(diff.fixes[0]!.status1).toBe("failed");
      expect(diff.fixes[0]!.status2).toBe("passed");
    });

    test("finds unchanged scenarios", () => {
      const { run1, run2, s3 } = setupTwoRunsWithScenarios();
      const diff = diffRuns(run1.id, run2.id);

      expect(diff.unchanged.length).toBe(1);
      expect(diff.unchanged[0]!.scenarioId).toBe(s3.id);
      expect(diff.unchanged[0]!.status1).toBe("passed");
      expect(diff.unchanged[0]!.status2).toBe("passed");
    });

    test("detects new scenarios in run 2", () => {
      const s1 = createScenario({ name: "Test A", description: "A" });
      const s2 = createScenario({ name: "Test B", description: "B" });

      const run1 = createRun({ url: "http://localhost:3000", model: "claude-haiku" });
      const run2 = createRun({ url: "http://localhost:3000", model: "claude-haiku" });

      const r1s1 = createResult({ runId: run1.id, scenarioId: s1.id, model: "claude-haiku", stepsTotal: 2 });
      updateResult(r1s1.id, { status: "passed" });

      // Run 2 has s1 and s2 (s2 is new)
      const r2s1 = createResult({ runId: run2.id, scenarioId: s1.id, model: "claude-haiku", stepsTotal: 2 });
      updateResult(r2s1.id, { status: "passed" });
      const r2s2 = createResult({ runId: run2.id, scenarioId: s2.id, model: "claude-haiku", stepsTotal: 2 });
      updateResult(r2s2.id, { status: "passed" });

      const diff = diffRuns(run1.id, run2.id);
      expect(diff.newScenarios.length).toBe(1);
      expect(diff.newScenarios[0]!.scenarioId).toBe(s2.id);
    });

    test("throws on invalid run ID for run 1", () => {
      expect(() => {
        diffRuns("nonexistent-id-1", "nonexistent-id-2");
      }).toThrow("Run not found: nonexistent-id-1");
    });

    test("throws on invalid run ID for run 2", () => {
      const run1 = createRun({ url: "http://localhost:3000", model: "claude-haiku" });
      expect(() => {
        diffRuns(run1.id, "nonexistent-id-2");
      }).toThrow("Run not found: nonexistent-id-2");
    });

    test("returns correct run objects in diff result", () => {
      const { run1, run2 } = setupTwoRunsWithScenarios();
      const diff = diffRuns(run1.id, run2.id);

      expect(diff.run1.id).toBe(run1.id);
      expect(diff.run2.id).toBe(run2.id);
    });
  });

  describe("formatDiffJSON", () => {
    test("returns valid JSON string", () => {
      const { run1, run2 } = setupTwoRunsWithScenarios();
      const diff = diffRuns(run1.id, run2.id);
      const json = formatDiffJSON(diff);

      const parsed = JSON.parse(json);
      expect(parsed.regressions).toBeDefined();
      expect(parsed.fixes).toBeDefined();
      expect(parsed.unchanged).toBeDefined();
      expect(parsed.run1).toBeDefined();
      expect(parsed.run2).toBeDefined();
    });

    test("JSON contains correct counts", () => {
      const { run1, run2 } = setupTwoRunsWithScenarios();
      const diff = diffRuns(run1.id, run2.id);
      const parsed = JSON.parse(formatDiffJSON(diff));

      expect(parsed.regressions.length).toBe(1);
      expect(parsed.fixes.length).toBe(1);
      expect(parsed.unchanged.length).toBe(1);
    });
  });
});
