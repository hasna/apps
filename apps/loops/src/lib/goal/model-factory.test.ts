import { describe, expect, test } from "bun:test";
import { resolveGoalModel } from "./model-factory.js";

describe("goal model factory", () => {
  test("fails fast without OPENROUTER_API_KEY", () => {
    expect(() => resolveGoalModel({ env: {}, model: "openai/gpt-4o-mini" })).toThrow("OPENROUTER_API_KEY");
  });

  test("creates an OpenRouter language model without network access", () => {
    const model = resolveGoalModel({
      env: { OPENROUTER_API_KEY: "test-key" },
      model: "openai/gpt-4o-mini",
      baseURL: "http://127.0.0.1:8787/api/v1",
    }) as { provider: string; modelId: string };
    expect(model.provider).toContain("openrouter");
    expect(model.modelId).toBe("openai/gpt-4o-mini");
  });
});
