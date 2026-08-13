import { describe, expect, test } from "bun:test";
import { routePrompt } from "../src/router";
import { testConfig } from "./helpers";

describe("deterministic decisions", () => {
  test("same input returns same decision", () => {
    const input = {
      config: testConfig(),
      request: {
        model: "auto",
        messages: [{ role: "user" as const, content: "Summarize these logs as JSON." }],
        response_format: { type: "json_object" },
        hints: { priority: "balanced" as const, stickySessionId: "deterministic" },
      },
    };
    const first = routePrompt(input);
    const second = routePrompt(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
