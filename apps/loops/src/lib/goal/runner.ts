import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { ExecutableTarget, ExecutorResult } from "../../types.js";
import { executeTarget } from "../executor.js";
import { nowIso } from "../ids.js";
import { scrubSecrets, scrubSecretsDeep } from "../redact.js";
import { summarizeExecutorResult } from "../run-envelope.js";
import type { Store } from "../store.js";
import { assertAcyclicNodes, nodeBudgetExhausted, readyNodeKeys, rollupSummary, updateReadyFlags } from "./status.js";
import { executionMetadata, withGoalNodeEnv } from "./metadata.js";
import { resolveGoalModel, resolveGoalVerifierModel } from "./model-factory.js";
import { achievementPrompt, goalNodeTarget, planPrompt } from "./prompts.js";
import type { Goal, GoalExecutorResult, GoalPlan, GoalPlanNode, GoalSpec, RunGoalOptions } from "./types.js";
import { GOAL_OBJECTIVE_MAX_CHARS } from "./types.js";

const DEFAULT_MAX_TURNS = 10;

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

function planStatusForGoal(goal: Goal): GoalPlan["status"] {
  if (goal.status === "usageLimited") return "blocked";
  return goal.status;
}

function syncReadyFlags(store: Store, goal: Goal, nodes: GoalPlanNode[], opts: RunGoalOptions): GoalPlanNode[] {
  const withReady = updateReadyFlags(nodes, planStatusForGoal(goal));
  for (const node of withReady) {
    const current = nodes.find((entry) => entry.key === node.key);
    if (current && current.ready !== node.ready) {
      store.updateGoalPlanNode(goal.goalId, node.key, { ready: node.ready }, { daemonLeaseId: opts.daemonLeaseId });
    }
  }
  return withReady;
}

type NoReadyDiagnostic = {
  owner: "goal" | "goal-plan" | "goal-plan-node";
  blocker: string;
  planStatus: GoalPlan["status"];
  rollup: ReturnType<typeof rollupSummary>;
  pendingNodes: Array<{
    key: string;
    status: GoalPlanNode["status"];
    ready: boolean;
    tokenBudget?: number;
    tokensUsed: number;
    budgetExhausted: boolean;
    unmetDependencies: Array<{ key: string; status: GoalPlanNode["status"] | "missing" }>;
  }>;
  incompleteNodes: Array<{ key: string; status: GoalPlanNode["status"]; ready: boolean }>;
};

function summarizeLabels(values: string[], limit = 5): string {
  if (values.length <= limit) return values.join(", ");
  return `${values.slice(0, limit).join(", ")} and ${values.length - limit} more`;
}

