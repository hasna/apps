import { describe, expect, test } from "bun:test";
import { routePrompt } from "../src/router";
import { testConfig } from "./helpers";

describe("sticky routing", () => {
  test("uses deterministic sticky tie-breaker", () => {
    const config = testConfig();
    config.models = config.models.map((model) =>
      model.id === "openai/cheap" || model.id === "openai/coding"
        ? {
            ...model,
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 1,
            qualityScore: 0.7,
            averageLatencyMs: 1000,
            successRate: 0.99,
            taskQuality: { chat: 0.7 },
          }
        : model,
    );

    const request = {
      model: "auto",
      messages: [{ role: "user" as const, content: "Hello" }],
      hints: { stickySessionId: "session-a", priority: "balanced" as const },
    };
    const first = routePrompt({ config, request });
    const second = routePrompt({ config, request });
    expect(first.selectedId).toBe(second.selectedId);
    expect(JSON.stringify(first.scores)).toBe(JSON.stringify(second.scores));
  });
});
