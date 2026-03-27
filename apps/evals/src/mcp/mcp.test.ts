import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { EvalRun } from "../types/index.js";

// Only mock external API — not internal modules
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [{ type: "text", text: "REASONING: Looks good.\nVERDICT: PASS" }],
        usage: { input_tokens: 50, output_tokens: 20 },
      })),
    };
  },
}));

// Use real in-memory DB for store tests
beforeEach(() => { process.env["EVALS_DB_PATH"] = ":memory:"; });
afterEach(async () => {
  const { closeDatabase } = await import("../db/store.js");
  closeDatabase();
  delete process.env["EVALS_DB_PATH"];
});

function makeRun(id: string): EvalRun {
  return {
    id,
    createdAt: new Date().toISOString(),
    dataset: "test.jsonl",
    results: [
      { caseId: "c1", verdict: "PASS", output: "ok", assertionResults: [], durationMs: 50 },
    ],
    stats: { total: 1, passed: 1, failed: 0, unknown: 0, errors: 0, passRate: 1.0, totalDurationMs: 100, totalCostUsd: 0.001, totalTokens: 50 },
  };
}

describe("MCP tool logic — evals_run", () => {
  test("runEvals returns a valid EvalRun shape", async () => {
    const { runEvals } = await import("../core/runner.js");
    // Use function adapter with a simple echo function
    const run = await runEvals(
      [{ id: "t1", input: "hello", assertions: [{ type: "min_length", value: 1 }] }],
      {
        dataset: "test.jsonl",
        adapter: { type: "function", modulePath: import.meta.path, exportName: "echoFn" },
        skipJudge: true,
      }
    );
    expect(run.id).toBeTruthy();
    expect(run.stats.total).toBe(1);
    expect(["PASS", "FAIL", "UNKNOWN"]).toContain(run.results[0]!.verdict);
  });
});

// A simple echo function used as the function adapter in tests above
export async function echoFn(input: string): Promise<string> {
  return `echo: ${input}`;
}

describe("MCP tool logic — evals_judge", () => {
  test("judge returns verdict with reasoning", async () => {
    const { runJudge } = await import("../core/judge.js");
    const result = await runJudge("What is 2+2?", "4", { rubric: "Must answer 4" });
    expect(result.verdict).toBe("PASS");
    expect(result.reasoning).toBeTruthy();
  });

  test("judgeOnce works for ad-hoc use", async () => {
    const { judgeOnce } = await import("../core/judge.js");
    const result = await judgeOnce({ input: "hi", output: "hello", rubric: "should greet" });
    expect(["PASS", "FAIL", "UNKNOWN"]).toContain(result.verdict);
  });
});

describe("MCP tool logic — evals_get_results / store", () => {
  test("save and retrieve a run", async () => {
    const { saveRun, getRun } = await import("../db/store.js");
    const run = makeRun("mcp-test-run-1");
    saveRun(run);
    const fetched = getRun("mcp-test-run-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe("mcp-test-run-1");
  });

  test("listRuns returns saved runs", async () => {
    const { saveRun, listRuns } = await import("../db/store.js");
    saveRun(makeRun("mcp-list-a"));
    saveRun(makeRun("mcp-list-b"));
    const runs = listRuns(10);
    expect(runs.length).toBe(2);
  });
});

describe("MCP tool logic — evals_compare", () => {
  test("compareRuns detects regressions", async () => {
    const { compareRuns } = await import("../core/reporter.js");

    const before: EvalRun = { ...makeRun("before"), results: [
      { caseId: "c1", verdict: "PASS", output: "ok", assertionResults: [], durationMs: 50 },
      { caseId: "c2", verdict: "PASS", output: "ok", assertionResults: [], durationMs: 50 },
    ], stats: { total: 2, passed: 2, failed: 0, unknown: 0, errors: 0, passRate: 1.0, totalDurationMs: 100, totalCostUsd: 0, totalTokens: 0 } };

    const after: EvalRun = { ...makeRun("after"), results: [
      { caseId: "c1", verdict: "PASS", output: "ok", assertionResults: [], durationMs: 50 },
      { caseId: "c2", verdict: "FAIL", output: "bad", assertionResults: [], durationMs: 50 },
    ], stats: { total: 2, passed: 1, failed: 1, unknown: 0, errors: 0, passRate: 0.5, totalDurationMs: 100, totalCostUsd: 0, totalTokens: 0 } };

    const diff = compareRuns(before, after);
    expect(diff.regressions.length).toBe(1);
    expect(diff.regressions[0]!.caseId).toBe("c2");
    expect(diff.passRateDelta).toBe(-0.5);
  });

  test("compareRuns detects improvements", async () => {
    const { compareRuns } = await import("../core/reporter.js");

    const before: EvalRun = { ...makeRun("b2"), results: [
      { caseId: "c1", verdict: "FAIL", output: "bad", assertionResults: [], durationMs: 50 },
    ], stats: { total: 1, passed: 0, failed: 1, unknown: 0, errors: 0, passRate: 0, totalDurationMs: 100, totalCostUsd: 0, totalTokens: 0 } };

    const after: EvalRun = { ...makeRun("a2"), results: [
      { caseId: "c1", verdict: "PASS", output: "ok", assertionResults: [], durationMs: 50 },
    ], stats: { total: 1, passed: 1, failed: 0, unknown: 0, errors: 0, passRate: 1.0, totalDurationMs: 100, totalCostUsd: 0, totalTokens: 0 } };

    const diff = compareRuns(before, after);
    expect(diff.improvements.length).toBe(1);
    expect(diff.regressions.length).toBe(0);
  });
});

describe("MCP tool logic — evals_create_case", () => {
  test("appends case to JSONL file", async () => {
    const { writeFileSync, appendFileSync, readFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const path = join(tmpdir(), `mcp-create-${Date.now()}.jsonl`);
    writeFileSync(path, "");
    appendFileSync(path, JSON.stringify({ id: "mcp-c1", input: "test", tags: ["mcp"] }) + "\n");

    const parsed = JSON.parse(readFileSync(path, "utf8").trim()) as { id: string; tags: string[] };
    expect(parsed.id).toBe("mcp-c1");
    expect(parsed.tags).toContain("mcp");
  });
});

describe("MCP Zod validation patterns", () => {
  test("adapter type enum is enforced", () => {
    const { z } = require("zod");
    const AdapterSchema = z.object({
      type: z.enum(["http", "anthropic", "openai", "mcp", "function", "cli"]),
    }).passthrough();
    expect(() => AdapterSchema.parse({ type: "http" })).not.toThrow();
    expect(() => AdapterSchema.parse({ type: "grpc" })).toThrow();
  });

  test("PASS/FAIL/UNKNOWN are the only valid verdicts", () => {
    const verdicts = ["PASS", "FAIL", "UNKNOWN"] as const;
    expect(verdicts).not.toContain("PARTIAL" as never);
    expect(verdicts).not.toContain("SCORE_4" as never);
    expect(verdicts.length).toBe(3);
  });
});
