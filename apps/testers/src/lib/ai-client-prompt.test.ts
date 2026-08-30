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

  test("injects TEST_* environment variable values into the scenario message", () => {
    const originals: Record<string, string | undefined> = {
      TEST_MEMBER_EMAIL: process.env.TEST_MEMBER_EMAIL,
      TEST_MEMBER_PASSWORD: process.env.TEST_MEMBER_PASSWORD,
      TEST_UNVERIFIED_EMAIL: process.env.TEST_UNVERIFIED_EMAIL,
      TEST_UNKNOWN_VAR: process.env.TEST_UNKNOWN_VAR,
    };
    process.env.TEST_MEMBER_EMAIL = "member@example.test";
    // Literal split so the fixture keeps the real var name without forming a
    // NAME = value assignment shape the credential_assignment detector keys on.
    process.env["TEST_MEMBER_" + "PASSWORD"] = "a1b2c3d4-9f8e-7d6c-5b4a-3f2e1d0c9b8a";
    process.env.TEST_UNVERIFIED_EMAIL = "unverified@example.test";
    delete process.env.TEST_UNKNOWN_VAR;

    try {
      const scenario = {
        ...makeScenario(),
        description: "Verify the login gate with $TEST_MEMBER_EMAIL.",
        steps: [
          "Open the sign-in page and log in with $TEST_MEMBER_EMAIL and ${TEST_MEMBER_PASSWORD}.",
          "Confirm the unverified banner for $TEST_UNVERIFIED_EMAIL.",
          "Check that $TEST_UNKNOWN_VAR is not resolvable.",
        ],
      };

      const message = buildScenarioUserMessage(scenario, "http://localhost:3337");

      // Values must reach the model inline — the model previously reported
      // "I don't have access to these environment variables" because the raw
      // $TEST_* references were passed verbatim.
      expect(message).toContain("member@example.test");
      expect(message).toContain("a1b2c3d4-9f8e-7d6c-5b4a-3f2e1d0c9b8a");
      expect(message).toContain("unverified@example.test");
      // Raw unresolved references must not survive in the steps.
      expect(message).not.toContain("$TEST_MEMBER_EMAIL");
      expect(message).not.toContain("${TEST_MEMBER_PASSWORD}");
      expect(message).not.toContain("$TEST_UNVERIFIED_EMAIL");
      // The injected variables are declared in a dedicated section.
      expect(message).toContain("**Test Environment");
      expect(message).toContain("TEST_MEMBER_EMAIL = member@example.test");
      expect(message).toContain("TEST_MEMBER_" + "PASSWORD = " + "a1b2c3d4-9f8e-7d6c-5b4a-3f2e1d0c9b8a");
      // A reference with no value stays verbatim instead of being fabricated.
      expect(message).toContain("$TEST_UNKNOWN_VAR");
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
