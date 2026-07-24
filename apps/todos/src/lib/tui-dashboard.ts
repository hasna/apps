import type { Database, SQLQueryBindings } from "bun:sqlite";
import { listInboxItems, type InboxItem } from "../db/inbox.js";
import { listPlans } from "../db/plans.js";
import { listProjects } from "../db/projects.js";
import { listTaskRuns, type TaskRun } from "../db/task-runs.js";
import { countTasks, listTasks } from "../db/tasks.js";
import { getDatabase } from "../db/database.js";
import { searchTasks } from "./search.js";
import type { Plan, Project, Task, TaskStatus } from "../types/index.js";

export type TuiDashboardView = "overview" | "projects" | "tasks" | "plans" | "runs" | "dependencies" | "inbox" | "search";

export const TUI_DASHBOARD_VIEWS: TuiDashboardView[] = ["overview", "projects", "tasks", "plans", "runs", "dependencies", "inbox", "search"];

export interface TuiDashboardProject extends Pick<Project, "id" | "name" | "path"> {
  open_tasks: number;
}

export interface TuiDashboardPlan extends Pick<Plan, "id" | "name" | "status" | "project_id"> {
  open_tasks: number;
}

export interface TuiDashboardDependency {
  task_id: string;
  task_title: string;
  task_status: TaskStatus;
  depends_on: string;
  depends_on_title: string;
  depends_on_status: TaskStatus;
  blocking: boolean;
}

export interface TuiDashboardSnapshot {
  generated_at: string;
  local_only: true;
  project_id: string | null;
  active_view: TuiDashboardView;
  keymap: string[];
  counts: Record<TaskStatus | "total", number>;
  projects: TuiDashboardProject[];
  tasks: Task[];
  plans: TuiDashboardPlan[];
  runs: TaskRun[];
  dependencies: TuiDashboardDependency[];
  inbox: InboxItem[];
  search: {
    query: string;
    total: number;
    results: Task[];
  };
}

export interface CreateTuiDashboardSnapshotOptions {
  project_id?: string;
  search?: string;
  active_view?: TuiDashboardView;
  limit?: number;
}

const TASK_STATUSES: TaskStatus[] = ["pending", "in_progress", "completed", "failed", "cancelled"];
const DEFAULT_LIMIT = 8;

function limited(value: number | undefined): number {
  const parsed = Number.isFinite(value) ? value! : DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed || DEFAULT_LIMIT, 25));
}

function projectFilter(projectId: string | undefined): { project_id?: string } {
  return projectId ? { project_id: projectId } : {};
}

function dependencyRows(projectId: string | undefined, limit: number, db: Database): TuiDashboardDependency[] {
  const where: string[] = ["t.archived_at IS NULL", "dep.archived_at IS NULL"];
  const params: SQLQueryBindings[] = [];
  if (projectId) {
    where.push("t.project_id = ?");
    params.push(projectId);
  }
  params.push(limit);
  return db.query(
    `SELECT
       td.task_id,
       t.title AS task_title,
       t.status AS task_status,
       td.depends_on,
       dep.title AS depends_on_title,
       dep.status AS depends_on_status
     FROM task_dependencies td
     JOIN tasks t ON t.id = td.task_id
     JOIN tasks dep ON dep.id = td.depends_on
     WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN dep.status = 'completed' THEN 1 ELSE 0 END, t.priority, t.created_at DESC
     LIMIT ?`,
  ).all(...params).map((row) => {
    const item = row as Omit<TuiDashboardDependency, "blocking">;
    return { ...item, blocking: item.depends_on_status !== "completed" };
  });
}

