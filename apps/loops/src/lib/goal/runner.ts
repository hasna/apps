import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { ExecutableTarget, ExecutorResult } from "../../types.js";
import { executeTarget, type GoalPromptContext } from "../executor.js";
import { nowIso } from "../ids.js";
import type { Store } from "../store.js";
import { assertAcyclicNodes, readyNodeKeys, rollupSummary } from "./status.js";
import { resolveGoalModel } from "./model-factory.js";
import { achievementPrompt, iterationPrompt, planPrompt } from "./prompts.js";
import type { Goal, GoalExecutorResult, GoalPlanNode, GoalRun, GoalSpec, RunGoalOptions } from "./types.js";
import { GOAL_OBJECTIVE_MAX_CHARS } from "./types.js";

const DEFAULT_MAX_TURNS = 10;
const GOAL_EVIDENCE_TEXT_MAX_CHARS = 12_000;
const GOAL_EVENT_STDIO_MAX_CHARS = 60_000;

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
): GoalExecutorResult {
  const finishedAt = nowIso();
  return {
    status,
    exitCode: status === "succeeded" ? 0 : 1,
    stdout,
    stderr: "",
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

function sameBlockerKey(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("\n") || "goal completion remains unproven";
}

function truncateMiddle(value: string | undefined, maxChars: number): string {
  if (!value || value.length <= maxChars) return value ?? "";
  const placeholder = "\n...[truncated]...\n";
  const keep = Math.max(0, maxChars - placeholder.length - 32);
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  const omitted = value.length - head - tail;
  return `${value.slice(0, head)}\n...[truncated ${omitted} chars]...\n${value.slice(value.length - tail)}`;
}

function nodeEvidenceLine(node: GoalPlanNode, result: ExecutorResult): string {
  return [
    `node ${node.key} succeeded`,
    `objective: ${node.objective}`,
    `stdout:\n${truncateMiddle(result.stdout, GOAL_EVIDENCE_TEXT_MAX_CHARS)}`,
    `stderr:\n${truncateMiddle(result.stderr, GOAL_EVIDENCE_TEXT_MAX_CHARS)}`,
  ].join("\n");
}

function storedNodeEvidenceLine(run: GoalRun, node: GoalPlanNode | undefined): string | undefined {
  const evidence = run.evidence as { status?: unknown; stdout?: unknown; stderr?: unknown } | undefined;
  if (run.phase !== "execute" || run.status !== "complete" || !run.nodeKey || evidence?.status !== "succeeded") {
    return undefined;
  }
  return [
    `node ${run.nodeKey} succeeded`,
    node ? `objective: ${node.objective}` : undefined,
    `stdout:\n${truncateMiddle(typeof evidence.stdout === "string" ? evidence.stdout : "", GOAL_EVIDENCE_TEXT_MAX_CHARS)}`,
    `stderr:\n${truncateMiddle(typeof evidence.stderr === "string" ? evidence.stderr : "", GOAL_EVIDENCE_TEXT_MAX_CHARS)}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function storedEvidenceLines(store: Store, goalId: string, nodes: GoalPlanNode[]): string[] {
  const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
  return store.listGoalRuns({ goalId })
    .map((run) => storedNodeEvidenceLine(run, run.nodeKey ? nodesByKey.get(run.nodeKey) : undefined))
    .filter((line): line is string => Boolean(line));
}

function acceptanceCriteriaFor(goal: Goal, node: GoalPlanNode): string[] {
  return [
    `Satisfy the top objective: ${goal.objective}`,
    `Complete the current node objective: ${node.objective}`,
    "Respect the original target prompt, repository instructions, and any workflow or loop constraints.",
    "Return concrete evidence of completed work, verification commands, or blockers for OpenLoops validation.",
  ];
}

function promptContextFor(goal: Goal, node: GoalPlanNode, evidence: string[], parentGoalContext?: GoalPromptContext): GoalPromptContext {
  return {
    goalId: goal.goalId,
    topObjective: goal.objective,
    currentNodeKey: node.key,
    currentNodeObjective: node.objective,
    acceptanceCriteria: acceptanceCriteriaFor(goal, node),
    priorEvidence: evidence.map((line) => truncateMiddle(line, GOAL_EVIDENCE_TEXT_MAX_CHARS)),
    explicitNodeInstruction: `Work against current node ${node.key}: ${node.objective}. Use the original target prompt as the task surface, but prioritize this node and produce concise evidence for goal validation.`,
    parentGoalContext,
  };
}

function metadataFor(goal: Goal, node: GoalPlanNode, context: RunGoalOptions["context"]): Record<string, string | undefined> {
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
    goalNodeObjective: node.objective,
  };
}

async function executeUnderlyingTarget(
  target: ExecutableTarget | undefined,
  goal: Goal,
  node: GoalPlanNode,
  evidence: string[],
  opts: RunGoalOptions,
): Promise<ExecutorResult> {
  const metadata = metadataFor(goal, node, opts.context);
  const goalPromptContext = promptContextFor(goal, node, evidence, opts.goalPromptContext);
  if (opts.executeNode) return opts.executeNode(node, metadata, goalPromptContext);
  if (!target) throw new Error("runGoal requires either target or executeNode");
  return executeTarget(target, metadata, {
    env: opts.env,
    daemonLeaseId: opts.daemonLeaseId,
    beforePersist: opts.beforePersist,
    signal: opts.signal,
    goalPromptContext,
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
  let nodes = await planGoal(store, goal, spec, model, opts);
  goal = store.requireGoal(goal.goalId);
  const evidence: string[] = storedEvidenceLines(store, goal.goalId, nodes);
  let validation: unknown;
  let lastBlocker = "";
  let repeatedBlockerCount = 0;

  if (budgetExhausted(goal)) {
    goal = store.updateGoalStatus(goal.goalId, "budgetLimited", { daemonLeaseId: opts.daemonLeaseId });
    return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal token budget exhausted after planning", startedAt);
  }

  for (let turn = 1; turn <= (spec.maxTurns ?? DEFAULT_MAX_TURNS); turn++) {
    if (opts.signal?.aborted) {
      goal = store.updateGoalStatus(goal.goalId, "cancelled", { daemonLeaseId: opts.daemonLeaseId });
      return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal cancelled", startedAt);
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
        const result = await executeUnderlyingTarget(opts.target, goal, node, evidence, opts);
        store.recordGoalEvent(
          {
            goalId: goal.goalId,
            turn,
            phase: "execute",
            status: result.status === "succeeded" ? "complete" : "active",
            nodeKey: node.key,
            evidence: {
              status: result.status,
              exitCode: result.exitCode,
              stdout: truncateMiddle(result.stdout, GOAL_EVENT_STDIO_MAX_CHARS),
              stderr: truncateMiddle(result.stderr, GOAL_EVENT_STDIO_MAX_CHARS),
              error: truncateMiddle(result.error, GOAL_EVIDENCE_TEXT_MAX_CHARS),
            },
          },
          { daemonLeaseId: opts.daemonLeaseId },
        );
        if (result.status === "succeeded") {
          evidence.push(nodeEvidenceLine(node, result));
          store.updateGoalPlanNode(goal.goalId, node.key, {
            status: "complete",
            timeUsedSeconds: Math.round(result.durationMs / 1000),
          }, { daemonLeaseId: opts.daemonLeaseId });
          continue;
        }
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
          return resultFromGoal(goal, "failed", stdoutFor(goal, store.listGoalPlanNodes(goal.goalId), evidence), blocker, startedAt);
        }
        break;
      }
      continue;
    }

    if (nodes.every((node) => node.status === "complete")) {
      const judged = await generateObject({
        model,
        schema: AchievementSchema,
        temperature: 0,
        prompt: achievementPrompt(goal, nodes, evidence),
        abortSignal: opts.signal,
      });
      const tokens = usageTotal(judged.usage);
      validation = judged.object;
      const achieved = judged.object.achieved && judged.object.adversarialReview.trim().length > 0;
      const unmet = achieved ? [] : judged.object.unmetRequirements.length > 0
        ? judged.object.unmetRequirements
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
            evidence: judged.object.evidence,
            unmetRequirements: unmet,
            adversarialReview: judged.object.adversarialReview,
          },
          rawResponse: judged.object,
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
