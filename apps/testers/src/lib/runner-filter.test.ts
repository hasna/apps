process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createScenario } from "../db/scenarios.js";
import { resolveScenariosForRun } from "./runner.js";

describe("resolveScenariosForRun", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("resolves explicit scenario UUID prefixes for workflow and CLI runs", () => {
    const scenario = createScenario({
      name: "Login shell",
      description: "Test login shell",
      tags: ["alumia-smoke"],
    });

    const scenarios = resolveScenariosForRun({
      url: "https://example.com",
      scenarioIds: [scenario.id.slice(0, 8)],
    });

    expect(scenarios.map((s) => s.id)).toEqual([scenario.id]);
  });
});
