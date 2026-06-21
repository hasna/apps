process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTestingWorkflow } from "../db/workflows.js";
import {
  assertWorkflowFanoutLeasePlan,
  buildWorkflowFanoutLeasePlan,
  checkWorkflowFanoutReadiness,
  normalizeFanoutWorkerCount,
  resolveWorkflowFanoutBatch,
  resolveWorkflowFanoutBatchRange,
  resolveWorkflowFanoutSelection,
  runWorkflowFanout,
  runWorkflowFanoutBatches,
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

  test("models active and queued fanout leases", () => {
    expect(buildWorkflowFanoutLeasePlan(5, 3)).toEqual({
      selected: 5,
      workers: 3,
      activeLeases: 3,
      queuedLeases: 2,
      maxQueuedLeases: 12,
      withinLimit: true,
    });

    const overloaded = buildWorkflowFanoutLeasePlan(31, 6);
    expect(overloaded).toMatchObject({
      activeLeases: 6,
      queuedLeases: 25,
      maxQueuedLeases: 24,
      withinLimit: false,
    });
    expect(() => assertWorkflowFanoutLeasePlan(overloaded)).toThrow("max queued leases");
    expect(buildWorkflowFanoutLeasePlan(31, 6, { maxQueuedLeases: 25 }).withinLimit).toBe(true);
  });

  test("resolves deterministic fanout batches and offsets", () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));

    const secondBatch = resolveWorkflowFanoutBatch(workflows, { batchSize: 2, batch: 2 });
    expect(secondBatch.workflows.map((workflow) => workflow.name)).toEqual(["workflow-3", "workflow-4"]);
    expect(secondBatch.selection).toEqual({
      matched: 5,
      offset: 2,
      limit: 2,
      batch: 2,
      batchSize: 2,
      totalBatches: 3,
    });

    const manualOffset = resolveWorkflowFanoutBatch(workflows, { offset: 4 });
    expect(manualOffset.workflows.map((workflow) => workflow.name)).toEqual(["workflow-5"]);
    expect(manualOffset.selection).toEqual({ matched: 5, offset: 4 });
  });

  test("rejects invalid fanout batch selections", () => {
    const workflows = Array.from({ length: 2 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));

    expect(() => resolveWorkflowFanoutBatch(workflows, { batch: 1 })).toThrow("requires batch size");
    expect(() => resolveWorkflowFanoutBatch(workflows, { batchSize: 1, batch: 1, offset: 0 })).toThrow("cannot both be set");
    expect(() => resolveWorkflowFanoutBatch(workflows, { offset: 99 })).toThrow("batch selection");
  });

  test("resolves validated fanout batch ranges", () => {
    expect(resolveWorkflowFanoutBatchRange(5, { batchSize: 2 })).toEqual({
      batchSize: 2,
      batchStart: 1,
      batchEnd: 3,
      totalBatches: 3,
    });
    expect(resolveWorkflowFanoutBatchRange(5, { batchSize: 2, batchStart: 2, batchEnd: 3 })).toEqual({
      batchSize: 2,
      batchStart: 2,
      batchEnd: 3,
      totalBatches: 3,
    });
    expect(() => resolveWorkflowFanoutBatchRange(5, { batchSize: 2, batchStart: 4, batchEnd: 4 })).toThrow("exceeds total batches");
    expect(() => resolveWorkflowFanoutBatchRange(5, { batchSize: 2, batchStart: 3, batchEnd: 2 })).toThrow("less than or equal");
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
    expect(result.selection).toEqual({ matched: 5, offset: 0 });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  test("refuses oversized real fanout before preflight or worker launch", async () => {
    const workflows = Array.from({ length: 31 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    let preflightCalls = 0;
    let launched = 0;

    await expect(runWorkflowFanout({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 6,
    }, {
      async preflight() {
        preflightCalls++;
        return { ok: true, checks: [] };
      },
      async runTestingWorkflow() {
        launched++;
        throw new Error("should not run");
      },
    })).rejects.toThrow("max queued leases");

    expect(preflightCalls).toBe(0);
    expect(launched).toBe(0);
  });

  test("runs only the selected workflow fanout batch", async () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));

    const result = await runWorkflowFanout({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 1,
      batchSize: 2,
      batch: 2,
      dryRun: true,
    }, {
      async preflight() {
        return { ok: true, checks: [] };
      },
      async runTestingWorkflow(workflowId) {
        return {
          run: null,
          results: [],
          plan: {
            workflow: workflows.find((workflow) => workflow.id === workflowId)!,
            runOptions: { url: "https://preview.example", dryRun: true },
            sandbox: null,
          },
          sandboxResult: undefined,
        };
      },
    });

    expect(result.status).toBe("dry-run");
    expect(result.total).toBe(2);
    expect(result.leases).toMatchObject({
      selected: 2,
      activeLeases: 1,
      queuedLeases: 1,
      withinLimit: true,
    });
    expect(result.items.map((item) => item.workflowName)).toEqual(["workflow-3", "workflow-4"]);
    expect(result.selection).toEqual({
      matched: 5,
      offset: 2,
      limit: 2,
      batch: 2,
      batchSize: 2,
      totalBatches: 3,
    });
  });

  test("runs a workflow fanout batch range in sequence", async () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    const launched: string[] = [];

    const result = await runWorkflowFanoutBatches({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 2,
      batchSize: 2,
      batchStart: 2,
      batchEnd: 3,
      dryRun: true,
    }, {
      async preflight() {
        return { ok: true, checks: [] };
      },
      async runTestingWorkflow(workflowId) {
        const workflow = workflows.find((item) => item.id === workflowId)!;
        launched.push(workflow.name);
        return {
          run: null,
          results: [],
          plan: {
            workflow,
            runOptions: { url: "https://preview.example", dryRun: true },
            sandbox: null,
          },
          sandboxResult: undefined,
        };
      },
    });

    expect(result.status).toBe("dry-run");
    expect(result.matched).toBe(5);
    expect(result.total).toBe(3);
    expect(result.batchStart).toBe(2);
    expect(result.batchEnd).toBe(3);
    expect(result.totalBatches).toBe(3);
    expect(result.stoppedEarly).toBe(false);
    expect(result.batches.map((batch) => batch.selection.batch)).toEqual([2, 3]);
    expect(launched).toEqual(["workflow-3", "workflow-4", "workflow-5"]);
  });

  test("stops multi-batch fanout on the first failed batch by default", async () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    const launched: string[] = [];

    const result = await runWorkflowFanoutBatches({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 2,
      batchSize: 2,
    }, {
      async preflight() {
        return { ok: true, checks: [] };
      },
      async runTestingWorkflow(workflowId) {
        const workflow = workflows.find((item) => item.id === workflowId)!;
        launched.push(workflow.name);
        if (workflow.name === "workflow-3") {
          throw new Error("action failed");
        }
        return {
          run: null,
          results: [],
          plan: {
            workflow,
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

    expect(result.status).toBe("failed");
    expect(result.stoppedEarly).toBe(true);
    expect(result.batches.map((batch) => batch.selection.batch)).toEqual([1, 2]);
    expect(result.total).toBe(4);
    expect(result.failed).toBe(1);
    expect(launched).toEqual(["workflow-1", "workflow-2", "workflow-3", "workflow-4"]);
  });

  test("can continue multi-batch fanout after failed batches", async () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    const launched: string[] = [];

    const result = await runWorkflowFanoutBatches({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 2,
      batchSize: 2,
      continueOnFailure: true,
    }, {
      async preflight() {
        return { ok: true, checks: [] };
      },
      async runTestingWorkflow(workflowId) {
        const workflow = workflows.find((item) => item.id === workflowId)!;
        launched.push(workflow.name);
        if (workflow.name === "workflow-3") {
          throw new Error("action failed");
        }
        return {
          run: null,
          results: [],
          plan: {
            workflow,
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

    expect(result.status).toBe("failed");
    expect(result.stoppedEarly).toBe(false);
    expect(result.batches.map((batch) => batch.selection.batch)).toEqual([1, 2, 3]);
    expect(result.total).toBe(5);
    expect(result.failed).toBe(1);
    expect(launched).toEqual(["workflow-1", "workflow-2", "workflow-3", "workflow-4", "workflow-5"]);
  });

  test("preflight reports missing sandbox provider credentials", async () => {
    const workflow = createTestingWorkflow({
      name: "e2b workflow",
      execution: {
        target: "sandbox",
        provider: "e2b",
        env: { ANTHROPIC_API_KEY: "$ANTHROPIC_API_KEY" },
      },
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
          ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}",
          REQUIRED_TOKEN: "${MISSING_REQUIRED}",
          OPTIONAL_TOKEN: "$?{MISSING_OPTIONAL}",
          LITERAL: "plain-value",
        },
      },
    });

    const failedPreflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set", ANTHROPIC_API_KEY: "model-key" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
    });

    expect(failedPreflight.ok).toBe(false);
    expect(failedPreflight.checks.find((check) => check.name === "env:required")?.required).toBe(true);
    expect(failedPreflight.checks.find((check) => check.name === "env:optional")?.required).toBe(false);

    const warningOnlyPreflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set", ANTHROPIC_API_KEY: "model-key", MISSING_REQUIRED: "now-set" },
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
        env: { ANTHROPIC_API_KEY: "$ANTHROPIC_API_KEY" },
        appSourceDir: "/tmp/open-testers-missing-app-source",
      },
    });

    const preflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set", ANTHROPIC_API_KEY: "model-key" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
    });

    expect(preflight.ok).toBe(false);
    expect(preflight.checks.find((check) => check.name === "app-source")?.message).toContain("missing");
  });

  test("preflight requires sandbox env for the selected model provider", async () => {
    const workflow = createTestingWorkflow({
      name: "model workflow",
      execution: { target: "sandbox", provider: "e2b" },
    });

    const preflight = await checkWorkflowFanoutReadiness([workflow], {
      env: { E2B_API_KEY: "set" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
    });

    const modelCheck = preflight.checks.find((check) => check.name === "model:anthropic");
    expect(preflight.ok).toBe(false);
    expect(modelCheck?.ok).toBe(false);
    expect(modelCheck?.required).toBe(true);
    expect(modelCheck?.message).toContain("ANTHROPIC_API_KEY");
  });

  test("preflight validates selected model credentials when requested", async () => {
    const workflow = createTestingWorkflow({
      name: "live model workflow",
      execution: {
        target: "sandbox",
        provider: "e2b",
        env: { CEREBRAS_API_KEY: "$CEREBRAS_API_KEY" },
      },
    });

    const preflight = await checkWorkflowFanoutReadiness([workflow], {
      model: "cerebras-fast",
      validateModelCredentials: true,
      env: { E2B_API_KEY: "set", CEREBRAS_API_KEY: "invalid-model-key" },
      providerApiKeyResolver: () => "set",
      commandExists: () => true,
      modelCredentialValidator: async (input) => ({
        ok: input.apiKey === "valid-model-key",
        status: 401,
        message: "Wrong API Key",
      }),
    });

    const modelCheck = preflight.checks.find((check) => check.name === "model:cerebras");
    const liveCheck = preflight.checks.find((check) => check.name === "model:cerebras:live");
    expect(modelCheck?.ok).toBe(true);
    expect(liveCheck?.ok).toBe(false);
    expect(liveCheck?.message).toContain("Wrong API Key");
    expect(preflight.ok).toBe(false);
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
