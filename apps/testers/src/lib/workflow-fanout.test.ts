process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTestingWorkflow } from "../db/workflows.js";
import {
  checkWorkflowFanoutReadiness,
  normalizeFanoutWorkerCount,
  resolveWorkflowFanoutSelection,
  runWorkflowFanout,
} from "./workflow-fanout.js";

describe("workflow fanout", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("selects saved sandbox workflows by project and tag", () => {
    const project = createProject({ name: "alumia" });
    const selected = createTestingWorkflow({
      name: "projects page",
      projectId: project.id,
      scenarioFilter: { tags: ["projects"] },
      execution: { target: "sandbox", provider: "e2b" },
    });
    createTestingWorkflow({
      name: "billing page",
      projectId: project.id,
      scenarioFilter: { tags: ["billing"] },
      execution: { target: "sandbox", provider: "e2b" },
    });

    const workflows = resolveWorkflowFanoutSelection({
      projectId: project.id,
      tags: ["projects"],
    });

    expect(workflows.map((workflow) => workflow.id)).toEqual([selected.id]);
  });

  test("requires selected workflows to use sandbox execution", () => {
    createTestingWorkflow({ name: "local only", execution: { target: "local" } });

    expect(() => resolveWorkflowFanoutSelection({})).toThrow("requires sandbox workflows");
  });

  test("bounds worker count to the supported 1-12 sandbox range", () => {
    expect(normalizeFanoutWorkerCount(undefined)).toBe(6);
    expect(normalizeFanoutWorkerCount(12)).toBe(12);
    expect(() => normalizeFanoutWorkerCount(0)).toThrow("between 1 and 12");
    expect(() => normalizeFanoutWorkerCount(13)).toThrow("between 1 and 12");
  });

  test("runs workflows with bounded sandbox concurrency", async () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    let active = 0;
    let maxActive = 0;

    const result = await runWorkflowFanout({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 3,
    }, {
      async preflight() {
        return { ok: true, checks: [] };
      },
      async runTestingWorkflow(workflowId) {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return {
          run: null,
          results: [],
          plan: {
            workflow: workflows.find((workflow) => workflow.id === workflowId)!,
            runOptions: { url: "https://preview.example" },
            sandbox: null,
          },
          sandboxResult: {
            sandboxId: `sb_${workflowId.slice(0, 8)}`,
            sessionId: `sess_${workflowId.slice(0, 8)}`,
            exitCode: 0,
            stdout: "",
            stderr: "",
            cleanup: "deleted",
          },
        };
      },
    });

    expect(result.status).toBe("passed");
    expect(result.total).toBe(5);
    expect(result.passed).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  test("preflight reports missing sandbox provider credentials", async () => {
    const workflow = createTestingWorkflow({
      name: "e2b workflow",
      execution: { target: "sandbox", provider: "e2b" },
    });

    const preflight = await checkWorkflowFanoutReadiness([workflow], {
      env: {},
      providerApiKeyResolver: () => undefined,
      commandExists: () => true,
    });

    expect(preflight.ok).toBe(false);
    const providerCheck = preflight.checks.find((check) => check.name === "provider:e2b");
    expect(providerCheck?.ok).toBe(false);
    expect(providerCheck?.required).toBe(true);
    expect(providerCheck?.message).toContain("E2B_API_KEY");
  });

  test("preflight treats optional env refs as warnings and required refs as failures", async () => {
    const workflow = createTestingWorkflow({
      name: "env workflow",
      execution: {
        target: "sandbox",
        provider: "e2b",
        env: {
          REQUIRED_TOKEN: "$MISSING_REQUIRED",
          OPTIONAL_TOKEN: "$?MISSING_OPTIONAL",
          LITERAL: "plain-value",
        },
      },
    });

    const failedPreflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
    });

    expect(failedPreflight.ok).toBe(false);
    expect(failedPreflight.checks.find((check) => check.name === "env:required")?.required).toBe(true);
    expect(failedPreflight.checks.find((check) => check.name === "env:optional")?.required).toBe(false);

    const warningOnlyPreflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set", MISSING_REQUIRED: "now-set" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
    });

    expect(warningOnlyPreflight.ok).toBe(true);
    expect(warningOnlyPreflight.checks.find((check) => check.name === "env:optional")?.ok).toBe(false);
  });

  test("preflight reports missing app source directories", async () => {
    const workflow = createTestingWorkflow({
      name: "app workflow",
      execution: {
        target: "sandbox",
        provider: "e2b",
        appSourceDir: "/tmp/open-testers-missing-app-source",
      },
    });

    const preflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
    });

    expect(preflight.ok).toBe(false);
    expect(preflight.checks.find((check) => check.name === "app-source")?.message).toContain("missing");
  });

  test("does not launch sandbox workers when required preflight checks fail", async () => {
    const workflows = Array.from({ length: 2 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    let launched = 0;

    const result = await runWorkflowFanout({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 2,
    }, {
      providerApiKeyResolver: () => undefined,
      commandExists: () => true,
      async runTestingWorkflow() {
        launched++;
        throw new Error("should not run");
      },
    });

    expect(launched).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.failed).toBe(2);
    expect(result.preflight?.ok).toBe(false);
    expect(result.items.every((item) => item.error?.startsWith("Preflight failed:"))).toBe(true);
  });
});
