process.env.TESTERS_DB_PATH = ":memory:";

import { describe, it, expect, beforeAll } from "bun:test";
import { resetDatabase } from "../db/database.js";
import { createScenario } from "../db/scenarios.js";
import { createRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import { createScreenshot } from "../db/screenshots.js";
import { formatJSON, formatSummary, getExitCode } from "./reporter.js";
import type { Run, Result } from "../types/index.js";

let testRun: ReturnType<typeof createRun>;
let testScenario: ReturnType<typeof createScenario>;
let testResult: ReturnType<typeof createResult>;

beforeAll(() => {
  resetDatabase();

  testScenario = createScenario({
    name: "Login test",
    description: "Test login flow",
    steps: ["Navigate to /login", "Fill email", "Click submit"],
    tags: ["auth"],
  });

  testRun = createRun({
    url: "http://localhost:3000",
    model: "claude-haiku-4-5-20251001",
    headed: false,
    parallel: 1,
  });

  testResult = createResult({
    runId: testRun.id,
    scenarioId: testScenario.id,
    model: "claude-haiku-4-5-20251001",
    stepsTotal: 3,
  });

  testResult = updateResult(testResult.id, {
    status: "passed",
    reasoning: "All steps completed successfully",
    stepsCompleted: 3,
    durationMs: 5000,
    tokensUsed: 1500,
    costCents: 0.5,
  });

  createScreenshot({
    resultId: testResult.id,
    stepNumber: 1,
    action: "navigate",
    filePath: "/tmp/screenshots/001-navigate.png",
    width: 1280,
    height: 720,
  });
});

describe("formatJSON", () => {
  it("returns valid JSON", () => {
    const json = formatJSON(testRun, [testResult]);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("has correct top-level structure", () => {
    const json = formatJSON(testRun, [testResult]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("run");
    expect(parsed).toHaveProperty("results");
    expect(parsed).toHaveProperty("summary");
  });

  it("includes run metadata", () => {
    const json = formatJSON(testRun, [testResult]);
    const parsed = JSON.parse(json);
    expect(parsed.run.id).toBe(testRun.id);
    expect(parsed.run.url).toBe("http://localhost:3000");
    expect(parsed.run.model).toBe("claude-haiku-4-5-20251001");
  });

  it("includes results with scenario info", () => {
    const json = formatJSON(testRun, [testResult]);
    const parsed = JSON.parse(json);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].scenarioName).toBe("Login test");
    expect(parsed.results[0].status).toBe("passed");
  });

  it("includes screenshots in results", () => {
    const json = formatJSON(testRun, [testResult]);
    const parsed = JSON.parse(json);
    expect(parsed.results[0].screenshots).toHaveLength(1);
    expect(parsed.results[0].screenshots[0].action).toBe("navigate");
  });

  it("includes summary with totals", () => {
    const json = formatJSON(testRun, [testResult]);
    const parsed = JSON.parse(json);
    expect(parsed.summary.total).toBe(testRun.total);
    expect(parsed.summary.passed).toBe(testRun.passed);
    expect(parsed.summary.failed).toBe(testRun.failed);
    expect(parsed.summary.totalTokens).toBe(1500);
    expect(parsed.summary.totalCostCents).toBe(0.5);
  });
});

describe("getExitCode", () => {
  it("returns 0 for passed run", () => {
    const run = { ...testRun, status: "passed" } as Run;
    expect(getExitCode(run)).toBe(0);
  });

  it("returns 1 for failed run", () => {
    const run = { ...testRun, status: "failed" } as Run;
    expect(getExitCode(run)).toBe(1);
  });

  it("returns 2 for cancelled run", () => {
    const run = { ...testRun, status: "cancelled" } as Run;
    expect(getExitCode(run)).toBe(2);
  });

  it("returns 2 for pending run", () => {
    const run = { ...testRun, status: "pending" } as Run;
    expect(getExitCode(run)).toBe(2);
  });

  it("returns 2 for running run", () => {
    const run = { ...testRun, status: "running" } as Run;
    expect(getExitCode(run)).toBe(2);
  });
});

describe("formatSummary", () => {
  it("includes passed count", () => {
    const run = {
      ...testRun,
      status: "passed" as const,
      passed: 3,
      failed: 0,
      total: 3,
      finishedAt: new Date().toISOString(),
    };
    const summary = formatSummary(run);
    expect(summary).toContain("3 passed");
  });

  it("includes failed count when there are failures", () => {
    const run = {
      ...testRun,
      status: "failed" as const,
      passed: 2,
      failed: 1,
      total: 3,
      finishedAt: new Date().toISOString(),
    };
    const summary = formatSummary(run);
    expect(summary).toContain("2 passed");
    expect(summary).toContain("1 failed");
  });

  it("includes total count", () => {
    const run = {
      ...testRun,
      status: "passed" as const,
      passed: 5,
      failed: 0,
      total: 5,
      finishedAt: new Date().toISOString(),
    };
    const summary = formatSummary(run);
    expect(summary).toContain("5 total");
  });

  it("shows 'running' when no finishedAt", () => {
    const run = {
      ...testRun,
      status: "running" as const,
      passed: 0,
      failed: 0,
      total: 3,
      finishedAt: null,
    };
    const summary = formatSummary(run);
    expect(summary).toContain("running");
  });
});
