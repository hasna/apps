process.env.TESTERS_DB_PATH = ":memory:";

import { describe, it, expect } from "bun:test";
import { resolveModel, BROWSER_TOOLS, createClient } from "./ai-client.js";

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
