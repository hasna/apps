import { describe, test, expect, mock } from "bun:test";
import type { EvalCase, AdapterConfig } from "../types/index.js";

// Mock adapters
mock.module("../adapters/http.js", () => ({
  callHttpAdapter: mock(async () => ({ output: "mock response", durationMs: 50 })),
}));
mock.module("../adapters/anthropic.js", () => ({
  callAnthropicAdapter: mock(async () => ({ output: "mock response", durationMs: 50 })),
}));
mock.module("../adapters/openai.js", () => ({
  callOpenAIAdapter: mock(async () => ({ output: "mock response", durationMs: 50 })),
}));
mock.module("../adapters/mcp.js", () => ({
  callMcpAdapter: mock(async () => ({ output: "mock response", durationMs: 50 })),
}));
mock.module("../adapters/function.js", () => ({
  callFunctionAdapter: mock(async () => ({ output: "mock response", durationMs: 50 })),
}));
mock.module("../adapters/cli.js", () => ({
  callCliAdapter: mock(async () => ({ output: "mock response", durationMs: 50 })),
}));

// Mock judge
mock.module("../core/judge.js", () => ({
  runJudge: mock(async () => ({
    verdict: "PASS",
    reasoning: "Looks good",
    durationMs: 100,
    inputTokens: 50,
    outputTokens: 20,
    costUsd: 0.001,
  })),
}));

const { runEvals, runSingleCase } = await import("./runner.js");

const adapter: AdapterConfig = { type: "http", url: "http://localhost:9999" };

const basicCase: EvalCase = {
  id: "test-001",
  input: "hello",
  assertions: [{ type: "min_length", value: 1 }],
  judge: { rubric: "Should respond" },
};

describe("runSingleCase", () => {
  test("returns PASS result for basic case", async () => {
    const result = await runSingleCase(basicCase, adapter);
    expect(result.caseId).toBe("test-001");
    expect(result.verdict).toBe("PASS");
    expect(result.output).toBe("mock response");
    expect(result.assertionResults.length).toBeGreaterThan(0);
    expect(result.assertionResults[0]!.passed).toBe(true);
  });

  test("skips judge when skipJudge=true", async () => {
    const result = await runSingleCase(basicCase, adapter, true);
    expect(result.judgeResult).toBeUndefined();
  });

  test("judge is skipped when assertion fails", async () => {
    const failCase: EvalCase = {
      id: "fail-001",
      input: "hello",
      assertions: [{ type: "contains", value: "IMPOSSIBLE_STRING_XYZ" }],
      judge: { rubric: "Should contain impossible string" },
    };
    const result = await runSingleCase(failCase, adapter);
    expect(result.verdict).toBe("FAIL");
    expect(result.judgeResult).toBeUndefined();
  });
});

describe("runEvals", () => {
  test("runs multiple cases in parallel", async () => {
    const cases: EvalCase[] = Array.from({ length: 5 }, (_, i) => ({
      id: `case-${i}`,
      input: `input ${i}`,
    }));
    const run = await runEvals(cases, { dataset: "test.jsonl", adapter, concurrency: 3 });
    expect(run.results.length).toBe(5);
    expect(run.stats.total).toBe(5);
    expect(run.id).toBeTruthy();
  });

  test("stats computed correctly", async () => {
    const cases: EvalCase[] = [
      { id: "pass-1", input: "hello" },
      { id: "pass-2", input: "world" },
    ];
    const run = await runEvals(cases, { dataset: "test.jsonl", adapter });
    expect(run.stats.passed + run.stats.failed + run.stats.unknown).toBe(run.stats.total);
    expect(run.stats.passRate).toBeGreaterThanOrEqual(0);
    expect(run.stats.passRate).toBeLessThanOrEqual(1);
  });

  test("filters cases by tags", async () => {
    const cases: EvalCase[] = [
      { id: "tagged", input: "hello", tags: ["smoke"] },
      { id: "untagged", input: "world" },
    ];
    const run = await runEvals(cases, { dataset: "test.jsonl", adapter, tags: ["smoke"] });
    expect(run.results.length).toBe(1);
    expect(run.results[0]!.caseId).toBe("tagged");
  });

  test("Pass^k: repeats case and tracks pass_rate", async () => {
    const passKCase: EvalCase = { id: "passk-001", input: "hello", repeat: 3 };
    const run = await runEvals([passKCase], { dataset: "test.jsonl", adapter });
    const result = run.results[0]!;
    expect(result.repeatVerdicts?.length).toBe(3);
    expect(result.passRate).toBeDefined();
    expect(result.passRate).toBeGreaterThanOrEqual(0);
  });
});
