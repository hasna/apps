import { describe, expect, test } from "bun:test";
import type { GoalPlan, GoalPlanNode, GoalPlanNodeStatus, GoalStatus } from "./types.js";
import { assertGoalTransition, isTerminal, readyNodeKeys, rollupSummary } from "./status.js";

function node(key: string, status: GoalPlanNodeStatus = "pending", dependsOn: string[] = []): GoalPlanNode {
  return {
    nodeId: `node-${key}`,
    planId: "plan-1",
    key,
    sequence: key.charCodeAt(0),
    priority: 0,
    objective: `do ${key}`,
    status,
    ready: false,
    dependsOn,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function plan(nodes: GoalPlanNode[], patch: Partial<GoalPlan> = {}): GoalPlan {
  return {
    planId: "plan-1",
    goalId: "goal-1",
    status: "active",
    autoExecute: "readyOnly",
    rollup: rollupSummary(nodes),
    nodes,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("goal status helpers", () => {
  test("recognizes terminal goal statuses", () => {
    const terminal: GoalStatus[] = ["budgetLimited", "complete", "cancelled"];
    for (const status of terminal) expect(isTerminal(status)).toBe(true);
    for (const status of ["active", "paused", "blocked", "usageLimited"] as GoalStatus[]) {
      expect(isTerminal(status)).toBe(false);
    }
  });

  test("computes ready nodes from a flat DAG and budget state", () => {
    const nodes = [node("a"), node("b", "pending", ["a"]), { ...node("c"), tokenBudget: 10, tokensUsed: 10 }];
    expect(readyNodeKeys(plan(nodes))).toEqual(["a"]);

    const afterA = [{ ...nodes[0]!, status: "complete" as const }, nodes[1]!, nodes[2]!];
    expect(readyNodeKeys(plan(afterA))).toEqual(["b"]);
    expect(readyNodeKeys(plan(afterA, { status: "paused" }))).toEqual([]);
  });

  test("rolls up node counts", () => {
    expect(rollupSummary([node("a", "complete"), node("b", "pending"), node("c", "blocked")])).toEqual({
      total: 3,
      pending: 1,
      active: 0,
      paused: 0,
      blocked: 1,
      usageLimited: 0,
      budgetLimited: 0,
      complete: 1,
      cancelled: 0,
    });
  });

  test("rejects transitions away from terminal statuses", () => {
    expect(() => assertGoalTransition("complete", "active")).toThrow("terminal");
    expect(() => assertGoalTransition("budgetLimited", "cancelled")).toThrow("terminal");
    expect(() => assertGoalTransition("active", "complete")).not.toThrow();
  });
});
