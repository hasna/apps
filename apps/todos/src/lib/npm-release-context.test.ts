import { describe, expect, test } from "bun:test";
import { parseNpmReleaseLane, resolveNpmReleaseContext, resolveNpmReleasePublishMode } from "./npm-release-context";

const commit = "a".repeat(40);
const local = { HASNA_TODOS_RELEASE_CONTEXT: "vault-token", RELEASE_PUBLISH_MODE: "vault-token", HASNA_TODOS_EXPECTED_COMMIT: commit, HASNA_TODOS_RELEASE_TAG: "npm/todos/v0.17.0" };
const actions = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "hasna/apps", GITHUB_SHA: commit, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "npm/todos/v0.17.0" };

describe("npm release delivery contexts", () => {
  test("accepts explicit local authority without pretending to be Actions", () => {
    expect(resolveNpmReleaseContext(local)).toEqual({ mode: "vault-token", releaseCommit: commit, tag: local.HASNA_TODOS_RELEASE_TAG, failures: [] });
    expect(resolveNpmReleaseContext(actions).failures).toEqual([]);
  });
  test("refuses absent, invalid, mixed, and incomplete authority", () => {
    for (const env of [{}, { ...local, HASNA_TODOS_RELEASE_CONTEXT: "anything" }, { ...local, RELEASE_PUBLISH_MODE: "oidc" }, { ...local, GITHUB_ACTIONS: "false" }, { ...local, HASNA_TODOS_EXPECTED_COMMIT: "main" }, { ...local, HASNA_TODOS_RELEASE_TAG: "../../other" }, { ...actions, GITHUB_ACTIONS: undefined }, { ...actions, GITHUB_EVENT_NAME: "workflow_dispatch" }, { ...actions, GITHUB_REPOSITORY: "fork/apps" }, { ...actions, GITHUB_REF_TYPE: "branch" }, { ...actions, HASNA_TODOS_EXPECTED_COMMIT: "b".repeat(40) }, { ...actions, HASNA_TODOS_RELEASE_TAG: actions.GITHUB_REF_NAME }]) {
      expect(resolveNpmReleaseContext(env).failures.length).toBeGreaterThan(0);
    }
  });
  test("only explicit oidc chooses automatic publication", () => {
    expect(resolveNpmReleasePublishMode(undefined)).toBe("vault-token");
    expect(resolveNpmReleasePublishMode("")).toBe("vault-token");
    expect(resolveNpmReleasePublishMode("vault-token")).toBe("vault-token");
    expect(resolveNpmReleasePublishMode("oidc")).toBe("oidc");
    for (const value of ["auto", "OIDC", " oidc", "none"]) expect(() => resolveNpmReleasePublishMode(value)).toThrow();
  });
  test("an annotated tag has exactly one unambiguous delivery choice", () => {
    for (const lane of ["vault-token", "oidc"] as const) expect(parseNpmReleaseLane(`Release\n\nRelease-Lane: ${lane}\nAgent: publisher\n`)).toBe(lane);
    for (const message of ["Agent: publisher", "Release-Lane: invalid", "Release-Lane: vault-token\nRelease-Lane: oidc", "release-lane: vault-token", " Release-Lane: vault-token", "Release-Lane: vault-token "]) expect(() => parseNpmReleaseLane(message)).toThrow();
  });
});