export function createTuiDashboardSnapshot(options: CreateTuiDashboardSnapshotOptions = {}, db?: Database): TuiDashboardSnapshot {
  const d = getDatabase(db);
  const limit = limited(options.limit);
  const filter = projectFilter(options.project_id);
  const counts = TASK_STATUSES.reduce((acc, status) => {
    acc[status] = countTasks({ ...filter, status }, d);
    return acc;
  }, { total: 0 } as Record<TaskStatus | "total", number>);
  counts.total = TASK_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  const projectRows = listProjects(d)
    .filter(project => !options.project_id || project.id === options.project_id)
    .slice(0, limit)
    .map(project => ({
      id: project.id,
      name: project.name,
      path: project.path,
      open_tasks: countTasks({ project_id: project.id, status: ["pending", "in_progress"] }, d),
    }));

  const plans = listPlans(options.project_id, d).slice(0, limit).map(plan => ({
    id: plan.id,
    name: plan.name,
    status: plan.status,
    project_id: plan.project_id,
    open_tasks: countTasks({ plan_id: plan.id, status: ["pending", "in_progress"] }, d),
  }));

  const taskRows = listTasks({ ...filter, status: ["pending", "in_progress"], limit }, d);
  const projectTaskIds = new Set(options.project_id ? listTasks({ project_id: options.project_id, include_archived: true }, d).map(task => task.id) : []);
  const runs = listTaskRuns(undefined, d)
    .filter(run => !options.project_id || projectTaskIds.has(run.task_id))
    .slice(0, limit);
  const inbox = listInboxItems({ limit }, d);
  const searchResults = options.search
    ? searchTasks({ query: options.search, project_id: options.project_id }, undefined, undefined, d).slice(0, limit)
    : [];

  return {
    generated_at: new Date().toISOString(),
    local_only: true,
    project_id: options.project_id ?? null,
    active_view: options.active_view || "overview",
    keymap: [
      "q quit",
      "r refresh",
      "h/left previous tab",
      "l/right next tab",
      "1-8 jump tabs",
      "/ search",
    ],
    counts,
    projects: projectRows,
    tasks: taskRows,
    plans,
    runs,
    dependencies: dependencyRows(options.project_id, limit, d),
    inbox,
    search: {
      query: options.search || "",
      total: searchResults.length,
      results: searchResults,
    },
  };
}

function lineId(id: string): string {
  return id.slice(0, 8);
}

export function renderTuiDashboardSnapshot(snapshot: TuiDashboardSnapshot): string {
  const lines = [
    "# todos terminal dashboard",
    "",
    `View: ${snapshot.active_view}`,
    `Local only: ${snapshot.local_only}`,
    `Keys: ${snapshot.keymap.join(" | ")}`,
    "",
    `Tasks: ${snapshot.counts.pending} pending | ${snapshot.counts.in_progress} active | ${snapshot.counts.completed} done | ${snapshot.counts.failed} failed | ${snapshot.counts.total} total`,
    "",
    "## Projects",
    ...snapshot.projects.map(project => `- ${lineId(project.id)} ${project.name} (${project.open_tasks} open) ${project.path}`),
    "",
    "## Tasks",
    ...snapshot.tasks.map(task => `- ${lineId(task.id)} [${task.status}] ${task.priority} ${task.title}`),
    "",
    "## Plans",
    ...snapshot.plans.map(plan => `- ${lineId(plan.id)} [${plan.status}] ${plan.name} (${plan.open_tasks} open)`),
    "",
    "## Runs",
    ...snapshot.runs.map(run => `- ${lineId(run.id)} [${run.status}] ${run.title || run.task_id}`),
    "",
    "## Dependencies",
    ...snapshot.dependencies.map(dep => `- ${lineId(dep.task_id)} waits on ${lineId(dep.depends_on)} [${dep.depends_on_status}]${dep.blocking ? " blocking" : ""}`),
    "",
    "## Inbox",
    ...snapshot.inbox.map(item => `- ${lineId(item.id)} [${item.status}] ${item.title}`),
    "",
    "## Search",
    snapshot.search.query ? `Query: ${snapshot.search.query}` : "Query: (none)",
    ...snapshot.search.results.map(task => `- ${lineId(task.id)} [${task.status}] ${task.title}`),
    "",
  ];
  return lines.join("\n");
}
