import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { ExecutableTarget, ExecutorResult } from "../../types.js";
import { executeTarget, type ExecutionMetadata } from "../executor.js";
import { nowIso } from "../ids.js";
import type { Store } from "../store.js";
import { assertAcyclicNodes, readyNodeKeys, rollupSummary } from "./status.js";
import { resolveGoalModel } from "./model-factory.js";
import { achievementPrompt, iterationPrompt, planPrompt } from "./prompts.js";
import type { Goal, GoalExecutorResult, GoalPlanNode, GoalSpec, RunGoalOptions } from "./types.js";
import { GOAL_OBJECTIVE_MAX_CHARS } from "./types.js";

const DEFAULT_MAX_TURNS = 10;
const NODE_OUTPUT_MAX_CHARS = 1_200;

const PlanNodeSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  objective: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  priority: z.number().int(),
  tokenBudget: z.number().int().positive().nullable(),
});

const PlanSchema = z.object({
  nodes: z.array(PlanNodeSchema).min(1),
});

const AchievementSchema = z.object({
  achieved: z.boolean(),
  status: z.enum(["active", "blocked", "budgetLimited", "complete", "cancelled"]).nullable(),
  evidence: z.array(z.string()),
  unmetRequirements: z.array(z.string()),
  adversarialReview: z.string().min(1),
});

function normalizeGoalSpec(spec: GoalSpec): GoalSpec {
  const objective = spec.objective.trim();
  if (!objective) throw new Error("goal.objective must be a non-empty string");
  if (objective.length > GOAL_OBJECTIVE_MAX_CHARS) {
    throw new Error(`goal.objective must be ${GOAL_OBJECTIVE_MAX_CHARS} characters or fewer`);
  }
  return { ...spec, objective, autoExecute: spec.autoExecute ?? "readyOnly" };
}

function usageTotal(value: unknown): number {
  const usage = value as {
    inputTokens?: number | { total?: number };
    outputTokens?: number | { total?: number };
    totalTokens?: number;
  };
  const input = typeof usage.inputTokens === "number" ? usage.inputTokens : usage.inputTokens?.total ?? 0;
  const output = typeof usage.outputTokens === "number" ? usage.outputTokens : usage.outputTokens?.total ?? 0;
  return usage.totalTokens ?? input + output;
}

function resultFromGoal(
  goal: Goal,
  status: ExecutorResult["status"],
  stdout: string,
  error?: string,
  startedAt = goal.createdAt,
  stderr = "",
): GoalExecutorResult {
  const finishedAt = nowIso();
  return {
    status,
    exitCode: status === "succeeded" ? 0 : 1,
    stdout,
    stderr,
    error,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    goalId: goal.goalId,
  };
}

function budgetExhausted(goal: Goal): boolean {
  return goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget;
}

function abortResult(
  store: Store,
  goal: Goal,
  nodes: GoalPlanNode[],
  evidence: string[],
  opts: RunGoalOptions,
  startedAt: string,
): GoalExecutorResult {
  const timeoutMessage = opts.signalTimeoutMessage?.();
  if (timeoutMessage) {
    for (const node of nodes) {
      if (node.status === "active") {
        store.updateGoalPlanNode(goal.goalId, node.key, { status: "pending", ready: false }, { daemonLeaseId: opts.daemonLeaseId });
      }
    }
  }
  goal = store.updateGoalStatus(goal.goalId, timeoutMessage ? "usageLimited" : "cancelled", { daemonLeaseId: opts.daemonLeaseId });
  return resultFromGoal(
    goal,
    timeoutMessage ? "timed_out" : "failed",
    stdoutFor(goal, nodes, evidence),
    timeoutMessage ?? "goal cancelled",
    startedAt,
  );
}

function sameBlockerKey(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("\n") || "goal completion remains unproven";
}

function outputExcerpt(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= NODE_OUTPUT_MAX_CHARS) return trimmed;
  const headChars = Math.ceil(NODE_OUTPUT_MAX_CHARS / 2);
  const tailChars = Math.floor(NODE_OUTPUT_MAX_CHARS / 2);
  const omitted = trimmed.length - headChars - tailChars;
  return `[truncated ${omitted} chars]\n${trimmed.slice(0, headChars)}\n...\n${trimmed.slice(-tailChars)}`;
}

