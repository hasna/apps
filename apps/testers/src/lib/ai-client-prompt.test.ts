import { describe, expect, test } from "bun:test";
import { buildScenarioUserMessage } from "./ai-client.js";
import type { Scenario } from "../types/index.js";

function makeScenario(): Scenario {
  return {
    id: "scenario-1",
    shortId: "SCE-1",
    projectId: null,
    name: "Pricing discovery",
    description: "Validate pricing and docs.",
    steps: ["Open pricing.", "Navigate to docs from the same app."],
    tags: [],
    priority: "high",
    model: null,
    timeoutMs: null,
    targetPath: "/pricing",
    requiresAuth: false,
    authConfig: null,
    metadata: null,
    assertions: [],
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

describe("buildScenarioUserMessage", () => {
  test("anchors relative paths to the supplied base URL", () => {
    const message = buildScenarioUserMessage(makeScenario(), "http://localhost:3337");

    expect(message).toContain("**Base URL:** http://localhost:3337");
    expect(message).toContain("**Start URL:** http://localhost:3337/pricing");
    expect(message).toContain("Do not navigate to another host");
  });

  test("materializes dynamic target paths from scenario route fixtures", () => {
    const scenario = {
      ...makeScenario(),
      targetPath: "/:orgSlug/projects/:projectId",
      metadata: { fixtureParams: ["orgSlug", "projectId"] },
      parameters: {
        routeFixtures: {
          orgSlug: "acme",
          projectId: "11111111-1111-4111-8111-111111111111",
        },
      },
      steps: ["Open /:orgSlug/projects/:projectId."],
    };

    const message = buildScenarioUserMessage(scenario, "http://localhost:3337");

    expect(message).toContain("**Start URL:** http://localhost:3337/acme/projects/11111111-1111-4111-8111-111111111111");
    expect(message).toContain("- :orgSlug = acme (scenario)");
    expect(message).toContain("Open /acme/projects/11111111-1111-4111-8111-111111111111.");
  });
});
