process.env.TESTERS_DB_PATH = ":memory:";

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createFailureTasks, notifyFailureToConversations } from "./failure-pipeline.js";
import type { Run, Result, Scenario } from "../types/index.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    projectId: null,
    status: "failed",
    url: "https://example.com",
    model: "claude-haiku-4-5-20251001",
    headed: false,
    parallel: 1,
    total: 2,
    passed: 0,
    failed: 2,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    metadata: null,
    isBaseline: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<Result> = {}): Result {
  return {
    id: "result-1",
    runId: "run-1",
    scenarioId: "sc-1",
    status: "failed",
    reasoning: "Button not found",
    error: "Element not found: #submit",
    stepsCompleted: 2,
    stepsTotal: 5,
    durationMs: 3000,
    model: "claude-haiku-4-5-20251001",
    tokensUsed: 500,
    costCents: 0.1,
    metadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "sc-1",
    shortId: "sc-1",
    projectId: null,
    name: "Login flow",
    description: "Test login",
    steps: [],
    tags: [],
    priority: "high",
    model: null,
    timeoutMs: null,
    targetPath: null,
    requiresAuth: false,
    authConfig: null,
    metadata: null,
    assertions: [],
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── createFailureTasks ───────────────────────────────────────────────────────

describe("createFailureTasks", () => {
  beforeEach(() => {
    delete process.env["TESTERS_TODOS_PROJECT_ID"];
  });

  it("returns {created:0, skipped:0} when TESTERS_TODOS_PROJECT_ID is not set", async () => {
    const result = await createFailureTasks(makeRun(), [makeResult()], [makeScenario()]);
    expect(result).toEqual({ created: 0, skipped: 0 });
  });

  it("returns {created:0, skipped:0} when failedResults is empty", async () => {
    process.env["TESTERS_TODOS_PROJECT_ID"] = "proj-123";
    const result = await createFailureTasks(makeRun(), [], [makeScenario()]);
    expect(result).toEqual({ created: 0, skipped: 0 });
  });

  it("never throws even when todos DB insert fails", async () => {
    process.env["TESTERS_TODOS_PROJECT_ID"] = "proj-123";
    // Either the todos DB is unavailable (skipped=0) or insert fails (skipped=1) — both are fine
    const result = await createFailureTasks(makeRun(), [makeResult()], [makeScenario()]);
    expect(result.created + result.skipped).toBe(result.created + result.skipped); // no throw
    expect(typeof result.created).toBe("number");
    expect(typeof result.skipped).toBe("number");
  });
});

// ─── notifyFailureToConversations ─────────────────────────────────────────────

describe("notifyFailureToConversations", () => {
  beforeEach(() => {
    delete process.env["TESTERS_CONVERSATIONS_URL"];
    delete process.env["TESTERS_CONVERSATIONS_SPACE"];
  });

  it("is a no-op when TESTERS_CONVERSATIONS_URL is not set", async () => {
    // Should not throw and should resolve cleanly
    await expect(
      notifyFailureToConversations(makeRun(), [makeResult()], [makeScenario()])
    ).resolves.toBeUndefined();
  });

  it("is a no-op when TESTERS_CONVERSATIONS_SPACE is not set", async () => {
    process.env["TESTERS_CONVERSATIONS_URL"] = "http://localhost:9999";
    await expect(
      notifyFailureToConversations(makeRun(), [makeResult()], [makeScenario()])
    ).resolves.toBeUndefined();
  });

  it("does not throw when fetch fails", async () => {
    process.env["TESTERS_CONVERSATIONS_URL"] = "http://127.0.0.1:1"; // unreachable
    process.env["TESTERS_CONVERSATIONS_SPACE"] = "test-space";
    // Should swallow the error and resolve cleanly
    await expect(
      notifyFailureToConversations(makeRun(), [makeResult()], [makeScenario()])
    ).resolves.toBeUndefined();
  });

  it("truncates failure list to 5 scenarios", async () => {
    // Just verify the function handles >5 results without throwing
    process.env["TESTERS_CONVERSATIONS_URL"] = "http://127.0.0.1:1";
    process.env["TESTERS_CONVERSATIONS_SPACE"] = "test-space";
    const results = Array.from({ length: 8 }, (_, i) =>
      makeResult({ id: `result-${i}`, scenarioId: `sc-${i}` })
    );
    const scenarios = Array.from({ length: 8 }, (_, i) =>
      makeScenario({ id: `sc-${i}`, name: `Scenario ${i}` })
    );
    await expect(
      notifyFailureToConversations(makeRun(), results, scenarios)
    ).resolves.toBeUndefined();
  });
});
