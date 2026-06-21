process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import {
  createExecutionSubject,
  createLoopRun,
  createRunArtifact,
  createRunAttempt,
  createTestGoal,
  createTestSpec,
  ensureRunAttemptForResult,
  ensureTestSpecForScenario,
  getRunAttempt,
  getTestSpec,
  listExecutionSubjects,
  listLoopRuns,
  listRunArtifacts,
  listRunAttempts,
  listRunEvents,
  listTestGoals,
  listTestSpecs,
  recordRunEvent,
  updateRunAttempt,
} from "./execution.js";
import { createProject } from "./projects.js";
import { createResult, updateResult } from "./results.js";
import { createRun } from "./runs.js";
import { createScenario } from "./scenarios.js";

describe("app-agnostic execution storage", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("creates subjects, specs, goals, loop runs, attempts, events, and artifacts", () => {
    const project = createProject({ name: "execution-project" });
    const subject = createExecutionSubject({
      projectId: project.id,
      kind: "web_app",
      name: "Preview app",
      uri: "http://127.0.0.1:3000",
      externalRef: "preview:123",
      metadata: { environment: "preview" },
    });
    const spec = createTestSpec({
      projectId: project.id,
      subjectId: subject.id,
      kind: "agentic",
      name: "Checkout goal",
      objective: "Prove checkout can complete",
      steps: [{ instruction: "Buy a test item", expected: "confirmation" }],
      assertions: [{ type: "text_contains", expected: "Confirmed" }],
      tags: ["checkout", "agentic"],
      priority: "high",
      config: { timeoutMs: 90000 },
    });
    const goal = createTestGoal({
      projectId: project.id,
      subjectId: subject.id,
      specId: spec.id,
      title: "Checkout proof",
      prompt: "Keep testing until checkout is proven or a clear blocker is found.",
      successCriteria: ["confirmation screen is visible"],
    });
    const loopRun = createLoopRun({
      goalId: goal.id,
      specId: spec.id,
      subjectId: subject.id,
      status: "running",
      maxIterations: 3,
    });
    const attempt = createRunAttempt({
      loopRunId: loopRun.id,
      specId: spec.id,
      subjectId: subject.id,
      status: "running",
      executor: "local-agent",
      metadata: { worker: 1 },
    });

    const firstEvent = recordRunEvent({ attemptId: attempt.id, loopRunId: loopRun.id, type: "attempt.started" });
    const secondEvent = recordRunEvent({
      attemptId: attempt.id,
      loopRunId: loopRun.id,
      level: "warn",
      type: "assertion.retry",
      message: "Retrying after transient failure",
      data: { retry: 1 },
    });
    const artifact = createRunArtifact({
      attemptId: attempt.id,
      loopRunId: loopRun.id,
      kind: "json",
      name: "trace",
      uri: "file:///tmp/trace.json",
      mimeType: "application/json",
      metadata: { compressed: false },
    });
    const completed = updateRunAttempt(attempt.id, { status: "passed", summary: "Checkout passed" });

    expect(subject.metadata.environment).toBe("preview");
    expect(listExecutionSubjects({ projectId: project.id, kind: "web_app" }).map((item) => item.id)).toEqual([subject.id]);
    expect(listTestSpecs({ projectId: project.id, tags: ["checkout"] }).map((item) => item.id)).toEqual([spec.id]);
    expect(listTestGoals({ specId: spec.id }).map((item) => item.id)).toEqual([goal.id]);
    expect(listLoopRuns({ goalId: goal.id }).map((item) => item.id)).toEqual([loopRun.id]);
    expect(listRunAttempts({ specId: spec.id }).map((item) => item.id)).toEqual([attempt.id]);
    expect(firstEvent.sequence).toBe(1);
    expect(secondEvent.sequence).toBe(2);
    expect(listRunEvents(attempt.id).map((event) => event.type)).toEqual(["attempt.started", "assertion.retry"]);
    expect(listRunArtifacts(attempt.id).map((item) => item.id)).toEqual([artifact.id]);
    expect(completed.status).toBe("passed");
    expect(completed.finishedAt).toBeTruthy();
  });

  test("mirrors legacy scenarios into idempotent test specs without changing scenario APIs", () => {
    const project = createProject({ name: "legacy-project", scenarioPrefix: "LEG" });
    const scenario = createScenario({
      projectId: project.id,
      name: "Homepage smoke",
      description: "Load the homepage",
      steps: ["Open /", "Check the headline"],
      tags: ["smoke"],
      priority: "critical",
      assertions: [{ type: "text_contains", expected: "Welcome" }],
      metadata: { owner: "qa" },
    });

    const spec = ensureTestSpecForScenario(scenario.id);
    const again = ensureTestSpecForScenario(scenario.id);

    expect(again.id).toBe(spec.id);
    expect(getTestSpec(scenario.id)?.id).toBe(spec.id);
    expect(spec).toMatchObject({
      projectId: project.id,
      legacyScenarioId: scenario.id,
      kind: "browser",
      name: "Homepage smoke",
      priority: "critical",
      tags: ["smoke"],
    });
    expect(spec.steps).toEqual(["Open /", "Check the headline"]);
    expect(spec.metadata.legacyScenarioShortId).toBe(scenario.shortId);
    expect(getDatabase().query("SELECT COUNT(*) AS count FROM scenarios").get()).toEqual({ count: 1 });
  });

  test("mirrors legacy results into idempotent run attempts", () => {
    const scenario = createScenario({
      name: "Result compatibility",
      description: "Verify compatibility",
      steps: ["Run check"],
    });
    const run = createRun({ url: "http://127.0.0.1:3000", model: "test-model" });
    const result = createResult({
      runId: run.id,
      scenarioId: scenario.id,
      model: "test-model",
      stepsTotal: 1,
    });
    const updated = updateResult(result.id, {
      status: "passed",
      reasoning: "All checks passed",
      stepsCompleted: 1,
      durationMs: 42,
      tokensUsed: 10,
      costCents: 0.01,
      metadata: { browser: "none" },
    });

    const attempt = ensureRunAttemptForResult(updated.id);
    const again = ensureRunAttemptForResult(updated.id);

    expect(again.id).toBe(attempt.id);
    expect(getRunAttempt(updated.id)?.id).toBe(attempt.id);
    expect(attempt).toMatchObject({
      runId: run.id,
      legacyResultId: updated.id,
      status: "passed",
      executor: "legacy-result",
      durationMs: 42,
      summary: "All checks passed",
    });
    expect(attempt.metadata.tokensUsed).toBe(10);
    expect(getTestSpec(scenario.id)?.legacyScenarioId).toBe(scenario.id);
  });
});
