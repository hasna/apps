process.env.TESTERS_DB_PATH = ":memory:";
process.env.NO_COLOR = "1";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createResult, updateResult } from "../db/results.js";
import { createRun, updateRun } from "../db/runs.js";
import { createScenario } from "../db/scenarios.js";
import { formatTerminal } from "./reporter.js";

describe("compact terminal report output", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("caps result rows by default and discloses full output with verbose", () => {
    const run = createRun({
      url: "https://example.test/run",
      model: "model-compact",
    });
    const results = [];

    for (let index = 0; index < 55; index++) {
      const scenario = createScenario({
        name: `Scenario ${index} ${index === 54 ? "TAIL_RESULT_ROW" : ""}`,
        description: "Scenario for compact terminal output",
      });
      const result = createResult({
        runId: run.id,
        scenarioId: scenario.id,
        model: "model-compact",
        stepsTotal: 1,
      });
      results.push(updateResult(result.id, { status: "passed", stepsCompleted: 1 }));
    }

    const completedRun = updateRun(run.id, {
      status: "passed",
      total: 55,
      passed: 55,
      failed: 0,
    });

    const compact = formatTerminal(completedRun, results);
    expect(compact).toContain("Showing 1-50 of 55");
    expect(compact).toContain("Compact output");
    expect(compact).not.toContain("TAIL_RESULT_ROW");

    const verbose = formatTerminal(completedRun, results, { verbose: true });
    expect(verbose).toContain("TAIL_RESULT_ROW");
    expect(verbose).not.toContain("Compact output");
  });
});