function noReadyDiagnostic(goal: Goal, nodes: GoalPlanNode[]): NoReadyDiagnostic {
  const planStatus = planStatusForGoal(goal);
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const pendingNodes = nodes.filter((node) => node.status === "pending");
  const incompleteNodes = nodes.filter((node) => node.status !== "complete");
  const pendingDetails = pendingNodes.map((node) => ({
    key: node.key,
    status: node.status,
    ready: node.ready,
    tokenBudget: node.tokenBudget,
    tokensUsed: node.tokensUsed,
    budgetExhausted: nodeBudgetExhausted(node),
    unmetDependencies: node.dependsOn
      .map((dependency) => ({ key: dependency, status: byKey.get(dependency)?.status ?? "missing" as const }))
      .filter((dependency) => dependency.status !== "complete"),
  }));
  const incompleteDetails = incompleteNodes.map((node) => ({
    key: node.key,
    status: node.status,
    ready: node.ready,
  }));

  let owner: NoReadyDiagnostic["owner"] = "goal-plan";
  let cause = "goal plan has no ready nodes";
  if (planStatus !== "active") {
    owner = "goal";
    cause = `goal status is ${goal.status}`;
  } else if (pendingNodes.length === 0) {
    owner = "goal-plan";
    cause = `goal plan has no pending runnable nodes; incomplete nodes: ${
      summarizeLabels(incompleteDetails.map((node) => `${node.key}:${node.status}`))
    }`;
  } else if (pendingDetails.every((node) => node.budgetExhausted)) {
    owner = "goal-plan-node";
    cause = `all pending nodes are budget-exhausted: ${summarizeLabels(pendingDetails.map((node) => node.key))}`;
  } else {
    const missingDependencies = pendingDetails.flatMap((node) =>
      node.unmetDependencies
        .filter((dependency) => dependency.status === "missing")
        .map((dependency) => `${node.key}->${dependency.key}`),
    );
    if (missingDependencies.length > 0) {
      owner = "goal-plan";
      cause = `pending nodes reference missing dependencies: ${summarizeLabels(missingDependencies)}`;
    } else if (pendingDetails.every((node) => node.unmetDependencies.length > 0 || node.budgetExhausted)) {
      owner = "goal-plan-node";
      const waiting = pendingDetails
        .filter((node) => node.unmetDependencies.length > 0)
        .map((node) => `${node.key} waits on ${
          node.unmetDependencies.map((dependency) => `${dependency.key}:${dependency.status}`).join(",")
        }`);
      const exhausted = pendingDetails
        .filter((node) => node.budgetExhausted)
        .map((node) => `${node.key} budget exhausted`);
      cause = `pending nodes are blocked by prerequisites: ${summarizeLabels([...waiting, ...exhausted])}`;
    }
  }

  const blocker = `${cause}; owner=${owner}`;
  return {
    owner,
    blocker,
    planStatus,
    rollup: rollupSummary(nodes),
    pendingNodes: pendingDetails,
    incompleteNodes: incompleteDetails,
  };
}

async function executeUnderlyingTarget(
  target: ExecutableTarget | undefined,
  goal: Goal,
  node: GoalPlanNode,
  opts: RunGoalOptions,
): Promise<ExecutorResult> {
  const metadata = executionMetadata(opts.context, goal, node);
  if (opts.executeNode) return opts.executeNode(node, metadata);
  if (!target) throw new Error("runGoal requires either target or executeNode");
  return executeTarget(goalNodeTarget(target, goal, node), metadata, {
    env: withGoalNodeEnv(opts.env, node),
    daemonLeaseId: opts.daemonLeaseId,
    beforePersist: opts.beforePersist,
    signal: opts.signal,
    knowledgeFeedback: opts.knowledgeFeedback,
  });
}

function verifierModelFor(spec: GoalSpec, opts: RunGoalOptions, planner: LanguageModel): LanguageModel {
  if (opts.verifierModel) return opts.verifierModel;
  const env = opts.env ?? process.env;
  const configured = spec.verifierModel ?? env.LOOPS_GOAL_VERIFIER_MODEL;
  if (!configured) return planner;
  return resolveGoalVerifierModel({ model: configured, env: opts.env });
}

