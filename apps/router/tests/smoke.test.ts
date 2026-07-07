import { describe, expect, test } from "bun:test";
import { loadRouterConfig } from "../src/config";
import { routePrompt } from "../src/router";

describe("smoke path", () => {
  test("example config can route without provider credentials", async () => {
    const config = await loadRouterConfig("router.config.example.json");
    const decision = routePrompt({
      config,
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Implement a retry helper in TypeScript." }],
        hints: { task: "coding", priority: "quality" },
      },
    });
    expect(decision.status).toBe("selected");
    expect(decision.selectedId).toBeTruthy();
  });
});
