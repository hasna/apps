import { describe, test, expect } from "bun:test";
import { formatPRComment, formatCommitStatus } from "./pr-comment.js";

describe("PR comment formatting (OPE9-00278)", () => {
  const sampleRun = {
    id: "run-abc123",
    url: "http://test.example",
    status: "failed",
    model: "claude-haiku",
    startedAt: "2026-04-04T12:00:00.000Z",
    finishedAt: "2026-04-04T12:01:30.000Z",
    projectId: null,
    passed: 2,
    failed: 1,
    total: 3,
  };

  const sampleResults = [
    { scenarioId: "scenario-1", status: "passed", model: "quick", durationMs: 5000, tokensUsed: 1000, costCents: 1, stepsCompleted: 3, stepsTotal: 3 } as any,
    { scenarioId: "scenario-2", status: "passed", model: "quick", durationMs: 3000, tokensUsed: 800, costCents: 1, stepsCompleted: 2, stepsTotal: 2 } as any,
    { scenarioId: "scenario-3", status: "failed", model: "quick", durationMs: 2000, tokensUsed: 500, costCents: 1, stepsCompleted: 1, stepsTotal: 3, reasoning: "Element #submit not found" } as any,
  ];

  test("generates header with status", () => {
    const comment = formatPRComment({ run: sampleRun, results: sampleResults });
    expect(comment).toContain("Test Results: FAILED");
    expect(comment).toContain("##");
  });

  test("generates summary table", () => {
    const comment = formatPRComment({ run: sampleRun, results: sampleResults });
    expect(comment).toContain("| Metric | Value |");
    expect(comment).toContain("| Total Scenarios | 3 |");
    expect(comment).toContain("| Passed | 2 |");
    expect(comment).toContain("| Failed | 1 |");
  });

  test("lists failed scenarios", () => {
    const comment = formatPRComment({ run: sampleRun, results: sampleResults });
    expect(comment).toContain("### Failed Scenarios");
    expect(comment).toContain("Element #submit not found");
  });

  test("includes report URL when provided", () => {
    const comment = formatPRComment({
      run: sampleRun,
      results: sampleResults,
      reportUrl: "https://reports.example.com/run-abc123",
    });
    expect(comment).toContain("[Full Report]");
    expect(comment).toContain("https://reports.example.com/run-abc123");
  });

  test("includes cost when provided", () => {
    const comment = formatPRComment({
      run: sampleRun,
      results: sampleResults,
      costCents: 150,
    });
    expect(comment).toContain("$1.50");
  });

  test("formats passing run correctly", () => {
    const passingRun = { ...sampleRun, status: "passed", passed: 3, failed: 0 };
    const passingResults = sampleResults.map((r) => ({ ...r, status: "passed" }));
    const comment = formatPRComment({ run: passingRun, results: passingResults });
    expect(comment).toContain("Test Results: PASSED");
    expect(comment).not.toContain("### Failed Scenarios");
  });

  test("formatCommitStatus returns correct format", () => {
    const status = formatCommitStatus(sampleRun, sampleResults);
    expect(status).toContain("failure");
    expect(status).toContain("2/3 passed");
    expect(status).toContain("open-testers/claude-haiku");
  });

  test("formatCommitStatus returns success for all passed", () => {
    const passingResults = sampleResults.map((r) => ({ ...r, status: "passed" }));
    const status = formatCommitStatus(sampleRun, passingResults);
    expect(status).toContain("success");
    expect(status).toContain("3/3 passed");
  });
});
