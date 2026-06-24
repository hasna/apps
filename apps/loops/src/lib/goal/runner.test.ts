import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import type { ExecutorResult } from "../../types.js";
import { Store } from "../store.js";
import { runGoal } from "./runner.js";

type JsonSchemaObject = {
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
};

function generated(object: unknown, totalTokens = 10) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(object) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: totalTokens, noCache: totalTokens, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: totalTokens, text: totalTokens, reasoning: undefined },
    },
    warnings: [],
  };
}

function mockObjects(objects: unknown[], totalTokens = 10) {
  let index = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => generated(objects[Math.min(index++, objects.length - 1)], totalTokens),
  });
}

function ok(stdout = ""): ExecutorResult {
  return {
    status: "succeeded",
    exitCode: 0,
    stdout,
    stderr: "",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
  };
}

function failed({
  stdout = "",
  stderr = "",
  error = "process exited with code 1",
}: {
  stdout?: string;
  stderr?: string;
  error?: string;
}): ExecutorResult {
  return {
    status: "failed",
    exitCode: 1,
    stdout,
    stderr,
    error,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
  };
}

function plannedNode({
  key,
  objective,
  dependsOn = [],
  priority = 0,
  tokenBudget = null,
}: {
  key: string;
  objective: string;
  dependsOn?: string[];
  priority?: number;
  tokenBudget?: number | null;
}) {
  return { key, objective, dependsOn, priority, tokenBudget };
}

function expectAllPropertiesRequired(schema: JsonSchemaObject, path = "schema") {
  if (schema.properties) {
    const propertyKeys = Object.keys(schema.properties).sort();
    expect(schema.required?.toSorted()).toEqual(propertyKeys);
    for (const [key, property] of Object.entries(schema.properties)) {
      expectAllPropertiesRequired(property, `${path}.${key}`);
    }
  }
  if (schema.items) expectAllPropertiesRequired(schema.items, `${path}[]`);
}

function responseJsonSchema(call: (typeof MockLanguageModelV3.prototype.doGenerateCalls)[number] | undefined) {
  const responseFormat = call?.responseFormat;
  expect(responseFormat?.type).toBe("json");
  return (responseFormat as { type: "json"; schema?: JsonSchemaObject }).schema;
}

