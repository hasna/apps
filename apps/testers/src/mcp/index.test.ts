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
});
