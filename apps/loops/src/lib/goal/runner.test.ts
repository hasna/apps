import { chmodSync, mkdtempSync } from "node:fs";
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
      "#!/usr/bin/env bash\nprintf 'goal=%s\\nobjective=%s\\nnode=%s\\nnodeObjective=%s\\n' \"$LOOPS_GOAL_ID\" \"$LOOPS_GOAL_OBJECTIVE\" \"$LOOPS_GOAL_NODE_KEY\" \"$LOOPS_GOAL_NODE_OBJECTIVE\"\n",
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
      expect(result.stdout).toContain("nodeObjective=inspect metadata");
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

  test("reports an actionable owner when an existing plan has no runnable nodes", async () => {
    const store = new Store(":memory:");
    try {
      const objective = "resume existing exhausted plan";
      const goal = store.createGoal({ objective, sourceType: "manual", sourceId: objective });
      store.createGoalPlanNodes(goal.goalId, [
        { key: "exhausted", objective: "continue work after using the node budget", tokenBudget: 1 },
      ]);
      store.updateGoalPlanNode(goal.goalId, "exhausted", { tokensUsed: 1 });

      const calls: string[] = [];
      const result = await runGoal(store, { objective, maxTurns: 3 }, {
        model: mockObjects([]),
        executeNode: async (node) => {
          calls.push(node.key);
          return ok("should not run");
        },
      });

      expect(calls).toEqual([]);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("all pending nodes are budget-exhausted");
      expect(result.error).toContain("owner=goal-plan-node");
      expect(store.getGoal(goal.goalId)?.status).toBe("blocked");

      const output = JSON.parse(result.stdout) as {
        diagnostics?: { owner?: string; blocker?: string; pendingNodes?: Array<{ key: string; budgetExhausted: boolean }> };
      };
      expect(output.diagnostics?.owner).toBe("goal-plan-node");
      expect(output.diagnostics?.blocker).toContain("budget-exhausted");
      expect(output.diagnostics?.pendingNodes).toEqual([
        expect.objectContaining({ key: "exhausted", budgetExhausted: true }),
      ]);

      const statusEvents = store.listGoalRuns({ goalId: goal.goalId }).filter((entry) => entry.phase === "status");
      expect(statusEvents).toHaveLength(3);
      expect(statusEvents.at(-1)?.evidence).toEqual(expect.objectContaining({
        owner: "goal-plan-node",
        blocker: expect.stringContaining("budget-exhausted"),
      }));
    } finally {
      store.close();
    }
  });

  test("keeps no-ready diagnostics when max turns is lower than the blocker threshold", async () => {
    const store = new Store(":memory:");
    try {
      const objective = "single turn exhausted plan";
      const goal = store.createGoal({ objective, sourceType: "manual", sourceId: objective });
      store.createGoalPlanNodes(goal.goalId, [
        { key: "one", objective: "cannot run again", tokenBudget: 1 },
      ]);
      store.updateGoalPlanNode(goal.goalId, "one", { tokensUsed: 1 });

      const result = await runGoal(store, { objective, maxTurns: 1 }, {
        model: mockObjects([]),
        executeNode: async () => ok("should not run"),
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("all pending nodes are budget-exhausted");
      expect(result.error).toContain("owner=goal-plan-node");
      expect(store.getGoal(goal.goalId)?.status).toBe("usageLimited");
      const output = JSON.parse(result.stdout) as { diagnostics?: { owner?: string; blocker?: string } };
      expect(output.diagnostics?.owner).toBe("goal-plan-node");
      expect(output.diagnostics?.blocker).toContain("budget-exhausted");
    } finally {
      store.close();
    }
  });

  test("autoExecute off plans and persists without executing nodes", async () => {
    const store = new Store(":memory:");
    try {
      const model = mockObjects([{ nodes: [plannedNode({ key: "only", objective: "planned but not executed" })] }]);
      const calls: string[] = [];
      const result = await runGoal(store, { objective: "plan only", autoExecute: "off", maxTurns: 3 }, {
        model,
        executeNode: async (node) => {
          calls.push(node.key);
          return ok();
        },
      });

      expect(result.status).toBe("succeeded");
      expect(calls).toEqual([]);
      expect(model.doGenerateCalls).toHaveLength(1);
      const goal = store.getGoal(result.goalId!)!;
      expect(goal.status).toBe("active");
      expect(store.listGoalPlanNodes(goal.goalId).map((node) => node.status)).toEqual(["pending"]);
      const output = JSON.parse(result.stdout) as { diagnostics?: { autoExecute?: string } };
      expect(output.diagnostics?.autoExecute).toBe("off");
    } finally {
      store.close();
    }
  });

  test("runs the achievement audit on an independent verifier model", async () => {
    const store = new Store(":memory:");
    try {
      const planner = mockObjects([{ nodes: [plannedNode({ key: "a", objective: "do a" })] }]);
      const verifier = mockObjects([
        {
          achieved: true,
          status: "complete",
          evidence: ["a ran"],
          unmetRequirements: [],
          adversarialReview: "Audited on a model independent from the planner.",
        },
      ]);
      const result = await runGoal(store, { objective: "verify independently", maxTurns: 3 }, {
        model: planner,
        verifierModel: verifier,
        executeNode: async () => ok("ran a"),
      });

      expect(result.status).toBe("succeeded");
      expect(planner.doGenerateCalls).toHaveLength(1);
      expect(verifier.doGenerateCalls).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("bounds node output evidence in the goal envelope", async () => {
    const store = new Store(":memory:");
    try {
      const big = "s".repeat(30_000);
      const model = mockObjects([
        { nodes: [plannedNode({ key: "noisy", objective: "produce a lot of output" })] },
        {
          achieved: true,
          status: "complete",
          evidence: ["noisy ran"],
          unmetRequirements: [],
          adversarialReview: "Verified against bounded excerpts.",
        },
      ]);
      const result = await runGoal(store, { objective: "bound evidence", maxTurns: 3 }, {
        model,
        executeNode: async () => ok(big),
      });

      expect(result.status).toBe("succeeded");
      expect(result.stdout.length).toBeLessThan(20_000);
      const output = JSON.parse(result.stdout) as { evidence: string[] };
      expect(output.evidence[0]).toContain("stdout 30000B");
      expect(output.evidence[0]).toContain("chars omitted");
      const executeEvents = store.listGoalRuns({ goalId: result.goalId! }).filter((entry) => entry.phase === "execute");
      expect((executeEvents[0]?.evidence as { stdout?: string }).stdout).toHaveLength(30_000);
    } finally {
      store.close();
    }
  });

  test("scrubs assignment secrets from the goal stdout envelope before persistence", async () => {
    const store = new Store(":memory:");
    try {
      const nodeSecret = "hunter2SEcretValu3XkQ92mzP";
      const validationSecret = "z8Wq4RtY71LmXe2KNope9SdfB3";
      // A JSON agent's stdout carries the assignment once-escaped; copying it
      // into evidence and stringifying the envelope escapes it again, which
      // the store's flat scrub at persist time can no longer match.
      const agentStdout = JSON.stringify({ result: `export api_key="${nodeSecret}"` });
      const model = mockObjects([
        { nodes: [plannedNode({ key: "leaky", objective: "handle credentials" })] },
        {
          achieved: true,
          status: "complete",
          evidence: [`saw token="${validationSecret}" while verifying`],
          unmetRequirements: [],
          adversarialReview: "Verified with credential-bearing evidence.",
        },
      ]);
      const result = await runGoal(store, { objective: "scrub envelope", maxTurns: 3 }, {
        model,
        executeNode: async () => ok(agentStdout),
      });

      expect(result.status).toBe("succeeded");
      expect(result.stdout).not.toContain(nodeSecret);
      expect(result.stdout).not.toContain(validationSecret);
      expect(result.stdout).toContain("[SCRUBBED]");
    } finally {
      store.close();
    }
  });
});
