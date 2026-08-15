import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTodosCliCommandCapabilityMatrix, initializeTodosCliAuthority } from "./stage-a.js";
import { resetTodosCloudClient } from "./cloud-router.js";

/**
 * Bundled static content must render on the /v1 route (todos 3e5e773f).
 *
 * `todos manual` is bundled static and works in remote mode, while `workflows`,
 * `template-library`, `sdk-fixtures` and `onboarding` were refused as
 * `local-only`. The shipped manual even documents `todos workflows` in its
 * examples, so the CLI advertised a command it then refused on the route most
 * of this fleet runs.
 *
 * The reclassification is deliberately at the INVOCATION level rather than the
 * COMMAND level, because two of those four verbs are genuinely mixed. Measured
 * against an isolated `HASNA_TODOS_DB_PATH` on 0.13.12, with `todos list` as the
 * positive control that a database is created when one is needed:
 *
 *   todos workflows list            no database created
 *   todos template-library          no database created
 *   todos onboarding                no database created
 *   todos onboarding --write DIR    no database created
 *   todos sdk-fixtures              no database created
 *   todos onboarding --import NAME  DATABASE CREATED
 *   todos sdk-fixtures --show       DATABASE CREATED
 *   todos sdk-fixtures --write DIR  DATABASE CREATED
 *   todos list  (positive control)  DATABASE CREATED
 *
 * `onboarding --import` reaches `importLocalBridgeBundle`, and `sdk-fixtures
 * --show/--write` reach `ensureFixtureImported`, which performs a NON-dry-run
 * bridge import; both land in `getDatabase()` on bun:sqlite. Admitting those on
 * a route where the local SQLite fallback is disabled would be a regression, so
 * the second half of this file is as load-bearing as the first.
 */

const REMOTE_ENV = {
  HASNA_TODOS_STORAGE_MODE: "remote",
  HASNA_TODOS_API_URL: "https://authority.invalid",
  HASNA_TODOS_API_KEY: "fixture-remote-key",
} as const;

const DIAGNOSTIC_RESULT = {
  route: "remote-diagnostic",
  v1_base_url: "https://authority.invalid/v1",
} as const;

describe("bundled static commands on the /v1 route", () => {
  beforeEach(() => resetTodosCloudClient());
  afterEach(() => resetTodosCloudClient());

  test("positive control: `manual` already renders bundled static content in remote mode", () => {
    expect(initializeTodosCliAuthority(["manual"], REMOTE_ENV)).toEqual(DIAGNOSTIC_RESULT);
  });

  test("negative control: a near-miss verb is still an UNKNOWN_COMMAND, not a silent pass", () => {
    // A near-miss rather than an invented string: `workflowz` is one edit from a
    // verb this change makes diagnostic, so it exercises the same matrix lookup
    // the reclassification touches.
    expect(() => initializeTodosCliAuthority(["workflowz"], REMOTE_ENV)).toThrow(/UNKNOWN_COMMAND/);
  });

  test("store-free bundled invocations resolve to the diagnostic route", () => {
    for (const args of [
      ["workflows"],
      ["workflows", "list"],
      ["workflows", "show", "goal_planning"],
      ["workflows", "export"],
      ["template-library"],
      ["template-library", "--show", "bug-fix"],
      ["template-library", "--write", "/tmp/todos-fixture-templates"],
      ["templates-library"],
      ["onboarding"],
      ["onboarding", "--show", "agent-project-demo"],
      ["onboarding", "--write", "/tmp/todos-fixture-onboarding"],
      ["demo-fixtures"],
      ["sdk-fixtures"],
    ]) {
      expect(initializeTodosCliAuthority([...args], REMOTE_ENV)).toEqual(DIAGNOSTIC_RESULT);
    }
  });

  test("bundled verbs are advertised in remote help once they are executable there", () => {
    const matrix = getTodosCliCommandCapabilityMatrix();
    for (const command of [
      "workflows",
      "template-library",
      "templates-library",
      "onboarding",
      "demo-fixtures",
      "sdk-fixtures",
    ]) {
      expect(matrix.get(command)).toBe("diagnostic");
    }
  });

  test("invocations that reach bun:sqlite are still refused on the /v1 route", () => {
    for (const args of [
      // importLocalBridgeBundle -> getDatabase()
      ["onboarding", "--import", "agent-project-demo"],
      ["onboarding", "--import", "agent-project-demo", "--apply"],
      ["onboarding", "--import=agent-project-demo"],
      ["demo-fixtures", "--import", "agent-project-demo"],
      // ensureFixtureImported() performs a non-dry-run bridge import
      ["sdk-fixtures", "--show"],
      ["sdk-fixtures", "--write", "/tmp/todos-fixture-sdk"],
    ]) {
      expect(() => initializeTodosCliAuthority([...args], REMOTE_ENV)).toThrow(/REMOTE_COMMAND_UNSUPPORTED/);
    }
  });

  test("a refused bundled invocation names the offending flag, not the whole verb", () => {
    // `sdk-fixtures` alone works, so a message that blames `sdk-fixtures` would
    // send the reader to debug a verb that is fine.
    expect(() => initializeTodosCliAuthority(["sdk-fixtures", "--show"], REMOTE_ENV)).toThrow(/--show/);
    expect(() => initializeTodosCliAuthority(["onboarding", "--import", "agent-project-demo"], REMOTE_ENV))
      .toThrow(/--import/);
  });

  test("a refused bundled invocation does not blame the /v1 authority it never used", () => {
    // These verbs are served from the package, so "`onboarding` is served by
    // the Todos /v1 authority but ..." would send the reader to debug their
    // connection, credentials or storage mode for a purely local refusal.
    for (const args of [["sdk-fixtures", "--show"], ["onboarding", "--import", "agent-project-demo"]]) {
      expect(() => initializeTodosCliAuthority([...args], REMOTE_ENV)).toThrow(/renders bundled content on this route/);
      expect(() => initializeTodosCliAuthority([...args], REMOTE_ENV)).not.toThrow(/is served by the Todos \/v1 authority/);
    }
  });
});
