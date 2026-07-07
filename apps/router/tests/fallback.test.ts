import { describe, expect, test } from "bun:test";
import { routePrompt } from "../src/router";
import { testConfig } from "./helpers";

describe("fallback routing", () => {
  test("preserves configured fallback order after skips", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "coding",
        messages: [{ role: "user", content: "Implement a parser." }],
      },
    });
    expect(decision.mode).toBe("fallback");
    expect(decision.resolvedCandidates).toEqual(["deepseek/coder", "openai/coding"]);
    expect(decision.selectedId).toBe("openai/coding");
  });

  test("fails cheapest route when all eligible candidates are unpriced", () => {
    const config = testConfig();
    config.routes[0] = { ...config.routes[0]!, mode: "cheapest" };
    config.models = config.models.map(({ inputUsdPerMillionTokens: _input, outputUsdPerMillionTokens: _output, ...model }) => model);
    const decision = routePrompt({
      config,
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Hello." }],
      },
    });
    expect(decision.status).toBe("no_route");
    expect(decision.reason).toContain("configured token price");
  });
});
