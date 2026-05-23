/**
 * Terminal dashboard state — keyboard workflows, filters, read-only safe mode.
 * Logic layer testable without Ink rendering.
 */

import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { listProjects } from "../db/projects.js";
import { listPlans } from "../db/plans.js";
import { listTasks, countTasks, claimNextTask, startTask, completeTask } from "../db/tasks.js";
import { addComment } from "../db/comments.js";
import { listAgents } from "../db/agents.js";
import { getRecap } from "../db/audit.js";
import { getBlockedTaskReports, getReadyTasks } from "./dependency-graph.js";
import { listRunRecords } from "./run-records.js";
import type { Task } from "../types/index.js";

export const TUI_DASHBOARD_SCHEMA = "todos.tui_dashboard.v1";

export type DashboardPanel = "overview" | "tasks" | "blockers" | "agents" | "plans";
export type DashboardFilter = "all" | "pending" | "in_progress" | "blocked" | "ready";

export interface DashboardState {
  schema_version: typeof TUI_DASHBOARD_SCHEMA;
  panel: DashboardPanel;
  filter: DashboardFilter;
  selectedIndex: number;
  readOnly: boolean;
  projectId?: string;
}

export type DashboardAction =
  | { type: "nav_up" }
  | { type: "nav_down" }
  | { type: "panel_next" }
  | { type: "panel_prev" }
  | { type: "set_filter"; filter: DashboardFilter }
  | { type: "set_project"; projectId?: string }
  | { type: "select_index"; index: number };

export type DashboardTaskAction = "claim" | "start" | "done" | "comment";

export interface DashboardTaskRow {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  plan_id: string | null;
}

export interface DashboardData {
  schema_version: typeof TUI_DASHBOARD_SCHEMA;
  loaded_at: string;
  counts: { pending: number; in_progress: number; completed: number; failed: number; total: number };
  tasks: DashboardTaskRow[];
  blocked: DashboardTaskRow[];
  ready: DashboardTaskRow[];
  agents: Array<{ id: string; name: string; last_seen_at: string }>;
  plans: Array<{ id: string; name: string; status: string; task_count: number }>;
  runs_active: number;
  in_progress_titles: string[];
}

export const DASHBOARD_PANELS: DashboardPanel[] = ["overview", "tasks", "blockers", "agents", "plans"];

export const KEYBOARD_HELP = [
  "j/k or arrows: navigate",
  "Tab/Shift+Tab: switch panel",
  "f: cycle filter",
  "c: claim next ready",
  "s: start selected",
  "d: done selected",
  "m: comment on selected",
  "r: refresh",
  "q: quit",
];

export function initialDashboardState(opts: { projectId?: string; readOnly?: boolean } = {}): DashboardState {
  return {
    schema_version: TUI_DASHBOARD_SCHEMA,
    panel: "overview",
    filter: "all",
    selectedIndex: 0,
    readOnly: !!opts.readOnly,
    projectId: opts.projectId,
  };
}

export function reduceDashboardState(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "nav_up":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "nav_down":
      return { ...state, selectedIndex: state.selectedIndex + 1 };
    case "panel_next": {
      const idx = DASHBOARD_PANELS.indexOf(state.panel);
      return { ...state, panel: DASHBOARD_PANELS[(idx + 1) % DASHBOARD_PANELS.length]!, selectedIndex: 0 };
    }
    case "panel_prev": {
      const idx = DASHBOARD_PANELS.indexOf(state.panel);
      return { ...state, panel: DASHBOARD_PANELS[(idx - 1 + DASHBOARD_PANELS.length) % DASHBOARD_PANELS.length]!, selectedIndex: 0 };
    }
    case "set_filter": {
      const filters: DashboardFilter[] = ["all", "pending", "in_progress", "blocked", "ready"];
      const next = action.filter ?? filters[(filters.indexOf(state.filter) + 1) % filters.length]!;
      return { ...state, filter: next, selectedIndex: 0 };
    }
    case "set_project":
      return { ...state, projectId: action.projectId, selectedIndex: 0 };
    case "select_index":
      return { ...state, selectedIndex: Math.max(0, action.index) };
    default:
      return state;
  }
}

function toRow(t: Task): DashboardTaskRow {
  return {
    id: t.id,
    short_id: t.short_id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigned_to: t.assigned_to,
    plan_id: t.plan_id,
  };
}

