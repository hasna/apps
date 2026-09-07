import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initializeTodosCliAuthority } from "./stage-a.js";
import { resetTodosCloudClient } from "./cloud-router.js";

/**
 * Bundled static content renders on the /v1 route (todos 3e5e773f), and the
 * forms that reach the on-box store serve the workstation store even when a
 * hosted authority is configured.
 *
 * `todos manual` is bundled static and works in remote mode; `workflows`,
 * `template-library`, `sdk-fixtures` and `onboarding` used to be refused as
 * transport-dependent even though the shipped manual documents `todos
 * workflows` in its own examples.
 *
 * The classification is deliberately at the INVOCATION level rather than the
 * COMMAND level, because two of those four verbs are genuinely mixed. Measured
 * against an isolated `HASNA_TODOS_DB_PATH`, with `todos list` as the positive
 * control that a database is created when one is needed:
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
 * bridge import; both land in `getDatabase()` on bun:sqlite. Those forms serve
 * the on-box store (routed local with the store notice), while every store-free
 * form stays diagnostic.
 */

const REMOTE_ENV = {
  HASNA_TODOS_API_URL: "https://authority.invalid",
  HASNA_TODOS_API_KEY: "fixture-remote-key",
} as const;

const DIAGNOSTIC_RESULT = {
  route: "remote-diagnostic",
  v1_base_url: "https://authority.invalid/v1",
} as const;

const ON_BOX_RESULT = {
  route: "local",
  v1_base_url: null,
  local_store: "configured-authority",
} as const;

describe("bundled static commands in a hosted-configured transport", () => {
  beforeEach(() => resetTodosCloudClient());
  afterEach(() => resetTodosCloudClient());

  test("positive control: `manual` already renders bundled static content in remote mode", () => {
    expect(initializeTodosCliAuthority(["manual"], REMOTE_ENV)).toEqual(DIAGNOSTIC_RESULT);
  });

  test("negative control: a near-miss verb is still an UNKNOWN_COMMAND, not a silent pass", () => {
    // A near-miss rather than an invented string: `workflowz` is one edit from
    // a verb this change keeps store-free.
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
    // They were never gated; their help is present in every transport and the
    // routed forms serve the on-box store.
    for (const command of [
      "workflows",
      "template-library",
      "templates-library",
      "onboarding",
      "demo-fixtures",
      "sdk-fixtures",
    ]) {
      expect(() => initializeTodosCliAuthority([command], REMOTE_ENV)).not.toThrow();
    }
  });

  test("invocations that reach bun:sqlite serve the on-box store on the hosted route", () => {
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
      expect(initializeTodosCliAuthority([...args], REMOTE_ENV)).toEqual(ON_BOX_RESULT);
    }
  });
});