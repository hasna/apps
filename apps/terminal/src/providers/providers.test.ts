import { describe, it, expect } from "bun:test";
import { availableProviders, resetProvider } from "./index.js";

describe("providers", () => {
  it("lists available providers", () => {
    const providers = availableProviders();
    expect(providers.length).toBe(2);
    expect(providers[0].name).toBe("cerebras");
    expect(providers[1].name).toBe("anthropic");
  });

  it("resetProvider clears cache", () => {
    // Should not throw
    resetProvider();
  });
});
