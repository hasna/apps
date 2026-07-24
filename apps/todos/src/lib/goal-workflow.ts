/**
 * /goal-style workflow: translate a goal into a plan + tasks, claim steps,
 * track progress, and produce deterministic handoffs — local-only, no hosted calls.
 */

import type { Database } from "bun:sqlite";
import { createPlan, getPlan, listPlans } from "../db/plans.js";
import { createTask, listTasks, claimNextTask } from "../db/tasks.js";
import { decomposeTasks } from "../db/tasks.js";
import { addComment, listComments } from "../db/comments.js";
import { createHandoff } from "../db/handoffs.js";
import { getDatabase } from "../db/database.js";
import type { Task, TaskPriority } from "../types/index.js";

export const GOAL_WORKFLOW_VERSION = "todos.goal-workflow.v1";

export interface GoalStep {
  title: string;
  description?: string;
  priority?: TaskPriority;
  estimated_minutes?: number;
  tags?: string[];
}

export interface GoalInput {
  goal: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  steps?: GoalStep[];
  /** Chain steps sequentially with dependencies (default true) */
  sequential?: boolean;
}

export interface GoalManifest {
  schema_version: typeof GOAL_WORKFLOW_VERSION;
  goal: string;
  plan_id: string;
  plan_name: string;
  root_task_id: string;
  step_task_ids: string[];
  project_id: string | null;
  agent_id: string | null;
  created_at: string;
}

export interface GoalProgress {
  plan_id: string;
  goal: string;
  total_steps: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  current_step: Task | null;
  steps: Array<{ id: string; title: string; status: string; short_id: string | null }>;
}

export interface ParsedGoalCommand {
  action: "execute" | "status" | "handoff" | "create" | "unknown";
  target: string;
  raw: string;
}

/** Command recipes for Codex, Claude Code, Takumi, and MCP agents */
export const GOAL_COMMAND_RECIPES = [
  {
    host: "codex|claude-code|takumi|mcp",
    command: "/goal execute <plan-name>",
    description: "Claim and start the next ready step for a goal plan",
    equivalent_cli: "todos goal execute <plan-name> --agent <name>",
  },
  {
    host: "codex|claude-code|takumi|mcp",
    command: "/goal create \"<goal text>\" --steps step1,step2,step3",
    description: "Create a plan and decompose into sequential tasks",
    equivalent_cli: "todos goal create \"<goal>\" --step \"step1\" --step \"step2\"",
  },
  {
    host: "codex|claude-code|takumi|mcp",
    command: "/goal status <plan-name>",
    description: "Show plan progress and current step",
    equivalent_cli: "todos goal status <plan-name>",
  },
  {
    host: "codex|claude-code|takumi|mcp",
    command: "/goal handoff <plan-name>",
    description: "Produce JSON/Markdown handoff packet for session transfer",
    equivalent_cli: "todos goal handoff <plan-name> --format md",
  },
] as const;

export function parseGoalCommand(command: string): ParsedGoalCommand {
  const trimmed = command.trim().replace(/^\/goal\s+/i, "");
  const [actionRaw, ...rest] = trimmed.split(/\s+/);
  const action = (actionRaw?.toLowerCase() ?? "") as ParsedGoalCommand["action"];
  const valid = new Set(["execute", "status", "handoff", "create"]);
  return {
    action: valid.has(action) ? action : "unknown",
    target: rest.join(" ").trim(),
    raw: command,
  };
}

function defaultStepsFromGoal(goal: string): GoalStep[] {
  const lines = goal.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.map((title) => ({ title }));
  }
  return [{ title: goal }];
}

export function resolvePlanId(planRef: string, db?: Database): string | null {
  const d = getDatabase(db);
  const byId = getPlan(planRef, d);
  if (byId) return byId.id;
  const normalized = planRef.toLowerCase();
  const match = listPlans(undefined, d).find(
    (p) => p.name.toLowerCase() === normalized || p.name.toLowerCase().replace(/\s+/g, "-") === normalized,
  );
  return match?.id ?? null;
}

export function createGoalWorkflow(input: GoalInput, db?: Database): GoalManifest {
  const d = getDatabase(db);
  const steps = input.steps?.length ? input.steps : defaultStepsFromGoal(input.goal);
  const planName = input.goal.split("\n")[0]!.slice(0, 120);

  const plan = createPlan({
    name: planName,
    description: input.goal,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    status: "active",
  }, d);

  const root = createTask({
    title: `Goal: ${planName}`,
    description: input.goal,
    project_id: input.project_id,
    plan_id: plan.id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    priority: "high",
    tags: ["goal", "goal-root"],
    metadata: { _goal: { schema_version: GOAL_WORKFLOW_VERSION, plan_id: plan.id } },
  }, d);

  const { subtasks } = decomposeTasks(
    root.id,
    steps.map((s) => ({
      title: s.title,
      description: s.description,
      priority: s.priority,
      estimated_minutes: s.estimated_minutes,
      tags: [...(s.tags ?? []), "goal-step"],
    })),
    { depends_on_prev: input.sequential !== false },
    d,
  );

  // Link subtasks to plan
  for (const task of subtasks) {
    d.run("UPDATE tasks SET plan_id = ? WHERE id = ?", [plan.id, task.id]);
  }

  return {
    schema_version: GOAL_WORKFLOW_VERSION,
    goal: input.goal,
    plan_id: plan.id,
    plan_name: plan.name,
    root_task_id: root.id,
    step_task_ids: subtasks.map((t) => t.id),
    project_id: input.project_id ?? null,
    agent_id: input.agent_id ?? null,
    created_at: plan.created_at,
  };
}

