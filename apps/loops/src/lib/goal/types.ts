import type { LanguageModel } from "ai";
import type { ExecutableTarget, ExecutorResult, KnowledgeFeedbackConfig } from "../../types.js";
import type { Store } from "../store.js";

export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete" | "cancelled";
export type GoalPlanNodeStatus = "pending" | GoalStatus;
export type GoalPlanStatus = "active" | "paused" | "blocked" | "budgetLimited" | "complete" | "cancelled";
export type GoalAutoExecute = "off" | "readyOnly" | "aiDirected";

export const GOAL_TERMINAL = ["budgetLimited", "complete", "cancelled"] as const satisfies readonly GoalStatus[];
export const GOAL_OBJECTIVE_MAX_CHARS = 4000;

export interface GoalSpec {
  objective: string;
  tokenBudget?: number;
  model?: string;
  /** Independent model for the achievement audit; defaults to LOOPS_GOAL_VERIFIER_MODEL, then the planner model. */
  verifierModel?: string;
  maxTurns?: number;
  maxTokens?: number;
  autoExecute?: GoalAutoExecute;
}

export interface Goal {
  goalId: string;
  planId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  autoExecute: GoalAutoExecute;
  maxTokens?: number;
  sourceType?: string;
  sourceId?: string;
  loopId?: string;
  loopRunId?: string;
  workflowId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

export interface GoalRollup {
  total: number;
  pending: number;
  active: number;
  paused: number;
  blocked: number;
  usageLimited: number;
  budgetLimited: number;
  complete: number;
  cancelled: number;
}

export interface GoalPlanNode {
  nodeId: string;
  planId: string;
  key: string;
  sequence: number;
  priority: number;
  objective: string;
  status: GoalPlanNodeStatus;
  ready: boolean;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalPlan {
  planId: string;
  goalId: string;
  status: GoalPlanStatus;
  autoExecute: GoalAutoExecute;
  maxTokens?: number;
  rollup: GoalRollup;
  nodes: GoalPlanNode[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalRun {
  runId: string;
  goalId: string;
  planId: string;
  loopId?: string;
  loopRunId?: string;
  workflowId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  turn: number;
  phase: "plan" | "execute" | "validate" | "status";
  status: GoalStatus | GoalPlanNodeStatus;
  nodeKey?: string;
  tokensUsed: number;
  evidence?: Record<string, unknown>;
  rawResponse?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface GoalExecutionContext {
  loopId?: string;
  loopName?: string;
  loopRunId?: string;
  scheduledFor?: string;
  workflowId?: string;
  workflowName?: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

export interface RunGoalOptions {
  store?: Store;
  model?: LanguageModel;
  verifierModel?: LanguageModel;
  target?: ExecutableTarget;
  executeNode?: (node: GoalPlanNode, metadata: Record<string, string | undefined>) => Promise<ExecutorResult>;
  env?: NodeJS.ProcessEnv;
  daemonLeaseId?: string;
  beforePersist?: () => void;
  signal?: AbortSignal;
  cancelPollMs?: number;
  context?: GoalExecutionContext;
  knowledgeFeedback?: KnowledgeFeedbackConfig;
}

export interface GoalExecutorResult extends ExecutorResult {
  goalId?: string;
  goalRunId?: string;
}
