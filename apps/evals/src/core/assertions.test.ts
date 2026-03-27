import { describe, test, expect } from "bun:test";
import { runAssertion, runAssertions, sortAssertionsCheapestFirst, allAssertionsPassed } from "./assertions.js";
import type { AssertionContext } from "./assertions.js";

const ctx: AssertionContext = {
  output: "Hello, World! This is a test response.",
  durationMs: 120,
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 0.001,
  toolCalls: [{ name: "search", arguments: { query: "test" } }],
};

describe("contains / not_contains", () => {
  test("contains: passes when substring present", async () => {
    const r = await runAssertion({ type: "contains", value: "Hello" }, ctx);
    expect(r.passed).toBe(true);
  });
  test("contains: fails when substring absent", async () => {
    const r = await runAssertion({ type: "contains", value: "XYZ" }, ctx);
    expect(r.passed).toBe(false);
  });
  test("not_contains: passes when absent", async () => {
    const r = await runAssertion({ type: "not_contains", value: "forbidden" }, ctx);
    expect(r.passed).toBe(true);
  });
  test("not_contains: fails when present", async () => {
    const r = await runAssertion({ type: "not_contains", value: "Hello" }, ctx);
    expect(r.passed).toBe(false);
  });
});

describe("starts_with / ends_with", () => {
  test("starts_with: passes", async () => {
    const r = await runAssertion({ type: "starts_with", value: "Hello" }, ctx);
    expect(r.passed).toBe(true);
  });
  test("starts_with: fails", async () => {
    const r = await runAssertion({ type: "starts_with", value: "World" }, ctx);
    expect(r.passed).toBe(false);
  });
  test("ends_with: passes", async () => {
    const r = await runAssertion({ type: "ends_with", value: "response." }, ctx);
    expect(r.passed).toBe(true);
  });
});

describe("equals", () => {
  test("passes on exact match", async () => {
    const c = { ...ctx, output: "exact" };
    const r = await runAssertion({ type: "equals", value: "exact" }, c);
    expect(r.passed).toBe(true);
  });
  test("fails on mismatch", async () => {
    const r = await runAssertion({ type: "equals", value: "other" }, ctx);
    expect(r.passed).toBe(false);
  });
});

describe("regex / not_regex", () => {
  test("regex: passes on match", async () => {
    const r = await runAssertion({ type: "regex", value: "Hello.*test" }, ctx);
    expect(r.passed).toBe(true);
  });
  test("regex: fails on no match", async () => {
    const r = await runAssertion({ type: "regex", value: "^FAIL" }, ctx);
    expect(r.passed).toBe(false);
  });
  test("not_regex: passes when no match", async () => {
    const r = await runAssertion({ type: "not_regex", value: "^FAIL" }, ctx);
    expect(r.passed).toBe(true);
  });
});

describe("length assertions", () => {
  test("max_length: passes", async () => {
    const r = await runAssertion({ type: "max_length", value: 1000 }, ctx);
    expect(r.passed).toBe(true);
  });
  test("max_length: fails", async () => {
    const r = await runAssertion({ type: "max_length", value: 5 }, ctx);
    expect(r.passed).toBe(false);
  });
  test("min_length: passes", async () => {
    const r = await runAssertion({ type: "min_length", value: 5 }, ctx);
    expect(r.passed).toBe(true);
  });
  test("min_length: fails", async () => {
    const r = await runAssertion({ type: "min_length", value: 9999 }, ctx);
    expect(r.passed).toBe(false);
  });
});

describe("json assertions", () => {
  test("json_valid: passes on valid JSON", async () => {
    const c = { ...ctx, output: '{"key":"value"}' };
    const r = await runAssertion({ type: "json_valid" }, c);
    expect(r.passed).toBe(true);
  });
  test("json_valid: fails on invalid JSON", async () => {
    const r = await runAssertion({ type: "json_valid" }, ctx);
    expect(r.passed).toBe(false);
  });
  test("json_schema: passes on matching schema", async () => {
    const c = { ...ctx, output: '{"name":"Alice","age":30}' };
    const r = await runAssertion({
      type: "json_schema",
      value: { type: "object", properties: { name: { type: "string" }, age: { type: "number" } }, required: ["name"] },
    }, c);
    expect(r.passed).toBe(true);
  });
  test("json_schema: fails on non-matching schema", async () => {
    const c = { ...ctx, output: '{"name":123}' };
    const r = await runAssertion({
      type: "json_schema",
      value: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    }, c);
    expect(r.passed).toBe(false);
  });
});

