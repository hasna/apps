import { describe, expect, test } from "bun:test";
import { parseAdapterConfig } from "./adapter-parser.js";

describe("parseAdapterConfig", () => {
  test("maps --url to baseURL for OpenAI-compatible endpoints", () => {
    const config = parseAdapterConfig({
      adapter: "openai",
      model: "llama3",
      url: "http://localhost:11434",
    });

    expect(config).toEqual({
      type: "openai",
      model: "llama3",
      baseURL: "http://localhost:11434",
      systemPrompt: undefined,
    });
  });

  test("reads explicit provider key from --api-key-env", () => {
    process.env["EVALS_TEST_OPENAI_KEY"] = "custom-endpoint-key";

    try {
      const config = parseAdapterConfig({
        adapter: "openai",
        model: "llama3",
        url: "http://localhost:11434",
        apiKeyEnv: "EVALS_TEST_OPENAI_KEY",
      });

      expect(config).toEqual({
        type: "openai",
        model: "llama3",
        baseURL: "http://localhost:11434",
        systemPrompt: undefined,
        apiKey: "custom-endpoint-key",
      });
    } finally {
      delete process.env["EVALS_TEST_OPENAI_KEY"];
    }
  });

  test("preserves advanced HTTP adapter options", () => {
    expect(parseAdapterConfig({
      adapter: "http",
      url: "https://app.example/api/chat",
      method: "patch",
      headers: JSON.stringify({ Authorization: "Bearer token" }),
      responseMode: "text",
      inputPath: "data.query",
      outputPath: "result.answer",
      timeoutMs: "1234",
    })).toEqual({
      type: "http",
      url: "https://app.example/api/chat",
      method: "PATCH",
      headers: { Authorization: "Bearer token" },
      responseMode: "text",
      inputPath: "data.query",
      outputPath: "result.answer",
      timeoutMs: 1234,
    });
  });

  test("preserves OpenAI-compatible base URL and max token options", () => {
    expect(parseAdapterConfig({
      adapter: "openai",
      model: "gpt-4o",
      url: "http://localhost:11434/v1",
      maxTokens: "256",
    })).toEqual({
      type: "openai",
      model: "gpt-4o",
      systemPrompt: undefined,
      baseURL: "http://localhost:11434/v1",
      maxTokens: 256,
    });
  });

  test("preserves CLI and MCP timeout options", () => {
    expect(parseAdapterConfig({
      adapter: "cli",
      command: "my-tool",
      timeoutMs: "99",
    })).toEqual({
      type: "cli",
      command: "my-tool",
      timeoutMs: 99,
    });

    expect(parseAdapterConfig({
      adapter: "mcp",
      mcpCommand: "node server.js",
      tool: "search",
      timeoutMs: "101",
    })).toEqual({
      type: "mcp",
      command: ["node", "server.js"],
      tool: "search",
      timeoutMs: 101,
    });
  });

  test("rejects invalid structured options early", () => {
    expect(() => parseAdapterConfig({
      adapter: "http",
      url: "https://app.example/api/chat",
      method: "DELETE",
    })).toThrow("--method");

    expect(() => parseAdapterConfig({
      adapter: "http",
      url: "https://app.example/api/chat",
      headers: JSON.stringify({ Authorization: 123 }),
    })).toThrow("--headers values");

    expect(() => parseAdapterConfig({
      adapter: "http",
      url: "https://app.example/api/chat",
      responseMode: "stream",
    })).toThrow("--response-mode");

    expect(() => parseAdapterConfig({
      adapter: "cli",
      command: "my-tool",
      timeoutMs: "0",
    })).toThrow("--timeout-ms");
  });
});
