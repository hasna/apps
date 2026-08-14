import { describe, expect, test } from "bun:test";
import { applyStructuredAssertionsToResult } from "./runner.js";
import type { Scenario } from "../types/index.js";

function makeScenario(assertions: Scenario["assertions"]): Scenario {
  return {
    id: "scenario-1",
    shortId: "SCE-1",
    projectId: null,
    name: "Console hygiene",
    description: "Verifies that console errors fail the scenario.",
    steps: [],
    tags: [],
    priority: "medium",
    model: null,
    timeoutMs: null,
    targetPath: null,
    requiresAuth: false,
    authConfig: null,
    metadata: null,
    assertions,
    personaId: null,
    scenarioType: "browser",
    requiredRole: null,
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastPassedAt: null,
    lastPassedUrl: null,
    parameters: null,
  };
}

describe("applyStructuredAssertionsToResult", () => {
  test("fails an otherwise passing result when captured console errors violate no-console-errors", async () => {
    const outcome = await applyStructuredAssertionsToResult({
      page: {} as never,
      scenario: makeScenario([
        { type: "no_console_errors", description: "No console errors" },
      ]),
      consoleErrors: ["Hydration mismatch in /auth/login"],
      status: "passed",
      reasoning: "Agent completed the requested flow.",
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.reasoning).toContain("Structured assertions failed");
    expect(outcome.assertionsFailed).toEqual([
      "No console errors (actual: Hydration mismatch in /auth/login)",
    ]);
  });
});
