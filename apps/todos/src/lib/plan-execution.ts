/**
 * First-class plan execution mode — attach plans to projects, materialize steps,
 * claim/execute one step at a time, track progress. Portable contract for hosted bridge.
 */

import type { Database } from "bun:sqlite";
import { createPlan, getPlan, listPlans } from "../db/plans.js";
import { createTask, getTask, listTasks, claimNextTask, decomposeTasks } from "../db/tasks.js";
import { addComment } from "../db/comments.js";
import { getDatabase, now } from "../db/database.js";
import { getReadyTasks } from "./dependency-graph.js";
import type { Task, TaskPriority } from "../types/index.js";

export const PLAN_EXECUTION_SCHEMA = "todos.plan_execution.v1";

export const PLAN_EXECUTION_MODES = ["sequential", "parallel"] as const;
export type PlanExecutionMode = (typeof PLAN_EXECUTION_MODES)[number];

export interface PlanStepInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  estimated_minutes?: number;
  tags?: string[];
}

export interface PlanExecutionManifest {
  schema_version: typeof PLAN_EXECUTION_SCHEMA;
  plan_id: string;
  plan_name: string;
  project_id: string | null;
  execution_mode: PlanExecutionMode;
  root_task_id: string;
  step_task_ids: string[];
  created_at: string;
}

export interface PlanExecutionState {
  schema_version: typeof PLAN_EXECUTION_SCHEMA;
  plan_id: string;
  plan_name: string;
  project_id: string | null;
  execution_mode: PlanExecutionMode;
  plan_status: string;
  total_steps: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  percent_complete: number;
  current_step: Task | null;
  ready_steps: Task[];
  steps: Array<{ id: string; title: string; status: string; short_id: string | null; position: number }>;
}

export interface AttachPlanInput {
  plan_id: string;
  project_id: string;
  execution_mode?: PlanExecutionMode;
}

export interface MaterializePlanInput {
  plan_id: string;
  steps: PlanStepInput[];
  execution_mode?: PlanExecutionMode;
  agent_id?: string;
}


export function resolvePlanRef(planRef: string, db?: Database): string | null {
  const d = db || getDatabase();
  const byId = getPlan(planRef, d);
  if (byId) return byId.id;
  const normalized = planRef.toLowerCase();
  const match = listPlans(undefined, d).find(
    (p) => p.name.toLowerCase() === normalized || p.name.toLowerCase().replace(/\s+/g, "-") === normalized,
  );
  return match?.id ?? null;
}

function getPlanSteps(planId: string, db: Database): Task[] {
  return listTasks({ plan_id: planId }, db)
    .filter((t) => t.tags.includes("plan-step"))
    .sort((a, b) => {
      const pa = (a.metadata?.position as number) ?? 0;
      const pb = (b.metadata?.position as number) ?? 0;
      return pa - pb;
    });
}

function getExecutionMode(planId: string, db: Database): PlanExecutionMode {
  const root = listTasks({ plan_id: planId }, db).find((t) => t.tags.includes("plan-root"));
  const mode = root?.metadata?.execution_mode;
  return mode === "parallel" ? "parallel" : "sequential";
}

export function attachPlanToProject(input: AttachPlanInput, db?: Database): PlanExecutionManifest {
  const d = db || getDatabase();
  const plan = getPlan(input.plan_id, d);
  if (!plan) throw new Error(`Plan not found: ${input.plan_id}`);

  d.run("UPDATE plans SET project_id = ?, updated_at = ? WHERE id = ?", [input.project_id, now(), plan.id]);

  const existingRoot = listTasks({ plan_id: plan.id }, d).find((t) => t.tags.includes("plan-root"));
  if (existingRoot) {
    const steps = getPlanSteps(plan.id, d);
    return {
      schema_version: PLAN_EXECUTION_SCHEMA,
      plan_id: plan.id,
      plan_name: plan.name,
      project_id: input.project_id,
      execution_mode: getExecutionMode(plan.id, d),
      root_task_id: existingRoot.id,
      step_task_ids: steps.map((s) => s.id),
      created_at: existingRoot.created_at,
    };
  }

  const mode = input.execution_mode ?? "sequential";
  const root = createTask({
    title: `Plan: ${plan.name}`,
    description: plan.description ?? undefined,
    project_id: input.project_id,
    plan_id: plan.id,
    priority: "high",
    tags: ["plan-root"],
    metadata: {
      execution_mode: mode,
      plan_execution: { schema_version: PLAN_EXECUTION_SCHEMA, plan_id: plan.id },
    },
  }, d);

  return {
    schema_version: PLAN_EXECUTION_SCHEMA,
    plan_id: plan.id,
    plan_name: plan.name,
    project_id: input.project_id,
    execution_mode: mode,
    root_task_id: root.id,
    step_task_ids: [],
    created_at: root.created_at,
  };
}

