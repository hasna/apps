import type { ExecutableTarget } from "../../types.js";
import type { Goal, GoalPlanNode, GoalSpec } from "./types.js";

export function planPrompt(spec: GoalSpec): string {
  const budget = spec.tokenBudget ? `Token budget: ${spec.tokenBudget}.` : "No explicit token budget.";
  return [
    "Create a flat DAG goal plan for this objective.",
    "Each node must have a stable short key, a concrete objective, dependsOn keys, priority, and tokenBudget.",
    "Use dependsOn: [] when there are no dependencies, priority: 0 when no priority is needed, and tokenBudget: null when no per-node budget is needed.",
    "Prefer the smallest plan that can prove the explicit requirements.",
    budget,
    `Objective: ${spec.objective}`,
  ].join("\n");
}

export function iterationPrompt(goal: Pick<Goal, "objective">, node: Pick<GoalPlanNode, "key" | "objective">): string {
  return [
    "Continue executing the goal plan without losing budget discipline.",
    `Goal: ${goal.objective}`,
    `Plan node: ${node.key}`,
    `Node objective: ${node.objective}`,
    "Work only on this node's objective in this run; other plan nodes run in their own iterations.",
  ].join("\n");
}

export function goalNodeTarget(
  target: ExecutableTarget,
  goal: Pick<Goal, "objective">,
  node: Pick<GoalPlanNode, "key" | "objective">,
): ExecutableTarget {
  if (target.type !== "agent") return target;
  return { ...target, prompt: `${target.prompt}\n\n${iterationPrompt(goal, node)}` };
}

export function achievementPrompt(goal: Goal, nodes: GoalPlanNode[], evidence: string[]): string {
  return [
    "Run an adversarial achievement audit.",
    "Completion is unproven until every explicit requirement is verified against evidence.",
    "Return achieved=false if evidence is missing, ambiguous, or only asserts completion.",
    "Return achieved=true when the evidence proves every explicit requirement; do not return achieved=false with an empty unmetRequirements array.",
    "Return status as complete, active, blocked, budgetLimited, cancelled, or null when no status change is appropriate.",
    "Return evidence and unmetRequirements as arrays, using [] when empty.",
    "adversarialReview must be non-empty and must describe the attempted falsification.",
    `Goal: ${goal.objective}`,
    `Nodes: ${nodes.map((node) => `${node.key}=${node.status}`).join(", ")}`,
    `Evidence:\n${evidence.join("\n---\n") || "(none)"}`,
  ].join("\n");
}
