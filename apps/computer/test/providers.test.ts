import { describe, test, expect } from "bun:test";
import { createProvider } from "../src/providers/index.js";

describe("providers", () => {
  test("createProvider('anthropic') creates AnthropicProvider", () => {
    const provider = createProvider("anthropic");
    expect(provider.name).toBe("anthropic");
  });

  test("createProvider('openai') creates OpenAIProvider", () => {
    const provider = createProvider("openai");
    expect(provider.name).toBe("openai");
  });

  test("createProvider with unknown provider throws", () => {
    expect(() => createProvider("unknown" as any)).toThrow("Unknown provider");
  });
});
