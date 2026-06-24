import { Output, generateText, type LanguageModel, type LanguageModelUsage } from "ai";
import { z } from "zod/v4";
import { logAuditEvent, recordModelUsage } from "../db/index.js";
import type { SafetyConfig } from "../types/index.js";
import { routePlannerTool, type CapabilityRouteResult } from "./capability-router.js";
import {
  addObservation,
  addRunStep,
  createApproval,
  createRuntimeGoal,
  createWorkflowDefinition,
  createWorkflowRun,
  recordPolicyDecision,
  type RuntimeGoal,
  type RunStep,
  type WorkflowDefinition,
  type WorkflowRun,
} from "./runtime.js";
import {
  approvalToolInputSchema,
  appToolInputSchema,
  browserToolInputSchema,
  computerToolInputSchema,
  fleetToolInputSchema,
  memoryToolInputSchema,
  observationToolInputSchema,
  storageToolInputSchema,
  terminalToolInputSchema,
  type PlannerToolName,
} from "./planner-tools.js";
import { buildPlannerSystemPrompt, promptReference, promptReferences } from "./prompts.js";

const MAX_PLANNER_STEPS = 24;

const plannerStepBaseSchema = z.object({
  title: z.string().min(1).max(160),
  intent: z.string().min(1).max(1_000),
  stopCondition: z.string().min(1).max(500),
}).strict();

export const goalPlanStepSchema = z.discriminatedUnion("toolName", [
  plannerStepBaseSchema.extend({ toolName: z.literal("computer"), input: computerToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("browser"), input: browserToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("terminal"), input: terminalToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("app"), input: appToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("fleet"), input: fleetToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("storage"), input: storageToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("memory"), input: memoryToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("approval"), input: approvalToolInputSchema }),
  plannerStepBaseSchema.extend({ toolName: z.literal("observation"), input: observationToolInputSchema }),
]);

export const goalPlanDraftSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2_000),
  stopConditions: z.array(z.string().min(1).max(500)).min(1).max(12),
  steps: z.array(goalPlanStepSchema).min(1).max(MAX_PLANNER_STEPS),
}).strict();

export type GoalPlanStep = z.infer<typeof goalPlanStepSchema>;
export type GoalPlanDraft = z.infer<typeof goalPlanDraftSchema>;

export interface GoalPlanGeneratorContext {
  prompt: string;
  maxSteps: number;
  workspaceRoots?: string[];
  availableTools: readonly PlannerToolName[];
}

export type GoalPlanGenerator = (context: GoalPlanGeneratorContext) => Promise<GoalPlanDraft> | GoalPlanDraft;

export interface PlanGoalOptions {
  prompt: string;
  maxSteps?: number;
  title?: string;
  model?: LanguageModel;
  generator?: GoalPlanGenerator;
  workspaceRoots?: string[];
  safety?: SafetyConfig;
  actor?: string;
  transport?: string;
  metadata?: Record<string, unknown>;
  modelName?: string;
  provider?: string;
}

export interface PersistedGoalPlanStep {
  index: number;
  step: GoalPlanStep;
  route: CapabilityRouteResult;
  runStep: RunStep;
  approvalId?: string;
}

export interface PersistedGoalPlan {
  goal: RuntimeGoal;
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  draft: GoalPlanDraft;
  steps: PersistedGoalPlanStep[];
  usage?: LanguageModelUsage;
}

export async function planGoalDryRun(options: PlanGoalOptions): Promise<PersistedGoalPlan> {
  const maxSteps = clampMaxSteps(options.maxSteps);
  const generated = await generateGoalPlanDraft(options, maxSteps);
  const rawDraft = generated.draft;
  const draft = goalPlanDraftSchema.parse({
    ...rawDraft,
    steps: rawDraft.steps.slice(0, maxSteps),
  });
  const title = options.title ?? draft.title;
  const goal = createRuntimeGoal({ title, prompt: options.prompt, status: "planned" });
  const workflow = createWorkflowDefinition({
    name: title,
    definition: {
      kind: "ai_sdk_goal_plan",
      dry_run: true,
      summary: draft.summary,
      stop_conditions: draft.stopConditions,
      steps: draft.steps,
      planner: {
        tool_count: AVAILABLE_PLANNER_TOOLS.length,
        generated_at: new Date().toISOString(),
        prompt: promptReference("planner"),
      },
    },
  });
  const run = createWorkflowRun({ goalId: goal.id, workflowId: workflow.id, status: "pending" });
  const steps: PersistedGoalPlanStep[] = [];

  if (generated.usage) {
    recordModelUsage({
      runId: run.id,
      phase: "planner",
      provider: options.provider ?? "ai-sdk",
      model: options.modelName ?? inferAiSdkModelName(options.model),
      inputTokens: generated.usage.inputTokens ?? 0,
      outputTokens: generated.usage.outputTokens ?? 0,
      metadata: {
        prompt: promptReference("planner"),
        dry_run: true,
      },
    });
  }

  addObservation({
    runId: run.id,
    kind: "planner_output",
    data: {
      title: draft.title,
      summary: draft.summary,
      stop_conditions: draft.stopConditions,
      dry_run: true,
      max_steps: maxSteps,
      prompts: promptReferences("planner", "safety_reviewer"),
    },
  });

  await logAuditEvent({
    event: "planner.dry_run_started",
    actor: options.actor,
    transport: options.transport ?? "planner",
    capability: "planner.goal",
    action_type: "goal_plan",
    action_data: { title, prompt_length: options.prompt.length, max_steps: maxSteps },
    decision: "started",
    metadata: {
      prompt: promptReference("planner"),
      ...options.metadata,
    },
  });

  for (const [index, step] of draft.steps.entries()) {
    const route = await routePlannerTool(step.toolName, step.input, {
      safety: options.safety,
      workspaceRoots: options.workspaceRoots,
      actor: options.actor,
      transport: options.transport ?? "planner",
      metadata: {
        ...options.metadata,
        goal_id: goal.id,
        run_id: run.id,
        workflow_id: workflow.id,
        step_index: index,
        dry_run: true,
        prompt: promptReference("planner"),
      },
    });
    const approvalId = route.status === "requires_confirmation"
      ? createApproval({
        runId: run.id,
        capability: route.capability,
        reason: route.reason ?? `${route.capability} requires approval before execution.`,
      })
      : undefined;
    recordPolicyDecision({
      runId: run.id,
      capability: route.capability,
      decision: route.status,
      reason: route.reason,
      metadata: {
        step_index: index,
        tool_name: step.toolName,
        dry_run: true,
        subsystem: route.subsystem,
        prompt: promptReference("planner"),
      },
    });
    const runStep = addRunStep({
      runId: run.id,
      stepIndex: index,
      status: "pending",
      action: {
        type: "planner_tool",
        toolName: step.toolName,
        input: step.input,
        title: step.title,
        intent: step.intent,
        stopCondition: step.stopCondition,
      },
      result: {
        planned: true,
        dry_run: true,
        route_status: route.status,
        route_allowed: route.allowed,
        capability: route.capability,
        approval_id: approvalId,
      },
    });
    steps.push({ index, step, route, runStep, approvalId });
  }

  await logAuditEvent({
    event: "planner.dry_run_persisted",
    actor: options.actor,
    transport: options.transport ?? "planner",
    capability: "planner.goal",
    action_type: "goal_plan",
    action_data: {
      goal_id: goal.id,
      workflow_id: workflow.id,
      run_id: run.id,
      step_count: steps.length,
    },
    decision: "planned",
    metadata: {
      prompt: promptReference("planner"),
      ...options.metadata,
    },
  });

  return { goal, workflow, run, draft, steps, usage: generated.usage };
}