export function materializePlanSteps(input: MaterializePlanInput, db?: Database): PlanExecutionManifest {
  const d = db || getDatabase();
  const plan = getPlan(input.plan_id, d);
  if (!plan) throw new Error(`Plan not found: ${input.plan_id}`);
  if (input.steps.length === 0) throw new Error("At least one plan step is required");

  const mode = input.execution_mode ?? getExecutionMode(plan.id, d);
  let root = listTasks({ plan_id: plan.id }, d).find((t) => t.tags.includes("plan-root"));
  if (!root) {
    const manifest = attachPlanToProject(
      { plan_id: plan.id, project_id: plan.project_id ?? "", execution_mode: mode },
      d,
    );
    root = getTask(manifest.root_task_id, d)!;
  }

  const { subtasks } = decomposeTasks(
    root.id,
    input.steps.map((s, i) => ({
      title: s.title,
      description: s.description,
      priority: s.priority,
      estimated_minutes: s.estimated_minutes,
      tags: [...(s.tags ?? []), "plan-step"],
      metadata: { position: i + 1, plan_execution: { schema_version: PLAN_EXECUTION_SCHEMA } },
    })),
    { depends_on_prev: mode === "sequential" },
    d,
  );

  for (const task of subtasks) {
    d.run("UPDATE tasks SET plan_id = ?, project_id = COALESCE(project_id, ?) WHERE id = ?", [
      plan.id,
      plan.project_id,
      task.id,
    ]);
  }

  return {
    schema_version: PLAN_EXECUTION_SCHEMA,
    plan_id: plan.id,
    plan_name: plan.name,
    project_id: plan.project_id,
    execution_mode: mode,
    root_task_id: root.id,
    step_task_ids: subtasks.map((t) => t.id),
    created_at: now(),
  };
}

export function getPlanExecutionState(planRef: string, db?: Database): PlanExecutionState | null {
  const d = db || getDatabase();
  const planId = resolvePlanRef(planRef, d);
  if (!planId) return null;

  const plan = getPlan(planId, d)!;
  const steps = getPlanSteps(planId, d);
  const pending = steps.filter((t) => t.status === "pending");
  const inProgress = steps.filter((t) => t.status === "in_progress");
  const completed = steps.filter((t) => t.status === "completed");
  const failed = steps.filter((t) => t.status === "failed");

  const ready = getReadyTasks({ plan_id: planId, limit: 20 }, d).map((r) => getTask(r.task.id, d)!);

  const current = inProgress[0] ?? pending[0] ?? null;
  const total = steps.length;
  const done = completed.length;

  return {
    schema_version: PLAN_EXECUTION_SCHEMA,
    plan_id: planId,
    plan_name: plan.name,
    project_id: plan.project_id,
    execution_mode: getExecutionMode(planId, d),
    plan_status: plan.status,
    total_steps: total,
    pending: pending.length,
    in_progress: inProgress.length,
    completed: completed.length,
    failed: failed.length,
    percent_complete: total > 0 ? Math.round((done / total) * 100) : 0,
    current_step: current,
    ready_steps: ready,
    steps: steps.map((t, i) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      short_id: t.short_id,
      position: (t.metadata?.position as number) ?? i + 1,
    })),
  };
}

export function claimPlanStep(planRef: string, agentId: string, db?: Database): Task | null {
  const d = db || getDatabase();
  const planId = resolvePlanRef(planRef, d);
  if (!planId) return null;

  const plan = getPlan(planId, d);
  const claimed = claimNextTask(agentId, {
    project_id: plan?.project_id ?? undefined,
    plan_id: planId,
    tags: ["plan-step"],
  }, d);
  if (!claimed) return null;

  addComment({
    task_id: claimed.id,
    content: `Plan step claimed by ${agentId}`,
    agent_id: agentId,
  }, d);
  return claimed;
}

export function exportPlanExecutionContract(planRef: string, db?: Database): Record<string, unknown> | null {
  const state = getPlanExecutionState(planRef, db);
  if (!state) return null;
  return {
    ...state,
    exported_at: new Date().toISOString(),
    portable: true,
  };
}

export function createPlanWithSteps(
  name: string,
  steps: PlanStepInput[],
  opts: { project_id?: string; execution_mode?: PlanExecutionMode; agent_id?: string } = {},
  db?: Database,
): PlanExecutionManifest {
  const d = db || getDatabase();
  const plan = createPlan({
    name,
    project_id: opts.project_id,
    agent_id: opts.agent_id,
    status: "active",
  }, d);

  if (opts.project_id) {
    attachPlanToProject({ plan_id: plan.id, project_id: opts.project_id, execution_mode: opts.execution_mode }, d);
  }

  return materializePlanSteps({
    plan_id: plan.id,
    steps,
    execution_mode: opts.execution_mode,
    agent_id: opts.agent_id,
  }, d);
}
