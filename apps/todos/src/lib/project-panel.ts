import type { Database } from "bun:sqlite";
import {
  parseContract,
  SCHEMA_IDS,
  type ProjectPanel,
  type ProjectPanelInput,
} from "@hasna/contracts";
import { getPlan, listPlans } from "../db/plans.js";
import { getProject, slugify } from "../db/projects.js";
import { getTaskWithRelations, listTasks } from "../db/task-crud.js";
import { getDatabase, now } from "../db/database.js";
import type { Project, Task, TaskPriority, TaskStatus } from "../types/index.js";

export interface TodosProjectPanelOptions {
  limit?: number;
  db?: Database;
}

const SOURCE_PACKAGE = "@hasna/todos";
const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 20)));
}

function taskUri(id: string): string {
  return `todo://tasks/${id}`;
}

function taskResource(task: Task) {
  return {
    kind: "task" as const,
    id: task.id,
    name: task.title,
    uri: taskUri(task.id),
    externalId: task.id,
    sourcePackage: SOURCE_PACKAGE,
    tags: task.tags,
  };
}

function planResource(id: string, name?: string | null) {
  return {
    kind: "workflow" as const,
    id,
    name: name ?? undefined,
    externalId: id,
    sourcePackage: SOURCE_PACKAGE,
  };
}

function projectResource(project: Project) {
  const projectSlug = projectSlugForPanel(project);
  return {
    kind: "project" as const,
    id: projectSlug,
    name: project.name,
    uri: `project://${projectSlug}`,
    externalId: project.id,
    sourcePackage: SOURCE_PACKAGE,
  };
}

function projectSlugForPanel(project: Project): string {
  const taskListSlug = project.task_list_id?.replace(/^todos-/, "");
  return taskListSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskListSlug)
    ? taskListSlug
    : slugify(project.name) || project.id.toLowerCase();
}

function countByStatus(tasks: Task[]): Record<TaskStatus, number> {
  return {
    pending: tasks.filter((task) => task.status === "pending").length,
    in_progress: tasks.filter((task) => task.status === "in_progress").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
  };
}

function countByPriority(tasks: Task[]): Record<TaskPriority, number> {
  return {
    critical: tasks.filter((task) => task.priority === "critical").length,
    high: tasks.filter((task) => task.priority === "high").length,
    medium: tasks.filter((task) => task.priority === "medium").length,
    low: tasks.filter((task) => task.priority === "low").length,
  };
}

function isOverdue(task: Task, generatedAt: string): boolean {
  if (!task.due_at || TERMINAL_STATUSES.has(task.status)) return false;
  const due = Date.parse(task.due_at);
  return Number.isFinite(due) && due < Date.parse(generatedAt);
}

function taskSummary(task: Task, blockers: Task[]): string | undefined {
  if (blockers.length > 0) {
    return `Blocked by ${blockers.map((blocker) => blocker.id.slice(0, 8)).join(", ")}`;
  }
  const firstLine = task.description?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine || undefined;
}

function priorityRank(priority: TaskPriority): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority];
}

function sortActionableTasks(a: Task, b: Task): number {
  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;
  return b.updated_at.localeCompare(a.updated_at);
}