function nodeEvidence(node: GoalPlanNode, result: ExecutorResult): string {
  const summary = summarizeExecutorResult(result);
  return [
    `node ${node.key} ${summary.status} (exit ${summary.exitCode ?? "unknown"}, ${summary.durationMs}ms, ` +
      `stdout ${summary.stdoutBytes}B, stderr ${summary.stderrBytes}B)`,
    summary.stdoutExcerpt ? `stdout excerpt:\n${summary.stdoutExcerpt}` : undefined,
    summary.stderrExcerpt ? `stderr excerpt:\n${summary.stderrExcerpt}` : undefined,
  ].filter(Boolean).join("\n");
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

function stdoutFor(
  goal: Goal,
  nodes: GoalPlanNode[],
  evidence: string[],
  validation?: unknown,
  diagnostics?: unknown,
): string {
  // Scrub string leaves BEFORE stringify (which escapes quotes and would hide
  // quoted secrets from the flat patterns), then scrub the encoded document
  // too for token shapes that survive escaping — the same two-pass idiom as
  // store.recordGoalEvent. The store's flat scrub at persist time cannot match
  // assignment/Authorization secrets once they are double JSON-escaped.
  return scrubSecrets(
    JSON.stringify(
      scrubSecretsDeep({
        goal,
        rollup: rollupSummary(nodes),
        nodes,
        evidence,
        validation,
        diagnostics,
      }),
      null,
      2,
    ),
  );
}

export async function runGoal(store: Store, input: GoalSpec, opts: RunGoalOptions = {}): Promise<GoalExecutorResult> {
  const spec = normalizeGoalSpec(input);
  const model = opts.model ?? resolveGoalModel({ model: spec.model, env: opts.env });
  const verifier = verifierModelFor(spec, opts, model);
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
  const evidence: string[] = [];
  let validation: unknown;
  let lastBlocker = "";
  let repeatedBlockerCount = 0;
  let lastDiagnostic: NoReadyDiagnostic | undefined;

  if (budgetExhausted(goal)) {
    goal = store.updateGoalStatus(goal.goalId, "budgetLimited", { daemonLeaseId: opts.daemonLeaseId });
    return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal token budget exhausted after planning", startedAt);
  }

  // autoExecute off: plan and persist only; readyOnly and aiDirected both run the
  // dependency-driven execution loop below (aiDirected keeps current behavior).
  if ((goal.autoExecute ?? spec.autoExecute) === "off") {
    nodes = syncReadyFlags(store, goal, nodes, opts);
    return resultFromGoal(
      goal,
      "succeeded",
      stdoutFor(goal, nodes, evidence, undefined, {
        autoExecute: "off",
        note: "autoExecute is off: goal plan persisted without executing any nodes",
      }),
      undefined,
      startedAt,
    );
  }

  for (let turn = 1; turn <= (spec.maxTurns ?? DEFAULT_MAX_TURNS); turn++) {
    if (opts.signal?.aborted) {
      goal = store.updateGoalStatus(goal.goalId, "cancelled", { daemonLeaseId: opts.daemonLeaseId });
      return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal cancelled", startedAt);
    }
    goal = store.requireGoal(goal.goalId);
    nodes = syncReadyFlags(store, goal, store.listGoalPlanNodes(goal.goalId), opts);
    if (budgetExhausted(goal)) {
      goal = store.updateGoalStatus(goal.goalId, "budgetLimited", { daemonLeaseId: opts.daemonLeaseId });
      return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence), "goal token budget exhausted", startedAt);
    }

    const readyKeys = readyNodeKeys({
      status: planStatusForGoal(goal),
      nodes,
    });
    if (readyKeys.length > 0) {
      for (const key of readyKeys) {
        const node = store.listGoalPlanNodes(goal.goalId).find((entry) => entry.key === key);
        if (!node || node.status !== "pending") continue;
        opts.beforePersist?.();
        store.updateGoalPlanNode(goal.goalId, node.key, { status: "active", ready: false }, { daemonLeaseId: opts.daemonLeaseId });
        const result = await executeUnderlyingTarget(opts.target, goal, node, opts);
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
              stdout: result.stdout,
              stderr: result.stderr,
              error: result.error,
            },
          },
          { daemonLeaseId: opts.daemonLeaseId },
        );
        if (result.status === "succeeded") {
          evidence.push(nodeEvidence(node, result));
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
        model: verifier,
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

    const diagnostic = noReadyDiagnostic(goal, nodes);
    lastDiagnostic = diagnostic;
    const blocker = diagnostic.blocker;
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
        evidence: diagnostic,
      },
      { daemonLeaseId: opts.daemonLeaseId },
    );
    if (repeatedBlockerCount >= 3) {
      goal = store.updateGoalStatus(goal.goalId, "blocked", { daemonLeaseId: opts.daemonLeaseId });
      return resultFromGoal(goal, "failed", stdoutFor(goal, nodes, evidence, validation, diagnostic), blocker, startedAt);
    }
  }

  goal = store.updateGoalStatus(goal.goalId, "usageLimited", { daemonLeaseId: opts.daemonLeaseId });
  const exhaustedError = lastDiagnostic?.blocker ?? (lastBlocker ? `${lastBlocker}; max turns exhausted` : "goal max turns exhausted");
  return resultFromGoal(
    goal,
    "failed",
    stdoutFor(goal, store.listGoalPlanNodes(goal.goalId), evidence, validation, lastDiagnostic),
    exhaustedError,
    startedAt,
  );
}
