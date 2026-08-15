process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import {
  createApiCheck,
  getApiCheck,
  listApiChecks,
  updateApiCheck,
  deleteApiCheck,
  countApiChecks,
  createApiCheckResult,
  getApiCheckResult,
  listApiCheckResults,
  getLatestApiCheckResult,
  countApiCheckResults,
} from "./api-checks.js";
import { createProject } from "./projects.js";
import { ApiCheckNotFoundError, VersionConflictError } from "../types/index.js";

describe("api-checks", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createApiCheck", () => {
    test("creates an api check with correct fields", () => {
      const check = createApiCheck({
        name: "Health check",
        url: "https://example.com/health",
        method: "GET",
        expectedStatus: 200,
        tags: ["smoke", "health"],
        description: "Verifies the health endpoint",
      });

      expect(check.id).toBeDefined();
      expect(check.shortId).toBeDefined();
      expect(check.name).toBe("Health check");
      expect(check.url).toBe("https://example.com/health");
      expect(check.method).toBe("GET");
      expect(check.expectedStatus).toBe(200);
      expect(check.tags).toEqual(["smoke", "health"]);
      expect(check.description).toBe("Verifies the health endpoint");
      expect(check.version).toBe(1);
      expect(check.enabled).toBe(true);
      expect(check.timeoutMs).toBe(10000);
      expect(check.headers).toEqual({});
      expect(check.body).toBeNull();
      expect(check.expectedBodyContains).toBeNull();
      expect(check.expectedResponseTimeMs).toBeNull();
      expect(check.projectId).toBeNull();
      expect(check.createdAt).toBeDefined();
      expect(check.updatedAt).toBeDefined();
    });

    test("creates with default values when optional fields omitted", () => {
      const check = createApiCheck({
        name: "Minimal check",
        url: "https://example.com/api",
      });

      expect(check.method).toBe("GET");
      expect(check.expectedStatus).toBe(200);
      expect(check.timeoutMs).toBe(10000);
      expect(check.enabled).toBe(true);
      expect(check.description).toBe("");
      expect(check.tags).toEqual([]);
      expect(check.headers).toEqual({});
    });

    test("creates with POST method and body", () => {
      const check = createApiCheck({
        name: "Create user",
        url: "https://example.com/users",
        method: "POST",
        body: JSON.stringify({ name: "Alice" }),
        headers: { "Content-Type": "application/json" },
        expectedStatus: 201,
      });

      expect(check.method).toBe("POST");
      expect(check.body).toBe(JSON.stringify({ name: "Alice" }));
      expect(check.headers).toEqual({ "Content-Type": "application/json" });
      expect(check.expectedStatus).toBe(201);
    });

    test("creates with enabled=false", () => {
      const check = createApiCheck({
        name: "Disabled check",
        url: "https://example.com/api",
        enabled: false,
      });

      expect(check.enabled).toBe(false);
    });

    test("creates with project association", () => {
      const project = createProject({ name: "my-app" });
      const check = createApiCheck({
        name: "App health",
        url: "https://myapp.com/health",
        projectId: project.id,
      });

      expect(check.projectId).toBe(project.id);
    });

    test("creates with all assertion fields", () => {
      const check = createApiCheck({
        name: "Full check",
        url: "https://example.com/api",
        expectedBodyContains: '"status":"ok"',
        expectedResponseTimeMs: 500,
        timeoutMs: 5000,
      });

      expect(check.expectedBodyContains).toBe('"status":"ok"');
      expect(check.expectedResponseTimeMs).toBe(500);
      expect(check.timeoutMs).toBe(5000);
    });
  });

  describe("getApiCheck", () => {
    test("gets a check by full ID", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });
      const found = getApiCheck(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("Test");
    });

    test("gets a check by short ID", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });
      const found = getApiCheck(created.shortId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("returns null for non-existent ID", () => {
      const found = getApiCheck("nonexistent-id");
      expect(found).toBeNull();
    });
  });

  describe("listApiChecks", () => {
    test("lists all checks when no filter", () => {
      createApiCheck({ name: "Check 1", url: "https://example.com/1" });
      createApiCheck({ name: "Check 2", url: "https://example.com/2" });
      createApiCheck({ name: "Check 3", url: "https://example.com/3" });

      const checks = listApiChecks();
      expect(checks.length).toBe(3);
    });

    test("filters by enabled=true", () => {
      createApiCheck({ name: "Enabled", url: "https://example.com/1", enabled: true });
      createApiCheck({ name: "Disabled", url: "https://example.com/2", enabled: false });

      const enabled = listApiChecks({ enabled: true });
      expect(enabled.length).toBe(1);
      expect(enabled[0]!.name).toBe("Enabled");
    });

    test("filters by enabled=false", () => {
      createApiCheck({ name: "Enabled", url: "https://example.com/1", enabled: true });
      createApiCheck({ name: "Disabled", url: "https://example.com/2", enabled: false });

      const disabled = listApiChecks({ enabled: false });
      expect(disabled.length).toBe(1);
      expect(disabled[0]!.name).toBe("Disabled");
    });

    test("filters by projectId", () => {
      const project = createProject({ name: "proj-a" });
      createApiCheck({ name: "In project", url: "https://example.com/1", projectId: project.id });
      createApiCheck({ name: "No project", url: "https://example.com/2" });

      const results = listApiChecks({ projectId: project.id });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("In project");
    });

    test("filters by tags", () => {
      createApiCheck({ name: "Smoke health", url: "https://example.com/1", tags: ["smoke", "health"] });
      createApiCheck({ name: "Smoke only", url: "https://example.com/2", tags: ["smoke"] });
      createApiCheck({ name: "Regression", url: "https://example.com/3", tags: ["regression"] });

      const smokeTags = listApiChecks({ tags: ["smoke"] });
      expect(smokeTags.length).toBe(2);

      const healthTags = listApiChecks({ tags: ["health"] });
      expect(healthTags.length).toBe(1);
      expect(healthTags[0]!.name).toBe("Smoke health");
    });

    test("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createApiCheck({ name: `Check ${i}`, url: `https://example.com/${i}` });
      }

      const limited = listApiChecks({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    test("respects offset", () => {
      for (let i = 0; i < 5; i++) {
        createApiCheck({ name: `Check ${i}`, url: `https://example.com/${i}` });
      }

      const all = listApiChecks();
      const offset = listApiChecks({ limit: 2, offset: 2 });
      expect(offset.length).toBe(2);
      expect(offset[0]!.id).toBe(all[2]!.id);
    });

    test("returns empty array when no matches", () => {
      const results = listApiChecks({ tags: ["nonexistent"] });
      expect(results).toEqual([]);
    });
  });

  describe("updateApiCheck", () => {
    test("updates check fields", () => {
      const created = createApiCheck({ name: "Old Name", url: "https://example.com/old" });
      const updated = updateApiCheck(created.id, { name: "New Name", url: "https://example.com/new" }, 1);

      expect(updated.name).toBe("New Name");
      expect(updated.url).toBe("https://example.com/new");
    });

    test("increments version on update", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });
      expect(created.version).toBe(1);

      const updated = updateApiCheck(created.id, { name: "Updated" }, 1);
      expect(updated.version).toBe(2);

      const updated2 = updateApiCheck(created.id, { name: "Updated Again" }, 2);
      expect(updated2.version).toBe(3);
    });

    test("throws VersionConflictError on wrong version", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });

      expect(() => {
        updateApiCheck(created.id, { name: "New" }, 99);
      }).toThrow(VersionConflictError);
    });

    test("throws ApiCheckNotFoundError for non-existent check", () => {
      expect(() => {
        updateApiCheck("nonexistent", { name: "New" }, 1);
      }).toThrow(ApiCheckNotFoundError);
    });

    test("updates enabled flag", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com", enabled: true });
      const updated = updateApiCheck(created.id, { enabled: false }, 1);
      expect(updated.enabled).toBe(false);
    });

    test("updates tags", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com", tags: ["old"] });
      const updated = updateApiCheck(created.id, { tags: ["new", "updated"] }, 1);
      expect(updated.tags).toEqual(["new", "updated"]);
    });

    test("updates method", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com", method: "GET" });
      const updated = updateApiCheck(created.id, { method: "POST" }, 1);
      expect(updated.method).toBe("POST");
    });

    test("updates headers as object", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });
      const updated = updateApiCheck(created.id, { headers: { Authorization: "Bearer token" } }, 1);
      expect(updated.headers).toEqual({ Authorization: "Bearer token" });
    });

    test("works with short ID", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });
      const updated = updateApiCheck(created.shortId, { name: "Updated via shortId" }, 1);
      expect(updated.name).toBe("Updated via shortId");
    });
  });

  describe("deleteApiCheck", () => {
    test("deletes an existing check", () => {
      const created = createApiCheck({ name: "Test", url: "https://example.com" });
      const deleted = deleteApiCheck(created.id);
      expect(deleted).toBe(true);

      const found = getApiCheck(created.id);
      expect(found).toBeNull();
    });

    test("returns false for non-existent check", () => {
      const deleted = deleteApiCheck("nonexistent-id");
      expect(deleted).toBe(false);
    });

    test("cascades delete to results", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      createApiCheckResult({ checkId: check.id, status: "passed" });

      expect(countApiCheckResults(check.id)).toBe(1);
      deleteApiCheck(check.id);
      // After cascade delete, results should be gone
      expect(countApiCheckResults(check.id)).toBe(0);
    });
  });

  describe("countApiChecks", () => {
    test("counts all checks", () => {
      createApiCheck({ name: "Check 1", url: "https://example.com/1" });
      createApiCheck({ name: "Check 2", url: "https://example.com/2" });

      expect(countApiChecks()).toBe(2);
    });

    test("counts with enabled filter", () => {
      createApiCheck({ name: "Enabled", url: "https://example.com/1", enabled: true });
      createApiCheck({ name: "Disabled", url: "https://example.com/2", enabled: false });

      expect(countApiChecks({ enabled: true })).toBe(1);
      expect(countApiChecks({ enabled: false })).toBe(1);
    });

    test("counts with projectId filter", () => {
      const project = createProject({ name: "count-proj" });
      createApiCheck({ name: "In project", url: "https://example.com/1", projectId: project.id });
      createApiCheck({ name: "No project", url: "https://example.com/2" });

      expect(countApiChecks({ projectId: project.id })).toBe(1);
    });

    test("returns 0 when no checks", () => {
      expect(countApiChecks()).toBe(0);
    });
  });

  describe("createApiCheckResult", () => {
    test("creates a result with correct fields", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const result = createApiCheckResult({
        checkId: check.id,
        status: "passed",
        statusCode: 200,
        responseTimeMs: 150,
        responseBody: '{"status":"ok"}',
        responseHeaders: { "content-type": "application/json" },
        assertionsPassed: ["Status code is 200"],
        assertionsFailed: [],
      });

      expect(result.id).toBeDefined();
      expect(result.checkId).toBe(check.id);
      expect(result.status).toBe("passed");
      expect(result.statusCode).toBe(200);
      expect(result.responseTimeMs).toBe(150);
      expect(result.responseBody).toBe('{"status":"ok"}');
      expect(result.responseHeaders).toEqual({ "content-type": "application/json" });
      expect(result.assertionsPassed).toEqual(["Status code is 200"]);
      expect(result.assertionsFailed).toEqual([]);
      expect(result.runId).toBeNull();
      expect(result.error).toBeNull();
      expect(result.createdAt).toBeDefined();
    });

    test("creates a failed result with assertions", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const result = createApiCheckResult({
        checkId: check.id,
        status: "failed",
        statusCode: 500,
        assertionsPassed: [],
        assertionsFailed: ["Expected status 200, got 500"],
      });

      expect(result.status).toBe("failed");
      expect(result.assertionsFailed).toEqual(["Expected status 200, got 500"]);
    });

    test("creates an error result", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const result = createApiCheckResult({
        checkId: check.id,
        status: "error",
        error: "Request timed out after 10000ms",
      });

      expect(result.status).toBe("error");
      expect(result.error).toBe("Request timed out after 10000ms");
      expect(result.statusCode).toBeNull();
    });

    test("creates with defaults for optional fields", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const result = createApiCheckResult({
        checkId: check.id,
        status: "passed",
      });

      expect(result.runId).toBeNull();
      expect(result.statusCode).toBeNull();
      expect(result.responseTimeMs).toBeNull();
      expect(result.responseBody).toBeNull();
      expect(result.responseHeaders).toEqual({});
      expect(result.error).toBeNull();
      expect(result.assertionsPassed).toEqual([]);
      expect(result.assertionsFailed).toEqual([]);
    });
  });

  describe("getApiCheckResult", () => {
    test("gets a result by ID", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const created = createApiCheckResult({ checkId: check.id, status: "passed" });
      const found = getApiCheckResult(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("returns null for non-existent ID", () => {
      const found = getApiCheckResult("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listApiCheckResults", () => {
    test("lists results for a check", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      createApiCheckResult({ checkId: check.id, status: "passed" });
      createApiCheckResult({ checkId: check.id, status: "failed" });

      const results = listApiCheckResults(check.id);
      expect(results.length).toBe(2);
    });

    test("only returns results for the specified check", () => {
      const check1 = createApiCheck({ name: "Check 1", url: "https://example.com/1" });
      const check2 = createApiCheck({ name: "Check 2", url: "https://example.com/2" });
      createApiCheckResult({ checkId: check1.id, status: "passed" });
      createApiCheckResult({ checkId: check2.id, status: "passed" });

      const results = listApiCheckResults(check1.id);
      expect(results.length).toBe(1);
      expect(results[0]!.checkId).toBe(check1.id);
    });

    test("respects limit and offset", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      for (let i = 0; i < 5; i++) {
        createApiCheckResult({ checkId: check.id, status: "passed" });
      }

      const limited = listApiCheckResults(check.id, { limit: 2 });
      expect(limited.length).toBe(2);

      const offset = listApiCheckResults(check.id, { limit: 2, offset: 2 });
      expect(offset.length).toBe(2);
    });

    test("returns empty array for check with no results", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const results = listApiCheckResults(check.id);
      expect(results).toEqual([]);
    });
  });

  describe("getLatestApiCheckResult", () => {
    test("returns the most recent result", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      createApiCheckResult({ checkId: check.id, status: "passed" });
      const latest = createApiCheckResult({ checkId: check.id, status: "failed" });

      const result = getLatestApiCheckResult(check.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(latest.id);
      expect(result!.status).toBe("failed");
    });

    test("returns null when no results exist", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      const result = getLatestApiCheckResult(check.id);
      expect(result).toBeNull();
    });
  });

  describe("countApiCheckResults", () => {
    test("counts results for a check", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      createApiCheckResult({ checkId: check.id, status: "passed" });
      createApiCheckResult({ checkId: check.id, status: "failed" });
      createApiCheckResult({ checkId: check.id, status: "error" });

      expect(countApiCheckResults(check.id)).toBe(3);
    });

    test("returns 0 when no results", () => {
      const check = createApiCheck({ name: "Test", url: "https://example.com" });
      expect(countApiCheckResults(check.id)).toBe(0);
    });
  });
});