describe("runGoal", () => {
  test("plans, executes dependent nodes, validates adversarially, and persists rows under a daemon fence", async () => {
    const store = new Store(":memory:");
    try {
      expect(store.acquireDaemonLease({ id: "daemon", pid: 1, hostname: "host", ttlMs: 60_000 })?.id).toBe("daemon");
      const model = mockObjects([
        {
          nodes: [
            plannedNode({ key: "a", objective: "write A" }),
            plannedNode({ key: "b", objective: "write B", dependsOn: ["a"] }),
          ],
        },
        {
          achieved: true,
          status: "complete",
          evidence: ["A executed", "B executed"],
          unmetRequirements: [],
          adversarialReview: "Verified that both dependent nodes executed in order against persisted evidence.",
        },
      ]);
      const calls: string[] = [];
      const result = await runGoal(store, { objective: "finish two nodes", maxTurns: 5 }, {
        daemonLeaseId: "daemon",
        model,
        executeNode: async (node) => {
          calls.push(node.key);
          return ok(`ran ${node.key}`);
        },
      });

      expect(result.status).toBe("succeeded");
      expect(calls).toEqual(["a", "b"]);
      const goal = store.getGoal(result.goalId!);
      expect(goal?.status).toBe("complete");
      expect(store.listGoalPlanNodes(goal!.goalId).map((entry) => entry.status)).toEqual(["complete", "complete"]);
      expect(store.listGoalRuns({ goalId: goal!.goalId }).map((entry) => entry.phase)).toContain("validate");
    } finally {
      store.close();
    }
  });

  test("stops before executing nodes when the token budget is exhausted", async () => {
    const store = new Store(":memory:");
    try {
      const model = mockObjects([{ nodes: [plannedNode({ key: "only", objective: "do expensive work" })] }], 20);
      const calls: string[] = [];
      const result = await runGoal(store, { objective: "respect tiny budget", tokenBudget: 5, maxTurns: 3 }, {
        model,
        executeNode: async (node) => {
          calls.push(node.key);
          return ok();
        },
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("budget");
      expect(calls).toEqual([]);
      expect(store.getGoal(result.goalId!)?.status).toBe("budgetLimited");
    } finally {
      store.close();
    }
  });

  test("surfaces failed node stderr in goal output and result stderr", async () => {
    const store = new Store(":memory:");
    try {
      const model = mockObjects([{ nodes: [plannedNode({ key: "init", objective: "initialize provider" })] }]);
      const result = await runGoal(store, { objective: "show failed node reason", maxTurns: 3 }, {
        model,
        executeNode: async () => failed({
          stdout: "{\"type\":\"thread.started\"}",
          stderr: "Codewith usage limit reached for profile account009",
        }),
      });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("node init failed: process exited with code 1");
      expect(result.stderr).toContain("node init failed");
      expect(result.stderr).toContain("Codewith usage limit reached");
      expect(result.stdout).toContain("Codewith usage limit reached");
      const payload = JSON.parse(result.stdout) as { evidence: string[] };
      expect(payload.evidence.some((entry) => entry.includes("stderr:") && entry.includes("account009"))).toBe(true);
      expect(store.getGoal(result.goalId!)?.status).toBe("blocked");
    } finally {
      store.close();
    }
  });

  test("returns timed_out when an outer loop timeout aborts goal execution", async () => {
    const store = new Store(":memory:");
    const controller = new AbortController();
    try {
      const model = mockObjects([{ nodes: [plannedNode({ key: "slow", objective: "do slow work" })] }]);
      const result = await runGoal(store, { objective: "respect loop timeout", maxTurns: 3 }, {
        model,
        signal: controller.signal,
        signalTimeoutMessage: () => "loop target timed out after 100ms",
        executeNode: async () => {
          controller.abort();
          return ok("late result");
        },
      });

      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("loop target timed out");
      expect(store.getGoal(result.goalId!)?.status).toBe("usageLimited");
    } finally {
      store.close();
    }
  });

  test("aborts a real goal-wrapped command target on timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-goal-timeout-"));
    const marker = join(root, "late-write");
    const store = new Store(":memory:");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30);
    try {
      const model = mockObjects([{ nodes: [plannedNode({ key: "slow", objective: "do slow work" })] }]);
      const result = await runGoal(store, { objective: "respect command timeout", maxTurns: 3 }, {
        model,
        signal: controller.signal,
        signalTimeoutMessage: () => "loop target timed out after 30ms",
        target: {
          type: "command",
          command: `sleep 1; printf late > ${JSON.stringify(marker)}`,
          shell: true,
          timeoutMs: 5_000,
        },
      });

      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("loop target timed out");
      expect(store.getGoal(result.goalId!)?.status).toBe("usageLimited");
      expect(store.listGoalPlanNodes(result.goalId!).map((node) => node.status)).toEqual(["pending"]);
      await Bun.sleep(1_100);
      expect(existsSync(marker)).toBe(false);
    } finally {
      clearTimeout(timer);
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("marks blocked only after the same adversarial blocker repeats three times", async () => {
    const store = new Store(":memory:");
    try {
      const blocker = {
        achieved: false,
        status: "blocked",
        evidence: ["command ran"],
        unmetRequirements: ["missing required proof"],
        adversarialReview: "The evidence does not prove the explicit requirement.",
      };
      const model = mockObjects([{ nodes: [plannedNode({ key: "prove", objective: "produce proof" })] }, blocker, blocker, blocker]);
      const result = await runGoal(store, { objective: "prove completion", maxTurns: 5 }, {
        model,
        executeNode: async () => ok("ran proof step"),
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("missing required proof");
      expect(store.getGoal(result.goalId!)?.status).toBe("blocked");
      const validateEvents = store.listGoalRuns({ goalId: result.goalId! }).filter((entry) => entry.phase === "validate");
      expect(validateEvents).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  test("passes goal metadata to wrapped goal-less command targets", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-goal-env-"));
    const fake = join(binDir, "goal-env");
    await Bun.write(
      fake,
      "#!/usr/bin/env bash\nprintf 'goal=%s\\nobjective=%s\\nnode=%s\\n' \"$LOOPS_GOAL_ID\" \"$LOOPS_GOAL_OBJECTIVE\" \"$LOOPS_GOAL_NODE_KEY\"\n",
    );
    chmodSync(fake, 0o755);
    const store = new Store(":memory:");
    try {
      const model = mockObjects([
        { nodes: [plannedNode({ key: "env", objective: "inspect metadata" })] },
        {
          achieved: true,
          status: "complete",
          evidence: ["metadata printed"],
          unmetRequirements: [],
          adversarialReview: "The command output includes the goal id, objective, and node key.",
        },
      ]);
      const result = await runGoal(store, { objective: "inspect env", maxTurns: 3 }, {
        model,
        target: { type: "command", command: "goal-env" },
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });

      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("node=env");
      expect(result.stdout).toContain("objective=inspect env");
      expect(result.stdout).toContain("goal=");
    } finally {
      store.close();
    }
  });

  test("uses strict provider JSON schemas with every property required", async () => {
    const store = new Store(":memory:");
    try {
      const model = mockObjects([
        { nodes: [plannedNode({ key: "strict", objective: "check schema" })] },
        {
          achieved: true,
          status: "complete",
          evidence: ["strict schema accepted"],
          unmetRequirements: [],
          adversarialReview: "The provider-facing schemas require every declared property.",
        },
      ]);

      await runGoal(store, { objective: "inspect strict schema", maxTurns: 2 }, {
        model,
        executeNode: async () => ok("strict"),
      });

      const planSchema = responseJsonSchema(model.doGenerateCalls[0]);
      const achievementSchema = responseJsonSchema(model.doGenerateCalls[1]);

      expect(planSchema).toBeDefined();
      expect(achievementSchema).toBeDefined();
      expectAllPropertiesRequired(planSchema!);
      expectAllPropertiesRequired(achievementSchema!);
    } finally {
      store.close();
    }
  });
});
