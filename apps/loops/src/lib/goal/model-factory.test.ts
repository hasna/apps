import { describe, expect, test } from "bun:test";
import { resolveGoalModel, resolveGoalVerifierModel } from "./model-factory.js";

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

  test("verifier resolution prefers LOOPS_GOAL_VERIFIER_MODEL over LOOPS_GOAL_MODEL", () => {
    const model = resolveGoalVerifierModel({
      env: {
        OPENROUTER_API_KEY: "test-key",
        LOOPS_GOAL_MODEL: "openai/gpt-4o-mini",
        LOOPS_GOAL_VERIFIER_MODEL: "openai/gpt-4o",
      },
      baseURL: "http://127.0.0.1:8787/api/v1",
    }) as { modelId: string };
    expect(model.modelId).toBe("openai/gpt-4o");
  });

  test("verifier resolution falls back to the configured goal model", () => {
    const model = resolveGoalVerifierModel({
      env: { OPENROUTER_API_KEY: "test-key", LOOPS_GOAL_MODEL: "openai/gpt-4o-mini" },
      baseURL: "http://127.0.0.1:8787/api/v1",
    }) as { modelId: string };
    expect(model.modelId).toBe("openai/gpt-4o-mini");
  });
});
