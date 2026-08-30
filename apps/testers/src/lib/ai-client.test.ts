process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, describe, it, expect } from "bun:test";
import {
  resolveModel,
  BROWSER_TOOLS,
  createClient,
  createClientForModel,
  createOpenAICompatibleConfig,
  detectProvider,
  resolveProviderApiKeyForModel,
  callOpenAICompatible,
} from "./ai-client.js";

interface CapturedMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string }>;
  tool_call_id?: string;
}

let capturedPayload: { model: string; messages: CapturedMessage[]; tools: unknown[]; max_tokens: number } | null = null;
let originalFetch: typeof globalThis.fetch;

function mockOpenAICompatibleEndpoint() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    capturedPayload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok", tool_calls: null }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined as unknown as typeof globalThis.fetch;
  }
  capturedPayload = null;
});

describe("resolveModel", () => {
  it("resolves 'quick' to haiku model ID", () => {
    expect(resolveModel("quick")).toBe("claude-haiku-4-5-20251001");
  });

  it("resolves 'thorough' to sonnet model ID", () => {
    expect(resolveModel("thorough")).toBe("claude-sonnet-4-6-20260311");
  });

  it("resolves 'deep' to opus model ID", () => {
    expect(resolveModel("deep")).toBe("claude-opus-4-6-20260311");
  });

  it("passes through direct model IDs unchanged", () => {
    expect(resolveModel("claude-3-haiku-20240307")).toBe(
      "claude-3-haiku-20240307",
    );
  });

  it("passes through arbitrary strings unchanged", () => {
    expect(resolveModel("my-custom-model-v2")).toBe("my-custom-model-v2");
  });
});

describe("BROWSER_TOOLS", () => {
  it("is an array", () => {
    expect(Array.isArray(BROWSER_TOOLS)).toBe(true);
  });

  it("contains expected tool names", () => {
    const toolNames = BROWSER_TOOLS.map((t) => t.name);
    expect(toolNames).toContain("navigate");
    expect(toolNames).toContain("click");
    expect(toolNames).toContain("fill");
    expect(toolNames).toContain("screenshot");
    expect(toolNames).toContain("get_text");
    expect(toolNames).toContain("get_url");
    expect(toolNames).toContain("wait_for");
    expect(toolNames).toContain("go_back");
    expect(toolNames).toContain("press_key");
    expect(toolNames).toContain("assert_visible");
    expect(toolNames).toContain("assert_text");
    expect(toolNames).toContain("report_result");
    expect(toolNames).toContain("select_option");
  });

  it("each tool has name, description, and input_schema", () => {
    for (const tool of BROWSER_TOOLS) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("input_schema");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.input_schema).toBe("object");
    }
  });
});

describe("createClient", () => {
  it("creates an Anthropic instance with a provided API key", () => {
    const client = createClient("test-api-key-123");
    expect(client).toBeDefined();
    expect(typeof client).toBe("object");
  });

  it("throws when no API key is provided and env is not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createClient()).toThrow("No Anthropic API key provided");
    } finally {
      if (original) {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });
});

describe("provider routing", () => {
  it("routes GLM models to Z.AI and Cerebras models to Cerebras", () => {
    expect(detectProvider("glm-5.1")).toBe("zai");
    expect(detectProvider("zai/glm-5.1")).toBe("zai");
    expect(detectProvider("zai-org/glm-5.1")).toBe("zai");
    expect(detectProvider("qwen-3-coder")).toBe("cerebras");
    expect(detectProvider("llama-3.3-70b")).toBe("cerebras");
  });

  it("uses provider-specific environment keys for OpenAI-compatible providers", () => {
    const oldCerebras = process.env["CEREBRAS_API_KEY"];
    const oldZai = process.env["ZAI_API_KEY"];
    process.env["CEREBRAS_API_KEY"] = "cerebras-provider-test-key";
    process.env["ZAI_API_KEY"] = "zai-provider-test-key";

    try {
      expect(createClientForModel("qwen-3-coder")).toMatchObject({
        provider: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: "cerebras-provider-test-key",
      });
      expect(createClientForModel("glm-5.1")).toMatchObject({
        provider: "zai",
        baseUrl: "https://api.z.ai/api/paas/v4",
        apiKey: "zai-provider-test-key",
      });
    } finally {
      if (oldCerebras === undefined) delete process.env["CEREBRAS_API_KEY"];
      else process.env["CEREBRAS_API_KEY"] = oldCerebras;
      if (oldZai === undefined) delete process.env["ZAI_API_KEY"];
      else process.env["ZAI_API_KEY"] = oldZai;
    }
  });

  it("allows an explicit key to override the provider environment key", () => {
    expect(createOpenAICompatibleConfig("zai", "explicit-zai-key")).toMatchObject({
      provider: "zai",
      apiKey: "explicit-zai-key",
    });
  });

  it("uses configured Anthropic keys only for Anthropic models", () => {
    expect(resolveProviderApiKeyForModel("claude-haiku-4-5-20251001", undefined, "anthropic-config-key")).toBe(
      "anthropic-config-key",
    );
    expect(resolveProviderApiKeyForModel("qwen-3-coder", undefined, "anthropic-config-key")).toBeUndefined();
    expect(resolveProviderApiKeyForModel("glm-5.1", undefined, "anthropic-config-key")).toBeUndefined();
  });
});

