import type { Workspace } from "../types/workspace.js";

/**
 * The single tag that marks a registry row as a generated fixture.
 *
 * The Projects normalization program tagged ~1882 generated registry rows with
 * `registry-fixture` so that tools reading the default project registry stop
 * seeing ~70% test data. This module owns that exclusion at read time; the
 * rows themselves are intentionally left in place (a destructive cleanup of
 * the fixture population is a separate, owned operation).
 */
export const REGISTRY_FIXTURE_TAG = "registry-fixture";

export function isRegistryFixtureProject(project: Workspace): boolean {
  return project.tags.includes(REGISTRY_FIXTURE_TAG);
}

export function filterRegistryFixtures<T extends Workspace>(projects: T[], includeFixtures = false): T[] {
  return includeFixtures ? projects : projects.filter((project) => !isRegistryFixtureProject(project));
}
