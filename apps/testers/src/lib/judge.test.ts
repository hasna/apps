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

// ─── OpenAI-compatible judge providers ───────────────────────────────────────

describe("judge — OpenAI-compatible providers", () => {
  it("routes GLM judge calls to Z.AI with the Z.AI provider key", async () => {
    const originalFetch = globalThis.fetch;
    const originalZaiKey = process.env["ZAI_API_KEY"];
    const originalAnthropicKey = process.env["ANTHROPIC_API_KEY"];
    process.env["ZAI_API_KEY"] = "zai-provider-test-key";
    process.env["ANTHROPIC_API_KEY"] = "anthropic-key-should-not-be-used";

    let requestBody: { model?: string } | undefined;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.z.ai/api/paas/v4/chat/completions");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer zai-provider-test-key",
          "Content-Type": "application/json",
        });
        requestBody = JSON.parse(String(init?.body)) as { model?: string };
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: JSON.stringify({ score: 1, pass: true, reason: "ok" }),
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }), { status: 200 });
      }) as typeof fetch;

      const result = await judge(
        { input: "question", output: "answer", rubric: { type: "llm", prompt: "Score this." } },
        { model: "glm-5.1" },
      );

      expect(requestBody?.model).toBe("glm-5.1");
      expect(result.provider).toBe("zai");
      expect(result.model).toBe("glm-5.1");
      expect(result.pass).toBe(true);
      expect(result.tokensUsed).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalZaiKey === undefined) delete process.env["ZAI_API_KEY"];
      else process.env["ZAI_API_KEY"] = originalZaiKey;
      if (originalAnthropicKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
      else process.env["ANTHROPIC_API_KEY"] = originalAnthropicKey;
    }
  });

  it("does not fall back to Anthropic keys for GLM judge calls", async () => {
    const originalZaiKey = process.env["ZAI_API_KEY"];
    const originalAnthropicKey = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ZAI_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "anthropic-key-should-not-be-used";

    try {
      await expect(judge(
        { input: "question", output: "answer", rubric: { type: "llm", prompt: "Score this." } },
        { model: "glm-5.1" },
      )).rejects.toThrow("No API key found for zai judge provider.");
    } finally {
      if (originalZaiKey === undefined) delete process.env["ZAI_API_KEY"];
      else process.env["ZAI_API_KEY"] = originalZaiKey;
      if (originalAnthropicKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
      else process.env["ANTHROPIC_API_KEY"] = originalAnthropicKey;
    }
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