describe("callOpenAICompatible tool-call sequencing", () => {
  // The exact multi-turn history the agent loop appends after two tool-call
  // turns: assistant messages carry mixed text + tool_use blocks, and each
  // tool batch comes back as a user message of tool_result blocks.
  function twoTurnHistory() {
    return [
      { role: "user", content: "Scenario: log in with the test member." },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll fill the email field." },
          { type: "tool_use", id: "call_a", name: "fill", input: { selector: "#email", value: "member@example.test" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_a", content: "filled" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now the password." },
          { type: "tool_use", id: "call_b", name: "fill", input: { selector: "#password", value: "s3cret" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_b", content: "filled" }],
      },
    ];
  }

  it("sends one assistant message carrying both content and tool_calls per assistant turn", async () => {
    mockOpenAICompatibleEndpoint();
    await callOpenAICompatible({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      system: "You are a QA engineer.",
      messages: twoTurnHistory() as never,
      tools: BROWSER_TOOLS,
    });

    expect(capturedPayload).not.toBeNull();
    const assistantMessages = capturedPayload!.messages.filter((m) => m.role === "assistant");
    // One logical assistant turn (text + tool_use) must be ONE message with
    // both fields — splitting it into a plain assistant message followed by a
    // tool_calls assistant message breaks OpenAI's sequence contract
    // ("An assistant message with tool_calls must be followed by tool messages
    // responding to each tool_call_id") and was rejected live by gpt-4o-mini.
    expect(assistantMessages).toHaveLength(2);
    for (const msg of assistantMessages) {
      expect(typeof msg.content).toBe("string");
      expect(msg.tool_calls).toBeDefined();
      expect(msg.tool_calls!.length).toBeGreaterThan(0);
    }
    expect(assistantMessages[0]!.content).toContain("email field");
    expect(assistantMessages[1]!.content).toContain("password");
    expect(assistantMessages[0]!.tool_calls![0]!.id).toBe("call_a");
    expect(assistantMessages[1]!.tool_calls![0]!.id).toBe("call_b");
  });

  it("never interleaves a non-tool message between an assistant tool_calls message and its tool responses", async () => {
    mockOpenAICompatibleEndpoint();
    await callOpenAICompatible({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      system: "You are a QA engineer.",
      messages: twoTurnHistory() as never,
      tools: BROWSER_TOOLS,
    });

    const msgs = capturedPayload!.messages;
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]!;
      if (msg.role !== "assistant" || !msg.tool_calls || msg.tool_calls.length === 0) continue;
      const declared = new Set(msg.tool_calls.map((tc) => tc.id));
      // The very next message must be a tool response for one of these ids —
      // tool messages must answer the tool_calls before any next assistant turn.
      const next = msgs[i + 1];
      expect(next).toBeDefined();
      expect(next!.role).toBe("tool");
      expect(declared.has(next!.tool_call_id!)).toBe(true);
    }
  });

  it("does not emit consecutive assistant messages", async () => {
    mockOpenAICompatibleEndpoint();
    await callOpenAICompatible({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      system: "You are a QA engineer.",
      messages: twoTurnHistory() as never,
      tools: BROWSER_TOOLS,
    });

    const msgs = capturedPayload!.messages;
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i]!.role === "assistant") {
        expect(msgs[i + 1]!.role).not.toBe("assistant");
      }
    }
  });
});