async function generateGoalPlanDraft(options: PlanGoalOptions, maxSteps: number): Promise<{ draft: GoalPlanDraft; usage?: LanguageModelUsage }> {
  if (options.generator) {
    return { draft: goalPlanDraftSchema.parse(await options.generator({
      prompt: options.prompt,
      maxSteps,
      workspaceRoots: options.workspaceRoots,
      availableTools: AVAILABLE_PLANNER_TOOLS,
    })) };
  }

  if (options.model) {
    const result = await generateText({
      model: options.model,
      output: Output.object({
        schema: goalPlanDraftSchema,
        name: "open_computer_goal_plan",
        description: "A safe dry-run workflow plan for the open-computer control plane.",
      }),
      system: buildPlannerSystemPrompt({ maxSteps, tools: AVAILABLE_PLANNER_TOOLS }),
      prompt: options.prompt,
    });
    return { draft: goalPlanDraftSchema.parse(result.output), usage: result.usage };
  }

  return { draft: fallbackGoalPlan(options.prompt, maxSteps, options.workspaceRoots) };
}

function fallbackGoalPlan(prompt: string, maxSteps: number, workspaceRoots?: string[]): GoalPlanDraft {
  const root = workspaceRoots?.[0] ?? process.cwd();
  const title = prompt.trim().slice(0, 120) || "Open-computer goal";
  const steps: GoalPlanStep[] = [
    {
      title: "Record goal context",
      intent: "Persist the operator prompt and initial planning context before touching any external capability.",
      toolName: "memory",
      input: {
        scope: "goal",
        title,
        body: prompt,
      },
      stopCondition: "The goal context is present in the durable run graph.",
    },
    {
      title: "Observe local screen",
      intent: "Gather the current desktop state before deciding whether native computer control is needed.",
      toolName: "computer",
      input: {
        action: "screenshot",
      },
      stopCondition: "A current screenshot observation is available for the run.",
    },
    {
      title: "Check browser lane",
      intent: "Discover whether a browser extension session is available before planning browser mutations.",
      toolName: "browser",
      input: {
        action: "status",
      },
      stopCondition: "Browser extension status is known.",
    },
    {
      title: "Check fleet route",
      intent: "Confirm whether at least one fleet machine can receive the planned work.",
      toolName: "fleet",
      input: {
        machineId: "local",
        action: "capabilities",
        timeoutMs: 15_000,
      },
      stopCondition: "Fleet capability status is known for the selected machine.",
    },
    {
      title: "Prepare workspace terminal",
      intent: "Open an approved terminal lane in the workspace only after policy approval.",
      toolName: "terminal",
      input: {
        app: "ghostty",
        dir: root,
        commands: ["pwd"],
        allPanes: false,
      },
      stopCondition: "The terminal transcript shows the workspace path and command status.",
    },
  ];

  return {
    title,
    summary: "Fallback dry-run plan generated locally without a model call.",
    stopConditions: [
      "Every planned step has a persisted run step.",
      "Mutating capabilities are routed through approval or policy gates before execution.",
      "No OS input is executed during this dry run.",
    ],
    steps: steps.slice(0, maxSteps),
  };
}

function clampMaxSteps(value: number | undefined): number {
  if (!Number.isFinite(value)) return Math.min(8, MAX_PLANNER_STEPS);
  return Math.max(1, Math.min(MAX_PLANNER_STEPS, Math.trunc(value!)));
}

function inferAiSdkModelName(model: LanguageModel | undefined): string {
  return typeof model === "string" ? model : "ai-sdk-model";
}

const AVAILABLE_PLANNER_TOOLS = [
  "computer",
  "browser",
  "terminal",
  "app",
  "fleet",
  "storage",
  "memory",
  "approval",
  "observation",
] as const satisfies readonly PlannerToolName[];
