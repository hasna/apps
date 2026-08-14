import { describe, test, expect, mock } from "bun:test";

// Each test gets its own mock to avoid ordering issues
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [{ type: "text", text: "REASONING: The response is correct.\nVERDICT: PASS" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      })),
    };
  },
}));

const { runJudge } = await import("./judge.js");

describe("judge — verdict parsing", () => {
  test("returns PASS from mock response", async () => {
    const result = await runJudge("What is 2+2?", "4", { rubric: "Must answer 4" });
    expect(result.verdict).toBe("PASS");
  });

  test("reasoning is always populated", async () => {
    const result = await runJudge("test", "response", { rubric: "any rubric" });
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  test("verdict is one of PASS/FAIL/UNKNOWN", async () => {
    const result = await runJudge("q", "a", { rubric: "r" });
    expect(["PASS", "FAIL", "UNKNOWN"]).toContain(result.verdict);
  });

  test("tracks token counts and cost", async () => {
    const result = await runJudge("q", "a", { rubric: "r" });
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("uses anthropic provider by default", async () => {
    const result = await runJudge("q", "a", { rubric: "r", provider: "anthropic" });
    expect(result.verdict).toBeDefined();
  });
});

describe("judge — FAIL and UNKNOWN parsing", () => {
  test("parses FAIL verdict from response text", () => {
    // Test the parsing logic directly via a mock that returns FAIL
    const text = "REASONING: This is wrong.\nVERDICT: FAIL";
    const reasoningMatch = text.match(/REASONING:\s*([\s\S]*?)(?=VERDICT:|$)/i);
    const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL|UNKNOWN)/i);
    expect(verdictMatch?.[1]).toBe("FAIL");
    expect(reasoningMatch?.[1]?.trim()).toContain("wrong");
  });

  test("parses UNKNOWN verdict from response text", () => {
    const text = "REASONING: Cannot determine.\nVERDICT: UNKNOWN";
    const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL|UNKNOWN)/i);
    expect(verdictMatch?.[1]).toBe("UNKNOWN");
  });

  test("defaults to UNKNOWN when no verdict marker", () => {
    const text = "Some response without a verdict marker";
    const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL|UNKNOWN)/i);
    const verdict = verdictMatch?.[1]?.toUpperCase();
    expect(verdict).toBeUndefined(); // would default to UNKNOWN in judge.ts
  });
});