export function createTodosProjectPanel(projectId: string, options: TodosProjectPanelOptions = {}): ProjectPanel {
  const db = options.db ?? getDatabase();
  const limit = clampLimit(options.limit);
  const project = getProject(projectId, db);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const generatedAt = now();
  const projectSlug = projectSlugForPanel(project);
  const tasks = listTasks({ project_id: project.id, include_archived: false }, db);
  const plans = listPlans(project.id, db);
  const activePlans = plans.filter((plan) => plan.status === "active");
  const statusCounts = countByStatus(tasks);
  const priorityCounts = countByPriority(tasks);

  const relations = tasks
    .map((task) => getTaskWithRelations(task.id, db))
    .filter((task): task is NonNullable<ReturnType<typeof getTaskWithRelations>> => task !== null);
  const blockersByTask = new Map<string, Task[]>();
  for (const task of relations) {
    const blockers = task.dependencies.filter((dep) => !TERMINAL_STATUSES.has(dep.status));
    if (blockers.length > 0) blockersByTask.set(task.id, blockers);
  }

  const blockedTasks = tasks.filter((task) => blockersByTask.has(task.id) && !TERMINAL_STATUSES.has(task.status));
  const overdueTasks = tasks.filter((task) => isOverdue(task, generatedAt));
  const activeTasks = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status));
  const completedRate = tasks.length === 0 ? 0 : Math.round((statusCounts.completed / tasks.length) * 100);

  const selected = new Map<string, Task>();
  for (const task of [...blockedTasks, ...overdueTasks, ...activeTasks.sort(sortActionableTasks), ...tasks.sort(sortActionableTasks)]) {
    if (selected.size >= limit) break;
    selected.set(task.id, task);
  }

  const state = tasks.length === 0 && plans.length === 0 ? "empty" : "ready";
  const draft: ProjectPanelInput = {
    schema: SCHEMA_IDS.projectPanel,
    id: `todos_panel_${project.id}`,
    createdAt: generatedAt,
    projectId: projectSlug,
    provider: {
      kind: "todos",
      id: `todos_${projectSlug}`,
      name: "Todos",
      sourcePackage: SOURCE_PACKAGE,
      externalId: project.id,
    },
    kind: "tasks",
    title: "Todos",
    summary: tasks.length === 0
      ? "No tracked todos for this project."
      : `${activeTasks.length} active task${activeTasks.length === 1 ? "" : "s"} across ${plans.length} plan${plans.length === 1 ? "" : "s"}.`,
    state,
    generatedAt,
    freshness: "fresh",
    metrics: [
      { id: "total_tasks", label: "Total tasks", value: tasks.length, status: tasks.length > 0 ? "good" : "unknown" },
      { id: "pending_tasks", label: "Pending", value: statusCounts.pending, status: statusCounts.pending > 0 ? "warning" : "good" },
      { id: "in_progress_tasks", label: "In progress", value: statusCounts.in_progress, status: statusCounts.in_progress > 0 ? "good" : "unknown" },
      { id: "completed_tasks", label: "Completed", value: statusCounts.completed, status: "good" },
      { id: "failed_tasks", label: "Failed", value: statusCounts.failed, status: statusCounts.failed > 0 ? "critical" : "good" },
      { id: "blocked_tasks", label: "Blocked", value: blockedTasks.length, status: blockedTasks.length > 0 ? "critical" : "good" },
      { id: "overdue_tasks", label: "Overdue", value: overdueTasks.length, status: overdueTasks.length > 0 ? "critical" : "good" },
      { id: "active_plans", label: "Active plans", value: activePlans.length, status: activePlans.length > 0 ? "good" : "unknown" },
      { id: "completion_rate", label: "Completion", value: completedRate, unit: "%", status: completedRate >= 80 ? "good" : "warning" },
      { id: "critical_priority", label: "Critical priority", value: priorityCounts.critical, status: priorityCounts.critical > 0 ? "critical" : "good" },
    ],
    items: [...selected.values()].map((task) => ({
      id: task.id,
      title: task.title,
      summary: taskSummary(task, blockersByTask.get(task.id) ?? []),
      status: task.status,
      priority: task.priority,
      timestamp: task.updated_at,
      resourceRefs: [
        taskResource(task),
        ...(task.plan_id ? [planResource(task.plan_id, getPlan(task.plan_id, db)?.name)] : []),
      ],
      metadata: {
        due_at: task.due_at,
        assigned_to: task.assigned_to,
        blocked: blockersByTask.has(task.id),
        overdue: isOverdue(task, generatedAt),
      },
    })),
    actions: [
      { kind: "action", id: "todos:create-task", name: "Create task", sourcePackage: SOURCE_PACKAGE, externalId: "create-task" },
      { kind: "action", id: "todos:list-tasks", name: "List tasks", sourcePackage: SOURCE_PACKAGE, externalId: "list-tasks" },
    ],
    resourceRefs: [
      projectResource(project),
      ...activePlans.slice(0, limit).map((plan) => planResource(plan.id, plan.name)),
    ],
    renderFragment: {
      renderer: "json_render",
      title: "Todos",
      spec: {
        component: "project.tasks.summary",
        metrics: ["pending_tasks", "in_progress_tasks", "blocked_tasks", "overdue_tasks", "completion_rate"],
        itemLimit: limit,
      },
    },
  };

  return parseContract(SCHEMA_IDS.projectPanel, draft);
}