export function getGoalProgress(planRef: string, db?: Database): GoalProgress | null {
  const d = getDatabase(db);
  const planId = resolvePlanId(planRef, d);
  if (!planId) return null;

  const plan = getPlan(planId, d)!;
  const steps = listTasks({ plan_id: planId }, d).filter(
    (t) => t.tags.includes("goal-step") || t.parent_id,
  );
  const stepTasks = steps.filter((t) => t.tags.includes("goal-step"));
  const tasks = stepTasks.length > 0 ? stepTasks : steps;

  const pending = tasks.filter((t) => t.status === "pending").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const current = tasks.find((t) => t.status === "in_progress")
    ?? tasks.find((t) => t.status === "pending")
    ?? null;

  return {
    plan_id: planId,
    goal: plan.description || plan.name,
    total_steps: tasks.length,
    pending,
    in_progress: inProgress,
    completed,
    failed,
    current_step: current,
    steps: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      short_id: t.short_id,
    })),
  };
}

export function claimGoalStep(planRef: string, agentId: string, db?: Database): Task | null {
  const d = getDatabase(db);
  const planId = resolvePlanId(planRef, d);
  if (!planId) return null;

  const claimed = claimNextTask(agentId, { project_id: getPlan(planId, d)?.project_id ?? undefined, plan_id: planId, tags: ["goal-step"] }, d);
  if (!claimed) return null;

  addComment({ task_id: claimed.id, content: `Goal step claimed by ${agentId} via /goal execute`, agent_id: agentId }, d);
  return claimed;
}

export function logGoalProgress(
  taskId: string,
  message: string,
  agentId?: string,
  pctComplete?: number,
  db?: Database,
): void {
  const d = getDatabase(db);
  const prefix = pctComplete !== undefined ? `[${pctComplete}%] ` : "";
  addComment({ task_id: taskId, content: `${prefix}${message}`, agent_id: agentId }, d);
}

export function formatGoalHandoff(
  planRef: string,
  format: "json" | "markdown" = "json",
  agentId?: string,
  db?: Database,
): string | null {
  const d = getDatabase(db);
  const progress = getGoalProgress(planRef, d);
  if (!progress) return null;

  const completed = progress.steps.filter((s) => s.status === "completed").map((s) => s.title);
  const inProgress = progress.steps.filter((s) => s.status === "in_progress").map((s) => s.title);
  const blockers = progress.steps.filter((s) => s.status === "failed").map((s) => s.title);
  const nextSteps = progress.steps.filter((s) => s.status === "pending").slice(0, 3).map((s) => s.title);

  const handoff = createHandoff({
    agent_id: agentId,
    project_id: getPlan(progress.plan_id, d)?.project_id ?? undefined,
    summary: `Goal handoff: ${progress.goal.slice(0, 200)}`,
    completed,
    in_progress: inProgress,
    blockers,
    next_steps: nextSteps,
  }, d);

  const packet = {
    schema_version: GOAL_WORKFLOW_VERSION,
    handoff_id: handoff.id,
    ...progress,
    comments: progress.current_step
      ? listComments(progress.current_step.id, d).slice(0, 10)
      : [],
  };

  if (format === "markdown") {
    const lines = [
      `# Goal Handoff`,
      ``,
      `**Goal:** ${progress.goal}`,
      `**Plan:** ${progress.plan_id.slice(0, 8)}`,
      ``,
      `## Progress (${progress.completed}/${progress.total_steps} done)`,
      ...progress.steps.map((s) => `- [${s.status === "completed" ? "x" : " "}] ${s.short_id || s.id.slice(0, 8)} ${s.title} (${s.status})`),
      ``,
      `## Completed`,
      ...completed.map((c) => `- ${c}`),
      `## In Progress`,
      ...inProgress.map((c) => `- ${c}`),
      `## Next`,
      ...nextSteps.map((c) => `- ${c}`),
    ];
    return lines.join("\n");
  }

  return JSON.stringify(packet, null, 2);
}

export function getGoalCommandRecipesMarkdown(): string {
  return [
    "# /goal Command Recipes (local-only)",
    "",
    "Primary agent surfaces: CLI, MCP, SDK. No hosted API calls.",
    "",
    ...GOAL_COMMAND_RECIPES.map(
      (r) => `## ${r.command}\n\n${r.description}\n\nCLI equivalent: \`${r.equivalent_cli}\`\n`,
    ),
  ].join("\n");
}
