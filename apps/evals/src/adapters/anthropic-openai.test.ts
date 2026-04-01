import { describe, test, expect, mock } from "bun:test";

// ─── Mock Anthropic SDK ───────────────────────────────────────────────────────

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async (params: { messages: Array<{ content: string }> }) => {
        const lastContent = params.messages[params.messages.length - 1]?.content ?? "";
        return {
          content: [
            { type: "text", text: `Mock response to: ${lastContent}` },
          ],
          usage: { input_tokens: 15, output_tokens: 10 },
          stop_reason: "end_turn",
        };
      }),
    };
  },
}));

// ─── Mock OpenAI SDK ──────────────────────────────────────────────────────────

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mock(async (params: { messages: Array<{ content: string }> }) => {
          const lastContent = params.messages[params.messages.length - 1]?.content ?? "";
          return {
            choices: [{
              message: {
                content: `OpenAI response to: ${lastContent}`,
                tool_calls: undefined,
              },
              finish_reason: "stop",
            }],
            usage: { prompt_tokens: 12, completion_tokens: 8 },
          };
        }),
      },
    };
  },
}));

const { callAnthropicAdapter } = await import("./anthropic.js");
const { callOpenAIAdapter } = await import("./openai.js");

// ─── Anthropic adapter tests ──────────────────────────────────────────────────

describe("Anthropic adapter", () => {
  test("calls Anthropic API and returns output", async () => {
    const result = await callAnthropicAdapter(
      { type: "anthropic", model: "claude-sonnet-4-6" },
      "hello"
    );
    expect(result.output).toContain("hello");
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("captures token usage and cost", async () => {
    const result = await callAnthropicAdapter(
      { type: "anthropic", model: "claude-sonnet-4-6" },
      "hello"
    );
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(10);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  test("passes system prompt", async () => {
    const result = await callAnthropicAdapter(
      { type: "anthropic", model: "claude-sonnet-4-6", systemPrompt: "You are a tester" },
      "test input"
    );
    expect(result.output).toBeTruthy();
  });

  test("supports multi-turn conversation", async () => {
    const result = await callAnthropicAdapter(
      { type: "anthropic", model: "claude-sonnet-4-6" },
      "",
      [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ]
    );
    expect(result.output).toBeTruthy();
    expect(result.error).toBeUndefined();
  });
});

// ─── OpenAI adapter tests ─────────────────────────────────────────────────────

describe("OpenAI adapter", () => {
  test("calls OpenAI API and returns output", async () => {
    const result = await callOpenAIAdapter(
      { type: "openai", model: "gpt-4o" },
      "hello"
    );
    expect(result.output).toContain("hello");
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("captures token usage and cost", async () => {
    const result = await callOpenAIAdapter(
      { type: "openai", model: "gpt-4o" },
      "hello"
    );
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(8);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  test("passes system prompt in messages", async () => {
    const result = await callOpenAIAdapter(
      { type: "openai", model: "gpt-4o", systemPrompt: "You are a tester" },
      "test input"
    );
    expect(result.output).toBeTruthy();
  });

  test("supports multi-turn conversation", async () => {
    const result = await callOpenAIAdapter(
      { type: "openai", model: "gpt-4o" },
      "",
      [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ]
    );
    expect(result.output).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  test("works with custom baseURL (Ollama-style)", async () => {
    const result = await callOpenAIAdapter(
      { type: "openai", model: "llama3", baseURL: "http://localhost:11434/v1" },
      "hello"
    );
    expect(result.output).toBeTruthy();
  });
});

// ─── resolveKey in judge (via env injection) ─────────────────────────────────

describe("judge.ts resolveKey — secrets fallback", () => {
  test("ANTHROPIC_API_KEY is injected from secrets on module load", async () => {
    // The judge module runs resolveKey eagerly on load.
    // In CI or clean envs it reads from ~/.secrets if available.
    // We just verify the module imports without throwing.
    const { runJudge } = await import("../core/judge.js");
    expect(typeof runJudge).toBe("function");
  });
});
