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
});