function nodeResultEventEvidence(result: ExecutorResult): Record<string, unknown> {
  const evidence: Record<string, unknown> = {
    status: result.status,
    exitCode: result.exitCode,
  };
  if (result.error) evidence.error = result.error;
  const stderr = outputExcerpt(result.stderr);
  if (stderr) evidence.stderr = stderr;
  const stdout = outputExcerpt(result.stdout);
  if (stdout) evidence.stdout = stdout;
  return evidence;
}

function nodeSuccessEvidence(node: GoalPlanNode, result: ExecutorResult): string {
  const lines = [`node ${node.key} succeeded`];
  const stdout = outputExcerpt(result.stdout);
  if (stdout) lines.push(`stdout:\n${stdout}`);
  const stderr = outputExcerpt(result.stderr);
  if (stderr) lines.push(`stderr:\n${stderr}`);
  return lines.join("\n");
}

function nodeFailureEvidence(node: GoalPlanNode, result: ExecutorResult): string {
  const lines = [`node ${node.key} ${result.status}`];
  if (result.exitCode !== undefined) lines.push(`exitCode: ${result.exitCode}`);
  if (result.error) lines.push(`error: ${result.error}`);
  const stderr = outputExcerpt(result.stderr);
  if (stderr) lines.push(`stderr:\n${stderr}`);
  const stdout = outputExcerpt(result.stdout);
  if (stdout) lines.push(`stdout:\n${stdout}`);
  return lines.join("\n");
}

function metadataFor(goal: Goal, node: GoalPlanNode, context: RunGoalOptions["context"]): ExecutionMetadata {
  return {
    loopId: context?.loopId,
    loopName: context?.loopName,
    runId: context?.loopRunId,
    scheduledFor: context?.scheduledFor,
    workflowId: context?.workflowId,
    workflowName: context?.workflowName,
    workflowRunId: context?.workflowRunId,
    workflowStepId: context?.workflowStepId,
    goalId: goal.goalId,
    goalObjective: goal.objective,
    goalNodeKey: node.key,
    extraEnv: context?.extraEnv,
  };
}

async function executeUnderlyingTarget(
  target: ExecutableTarget | undefined,
  goal: Goal,
  node: GoalPlanNode,
  opts: RunGoalOptions,
): Promise<ExecutorResult> {
  const metadata = metadataFor(goal, node, opts.context);
  if (opts.executeNode) return opts.executeNode(node, metadata);
  if (!target) throw new Error("runGoal requires either target or executeNode");
  return executeTarget(target, metadata, {
    env: opts.env,
    daemonLeaseId: opts.daemonLeaseId,
    beforePersist: opts.beforePersist,
    signal: opts.signal,
  });
}

async function planGoal(store: Store, goal: Goal, spec: GoalSpec, model: LanguageModel, opts: RunGoalOptions): Promise<GoalPlanNode[]> {
  const existing = store.listGoalPlanNodes(goal.goalId);
  if (existing.length > 0) return existing;
  const planned = await generateObject({
    model,
    schema: PlanSchema,
    temperature: 0,
    prompt: planPrompt(spec),
    abortSignal: opts.signal,
  });
  const tokens = usageTotal(planned.usage);
  const rawNodes = planned.object.nodes.map((node, index) => ({
    key: node.key,
    objective: node.objective,
    dependsOn: node.dependsOn ?? [],
    priority: node.priority ?? 0,
    tokenBudget: node.tokenBudget ?? undefined,
    sequence: index,
  }));
  assertAcyclicNodes(rawNodes.map((node) => ({ key: node.key, dependsOn: node.dependsOn })));
  store.recordGoalEvent(
    {
      goalId: goal.goalId,
      turn: 0,
      phase: "plan",
      status: "active",
      tokensUsed: tokens,
      evidence: { nodeCount: rawNodes.length },
      rawResponse: planned.object,
    },
    { daemonLeaseId: opts.daemonLeaseId },
  );
  return store.createGoalPlanNodes(goal.goalId, rawNodes, { daemonLeaseId: opts.daemonLeaseId });
}

function stdoutFor(goal: Goal, nodes: GoalPlanNode[], evidence: string[], validation?: unknown): string {
  return JSON.stringify(
    {
      goal,
      rollup: rollupSummary(nodes),
      nodes,
      evidence,
      validation,
    },
    null,
    2,
  );
}

