process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import {
  createScenario,
  getScenario,
  getScenarioByShortId,
  listScenarios,
  updateScenario,
  deleteScenario,
} from "./scenarios.js";
import { createProject } from "./projects.js";
import { VersionConflictError } from "../types/index.js";

describe("scenarios", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createScenario", () => {
    test("creates a scenario with correct fields", () => {
      const scenario = createScenario({
        name: "Login test",
        description: "Test the login flow",
        steps: ["Go to /login", "Enter credentials", "Click submit"],
        tags: ["auth", "smoke"],
        priority: "high",
      });

      expect(scenario.id).toBeDefined();
      expect(scenario.shortId).toBeDefined();
      expect(scenario.name).toBe("Login test");
      expect(scenario.description).toBe("Test the login flow");
      expect(scenario.steps).toEqual(["Go to /login", "Enter credentials", "Click submit"]);
      expect(scenario.tags).toEqual(["auth", "smoke"]);
      expect(scenario.priority).toBe("high");
      expect(scenario.version).toBe(1);
      expect(scenario.requiresAuth).toBe(false);
      expect(scenario.createdAt).toBeDefined();
      expect(scenario.updatedAt).toBeDefined();
    });

    test("creates a scenario with default values", () => {
      const scenario = createScenario({
        name: "Simple test",
        description: "A simple test",
      });

      expect(scenario.steps).toEqual([]);
      expect(scenario.tags).toEqual([]);
      expect(scenario.priority).toBe("medium");
      expect(scenario.model).toBeNull();
      expect(scenario.timeoutMs).toBeNull();
      expect(scenario.targetPath).toBeNull();
      expect(scenario.requiresAuth).toBe(false);
      expect(scenario.authConfig).toBeNull();
      expect(scenario.projectId).toBeNull();
    });

    test("creates a scenario with a project and gets sequential short IDs", () => {
      const project = createProject({ name: "my-app" });
      const s1 = createScenario({ name: "Test 1", description: "First", projectId: project.id });
      const s2 = createScenario({ name: "Test 2", description: "Second", projectId: project.id });

      expect(s1.shortId).toBe("TST-1");
      expect(s2.shortId).toBe("TST-2");
      expect(s1.projectId).toBe(project.id);
    });

    test("creates a scenario with auth config", () => {
      const scenario = createScenario({
        name: "Auth test",
        description: "Test with auth",
        requiresAuth: true,
        authConfig: { email: "test@test.com", password: "pass123", loginPath: "/login" },
      });

      expect(scenario.requiresAuth).toBe(true);
      expect(scenario.authConfig).toEqual({
        email: "test@test.com",
        password: "pass123",
        loginPath: "/login",
      });
    });

    test("creates a scenario with metadata", () => {
      const scenario = createScenario({
        name: "Meta test",
        description: "Test metadata",
        metadata: { browser: "chrome", retry: 3 },
      });

      expect(scenario.metadata).toEqual({ browser: "chrome", retry: 3 });
    });
  });

  describe("getScenario", () => {
    test("gets a scenario by full ID", () => {
      const created = createScenario({ name: "Test", description: "Desc" });
      const found = getScenario(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("Test");
    });

    test("gets a scenario by short ID", () => {
      const project = createProject({ name: "proj" });
      const created = createScenario({ name: "Test", description: "Desc", projectId: project.id });
      const found = getScenario(created.shortId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("gets a scenario by partial ID", () => {
      const created = createScenario({ name: "Test", description: "Desc" });
      const partial = created.id.slice(0, 8);
      const found = getScenario(partial);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("returns null for non-existent scenario", () => {
      const found = getScenario("nonexistent-id");
      expect(found).toBeNull();
    });
  });

  describe("getScenarioByShortId", () => {
    test("finds scenario by exact short ID", () => {
      const project = createProject({ name: "proj2" });
      const created = createScenario({ name: "Test", description: "Desc", projectId: project.id });
      const found = getScenarioByShortId(created.shortId);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Test");
    });

    test("returns null for non-existent short ID", () => {
      const found = getScenarioByShortId("TST-999");
      expect(found).toBeNull();
    });
  });

  describe("listScenarios", () => {
    test("lists all scenarios when no filter provided", () => {
      createScenario({ name: "Test 1", description: "Desc 1" });
      createScenario({ name: "Test 2", description: "Desc 2" });
      createScenario({ name: "Test 3", description: "Desc 3" });

      const scenarios = listScenarios();
      expect(scenarios.length).toBe(3);
    });

    test("filters by tags", () => {
      createScenario({ name: "Smoke 1", description: "D", tags: ["smoke", "auth"] });
      createScenario({ name: "Smoke 2", description: "D", tags: ["smoke"] });
      createScenario({ name: "Regression", description: "D", tags: ["regression"] });

      const smokeTests = listScenarios({ tags: ["smoke"] });
      expect(smokeTests.length).toBe(2);

      const authSmoke = listScenarios({ tags: ["smoke", "auth"] });
      expect(authSmoke.length).toBe(1);
      expect(authSmoke[0]!.name).toBe("Smoke 1");
    });

    test("filters by priority", () => {
      createScenario({ name: "Low", description: "D", priority: "low" });
      createScenario({ name: "High", description: "D", priority: "high" });
      createScenario({ name: "Critical", description: "D", priority: "critical" });

      const high = listScenarios({ priority: "high" });
      expect(high.length).toBe(1);
      expect(high[0]!.name).toBe("High");
    });

    test("filters by search term", () => {
      createScenario({ name: "Login flow", description: "Test login" });
      createScenario({ name: "Dashboard", description: "Test dashboard rendering" });
      createScenario({ name: "Settings", description: "Test settings page" });

      const results = listScenarios({ search: "login" });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("Login flow");
    });

    test("search matches description too", () => {
      createScenario({ name: "Some test", description: "Verify the checkout process" });

      const results = listScenarios({ search: "checkout" });
      expect(results.length).toBe(1);
    });

    test("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createScenario({ name: `Test ${i}`, description: "D" });
      }

      const limited = listScenarios({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    test("respects offset", () => {
      for (let i = 0; i < 5; i++) {
        createScenario({ name: `Test ${i}`, description: "D" });
      }

      const all = listScenarios();
      const offset = listScenarios({ limit: 2, offset: 2 });
      expect(offset.length).toBe(2);
      expect(offset[0]!.id).toBe(all[2]!.id);
    });

    test("returns empty array when no matches", () => {
      const results = listScenarios({ tags: ["nonexistent"] });
      expect(results).toEqual([]);
    });
  });

  describe("updateScenario", () => {
    test("updates scenario fields", () => {
      const created = createScenario({ name: "Old Name", description: "Old desc" });
      const updated = updateScenario(created.id, { name: "New Name", description: "New desc" }, 1);

      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("New desc");
    });

    test("increments version on update", () => {
      const created = createScenario({ name: "Test", description: "Desc" });
      expect(created.version).toBe(1);

      const updated = updateScenario(created.id, { name: "Updated" }, 1);
      expect(updated.version).toBe(2);

      const updated2 = updateScenario(created.id, { name: "Updated Again" }, 2);
      expect(updated2.version).toBe(3);
    });

    test("throws VersionConflictError on wrong version", () => {
      const created = createScenario({ name: "Test", description: "Desc" });

      expect(() => {
        updateScenario(created.id, { name: "New" }, 99);
      }).toThrow(VersionConflictError);
    });

    test("throws error for non-existent scenario", () => {
      expect(() => {
        updateScenario("nonexistent", { name: "New" }, 1);
      }).toThrow("Scenario not found");
    });

    test("returns existing scenario when no fields to update", () => {
      const created = createScenario({ name: "Test", description: "Desc" });
      const same = updateScenario(created.id, {}, 1);
      expect(same.version).toBe(1);
      expect(same.name).toBe("Test");
    });

    test("updates tags and steps", () => {
      const created = createScenario({ name: "Test", description: "Desc", tags: ["old"], steps: ["step1"] });
      const updated = updateScenario(created.id, { tags: ["new", "tags"], steps: ["step1", "step2"] }, 1);

      expect(updated.tags).toEqual(["new", "tags"]);
      expect(updated.steps).toEqual(["step1", "step2"]);
    });
  });

  describe("deleteScenario", () => {
    test("deletes an existing scenario", () => {
      const created = createScenario({ name: "Test", description: "Desc" });
      const deleted = deleteScenario(created.id);
      expect(deleted).toBe(true);

      const found = getScenario(created.id);
      expect(found).toBeNull();
    });

    test("returns false for non-existent scenario", () => {
      const deleted = deleteScenario("nonexistent-id");
      expect(deleted).toBe(false);
    });
  });
});
