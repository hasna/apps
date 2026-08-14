import type {
  GoalPlan,
  GoalPlanNode,
  GoalPlanNodeStatus,
  GoalRollup,
  GoalStatus,
} from "./types.js";
import { GOAL_TERMINAL } from "./types.js";

const NODE_STATUSES: GoalPlanNodeStatus[] = [
  "pending",
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
  "cancelled",
];

export function isTerminal(status: GoalStatus): boolean {
  return GOAL_TERMINAL.includes(status as (typeof GOAL_TERMINAL)[number]);
}

export function nodeBudgetExhausted(node: GoalPlanNode): boolean {
  return node.tokenBudget !== undefined && node.tokensUsed >= node.tokenBudget;
}

export function readyNodeKeys(plan: Pick<GoalPlan, "status" | "nodes">): string[] {
  if (plan.status !== "active") return [];
  const byKey = new Map(plan.nodes.map((node) => [node.key, node]));
  return plan.nodes
    .filter((node) => {
      if (node.status !== "pending") return false;
      if (nodeBudgetExhausted(node)) return false;
      return node.dependsOn.every((dependency) => byKey.get(dependency)?.status === "complete");
    })
    .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence || a.key.localeCompare(b.key))
    .map((node) => node.key);
}

export function rollupSummary(nodes: Pick<GoalPlanNode, "status">[]): GoalRollup {
  const rollup: GoalRollup = {
    total: nodes.length,
    pending: 0,
    active: 0,
    paused: 0,
    blocked: 0,
    usageLimited: 0,
    budgetLimited: 0,
    complete: 0,
    cancelled: 0,
  };
  for (const node of nodes) {
    if (node.status in rollup) {
      rollup[node.status as Exclude<GoalPlanNodeStatus, never>] += 1;
    }
  }
  return rollup;
}

export function assertGoalTransition(from: GoalStatus, to: GoalStatus): void {
  if (isTerminal(from) && from !== to) {
    throw new Error(`cannot transition terminal goal status ${from} to ${to}`);
  }
}

export function assertAcyclicNodes(nodes: Pick<GoalPlanNode, "key" | "dependsOn">[]): void {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`goal dependency cycle includes node ${key}`);
    const node = byKey.get(key);
    if (!node) throw new Error(`goal plan references missing node ${key}`);
    visiting.add(key);
    for (const dependency of node.dependsOn) {
      if (!byKey.has(dependency)) throw new Error(`goal node ${key} depends on missing node ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  }

  for (const node of nodes) visit(node.key);
}

export function updateReadyFlags(nodes: GoalPlanNode[], planStatus: GoalPlan["status"]): GoalPlanNode[] {
  const ready = new Set(readyNodeKeys({ status: planStatus, nodes }));
  return nodes.map((node) => ({ ...node, ready: ready.has(node.key) }));
}

export function normalizeNodeStatus(status: string): GoalPlanNodeStatus {
  if (!NODE_STATUSES.includes(status as GoalPlanNodeStatus)) throw new Error(`invalid goal node status: ${status}`);
  return status as GoalPlanNodeStatus;
}
