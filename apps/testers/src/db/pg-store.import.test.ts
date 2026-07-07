import { describe, it, expect } from "bun:test";
import { normalizeImportScenario, ValidationError } from "./pg-store.js";

describe("normalizeImportScenario", () => {
  it("preserves id, name, short_id and timestamps", () => {
    const n = normalizeImportScenario({
      id: "abc-123",
      shortId: "ALM-7",
      name: "Login works",
      createdAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2024-02-02T03:04:05.000Z",
      projectName: "platform-alumia",
    });
    expect(n.id).toBe("abc-123");
    expect(n.shortId).toBe("ALM-7");
    expect(n.name).toBe("Login works");
    expect(n.createdAt).toBe("2024-01-02T03:04:05.000Z");
    expect(n.updatedAt).toBe("2024-02-02T03:04:05.000Z");
    expect(n.projectName).toBe("platform-alumia");
  });

  it("requires id and name", () => {
    expect(() => normalizeImportScenario({ id: "", name: "x" })).toThrow(ValidationError);
    expect(() => normalizeImportScenario({ id: "x" } as never)).toThrow(ValidationError);
  });

  it("clamps invalid priority and scenario_type to defaults", () => {
    const n = normalizeImportScenario({ id: "a", name: "n", priority: "urgent", scenarioType: "chaos" });
    expect(n.priority).toBe("medium");
    expect(n.scenarioType).toBe("browser");
    const ok = normalizeImportScenario({ id: "b", name: "n", priority: "critical", scenarioType: "api" });
    expect(ok.priority).toBe("critical");
    expect(ok.scenarioType).toBe("api");
  });

  it("JSON-encodes array columns and passes through pre-serialized strings", () => {
    const fromArray = normalizeImportScenario({ id: "a", name: "n", steps: ["one", "two"], tags: ["t"] });
    expect(fromArray.steps).toBe('["one","two"]');
    expect(fromArray.tags).toBe('["t"]');
    const preSerialized = normalizeImportScenario({ id: "b", name: "n", steps: '["x"]' });
    expect(preSerialized.steps).toBe('["x"]');
    const empty = normalizeImportScenario({ id: "c", name: "n" });
    expect(empty.steps).toBe("[]");
    expect(empty.tags).toBe("[]");
    expect(empty.assertions).toBe("[]");
  });

  it("keeps nullable json columns null when absent", () => {
    const n = normalizeImportScenario({ id: "a", name: "n" });
    expect(n.metadata).toBeNull();
    expect(n.authConfig).toBeNull();
    expect(n.parameters).toBeNull();
    const withMeta = normalizeImportScenario({ id: "b", name: "n", metadata: { k: 1 } });
    expect(withMeta.metadata).toBe('{"k":1}');
  });

  it("coerces requiresAuth and defaults version to a positive int", () => {
    expect(normalizeImportScenario({ id: "a", name: "n", requiresAuth: 1 }).requiresAuth).toBe(true);
    expect(normalizeImportScenario({ id: "b", name: "n", requiresAuth: false }).requiresAuth).toBe(false);
    expect(normalizeImportScenario({ id: "c", name: "n" }).version).toBe(1);
    expect(normalizeImportScenario({ id: "d", name: "n", version: 5 }).version).toBe(5);
    expect(normalizeImportScenario({ id: "e", name: "n", version: 0 }).version).toBe(1);
  });
});
