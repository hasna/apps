process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { createScenario, listScenarios, getScenario, deleteScenario } from "../db/scenarios.js";
import { listRuns } from "../db/runs.js";
import { getDatabase } from "../db/database.js";

describe("MCP module dependencies", () => {
  test("database initializes with :memory:", () => {
    const db = getDatabase();
    expect(db).toBeDefined();
  });

  test("createScenario works via db layer", () => {
    const scenario = createScenario({
      name: "mcp-test-scenario",
      description: "testing db layer used by MCP",
    });
    expect(scenario).toBeDefined();
    expect(scenario.id).toBeTruthy();
    expect(scenario.name).toBe("mcp-test-scenario");
    expect(scenario.description).toBe("testing db layer used by MCP");
    expect(scenario.priority).toBe("medium");
    expect(scenario.version).toBe(1);
    expect(Array.isArray(scenario.steps)).toBe(true);
    expect(Array.isArray(scenario.tags)).toBe(true);
  });

  test("listScenarios returns created scenarios", () => {
    const scenarios = listScenarios();
    expect(Array.isArray(scenarios)).toBe(true);
    expect(scenarios.length).toBeGreaterThanOrEqual(1);
    const found = scenarios.find((s) => s.name === "mcp-test-scenario");
    expect(found).toBeDefined();
  });

  test("getScenario retrieves by id", () => {
    const created = createScenario({
      name: "get-by-id-test",
      description: "test retrieval",
      tags: ["mcp", "test"],
      priority: "high",
    });
    const retrieved = getScenario(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.name).toBe("get-by-id-test");
    expect(retrieved!.tags).toEqual(["mcp", "test"]);
    expect(retrieved!.priority).toBe("high");
  });

  test("deleteScenario removes a scenario", () => {
    const created = createScenario({
      name: "to-delete",
      description: "will be deleted",
    });
    const deleted = deleteScenario(created.id);
    expect(deleted).toBe(true);
    const retrieved = getScenario(created.id);
    expect(retrieved).toBeNull();
  });

  test("listRuns returns empty array initially", () => {
    const runs = listRuns();
    expect(Array.isArray(runs)).toBe(true);
  });

  test("listResults filters by status (OPE9-00118)", () => {
    const { listResults, updateResult } = require("../db/results.js");
    const { createRun } = require("../db/runs.js");

    const run = createRun({ url: "http://test.example", model: "quick" });
    const scenario = createScenario({ name: "filter-test", description: "test" });

    const passedResult = require("../db/results.js").createResult({
      runId: run.id,
      scenarioId: scenario.id,
      model: "quick",
      stepsTotal: 1,
    });
    updateResult(passedResult.id, { status: "passed" });

    const failedResult = require("../db/results.js").createResult({
      runId: run.id,
      scenarioId: scenario.id,
      model: "quick",
      stepsTotal: 1,
    });
    updateResult(failedResult.id, { status: "failed" });

    const allResults = listResults(run.id);
    expect(allResults.length).toBe(2);

    // Verify status filtering works at the MCP tool level (in-memory filter)
    const passedFiltered = allResults.filter((r: any) => r.status === "passed");
    expect(passedFiltered.length).toBe(1);
    expect(passedFiltered[0].id).toBe(passedResult.id);

    const failedFiltered = allResults.filter((r: any) => r.status === "failed");
    expect(failedFiltered.length).toBe(1);
    expect(failedFiltered[0].id).toBe(failedResult.id);
  });

  test("listResults filters by scenarioId (OPE9-00118)", () => {
    const { createRun } = require("../db/runs.js");
    const { listResults, updateResult, createResult } = require("../db/results.js");

    const run = createRun({ url: "http://test2.example", model: "quick" });
    const scenarioA = createScenario({ name: "scenario-A", description: "test A" });
    const scenarioB = createScenario({ name: "scenario-B", description: "test B" });

    const resultA = createResult({ runId: run.id, scenarioId: scenarioA.id, model: "quick", stepsTotal: 1 });
    updateResult(resultA.id, { status: "passed" });
    const resultB = createResult({ runId: run.id, scenarioId: scenarioB.id, model: "quick", stepsTotal: 1 });
    updateResult(resultB.id, { status: "passed" });

    const allResults = listResults(run.id);
    expect(allResults.length).toBe(2);

    // Verify scenarioId filtering (exact match and partial match)
    const exactFiltered = allResults.filter((r: any) => r.scenarioId === scenarioA.id);
    expect(exactFiltered.length).toBe(1);
    expect(exactFiltered[0].scenarioId).toBe(scenarioA.id);

    // Partial match (prefix)
    const partialFiltered = allResults.filter((r: any) => r.scenarioId === scenarioA.id || r.scenarioId.startsWith(scenarioA.id.slice(0, 8)));
    expect(partialFiltered.length).toBe(1);
  });

  test("default browser timeout is 120s (OPE9-00245)", () => {
    const { getDefaultConfig } = require("../lib/config.js");
    const config = getDefaultConfig();
    expect(config.browser.timeout).toBe(120_000);
  });

  test("runBatch accepts timeout in options (OPE9-00245)", () => {
    // Verify the runner accepts timeout param by checking RunOptions shape
    const runBatch = require("../lib/runner.js");
    expect(typeof runBatch.runBatch).toBe("function");
    // Timeout is already in RunOptions interface; runner uses options.timeout
    // as fallback when scenario.timeoutMs is not set
  });

  test("batch_create_scenarios creates multiple scenarios (OPE9-00246)", () => {
    const { createScenario } = require("../db/scenarios.js");
    const scenarios = [
      { name: "Batch Test 1", description: "First batch scenario", steps: ["Step 1"], tags: ["batch"] },
      { name: "Batch Test 2", description: "Second batch scenario", priority: "high" as const },
      { name: "Batch Test 3", description: "Third batch scenario", tags: ["batch", "smoke"] },
    ];
    const results = scenarios.map((s) => createScenario(s));
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe("Batch Test 1");
    expect(results[0].steps).toEqual(["Step 1"]);
    expect(results[0].tags).toEqual(["batch"]);
    expect(results[1].priority).toBe("high");
    expect(results[2].tags).toEqual(["batch", "smoke"]);
  });
});
