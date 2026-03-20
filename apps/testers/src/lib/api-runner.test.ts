process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { createApiCheck } from "../db/api-checks.js";
import { runApiCheck, runApiChecks, runApiChecksByFilter } from "./api-runner.js";
import type { ApiCheck } from "../types/index.js";

// Helper to create a mock Response
function mockResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  const responseHeaders = new Headers(headers);
  return new Response(body, { status, headers: responseHeaders });
}

describe("api-runner", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    resetDatabase();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    closeDatabase();
  });

  function makeCheck(overrides: Partial<Parameters<typeof createApiCheck>[0]> = {}): ApiCheck {
    return createApiCheck({
      name: "Test check",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: 200,
      timeoutMs: 5000,
      ...overrides,
    });
  }

  describe("runApiCheck", () => {
    test("successful GET with matching status → passed", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, '{"status":"ok"}')));

      const check = makeCheck({ expectedStatus: 200 });
      const result = await runApiCheck(check);

      expect(result.status).toBe("passed");
      expect(result.statusCode).toBe(200);
      expect(result.assertionsPassed).toContain("Status code is 200");
      expect(result.assertionsFailed).toEqual([]);
      expect(result.checkId).toBe(check.id);
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("status mismatch → failed", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(500, "Internal Server Error")));

      const check = makeCheck({ expectedStatus: 200 });
      const result = await runApiCheck(check);

      expect(result.status).toBe("failed");
      expect(result.statusCode).toBe(500);
      expect(result.assertionsFailed).toContain("Expected status 200, got 500");
      expect(result.assertionsPassed).toEqual([]);
    });

    test("body contains assertion passes when body includes substring", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, '{"status":"ok","version":"1.2.3"}')));

      const check = makeCheck({ expectedBodyContains: '"status":"ok"' });
      const result = await runApiCheck(check);

      expect(result.status).toBe("passed");
      expect(result.assertionsPassed).toContain('Response body contains ""status":"ok""');
    });

    test("body contains assertion fails when body does not include substring", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, '{"error":"not found"}')));

      const check = makeCheck({ expectedBodyContains: '"status":"ok"' });
      const result = await runApiCheck(check);

      expect(result.status).toBe("failed");
      expect(result.assertionsFailed).toContain('Response body does not contain ""status":"ok""');
    });

    test("response time assertion passes when within limit", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      const check = makeCheck({ expectedResponseTimeMs: 5000 });
      const result = await runApiCheck(check);

      expect(result.assertionsPassed.some((a) => a.includes("Response time"))).toBe(true);
      expect(result.assertionsFailed.some((a) => a.includes("Response time"))).toBe(false);
    });

    test("response time assertion fails when exceeds limit", async () => {
      // Use a very small threshold (1ms) that will be exceeded due to async overhead
      global.fetch = mock(async () => {
        // Add a small artificial delay to ensure the response time exceeds 1ms
        await new Promise((resolve) => setTimeout(resolve, 10));
        return mockResponse(200, "ok");
      });

      const check = makeCheck({ expectedResponseTimeMs: 1 });
      const result = await runApiCheck(check);

      // With 1ms limit and a 10ms delay, the response time assertion should fail
      expect(result.assertionsFailed.some((a) => a.includes("Response time") && a.includes("exceeds"))).toBe(true);
    });

    test("timeout → error with 'timed out' message", async () => {
      global.fetch = mock(() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });

      const check = makeCheck({ timeoutMs: 100 });
      const result = await runApiCheck(check);

      expect(result.status).toBe("error");
      expect(result.error).toContain("timed out");
    });

    test("network error → error status", async () => {
      global.fetch = mock(() => Promise.reject(new Error("Network connection refused")));

      const check = makeCheck();
      const result = await runApiCheck(check);

      expect(result.status).toBe("error");
      expect(result.error).toBe("Network connection refused");
      expect(result.statusCode).toBeNull();
    });

    test("saves runId to result when no runId provided, runId is null", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      const check = makeCheck();
      const result = await runApiCheck(check);

      expect(result.runId).toBeNull();
    });

    test("builds URL from baseUrl when url is relative", async () => {
      let capturedUrl: string | undefined;
      global.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(mockResponse(200, "ok"));
      });

      const check = makeCheck({ url: "/health" });
      await runApiCheck(check, { baseUrl: "https://myapp.com" });

      expect(capturedUrl).toBe("https://myapp.com/health");
    });

    test("preserves absolute URL when not relative", async () => {
      let capturedUrl: string | undefined;
      global.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(mockResponse(200, "ok"));
      });

      const check = makeCheck({ url: "https://example.com/health" });
      await runApiCheck(check, { baseUrl: "https://myapp.com" });

      expect(capturedUrl).toBe("https://example.com/health");
    });

    test("POST with body sends request body", async () => {
      let capturedOptions: RequestInit | undefined;
      global.fetch = mock((_url: string, opts?: RequestInit) => {
        capturedOptions = opts;
        return Promise.resolve(mockResponse(201, '{"id":"123"}'));
      });

      const check = makeCheck({
        method: "POST",
        body: '{"name":"Alice"}',
        expectedStatus: 201,
      });
      await runApiCheck(check);

      expect(capturedOptions?.body).toBe('{"name":"Alice"}');
      expect(capturedOptions?.method).toBe("POST");
    });

    test("stores response body in result", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, '{"data":"value"}')));

      const check = makeCheck();
      const result = await runApiCheck(check);

      expect(result.responseBody).toBe('{"data":"value"}');
    });

    test("multiple assertions — all pass → passed", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, '{"status":"ok"}')));

      const check = makeCheck({
        expectedStatus: 200,
        expectedBodyContains: '"status":"ok"',
      });
      const result = await runApiCheck(check);

      expect(result.status).toBe("passed");
      expect(result.assertionsPassed.length).toBe(2);
      expect(result.assertionsFailed.length).toBe(0);
    });

    test("multiple assertions — one fails → failed", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, '{"status":"error"}')));

      const check = makeCheck({
        expectedStatus: 200,
        expectedBodyContains: '"status":"ok"',
      });
      const result = await runApiCheck(check);

      expect(result.status).toBe("failed");
      expect(result.assertionsPassed).toContain("Status code is 200");
      expect(result.assertionsFailed.length).toBeGreaterThan(0);
    });
  });

  describe("runApiChecks", () => {
    test("runs all checks and returns results", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      const check1 = makeCheck({ name: "Check 1", url: "https://example.com/1" });
      const check2 = makeCheck({ name: "Check 2", url: "https://example.com/2" });
      const check3 = makeCheck({ name: "Check 3", url: "https://example.com/3" });

      const results = await runApiChecks([check1, check2, check3]);

      expect(results.length).toBe(3);
      expect(results.every((r) => r.status === "passed")).toBe(true);
    });

    test("batches by parallel limit", async () => {
      const callOrder: number[] = [];
      let callIndex = 0;

      global.fetch = mock(() => {
        const i = callIndex++;
        callOrder.push(i);
        return Promise.resolve(mockResponse(200, "ok"));
      });

      const checks = Array.from({ length: 6 }, (_, i) =>
        makeCheck({ name: `Check ${i}`, url: `https://example.com/${i}` })
      );

      const results = await runApiChecks(checks, { parallel: 3 });

      expect(results.length).toBe(6);
      expect(callOrder.length).toBe(6);
    });

    test("returns empty array for empty input", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      const results = await runApiChecks([]);
      expect(results).toEqual([]);
    });

    test("handles mixed pass/fail across batch", async () => {
      let call = 0;
      global.fetch = mock(() => {
        const status = call++ % 2 === 0 ? 200 : 500;
        return Promise.resolve(mockResponse(status, "body"));
      });

      const checks = Array.from({ length: 4 }, (_, i) =>
        makeCheck({ name: `Check ${i}`, url: `https://example.com/${i}`, expectedStatus: 200 })
      );

      const results = await runApiChecks(checks, { parallel: 2 });

      expect(results.length).toBe(4);
      const passed = results.filter((r) => r.status === "passed").length;
      const failed = results.filter((r) => r.status === "failed").length;
      expect(passed).toBe(2);
      expect(failed).toBe(2);
    });
  });

  describe("runApiChecksByFilter", () => {
    test("runs only enabled checks matching filter", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      makeCheck({ name: "Enabled", url: "https://example.com/1", enabled: true });
      makeCheck({ name: "Disabled", url: "https://example.com/2", enabled: false });

      const summary = await runApiChecksByFilter({ baseUrl: "https://example.com" });

      // Should only run the enabled check
      expect(summary.results.length).toBe(1);
    });

    test("returns pass/fail/error counts", async () => {
      let call = 0;
      global.fetch = mock(() => {
        const idx = call++;
        if (idx === 0) return Promise.resolve(mockResponse(200, "ok"));
        if (idx === 1) return Promise.resolve(mockResponse(500, "error"));
        return Promise.reject(new Error("Network error"));
      });

      makeCheck({ name: "Pass", url: "https://example.com/1", enabled: true, expectedStatus: 200 });
      makeCheck({ name: "Fail", url: "https://example.com/2", enabled: true, expectedStatus: 200 });
      makeCheck({ name: "Error", url: "https://example.com/3", enabled: true, expectedStatus: 200 });

      const summary = await runApiChecksByFilter({ baseUrl: "https://example.com" });

      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.errors).toBe(1);
      expect(summary.results.length).toBe(3);
    });

    test("filters by projectId", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      const { createProject } = await import("../db/projects.js");
      const project = createProject({ name: "filter-proj" });

      makeCheck({ name: "In project", url: "https://example.com/1", projectId: project.id, enabled: true });
      makeCheck({ name: "Other", url: "https://example.com/2", enabled: true });

      const summary = await runApiChecksByFilter({ baseUrl: "https://example.com", projectId: project.id });

      expect(summary.results.length).toBe(1);
    });

    test("returns empty results when no enabled checks", async () => {
      global.fetch = mock(() => Promise.resolve(mockResponse(200, "ok")));

      makeCheck({ name: "Disabled", url: "https://example.com/1", enabled: false });

      const summary = await runApiChecksByFilter({ baseUrl: "https://example.com" });

      expect(summary.results).toEqual([]);
      expect(summary.passed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.errors).toBe(0);
    });
  });
});
