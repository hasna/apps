import { afterEach, describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDb,
  getModelUsageSummary,
  getStats,
  listModelUsage,
  recordModelUsage,
} from "../src/db/index.js";
import { createWorkflowRun } from "../src/agent/runtime.js";
import { planGoalDryRun } from "../src/agent/goal-planner.js";
import { verifyGoalState } from "../src/agent/verifier.js";
import { runTask } from "../src/agent/loop.js";
import type { ComputerDriver, ComputerProvider, DriverAction, Screenshot } from "../src/types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-model-usage-"));
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

describe("model usage ledger", () => {
  const screenshot: Screenshot = {
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    size: { width: 1, height: 1 },
    timestamp: Date.now(),
  };

  function testDriver(): ComputerDriver {
    return {
      getScreenSize: async () => screenshot.size,
      screenshot: async () => screenshot,
      execute: async (_action: DriverAction) => ({ success: true, duration_ms: 0 }),
      dispose: async () => {},
    };
  }

  test("records and summarizes model usage by phase", () => {
    useTempDb();
    const run = createWorkflowRun({ status: "running" });
    recordModelUsage({
      runId: run.id,
      phase: "planner",
      provider: "ai-sdk",
      model: "test-model",
      inputTokens: 100,
      outputTokens: 50,
    });
    recordModelUsage({
      runId: run.id,
      phase: "verifier",
      provider: "ai-sdk",
      model: "test-model",
      inputTokens: 20,
      outputTokens: 10,
    });

    const summary = getModelUsageSummary({ runId: run.id });
    expect(summary.total_tokens).toBe(180);
    expect(summary.by_phase.planner.total_tokens).toBe(150);
    expect(summary.by_phase.verifier.total_tokens).toBe(30);
    expect(summary.total_cost_usd).toBeGreaterThan(0);
  });

  test("includes model usage in global stats", () => {
    useTempDb();
    const run = createWorkflowRun({ status: "running" });
    recordModelUsage({
      runId: run.id,
      phase: "planner",
      provider: "ai-sdk",
      model: "gpt-4.1",
      inputTokens: 30,
      outputTokens: 20,
    });

    const stats = getStats();
    expect(stats.model_usage.total_tokens).toBe(50);
    expect(stats.model_usage.by_phase.planner).toEqual(expect.objectContaining({
      input_tokens: 30,
      output_tokens: 20,
      total_tokens: 50,
    }));
    expect(stats.model_usage.total_cost_usd).toBeGreaterThan(0);
  });

  test("records executor usage from provider-native runTask calls", async () => {
    useTempDb();
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: null,
        reasoning: "done",
        done: true,
        usage: { input: 7, output: 3 },
      }),
    };
    const session = await runTask({
      task: "usage run",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    expect(listModelUsage({ sessionId: session.id, phase: "executor" })[0]).toEqual(expect.objectContaining({
      input_tokens: 7,
      output_tokens: 3,
      provider: "anthropic",
    }));
  });

  test("records AI SDK planner and verifier usage from mock models", async () => {
    useTempDb();
    const plan = await planGoalDryRun({
      prompt: "Create a one-step plan",
      maxSteps: 1,
      modelName: "mock-planner",
      model: mockObjectModel({
        title: "One step",
        summary: "Plan summary",
        stopConditions: ["Memory recorded"],
        steps: [{
          title: "Record memory",
          intent: "Persist context",
          stopCondition: "Memory exists",
          toolName: "memory",
          input: {
            scope: "goal",
            title: "One step",
            body: "Create a one-step plan",
          },
        }],
      }, 11, 6),
    });

    await verifyGoalState({
      task: "Verify",
      runId: plan.run.id,
      modelName: "mock-verifier",
      model: mockObjectModel({
        status: "done",
        confidence: 0.9,
        reason: "Evidence is enough.",
        evidence: ["planner output"],
      }, 13, 4),
      evidence: [{ kind: "note", summary: "done" }],
    });

    expect(listModelUsage({ runId: plan.run.id, phase: "planner" })[0]).toEqual(expect.objectContaining({
      model: "mock-planner",
      input_tokens: 11,
      output_tokens: 6,
    }));
    expect(listModelUsage({ runId: plan.run.id, phase: "verifier" })[0]).toEqual(expect.objectContaining({
      model: "mock-verifier",
      input_tokens: 13,
      output_tokens: 4,
    }));
  });
});