describe("tool assertions", () => {
  test("tool_called: passes when tool present", async () => {
    const r = await runAssertion({ type: "tool_called", value: "search" }, ctx);
    expect(r.passed).toBe(true);
  });
  test("tool_called: fails when tool absent", async () => {
    const r = await runAssertion({ type: "tool_called", value: "get_weather" }, ctx);
    expect(r.passed).toBe(false);
  });
  test("tool_not_called: passes when absent", async () => {
    const r = await runAssertion({ type: "tool_not_called", value: "forbidden_tool" }, ctx);
    expect(r.passed).toBe(true);
  });
  test("tool_call_count: passes in range", async () => {
    const r = await runAssertion({ type: "tool_call_count", min: 1, max: 3 }, ctx);
    expect(r.passed).toBe(true);
  });
  test("tool_call_count: fails outside range", async () => {
    const r = await runAssertion({ type: "tool_call_count", min: 5, max: 10 }, ctx);
    expect(r.passed).toBe(false);
  });
  test("tool_args_match: passes on matching args", async () => {
    const r = await runAssertion({ type: "tool_args_match", value: { tool: "search", args: { query: "test" } } }, ctx);
    expect(r.passed).toBe(true);
  });
  test("tool_args_match: fails on wrong args", async () => {
    const r = await runAssertion({ type: "tool_args_match", value: { tool: "search", args: { query: "wrong" } } }, ctx);
    expect(r.passed).toBe(false);
  });
});

describe("metric assertions", () => {
  test("response_time_ms: passes under limit", async () => {
    const r = await runAssertion({ type: "response_time_ms", max: 1000 }, ctx);
    expect(r.passed).toBe(true);
  });
  test("response_time_ms: fails over limit", async () => {
    const r = await runAssertion({ type: "response_time_ms", max: 50 }, ctx);
    expect(r.passed).toBe(false);
  });
  test("token_count: passes in range", async () => {
    const r = await runAssertion({ type: "token_count", min: 1, max: 100 }, ctx);
    expect(r.passed).toBe(true);
  });
  test("cost_usd: passes under limit", async () => {
    const r = await runAssertion({ type: "cost_usd", max: 1.0 }, ctx);
    expect(r.passed).toBe(true);
  });
  test("cost_usd: fails over limit", async () => {
    const r = await runAssertion({ type: "cost_usd", max: 0.0001 }, ctx);
    expect(r.passed).toBe(false);
  });
});

describe("sortAssertionsCheapestFirst", () => {
  test("puts semantic_similarity last", () => {
    const sorted = sortAssertionsCheapestFirst([
      { type: "semantic_similarity", value: "test" },
      { type: "contains", value: "hello" },
      { type: "json_valid" },
    ]);
    expect(sorted[sorted.length - 1]!.type).toBe("semantic_similarity");
    expect(sorted[0]!.type).toBe("contains");
  });
});

describe("runAssertions (short-circuit)", () => {
  test("stops after first failure and marks rest as skipped", async () => {
    const results = await runAssertions([
      { type: "contains", value: "MISSING" },
      { type: "min_length", value: 5 },
    ], ctx);
    expect(results[0]!.passed).toBe(false);
    expect(results[1]!.reason).toContain("Skipped");
  });

  test("allAssertionsPassed: true when all pass", async () => {
    const results = await runAssertions([
      { type: "contains", value: "Hello" },
      { type: "min_length", value: 5 },
    ], ctx);
    expect(allAssertionsPassed(results)).toBe(true);
  });
});