export async function runGoal(store: Store, input: GoalSpec, opts: RunGoalOptions = {}): Promise<GoalExecutorResult> {
  const spec = normalizeGoalSpec(input);
  const model = opts.model ?? resolveGoalModel({ model: spec.model, env: opts.env });
  const startedAt = nowIso();
  const existing = store.findGoalByContext({
    loopRunId: opts.context?.loopRunId,
    workflowRunId: opts.context?.workflowRunId,
    workflowStepId: opts.context?.workflowStepId,
    sourceType: opts.context?.loopRunId || opts.context?.workflowRunId ? undefined : "manual",
    sourceId: opts.context?.loopRunId || opts.context?.workflowRunId ? undefined : spec.objective,
  });
  let goal = existing ?? store.createGoal(
    {
      objective: spec.objective,
      tokenBudget: spec.tokenBudget,
      autoExecute: spec.autoExecute,
      maxTokens: spec.maxTokens ?? spec.tokenBudget,
      sourceType: opts.context?.loopRunId || opts.context?.workflowRunId ? undefined : "manual",
      sourceId: opts.context?.loopRunId || opts.context?.workflowRunId ? undefined : spec.objective,
      loopId: opts.context?.loopId,
      loopRunId: opts.context?.loopRunId,
      workflowId: opts.context?.workflowId,
      workflowRunId: opts.context?.workflowRunId,
      workflowStepId: opts.context?.workflowStepId,
    },
    { daemonLeaseId: opts.daemonLeaseId },
  );
  const evidence: string[] = [];
  if (existing && goal.status === "usageLimited") {
    goal = store.updateGoalStatus(goal.goalId, "active", { daemonLeaseId: opts.daemonLeaseId });
  }
  let nodes: GoalPlanNode[] = [];
  try {
    nodes = await planGoal(store, goal, spec, model, opts);
  } catch (err) {
    if (opts.signal?.aborted) return abortResult(store, goal, nodes, evidence, opts, startedAt);
    throw err;
  }
  goal = store.requireGoal(goal.goalId);
  let validation: unknown;
  let lastBlocker = "";
  let repeatedBlockerCount = 0;

  if (budgetExhausted(goal)) {
    goal = store.updateGoalStatus(goal.goalId, "budgetLimited", { daemonLeaseId: opts.daemonLeaseId });
    return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal token budget exhausted after planning", startedAt);
  }

  for (let turn = 1; turn <= (spec.maxTurns ?? DEFAULT_MAX_TURNS); turn++) {
    if (opts.signal?.aborted) {
      return abortResult(store, goal, nodes, evidence, opts, startedAt);
    }
    goal = store.requireGoal(goal.goalId);
    nodes = store.listGoalPlanNodes(goal.goalId);
    if (budgetExhausted(goal)) {
      goal = store.updateGoalStatus(goal.goalId, "budgetLimited", { daemonLeaseId: opts.daemonLeaseId });
      return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal token budget exhausted", startedAt);
    }

    const readyKeys = readyNodeKeys({
      status: goal.status === "active" ? "active" : goal.status === "budgetLimited" ? "budgetLimited" : "blocked",
      nodes,
    });
    if (readyKeys.length > 0) {
      for (const key of readyKeys) {
        const node = store.listGoalPlanNodes(goal.goalId).find((entry) => entry.key === key);
        if (!node || node.status !== "pending") continue;
        opts.beforePersist?.();
        store.updateGoalPlanNode(goal.goalId, node.key, { status: "active", ready: false }, { daemonLeaseId: opts.daemonLeaseId });
        let result: ExecutorResult;
        try {
          result = await executeUnderlyingTarget(opts.target, goal, node, opts);
        } catch (err) {
          if (opts.signal?.aborted) {
            return abortResult(store, goal, store.listGoalPlanNodes(goal.goalId), evidence, opts, startedAt);
          }
          throw err;
        }
        if (opts.signal?.aborted) {
          return abortResult(store, goal, store.listGoalPlanNodes(goal.goalId), evidence, opts, startedAt);
        }
        store.recordGoalEvent(
          {
            goalId: goal.goalId,
            turn,
            phase: "execute",
            status: result.status === "succeeded" ? "complete" : "active",
            nodeKey: node.key,
            evidence: nodeResultEventEvidence(result),
          },
          { daemonLeaseId: opts.daemonLeaseId },
        );
        if (result.status === "succeeded") {
          evidence.push(nodeSuccessEvidence(node, result));
          store.updateGoalPlanNode(goal.goalId, node.key, {
            status: "complete",
            timeUsedSeconds: Math.round(result.durationMs / 1000),
          }, { daemonLeaseId: opts.daemonLeaseId });
          continue;
        }
        const failureEvidence = nodeFailureEvidence(node, result);
        evidence.push(failureEvidence);
        const blocker = `node ${node.key} ${result.status}${result.error ? `: ${result.error}` : ""}`;
        if (blocker === lastBlocker) repeatedBlockerCount += 1;
        else {
          lastBlocker = blocker;
          repeatedBlockerCount = 1;
        }
        store.updateGoalPlanNode(goal.goalId, node.key, { status: repeatedBlockerCount >= 3 ? "blocked" : "pending" }, {
          daemonLeaseId: opts.daemonLeaseId,
        });
        if (repeatedBlockerCount >= 3) {
          goal = store.updateGoalStatus(goal.goalId, "blocked", { daemonLeaseId: opts.daemonLeaseId });
          return resultFromGoal(
            goal,
            "failed",
            stdoutFor(goal, store.listGoalPlanNodes(goal.goalId), evidence),
            blocker,
            startedAt,
            failureEvidence,
          );
        }
        break;
      }
      continue;
    }

    if (nodes.every((node) => node.status === "complete")) {
      let judgedObject: z.infer<typeof AchievementSchema>;
      let judgedUsage: unknown;
      try {
        const judged = await generateObject({
          model,
          schema: AchievementSchema,
          temperature: 0,
          prompt: achievementPrompt(goal, nodes, evidence),
          abortSignal: opts.signal,
        });
        judgedObject = judged.object;
        judgedUsage = judged.usage;
      } catch (err) {
        if (opts.signal?.aborted) return abortResult(store, goal, nodes, evidence, opts, startedAt);
        throw err;
      }
      const tokens = usageTotal(judgedUsage);
      validation = judgedObject;
      const achieved = judgedObject.achieved && judgedObject.adversarialReview.trim().length > 0;
      const unmet = achieved ? [] : judgedObject.unmetRequirements.length > 0
        ? judgedObject.unmetRequirements
        : ["adversarial review did not prove completion"];
      store.recordGoalEvent(
        {
          goalId: goal.goalId,
          turn,
          phase: "validate",
          status: achieved ? "complete" : "blocked",
          tokensUsed: tokens,
          evidence: {
            achieved,
            evidence: judgedObject.evidence,
            unmetRequirements: unmet,
            adversarialReview: judgedObject.adversarialReview,
          },
          rawResponse: judgedObject,
        },
        { daemonLeaseId: opts.daemonLeaseId },
      );
      goal = store.requireGoal(goal.goalId);
      if (achieved) {
        goal = store.updateGoalStatus(goal.goalId, "complete", { daemonLeaseId: opts.daemonLeaseId });
        return resultFromGoal(goal, "succeeded", stdoutFor(goal, nodes, evidence, validation), undefined, startedAt);
      }
      const blocker = sameBlockerKey(unmet);
      if (blocker === lastBlocker) repeatedBlockerCount += 1;
      else {
        lastBlocker = blocker;
        repeatedBlockerCount = 1;
      }
      if (repeatedBlockerCount >= 3) {
        goal = store.updateGoalStatus(goal.goalId, "blocked", { daemonLeaseId: opts.daemonLeaseId });
        return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence, validation), blocker, startedAt);
      }
      continue;
    }

    const blocker = "no ready goal nodes and goal plan is incomplete";
    if (blocker === lastBlocker) repeatedBlockerCount += 1;
    else {
      lastBlocker = blocker;
      repeatedBlockerCount = 1;
    }
    store.recordGoalEvent(
      {
        goalId: goal.goalId,
        turn,
        phase: "status",
        status: repeatedBlockerCount >= 3 ? "blocked" : "active",
        evidence: { blocker },
      },
      { daemonLeaseId: opts.daemonLeaseId },
    );
    if (repeatedBlockerCount >= 3) {
      goal = store.updateGoalStatus(goal.goalId, "blocked", { daemonLeaseId: opts.daemonLeaseId });
      return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence, validation), blocker, startedAt);
    }
  }

  goal = store.updateGoalStatus(goal.goalId, "usageLimited", { daemonLeaseId: opts.daemonLeaseId });
  return resultFromGoal(goal, "failed", stdoutFor(goal, store.listGoalPlanNodes(goal.goalId), evidence, validation), "goal max turns exhausted", startedAt);
}