export function loadDashboardData(state: DashboardState, db?: Database): DashboardData {
  const d = db || getDatabase();
  const filters = state.projectId ? { project_id: state.projectId } : {};

  const pending = countTasks({ ...filters, status: "pending" }, d);
  const in_progress = countTasks({ ...filters, status: "in_progress" }, d);
  const completed = countTasks({ ...filters, status: "completed" }, d);
  const failed = countTasks({ ...filters, status: "failed" }, d);

  let tasks = listTasks(filters, d).filter((t) => t.status !== "completed" && t.status !== "cancelled");
  if (state.filter === "pending") tasks = tasks.filter((t) => t.status === "pending");
  if (state.filter === "in_progress") tasks = tasks.filter((t) => t.status === "in_progress");

  const blockedReports = getBlockedTaskReports({ project_id: state.projectId, limit: 20 }, d);
  const blocked = blockedReports.map((b) => ({
    id: b.task.id,
    short_id: b.task.short_id,
    title: b.task.title,
    status: b.task.status,
    priority: b.task.priority,
    assigned_to: null as string | null,
    plan_id: b.task.plan_id,
  }));
  if (state.filter === "blocked") tasks = blocked;

  const readyReports = getReadyTasks({ project_id: state.projectId, limit: 20 }, d);
  const ready = readyReports.map((r) => ({
    id: r.task.id,
    short_id: r.task.short_id,
    title: r.task.title,
    status: r.task.status,
    priority: r.task.priority,
    assigned_to: null as string | null,
    plan_id: r.task.plan_id,
  }));
  if (state.filter === "ready") tasks = ready;

  const recap = getRecap(1, state.projectId, d);
  const runs = listRunRecords({ status: "active", limit: 50 }, d);

  const plans = listPlans(state.projectId, d).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    task_count: countTasks({ plan_id: p.id }, d),
  }));

  return {
    schema_version: TUI_DASHBOARD_SCHEMA,
    loaded_at: new Date().toISOString(),
    counts: { pending, in_progress, completed, failed, total: pending + in_progress + completed + failed },
    tasks: tasks.slice(0, 50).map(toRow),
    blocked,
    ready,
    agents: listAgents(undefined, d).map((a) => ({ id: a.id, name: a.name, last_seen_at: a.last_seen_at })),
    plans,
    runs_active: runs.length,
    in_progress_titles: recap.in_progress.map((t) => t.title),
  };
}

export function clampSelectedIndex(state: DashboardState, data: DashboardData): DashboardState {
  const list = state.panel === "blockers" ? data.blocked
    : state.panel === "plans" ? data.plans
    : state.panel === "agents" ? data.agents
    : data.tasks;
  const max = Math.max(0, list.length - 1);
  if (state.selectedIndex > max) return { ...state, selectedIndex: max };
  return state;
}

export function executeDashboardTaskAction(
  state: DashboardState,
  action: DashboardTaskAction,
  opts: { agentId?: string; comment?: string } = {},
  db?: Database,
): { state: DashboardState; result: string; error?: string } {
  if (state.readOnly) {
    return { state, result: "skipped", error: "Read-only mode — action disabled" };
  }

  const d = db || getDatabase();
  const data = loadDashboardData(state, d);
  const list = state.panel === "blockers" ? data.blocked : data.tasks;
  const selected = list[state.selectedIndex];

  try {
    if (action === "claim") {
      const agent = opts.agentId ?? "tui";
      const task = claimNextTask(agent, { project_id: state.projectId }, d);
      return { state, result: task ? `claimed:${task.id}` : "nothing_to_claim" };
    }
    if (!selected) return { state, result: "no_selection" };

    if (action === "start") {
      startTask(selected.id, opts.agentId ?? "tui", d);
      return { state, result: `started:${selected.id}` };
    }
    if (action === "done") {
      completeTask(selected.id, opts.agentId, d);
      return { state, result: `completed:${selected.id}` };
    }
    if (action === "comment") {
      addComment({ task_id: selected.id, content: opts.comment ?? "TUI note", agent_id: opts.agentId }, d);
      return { state, result: `commented:${selected.id}` };
    }
  } catch (e) {
    return { state, result: "error", error: e instanceof Error ? e.message : String(e) };
  }

  return { state, result: "unknown" };
}

export function listDashboardProjects(db?: Database): Array<{ id: string; name: string }> {
  return listProjects(db).map((p) => ({ id: p.id, name: p.name }));
}
