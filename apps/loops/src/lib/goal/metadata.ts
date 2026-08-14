import type { Loop, LoopRun, WorkflowSpec } from "../../types.js";
import type { Goal, GoalExecutionContext, GoalPlanNode } from "./types.js";

export interface GoalContextParts {
  loop?: Pick<Loop, "id" | "name">;
  loopRun?: Pick<LoopRun, "id" | "scheduledFor">;
  scheduledFor?: string;
  workflow?: Pick<WorkflowSpec, "id" | "name">;
  workflowRunId?: string;
  workflowStepId?: string;
}

/** Single source for the goal execution context previously copy-pasted across runners. */
export function goalExecutionContext(parts: GoalContextParts): GoalExecutionContext {
  return {
    loopId: parts.loop?.id,
    loopName: parts.loop?.name,
    loopRunId: parts.loopRun?.id,
    scheduledFor: parts.loopRun?.scheduledFor ?? parts.scheduledFor,
    workflowId: parts.workflow?.id,
    workflowName: parts.workflow?.name,
    workflowRunId: parts.workflowRunId,
    workflowStepId: parts.workflowStepId,
  };
}

/** Executor metadata (LOOPS_* env) derived from a goal execution context; loopRunId maps to runId. */
export function executionMetadata(
  context: GoalExecutionContext | undefined,
  goal?: Pick<Goal, "goalId" | "objective">,
  node?: Pick<GoalPlanNode, "key">,
): Record<string, string | undefined> {
  return {
    loopId: context?.loopId,
    loopName: context?.loopName,
    runId: context?.loopRunId,
    scheduledFor: context?.scheduledFor,
    workflowId: context?.workflowId,
    workflowName: context?.workflowName,
    workflowRunId: context?.workflowRunId,
    workflowStepId: context?.workflowStepId,
    goalId: goal?.goalId,
    goalObjective: goal?.objective,
    goalNodeKey: node?.key,
  };
}

/** Exposes the executing plan node to child processes so command targets can honor node objectives. */
export function withGoalNodeEnv(
  env: NodeJS.ProcessEnv | undefined,
  node: Pick<GoalPlanNode, "key" | "objective">,
): NodeJS.ProcessEnv {
  return { ...(env ?? process.env), LOOPS_GOAL_NODE_KEY: node.key, LOOPS_GOAL_NODE_OBJECTIVE: node.objective };
}
