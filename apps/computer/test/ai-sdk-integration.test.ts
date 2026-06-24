import { afterEach, describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDb,
  getDb,
  getModelUsageSummary,
  getSession,
  listAuditEvents,
  listModelUsage,
} from "../src/db/index.js";
import { planGoalDryRun } from "../src/agent/goal-planner.js";
import { runTask } from "../src/agent/loop.js";
import { cancelSession } from "../src/agent/control.js";
import {
  listApprovals,
  listPolicyDecisions,
  listRunSteps,
} from "../src/agent/runtime.js";
import { FallbackComputerProvider } from "../src/providers/index.js";
import type {
  ComputerDriver,
  ComputerProvider,
  DriverAction,
  GoalVerifier,
  Screenshot,
} from "../src/types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-ai-sdk-integration-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
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

function mockObjectModel(output: unknown, inputTokens = 10, outputTokens = 5): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(output) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: inputTokens,
          noCache: inputTokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: outputTokens,
          text: outputTokens,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  });
}

describe("offline AI SDK integration", () => {
  test("mock AI SDK planner decomposes a goal, routes capabilities, records audits, and tracks usage", async () => {
    useTempDb();

    const plan = await planGoalDryRun({
      prompt: "Use browser, fleet, terminal, and storage without executing anything",
      maxSteps: 5,
      workspaceRoots: [process.cwd()],
      modelName: "mock-planner",
      model: mockObjectModel({
        title: "Offline integration plan",
        summary: "Exercise planner tool routing without provider calls.",
        stopConditions: ["All routes are persisted."],
        steps: [
          {
            title: "Record memory",
            intent: "Keep the goal in local state.",
            toolName: "memory",
            input: {
              scope: "goal",
              title: "Offline integration plan",
              body: "Use browser, fleet, terminal, and storage without executing anything",
            },
            stopCondition: "Memory row exists.",
          },
          {
            title: "Navigate browser",
            intent: "Plan a visible browser navigation.",
            toolName: "browser",
            input: { action: "navigate", url: "https://example.com" },
            stopCondition: "Navigation is approval-gated.",
          },
          {
            title: "Run fleet smoke",
            intent: "Plan a remote machine smoke check.",
            toolName: "fleet",
            input: { machineId: "machine-test-01", action: "run_smoke", workspacePath: process.cwd() },
            stopCondition: "Fleet mutation is approval-gated.",
          },
          {
            title: "Prepare terminal",
            intent: "Plan a workspace terminal command.",
            toolName: "terminal",
            input: { app: "ghostty", dir: process.cwd(), commands: ["pwd"] },
            stopCondition: "Terminal command is approval-gated.",
          },
          {
            title: "Check storage",
            intent: "Read storage status.",
            toolName: "storage",
            input: { action: "status" },
            stopCondition: "Storage status route is allowed.",
          },
        ],
      }, 31, 14),
    });

    expect(getSession(plan.run.id)).toBeNull();
    expect(plan.steps.map((step) => [step.step.toolName, step.route.status])).toEqual([
      ["memory", "allowed"],
      ["browser", "requires_confirmation"],
      ["fleet", "requires_confirmation"],
      ["terminal", "requires_confirmation"],
      ["storage", "allowed"],
    ]);
    expect(listRunSteps(plan.run.id)).toHaveLength(5);
    expect(listApprovals(plan.run.id).map((approval) => approval.capability).sort()).toEqual([
      "browser.navigate",
      "fleet.run_smoke",
      "terminal.exec",
    ]);
    expect(listPolicyDecisions(plan.run.id).map((decision) => decision.capability)).toContain("storage.status");
    expect(listAuditEvents({ transport: "planner", capability: "planner.goal", decision: "planned", limit: 1 })).toHaveLength(1);
    expect(listAuditEvents({ transport: "planner", capability: "browser.navigate", decision: "requires_confirmation", limit: 1 })).toHaveLength(1);
    expect(listModelUsage({ runId: plan.run.id, phase: "planner" })[0]).toEqual(expect.objectContaining({
      model: "mock-planner",
      input_tokens: 31,
      output_tokens: 14,
    }));
  });

  test("provider fallback and verifier loop complete offline with audit and usage records", async () => {
    useTempDb();
    const primary: ComputerProvider = {
      name: "openai",
      analyze: async () => {
        throw new Error("offline primary failure");
      },
    };
    let fallbackCalls = 0;
    const fallback: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        fallbackCalls += 1;
        return {
          action: null,
          reasoning: fallbackCalls === 1 ? "premature completion" : "completed after verifier asked for more evidence",
          done: true,
          usage: fallbackCalls === 1 ? { input: 7, output: 3 } : { input: 11, output: 5 },
        };
      },
    };
    let verifierCalls = 0;
    const verifier: GoalVerifier = () => {
      verifierCalls += 1;
      return verifierCalls === 1
        ? {
          status: "needs_more_steps",
          confidence: 0.45,
          reason: "Need one more observation.",
          evidence: ["first screenshot"],
          nextStep: "Continue once more.",
        }
        : {
          status: "done",
          confidence: 0.92,
          reason: "Completion evidence is now sufficient.",
          evidence: ["second screenshot"],
        };
    };

    const session = await runTask({
      task: "complete through fallback and verifier",
      maxSteps: 3,
      dryRun: true,
      driver: testDriver(),
      computerProvider: new FallbackComputerProvider(primary, [fallback], {
        policy: { fallbackOn: ["error"] },
        metadata: { test: "ai-sdk-integration" },
      }),
      verifier,
    });

    expect(session.status).toBe("completed");
    expect(session.steps).toBe(2);
    expect(fallbackCalls).toBe(2);
    expect(verifierCalls).toBe(2);
    expect(listPolicyDecisions(session.id).map((decision) => decision.decision)).toContain("verifier_requested_more_steps");
    expect(listPolicyDecisions(session.id).map((decision) => decision.capability)).toContain("computer.complete");
    expect(listAuditEvents({ transport: "provider", capability: "provider.analyze", decision: "fallback", limit: 10 })).toHaveLength(2);
    expect(listAuditEvents({ transport: "agent", capability: "verifier.goal", decision: "needs_more_steps", limit: 10 })).toHaveLength(1);
    expect(getModelUsageSummary({ sessionId: session.id }).by_phase.executor.total_tokens).toBe(26);
  });

  test("session cancellation is honored in an offline mocked run", async () => {
    useTempDb();
    let cancelled = false;
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => {
        const running = getSessionByStatus("running");
        if (running && !cancelled) {
          cancelSession(running.id, "offline cancellation test");
          cancelled = true;
        }
        return {
          action: { type: "wait", ms: 1 },
          reasoning: "should not execute after cancellation",
          done: false,
          usage: { input: 5, output: 2 },
        };
      },
    };
    let executeCalls = 0;

    const session = await runTask({
      task: "cancel offline run",
      maxSteps: 2,
      dryRun: false,
      driver: testDriver({
        execute: async () => {
          executeCalls += 1;
          return { success: true, duration_ms: 0 };
        },
      }),
      computerProvider: provider,
    });

    expect(session.status).toBe("cancelled");
    expect(session.error).toBe("offline cancellation test");
    expect(executeCalls).toBe(0);
    expect(listModelUsage({ sessionId: session.id, phase: "executor" })).toHaveLength(0);
  });
});

function getSessionByStatus(status: string): { id: string } | undefined {
  return getDb()
    .prepare("SELECT id FROM sessions WHERE status = ? ORDER BY created_at DESC LIMIT 1")
    .get(status) as { id: string } | undefined;
}
