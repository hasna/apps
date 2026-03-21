import { describe, it, expect, beforeAll, mock } from "bun:test";
import { judge, judgeAll } from "./judge.js";
import type { JudgeInput } from "./judge.js";

// ─── Deterministic rubrics (no LLM needed) ───────────────────────────────────

describe("judge — deterministic rubrics", () => {
  it("contains: passes when output includes value", async () => {
    const result = await judge({ input: "q", output: "The refund policy is 30 days.", rubric: { type: "contains", value: "30 days" } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
    expect(result.tokensUsed).toBe(0);
    expect(result.provider).toBe("none");
  });

  it("contains: fails when output missing value", async () => {
    const result = await judge({ input: "q", output: "No refunds.", rubric: { type: "contains", value: "30 days" } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it("not_contains: passes when value absent", async () => {
    const result = await judge({ input: "q", output: "Hello world", rubric: { type: "not_contains", value: "error" } });
    expect(result.pass).toBe(true);
  });

  it("not_contains: fails when value present", async () => {
    const result = await judge({ input: "q", output: "An error occurred", rubric: { type: "not_contains", value: "error" } });
    expect(result.pass).toBe(false);
  });

  it("regex: passes when pattern matches", async () => {
    const result = await judge({ input: "q", output: "Price: $12.99", rubric: { type: "regex", pattern: "\\$\\d+\\.\\d{2}" } });
    expect(result.pass).toBe(true);
  });

  it("regex: fails when no match", async () => {
    const result = await judge({ input: "q", output: "Price: free", rubric: { type: "regex", pattern: "\\$\\d+" } });
    expect(result.pass).toBe(false);
  });

  it("factual: passes when all facts present", async () => {
    const result = await judge({ input: "q", output: "The sky is blue and grass is green.", rubric: { type: "factual", facts: ["sky is blue", "grass is green"] } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it("factual: partial score when some facts missing", async () => {
    const result = await judge({ input: "q", output: "The sky is blue.", rubric: { type: "factual", facts: ["sky is blue", "grass is green"] } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0.5);
  });

  it("no_pii: passes when no PII detected", async () => {
    const result = await judge({ input: "q", output: "The weather is nice today.", rubric: { type: "no_pii" } });
    expect(result.pass).toBe(true);
    expect(result.tokensUsed).toBe(0);
  });

  it("no_pii: fails when email detected", async () => {
    const result = await judge({ input: "q", output: "Contact us at admin@example.com for help.", rubric: { type: "no_pii" } });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("email");
  });

  it("no_pii: fails when API key detected", async () => {
    const result = await judge({ input: "q", output: "Use key sk-abc123def456ghi789jkl012mno345pqr678stu", rubric: { type: "no_pii" } });
    expect(result.pass).toBe(false);
  });

  it("no_pii: custom patterns", async () => {
    const result = await judge({ input: "q", output: "SECRET-12345 is your token", rubric: { type: "no_pii", patterns: ["SECRET-\\d+"] } });
    expect(result.pass).toBe(false);
  });
});

// ─── Batch judge ─────────────────────────────────────────────────────────────

describe("judgeAll", () => {
  it("aggregates multiple deterministic results", async () => {
    const inputs: JudgeInput[] = [
      { input: "q", output: "has 30 days refund", rubric: { type: "contains", value: "30 days" } },
      { input: "q", output: "no match here", rubric: { type: "contains", value: "30 days" } },
      { input: "q", output: "clean output", rubric: { type: "no_pii" } },
    ];
    const batch = await judgeAll(inputs);
    expect(batch.passCount).toBe(2);
    expect(batch.failCount).toBe(1);
    expect(batch.avgScore).toBeCloseTo(2 / 3, 2);
    expect(batch.totalTokensUsed).toBe(0);
  });
});

// ─── rubricType metadata ──────────────────────────────────────────────────────

describe("judge — rubricType field", () => {
  it("sets correct rubricType for contains", async () => {
    const r = await judge({ input: "", output: "x", rubric: { type: "contains", value: "x" } });
    expect(r.rubricType).toBe("contains");
  });

  it("sets correct rubricType for factual", async () => {
    const r = await judge({ input: "", output: "x", rubric: { type: "factual", facts: ["x"] } });
    expect(r.rubricType).toBe("factual");
  });

  it("durationMs is a non-negative number", async () => {
    const r = await judge({ input: "", output: "x", rubric: { type: "contains", value: "x" } });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
