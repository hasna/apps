import { describe, it, expect } from "bun:test";
import { availableProviders, resetProvider } from "./index.js";

describe("providers", () => {
  it("lists available providers", () => {
    const providers = availableProviders();
    expect(providers.length).toBe(4);
    expect(providers[0].name).toBe("cerebras");
    expect(providers[1].name).toBe("groq");
    expect(providers[2].name).toBe("xai");
    expect(providers[3].name).toBe("anthropic");
  });

  it("resetProvider clears cache", () => {
    // Should not throw
    resetProvider();
  });
});
