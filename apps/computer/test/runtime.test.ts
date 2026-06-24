import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDb,
  getActionLogs,
  getDb,
  getSession,
  listAuditEvents,
} from "../src/db/index.js";
import {
  acquireRuntimeLease,
  addObservation,
  addRunStep,
  assertRunTransition,
  createApproval,
  createRuntimeGoal,
  createWorkflowDefinition,
  createWorkflowRun,
  expireStaleRuntimeLeases,
  getWorkflowRun,
  isTerminalStatus,
  legalRunTransitions,
  listApprovals,
  listArtifacts,
  listObservations,
  listPolicyDecisions,
  listRunSteps,
  listRuntimeLeases,
  recordArtifact,
  recordPolicyDecision,
  releaseRuntimeLease,
  resolveApproval,
  RUNTIME_RESOURCE_TYPES,
  transitionWorkflowRun,
} from "../src/agent/runtime.js";
import { STORAGE_TABLES } from "../src/db/storage-sync.js";
import { PG_MIGRATIONS } from "../src/db/pg-migrations.js";
import { resumeTask, runTask } from "../src/agent/loop.js";
import { executeComputerAction } from "../src/agent/policy.js";
import { cancelSession, pauseSession } from "../src/agent/control.js";
import { FallbackComputerProvider } from "../src/providers/index.js";
import type { ComputerDriver, ComputerProvider, DriverAction, Screenshot } from "../src/types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): string {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-runtime-"));
  const dbPath = join(tempDir, "computer.db");
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = dbPath;
  return dbPath;
}

