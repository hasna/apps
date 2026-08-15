import { describe, expect, test } from "bun:test";
import type { Scenario } from "../types/index.js";
import {
  defaultRouteFixturesForParams,
  materializeScenarioRoute,
  resolveRouteFixtures,
  routeParamsFromPath,
} from "./route-fixtures.js";

function scenario(input: Partial<Scenario>): Scenario {
  return {
    id: "scenario-1",
    shortId: "SCE-1",
    projectId: null,
    name: "Dynamic route",
    description: "Dynamic route",
    steps: ["Open /:orgSlug/users/:id and do not confirm destructive actions."],
    tags: [],
    priority: "high",
    model: null,
    timeoutMs: null,
    targetPath: "/:orgSlug/users/:id",
    requiresAuth: true,
    authConfig: null,
    metadata: { fixtureParams: ["orgSlug", "id"] },
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
    ...input,
  };
}

describe("route fixtures", () => {
  test("extracts route parameters from normalized route paths", () => {
    expect(routeParamsFromPath("/:orgSlug/files/:path*?/:id")).toEqual(["orgSlug", "path", "id"]);
  });

  test("builds stable defaults for common Alumia route params", () => {
    expect(defaultRouteFixturesForParams(["orgSlug", "projectId", "projectSlug"])).toEqual({
      orgSlug: "test-org",
      projectId: "00000000-0000-4000-8000-000000000000",
      projectSlug: "test-project",
    });
  });

  test("resolves scenario, env, and default fixture values", () => {
    const resolved = resolveRouteFixtures(
      scenario({
        parameters: { routeFixtures: { orgSlug: "scenario-org" } },
      }),
      {
        TESTERS_FIXTURE_ID: "22222222-2222-4222-8222-222222222222",
      },
    );

    expect(resolved.resolvedPath).toBe("/scenario-org/users/22222222-2222-4222-8222-222222222222");
    expect(resolved.sources).toEqual({ orgSlug: "scenario", id: "env" });
  });

  test("materializes target path and steps for runner prompts", () => {
    const result = materializeScenarioRoute(scenario());

    expect(result.scenario.targetPath).toBe("/test-org/users/00000000-0000-4000-8000-000000000000");
    expect(result.scenario.steps[0]).toContain("/test-org/users/00000000-0000-4000-8000-000000000000");
    expect(result.resolution.synthetic).toEqual(["orgSlug", "id"]);
  });
});
