import { describe, expect, test } from "bun:test";
import type { Workspace } from "../types/workspace.js";
import { filterRegistryFixtures, isRegistryFixtureProject } from "./project-registry-fixtures.js";

function workspace(slug: string, tags: string[] = []): Workspace {
  return {
    id: `ws-${slug}`,
    slug,
    name: slug,
    description: null,
    kind: "generic",
    status: "active",
    root_id: null,
    recipe_id: null,
    primary_path: null,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags,
    integrations: {},
    metadata: {},
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    synced_at: null,
  } as Workspace;
}

describe("registry fixture projects", () => {
  test("isRegistryFixtureProject recognises the registry-fixture tag", () => {
    expect(isRegistryFixtureProject(workspace("real-project"))).toBe(false);
    expect(isRegistryFixtureProject(workspace("fixture-project", ["registry-fixture"]))).toBe(true);
    expect(isRegistryFixtureProject(workspace("fixture-project", ["github", "registry-fixture"]))).toBe(true);
    // A similarly-named tag is not the fixture marker.
    expect(isRegistryFixtureProject(workspace("other", ["registry-fixtures"]))).toBe(false);
    expect(isRegistryFixtureProject(workspace("other", ["registry"]))).toBe(false);
  });

  test("filterRegistryFixtures excludes fixture rows by default and keeps them with --include-fixtures", () => {
    const real = workspace("real-project");
    const fixture = workspace("fixture-project", ["registry-fixture"]);
    const projects = [real, fixture];

    expect(filterRegistryFixtures(projects).map((p) => p.slug)).toEqual(["real-project"]);
    expect(filterRegistryFixtures(projects, false).map((p) => p.slug)).toEqual(["real-project"]);
    expect(filterRegistryFixtures(projects, true).map((p) => p.slug)).toEqual(["real-project", "fixture-project"]);
    expect(filterRegistryFixtures([])).toEqual([]);
  });
});
