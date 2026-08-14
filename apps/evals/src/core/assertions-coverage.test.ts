import { describe, test, expect, mock } from "bun:test";
import { runAssertion, runAssertions } from "./assertions.js";
import type { AssertionContext } from "./assertions.js";

const ctx: AssertionContext = {
  output: "The quick brown fox",
  durationMs: 50,
  inputTokens: 5,
  outputTokens: 10,
  costUsd: 0.0005,
  toolCalls: [],
};

// ─── semantic_similarity with OpenAI embeddings mock ─────────────────────────

describe("semantic_similarity — OpenAI embeddings path", () => {
  test("passes when cosine similarity meets threshold", async () => {
    // Mock fetch to return embeddings with high cosine similarity
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
      return {
        json: async () => ({
          data: [
            { embedding: vec },
            { embedding: vec }, // identical => cosine = 1.0
          ],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    process.env["OPENAI_API_KEY"] = "test-key";

    const result = await runAssertion(
      { type: "semantic_similarity", value: "The quick brown fox", threshold: 0.9 },
      ctx
    );
    globalThis.fetch = origFetch;
    delete process.env["OPENAI_API_KEY"];

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("1.000");
  });

  test("fails when cosine similarity below threshold", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return {
        json: async () => ({
          data: [
            { embedding: [1, 0, 0, 0, 0] },
            { embedding: [0, 1, 0, 0, 0] }, // orthogonal => cosine = 0.0
          ],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    process.env["OPENAI_API_KEY"] = "test-key";

    const result = await runAssertion(
      { type: "semantic_similarity", value: "completely different", threshold: 0.8 },
      ctx
    );
    globalThis.fetch = origFetch;
    delete process.env["OPENAI_API_KEY"];

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("below threshold");
  });

  test("falls back to Jaccard when OpenAI API fails", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => { throw new Error("network error"); }) as unknown as typeof fetch;
    process.env["OPENAI_API_KEY"] = "test-key";

    const result = await runAssertion(
      { type: "semantic_similarity", value: "The quick brown fox", threshold: 0.5 },
      ctx
    );
    globalThis.fetch = origFetch;
    delete process.env["OPENAI_API_KEY"];

    // Jaccard on identical strings = 1.0 → should pass
    expect(result.passed).toBe(true);
  });

  test("uses Jaccard fallback when no OPENAI_API_KEY", async () => {
    const savedKey = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];

    // Identical strings → Jaccard = 1.0
    const result = await runAssertion(
      { type: "semantic_similarity", value: "The quick brown fox", threshold: 0.9 },
      ctx
    );
    if (savedKey) process.env["OPENAI_API_KEY"] = savedKey;

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("≥");
  });

  test("Jaccard gives low score for very different strings", async () => {
    const savedKey = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];

    const result = await runAssertion(
      {
        type: "semantic_similarity",
        value: "zxqvwbm completely unrelated words xyz",
        threshold: 0.9, // high threshold
      },
      { ...ctx, output: "the quick brown fox jumps over the lazy dog" }
    );
    if (savedKey) process.env["OPENAI_API_KEY"] = savedKey;

    expect(result.passed).toBe(false);
  });
});

// ─── Assertion short-circuit and edge cases ───────────────────────────────────

describe("assertions — edge cases and short-circuit", () => {
  test("unknown assertion type returns failed result with message", async () => {
    const result = await runAssertion(
      { type: "nonexistent_type" as never },
      ctx
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Unknown assertion type");
  });

  test("json_schema fails on non-parseable output", async () => {
    const result = await runAssertion(
      { type: "json_schema", value: { type: "object" } },
      { ...ctx, output: "not json at all" }
    );
    expect(result.passed).toBe(false);
  });

  test("tool_args_match: fails when tool not called", async () => {
    const result = await runAssertion(
      { type: "tool_args_match", value: { tool: "search", args: { q: "test" } } },
      { ...ctx, toolCalls: [] }
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("not called");
  });

  test("tool_args_match: passes when args match exactly", async () => {
    const result = await runAssertion(
      { type: "tool_args_match", value: { tool: "search", args: { q: "test" } } },
      { ...ctx, toolCalls: [{ name: "search", arguments: { q: "test" } }] }
    );
    expect(result.passed).toBe(true);
  });

  test("runAssertions: all passing returns true", async () => {
    const results = await runAssertions([
      { type: "min_length", value: 1 },
      { type: "max_length", value: 9999 },
    ], ctx);
    expect(results.every(r => r.passed)).toBe(true);
  });

  test("cost_usd: passes when cost equals max", async () => {
    const result = await runAssertion(
      { type: "cost_usd", max: 0.0005 },
      ctx
    );
    expect(result.passed).toBe(true); // 0.0005 <= 0.0005
  });

  test("token_count with only min", async () => {
    const result = await runAssertion(
      { type: "token_count", min: 5 },
      { ...ctx, inputTokens: 5, outputTokens: 5 } // total = 10
    );
    expect(result.passed).toBe(true);
  });
});

// Note: OpenAI judge path is tested indirectly via openai adapter tests in
// src/adapters/anthropic-openai.test.ts — mock.module isolation prevents
// testing it directly here alongside the Anthropic mock in judge.test.ts.