afterEach(() => {
  closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("durable runtime schema", () => {
  test("fresh SQLite bootstrap creates every synced runtime table and lease indexes", () => {
    useTempDb();
    const db = getDb();
    const tableNames = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );

    for (const table of STORAGE_TABLES) expect(tableNames.has(table)).toBe(true);

    const indexes = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    expect(indexes.has("idx_resource_leases_one_active")).toBe(true);
  });

  test("old local DBs are migrated in place on open", () => {
    const dbPath = useTempDb();
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        steps INTEGER NOT NULL DEFAULT 0,
        total_tokens_in INTEGER NOT NULL DEFAULT 0,
        total_tokens_out INTEGER NOT NULL DEFAULT 0,
        total_duration_ms INTEGER NOT NULL DEFAULT 0,
        tags TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    old.close();

    const db = getDb();
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );

    expect(tables.has("runtime_goals")).toBe(true);
    expect(tables.has("workflow_runs")).toBe(true);
    expect(tables.has("resource_leases")).toBe(true);
    expect(tables.has("policy_decisions")).toBe(true);
    expect(tables.has("feedback")).toBe(true);
  });

  test("Postgres storage migrations include runtime sync shape", () => {
    const sql = PG_MIGRATIONS.join("\n");

    for (const table of STORAGE_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("idx_resource_leases_one_active");
    expect(sql).toContain("status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'waiting_on_approval'");
    expect(sql).toContain("definition_json JSONB NOT NULL");
    expect(sql).toContain("metadata_json JSONB");
  });
});

describe("durable runtime accessors", () => {
  test("records replay steps, observations, approvals, artifacts, and policy decisions", () => {
    useTempDb();
    const goal = createRuntimeGoal({ title: "Test goal", prompt: "Do a safe thing" });
    const workflow = createWorkflowDefinition({ name: "safe-workflow", definition: { steps: ["observe"] } });
    const run = createWorkflowRun({ goalId: goal.id, workflowId: workflow.id });

    const step = addRunStep({
      runId: run.id,
      stepIndex: 0,
      action: { type: "screenshot" },
      result: { success: true },
    });
    addObservation({ runId: run.id, stepId: step.id, kind: "screenshot", data: { path: "/tmp/step-0.png" } });
    const approvalId = createApproval({ runId: run.id, capability: "computer.type", reason: "typing text" });
    const resolved = resolveApproval(approvalId, "approved");
    recordArtifact({ runId: run.id, kind: "screenshot", path: "/tmp/step-0.png", sha256: "abc123", metadata: { step: 0 } });
    recordPolicyDecision({ runId: run.id, capability: "computer.type", decision: "blocked", reason: "test", metadata: { source: "unit" } });

    expect(listRunSteps(run.id)).toEqual([
      expect.objectContaining({
        step_index: 0,
        action: { type: "screenshot" },
        result: { success: true },
      }),
    ]);
    expect(listObservations(run.id)[0]).toEqual(expect.objectContaining({ kind: "screenshot", data: { path: "/tmp/step-0.png" } }));
    expect(resolved).toEqual(expect.objectContaining({ status: "approved", resolved_at: expect.any(String) }));
    expect(listApprovals(run.id)[0]).toEqual(expect.objectContaining({ status: "approved" }));
    expect(listArtifacts(run.id)[0]).toEqual(expect.objectContaining({ sha256: "abc123", metadata: { step: 0 } }));
    expect(listPolicyDecisions(run.id)[0]).toEqual(expect.objectContaining({ decision: "blocked", metadata: { source: "unit" } }));
  });

  test("enforces legal run transitions and separates max-step exhaustion", () => {
    useTempDb();
    const run = createWorkflowRun({});

    expect(legalRunTransitions("pending")).toContain("running");
    expect(() => assertRunTransition("pending", "running")).not.toThrow();
    expect(() => assertRunTransition("completed", "running")).toThrow("Invalid run transition");

    const running = transitionWorkflowRun(run.id, "running");
    expect(running.status).toBe("running");

    const exhausted = transitionWorkflowRun(run.id, "max_steps_exceeded", { error: "Reached max steps (1)" });
    expect(exhausted.status).toBe("max_steps_exceeded");
    expect(exhausted.completed_at).toBeString();
    expect(exhausted.error).toBe("Reached max steps (1)");
    expect(isTerminalStatus("max_steps_exceeded")).toBe(true);
    expect(() => transitionWorkflowRun(run.id, "running")).toThrow("Invalid run transition");
  });

  test("enforces one active exclusive lease per resource", async () => {
    useTempDb();
    const runA = createWorkflowRun({ status: "running" });
    const runB = createWorkflowRun({ status: "running" });

    for (const resourceType of RUNTIME_RESOURCE_TYPES) {
      const first = acquireRuntimeLease({
        resourceType,
        resourceId: `${resourceType}:primary`,
        runId: runA.id,
        holder: "agent-a",
      });
      const reentrant = acquireRuntimeLease({
        resourceType,
        resourceId: `${resourceType}:primary`,
        runId: runA.id,
        holder: "agent-a",
      });

      expect(reentrant.id).toBe(first.id);
      expect(() => acquireRuntimeLease({
        resourceType,
        resourceId: `${resourceType}:primary`,
        runId: runB.id,
        holder: "agent-b",
      })).toThrow("Resource lease already active");

      expect(() => releaseRuntimeLease(first.id, { runId: runB.id, holder: "agent-b" })).toThrow("owned by run");
      const released = releaseRuntimeLease(first.id, { runId: runA.id, holder: "agent-a" });
      expect(released).toEqual(expect.objectContaining({ status: "released" }));
    }

    const second = acquireRuntimeLease({
      resourceType: "computer_display",
      resourceId: "local-display-1",
      runId: runB.id,
      holder: "agent-b",
      ttlMs: 1,
    });
    expect(second.run_id).toBe(runB.id);

    await Bun.sleep(5);
    expect(expireStaleRuntimeLeases()).toBeGreaterThanOrEqual(1);
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
  });
});

describe("runtime loop integration", () => {
  const screenshot: Screenshot = {
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    size: { width: 1, height: 1 },
    timestamp: Date.now(),
  };

  function testDriver(overrides: Partial<ComputerDriver> = {}): ComputerDriver {
    return {
      getScreenSize: async () => screenshot.size,
      screenshot: async () => screenshot,
      execute: async (_action: DriverAction) => ({ success: true, duration_ms: 0 }),
      dispose: async () => {},
      ...overrides,
    };
  }

  test("runTask records a durable run and releases the display lease on completion", async () => {
    useTempDb();
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: null,
        reasoning: "done",
        done: true,
        usage: { input: 1, output: 1 },
      }),
    };

    const session = await runTask({
      task: "complete safely",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(session.status).toBe("completed");
    expect(getSession(session.id)?.status).toBe("completed");
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
    expect(listRuntimeLeases({ status: "released", runId: session.id })).toHaveLength(1);
    expect(listRunSteps(session.id)[0]).toEqual(expect.objectContaining({ status: "completed" }));
    expect(listObservations(session.id).some((observation) => observation.kind === "screenshot")).toBe(true);
  });

  test("runTask display lease has crash-recovery TTL", async () => {
    useTempDb();
    let capturedLeaseExpiry: string | undefined;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        capturedLeaseExpiry = listRuntimeLeases({ status: "active" })[0]?.expires_at;
        return {
          action: null,
          reasoning: "done",
          done: true,
        };
      },
    };

    await runTask({
      task: "lease ttl",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(capturedLeaseExpiry).toBeString();
  });

  test("runTask stores max-step exhaustion separately from completion", async () => {
    useTempDb();
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: { type: "wait", ms: 1 },
        reasoning: "keep going",
        done: false,
      }),
    };

    const session = await runTask({
      task: "hit step limit",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(session.status).toBe("max_steps_exceeded");
    expect(session.error).toBe("Reached max steps (1)");
    expect(getSession(session.id)?.status).toBe("max_steps_exceeded");
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
  });

  test("runTask records pending approvals and waits for a later loop step", async () => {
    useTempDb();
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: { type: "click", point: { x: 1, y: 1 } },
        reasoning: "click needs approval",
        done: false,
      }),
    };

    const session = await runTask({
      task: "request approval",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
      safety: { confirmClicks: true, maxActionsPerMinute: 60, allowPasswordTyping: true },
    });

    expect(session.status).toBe("waiting_on_approval");
    expect(getWorkflowRun(session.id)?.status).toBe("waiting_on_approval");
    expect(listApprovals(session.id)[0]).toEqual(expect.objectContaining({
      capability: "computer.click",
      status: "pending",
    }));
    expect(listRunSteps(session.id)[0]).toEqual(expect.objectContaining({
      status: "waiting_on_approval",
    }));
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
  });

  test("runTask maps local screenshot coordinates to native display space without mutating provider history", async () => {
    useTempDb();
    const offsetScreenshot: Screenshot = {
      ...screenshot,
      size: { width: 100, height: 100 },
      coordinateSpace: {
        kind: "screenshot",
        size: { width: 100, height: 100 },
        origin: { x: 1000, y: 500 },
        displayNumber: 2,
      },
    };
    let analyzeCalls = 0;
    let executedAction: DriverAction | undefined;
    let providerHistoryAction: DriverAction | null | undefined;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async ({ history }) => {
        analyzeCalls += 1;
        if (analyzeCalls === 1) {
          return {
            action: { type: "click", point: { x: 10, y: 20 }, button: "left" },
            reasoning: "click local display point",
            done: false,
          };
        }
        providerHistoryAction = history.find((entry) => entry.action)?.action;
        return {
          action: null,
          reasoning: "done",
          done: true,
        };
      },
    };

    const session = await runTask({
      task: "click on secondary display",
      maxSteps: 2,
      dryRun: false,
      driver: testDriver({
        getScreenSize: async () => offsetScreenshot.size,
        screenshot: async () => offsetScreenshot,
        execute: async (action) => {
          executedAction = action;
          return { success: true, duration_ms: 0, screenshot: offsetScreenshot };
        },
      }),
      computerProvider: provider,
    });

    expect(session.status).toBe("completed");
    expect(executedAction).toEqual({ type: "click", point: { x: 1010, y: 520 }, button: "left" });
    expect(providerHistoryAction).toEqual({ type: "click", point: { x: 10, y: 20 }, button: "left" });
  });

  test("runTask pause stops before the next action", async () => {
    useTempDb();
    let executeCalls = 0;
    let paused = false;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        const running = getDb().prepare("SELECT id FROM sessions WHERE status = 'running' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
        if (running && !paused) {
          pauseSession(running.id, "operator paused before action");
          paused = true;
        }
        return {
          action: { type: "wait", ms: 1 },
          reasoning: "wait after pause",
          done: false,
        };
      },
    };

    const session = await runTask({
      task: "pause before action",
      maxSteps: 3,
      dryRun: false,
      driver: testDriver({
        execute: async () => {
          executeCalls += 1;
          return { success: true, duration_ms: 0 };
        },
      }),
      computerProvider: provider,
    });

    expect(executeCalls).toBe(0);
    expect(session.status).toBe("paused");
    expect(session.error).toBe("operator paused before action");
    expect(session.completed_at).toBeUndefined();
    expect(getWorkflowRun(session.id)?.status).toBe("paused");
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
  });

  test("resumeTask continues a paused session with persisted history", async () => {
    useTempDb();
    let analyzeCalls = 0;
    let resumedHistoryLength = -1;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async ({ history }) => {
        analyzeCalls += 1;
        if (analyzeCalls === 1) {
          return {
            action: { type: "wait", ms: 1 },
            reasoning: "first action",
            done: false,
            usage: { input: 2, output: 1 },
          };
        }
        resumedHistoryLength = history.length;
        return {
          action: null,
          reasoning: "done after resume",
          done: true,
          usage: { input: 3, output: 1 },
        };
      },
    };

    const pausingDriver = testDriver({
      execute: async () => {
        const running = getDb().prepare("SELECT id FROM sessions WHERE status = 'running' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
        if (!running) throw new Error("missing running session");
        pauseSession(running.id, "operator paused after action");
        return { success: true, duration_ms: 0 };
      },
    });

    const paused = await runTask({
      task: "pause then resume",
      maxSteps: 3,
      dryRun: false,
      driver: pausingDriver,
      computerProvider: provider,
    });
    expect(paused.status).toBe("paused");
    expect(paused.steps).toBe(1);
    expect(getActionLogs(paused.id)).toHaveLength(1);

    const resumed = await resumeTask(paused.id, {
      maxSteps: 3,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(resumed.id).toBe(paused.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.steps).toBe(2);
    expect(resumedHistoryLength).toBe(1);
    expect(getWorkflowRun(paused.id)?.status).toBe("completed");
    expect(getWorkflowRun(paused.id)?.error).toBeUndefined();
  });

  test("runTask cancellation updates runtime state and releases the display lease", async () => {
    useTempDb();
    let cancelled = false;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        if (!cancelled) {
          const running = getDb().prepare("SELECT id FROM sessions WHERE status = 'running' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
          if (running) cancelSession(running.id, "operator cancelled");
          cancelled = true;
        }
        return {
          action: { type: "wait", ms: 1 },
          reasoning: "wait once",
          done: false,
        };
      },
    };

    const session = await runTask({
      task: "cancel after one step",
      maxSteps: 3,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(session.status).toBe("cancelled");
    expect(session.error).toBe("operator cancelled");
    expect(getWorkflowRun(session.id)?.status).toBe("cancelled");
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
  });

  test("runTask cancellation aborts an in-flight driver action and does not continue", async () => {
    useTempDb();
    let executeCalls = 0;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: { type: "wait", ms: 10_000 },
        reasoning: "long wait",
        done: false,
      }),
    };

    const driver = testDriver({
      execute: async (_action, context) => {
        executeCalls += 1;
        const running = getDb().prepare("SELECT id FROM sessions WHERE status = 'running' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
        if (!running) throw new Error("missing running session");
        cancelSession(running.id, "operator cancelled in-flight");
        await new Promise<void>((resolve) => {
          if (context?.signal?.aborted) return resolve();
          context?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { success: false, error: "operator cancelled in-flight", duration_ms: 1 };
      },
    });

    const session = await runTask({
      task: "cancel while executing",
      maxSteps: 3,
      dryRun: false,
      driver,
      computerProvider: provider,
    });

    expect(executeCalls).toBe(1);
    expect(session.status).toBe("cancelled");
    expect(session.error).toBe("operator cancelled in-flight");
    expect(getWorkflowRun(session.id)?.status).toBe("cancelled");
    expect(listRuntimeLeases({ status: "active" })).toEqual([]);
  });

  test("runTask cancellation during model analysis is not overwritten as completed", async () => {
    useTempDb();
    let cancelled = false;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        const running = getDb().prepare("SELECT id FROM sessions WHERE status = 'running' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
        if (running && !cancelled) {
          cancelSession(running.id, "operator cancelled during analysis");
          cancelled = true;
        }
        return {
          action: null,
          reasoning: "done after cancel",
          done: true,
        };
      },
    };

    const session = await runTask({
      task: "cancel during analysis",
      maxSteps: 1,
      dryRun: false,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(session.status).toBe("cancelled");
    expect(session.error).toBe("operator cancelled during analysis");
    expect(getWorkflowRun(session.id)?.status).toBe("cancelled");
  });

  test("runTask provider fallback preserves the same session and run state", async () => {
    useTempDb();
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const provider = new FallbackComputerProvider(
      {
        name: "openai",
        analyze: async () => {
          primaryCalls += 1;
          throw new Error("primary unavailable");
        },
      },
      [{
        name: "anthropic",
        analyze: async () => {
          fallbackCalls += 1;
          return {
            action: null,
            reasoning: "done after fallback",
            done: true,
            usage: { input: 2, output: 3 },
          };
        },
      }],
      { policy: { fallbackOn: ["error"] } },
    );

    const session = await runTask({
      task: "complete through fallback",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(session.status).toBe("completed");
    expect(session.id).toBe(getWorkflowRun(session.id)?.id);
    expect(getSession(session.id)?.status).toBe("completed");
    expect(listAuditEvents({ transport: "provider", capability: "provider.analyze", decision: "succeeded", limit: 1 })).toHaveLength(1);
    expect(listRunSteps(session.id)[0]).toEqual(expect.objectContaining({ status: "completed" }));
  });

  test("runTask verifier can request another step before accepting completion", async () => {
    useTempDb();
    let analyzeCalls = 0;
    let verifierCalls = 0;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        analyzeCalls += 1;
        return {
          action: null,
          reasoning: analyzeCalls === 1 ? "maybe done" : "completed successfully",
          done: true,
        };
      },
    };

    const session = await runTask({
      task: "complete after verifier",
      maxSteps: 3,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
      verifier: async () => {
        verifierCalls += 1;
        return verifierCalls === 1
          ? {
            status: "needs_more_steps",
            confidence: 0.5,
            reason: "Need one more observation.",
            evidence: ["first screenshot is inconclusive"],
            nextStep: "Observe again.",
          }
          : {
            status: "done",
            confidence: 0.94,
            reason: "Completion is now visible.",
            evidence: ["second model log says completed successfully"],
          };
      },
    });

    expect(session.status).toBe("completed");
    expect(analyzeCalls).toBe(2);
    expect(verifierCalls).toBe(2);
    expect(listRunSteps(session.id)).toHaveLength(2);
    expect(listRunSteps(session.id)[0].result).toEqual(expect.objectContaining({ verifier_status: "needs_more_steps" }));
    expect(listObservations(session.id).filter((observation) => observation.kind === "verifier_decision")).toHaveLength(2);
  });

  test("runTask fails closed when the display is already leased", async () => {
    useTempDb();
    const existing = createWorkflowRun({ status: "running" });
    acquireRuntimeLease({
      resourceType: "computer_display",
      resourceId: "local:main",
      runId: existing.id,
      holder: "other-controller",
    });
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: null,
        reasoning: "should not run",
        done: true,
      }),
    };

    const session = await runTask({
      task: "blocked by lease",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(session.status).toBe("failed");
    expect(session.error).toContain("Resource lease already active");
    expect(listRuntimeLeases({ status: "active" })).toHaveLength(1);
    expect(listRuntimeLeases({ status: "active" })[0].run_id).toBe(existing.id);
  });

  test("policy-backed direct actions cannot bypass an active display lease", async () => {
    useTempDb();
    const existing = createWorkflowRun({ status: "running" });
    acquireRuntimeLease({
      resourceType: "computer_display",
      resourceId: "local:main",
      runId: existing.id,
      holder: "other-controller",
    });
    let calls = 0;

    const result = await executeComputerAction(
      { type: "click", point: { x: 1, y: 1 } },
      {
        safety: { confirmClicks: false, maxActionsPerMinute: 60, allowPasswordTyping: true },
        audit: false,
        executor: async () => {
          calls += 1;
          return { success: true, duration_ms: 0 };
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Resource lease already active");
    expect(calls).toBe(0);
    expect(listRuntimeLeases({ status: "active" })).toHaveLength(1);
  });
});
