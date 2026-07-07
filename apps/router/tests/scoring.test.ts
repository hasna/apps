import { describe, expect, test } from "bun:test";
import { routePrompt } from "../src/router";
import { testConfig } from "./helpers";

describe("candidate scoring", () => {
  test("cost priority chooses cheap eligible candidate", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Classify each row cheaply in bulk." }],
        hints: { priority: "cost" },
      },
    });
    expect(decision.selectedId).toBe("openai/cheap");
    expect(decision.scores.every((score) => !score.model.includes("deepseek"))).toBe(true);
  });

  test("quality priority chooses stronger coding candidate", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Implement a TypeScript compiler diagnostic fixer." }],
        hints: { priority: "quality" },
      },
    });
    expect(decision.selectedId).toBe("openai/coding");
  });

  test("runtime latency metrics can influence smart route", () => {
    const decision = routePrompt({
      config: testConfig(),
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Hi there." }],
        hints: { priority: "latency" },
      },
      runtime: {
        metrics: {
          "openai:openai/coding": { latencyMs: 100 },
          "openai:openai/cheap": { latencyMs: 900 },
        },
      },
    });
    expect(decision.selectedId).toBe("openai/coding");
  });
});
