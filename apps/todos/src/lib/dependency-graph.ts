/**
 * Dependency graph analysis — ready/blocked tasks, critical path, unlock impact.
 * Local-only; machine-readable JSON for MCP and CLI.
 */

import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { listTasks, getTask } from "../db/tasks.js";
import { getTaskDependencies, getTaskDependents } from "../db/task-graph.js";
import { getBlockingDeps } from "../db/task-lifecycle.js";
import type { Task } from "../types/index.js";

export const DEPENDENCY_GRAPH_SCHEMA = "todos.dependency_graph.v1";

export interface DependencyNode {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  plan_id: string | null;
  project_id: string | null;
}

export interface BlockedTaskReport {
  schema_version: typeof DEPENDENCY_GRAPH_SCHEMA;
  task: DependencyNode;
  blockers: DependencyNode[];
  stale_blockers: DependencyNode[];
  missing_dependencies: string[];
}

export interface ReadyTaskReport {
  schema_version: typeof DEPENDENCY_GRAPH_SCHEMA;
  task: DependencyNode;
  plan_id: string | null;
  priority_score: number;
}

export interface CriticalPathEntry {
  schema_version: typeof DEPENDENCY_GRAPH_SCHEMA;
  task: DependencyNode;
  downstream_count: number;
  direct_dependents: number;
  depth: number;
}

export interface UnlockImpactReport {
  schema_version: typeof DEPENDENCY_GRAPH_SCHEMA;
  task_id: string;
  currently_blocking: number;
  would_unlock: DependencyNode[];
  still_blocked_after: DependencyNode[];
}

export interface DependencyGraphAnalysis {
  schema_version: typeof DEPENDENCY_GRAPH_SCHEMA;
  analyzed_at: string;
  project_id: string | null;
  plan_id: string | null;
  ready_count: number;
  blocked_count: number;
  cycles: string[][];
  missing_dependencies: Array<{ task_id: string; missing_dep_id: string }>;
  stale_blockers: BlockedTaskReport[];
  ready_tasks: ReadyTaskReport[];
  blocked_tasks: BlockedTaskReport[];
  critical_path: CriticalPathEntry[];
}

export interface GraphFilter {
  project_id?: string;
  plan_id?: string;
  status?: string[];
  limit?: number;
}

function toNode(task: Task): DependencyNode {
  return {
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    plan_id: task.plan_id,
    project_id: task.project_id,
  };
}

const PRIORITY_SCORE: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function priorityScore(priority: string): number {
  return PRIORITY_SCORE[priority] ?? 0;
}

function filterTasks(tasks: Task[], filter: GraphFilter): Task[] {
  let out = tasks;
  if (filter.project_id) out = out.filter((t) => t.project_id === filter.project_id);
  if (filter.plan_id) out = out.filter((t) => t.plan_id === filter.plan_id);
  if (filter.status?.length) out = out.filter((t) => filter.status!.includes(t.status));
  return out;
}

function findMissingDependencies(db: Database): Array<{ task_id: string; missing_dep_id: string }> {
  const rows = db.query("SELECT task_id, depends_on FROM task_dependencies").all() as { task_id: string; depends_on: string }[];
  const missing: Array<{ task_id: string; missing_dep_id: string }> = [];
  for (const row of rows) {
    if (!getTask(row.depends_on, db)) {
      missing.push({ task_id: row.task_id, missing_dep_id: row.depends_on });
    }
  }
  return missing;
}

function detectCycles(db: Database): string[][] {
  const edges = db.query("SELECT task_id, depends_on FROM task_dependencies").all() as { task_id: string; depends_on: string }[];
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.task_id);
    nodes.add(e.depends_on);
    if (!adj.has(e.task_id)) adj.set(e.task_id, []);
    adj.get(e.task_id)!.push(e.depends_on);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const next of adj.get(node) ?? []) {
      if (!visited.has(next)) dfs(next);
      else if (stack.has(next)) {
        const idx = path.indexOf(next);
        if (idx >= 0) cycles.push([...path.slice(idx), next]);
      }
    }

    path.pop();
    stack.delete(node);
  }

  for (const node of nodes) {
    if (!visited.has(node)) dfs(node);
  }
  return cycles;
}

function isStaleBlocker(task: Task): boolean {
  if (task.status === "completed" || task.status === "cancelled") return false;
  if (task.status === "in_progress" && task.started_at) {
    const started = new Date(task.started_at).getTime();
    const staleMs = 30 * 60 * 1000;
    return Date.now() - started > staleMs;
  }
  return task.status === "pending" || task.status === "failed";
}

export function getReadyTasks(filter: GraphFilter = {}, db?: Database): ReadyTaskReport[] {
  const d = db || getDatabase();
  const pending = filterTasks(listTasks({ status: "pending" }, d), filter);
  const ready: ReadyTaskReport[] = [];

  for (const task of pending) {
    const blockers = getBlockingDeps(task.id, d);
    if (blockers.length > 0) continue;
    if (task.locked_by) continue;
    ready.push({
      schema_version: DEPENDENCY_GRAPH_SCHEMA,
      task: toNode(task),
      plan_id: task.plan_id,
      priority_score: priorityScore(task.priority),
    });
  }

  ready.sort((a, b) => b.priority_score - a.priority_score || a.task.title.localeCompare(b.task.title));
  return filter.limit ? ready.slice(0, filter.limit) : ready;
}

export function getBlockedTaskReports(filter: GraphFilter = {}, db?: Database): BlockedTaskReport[] {
  const d = db || getDatabase();
  const statuses = filter.status?.length ? filter.status : ["pending", "in_progress"];
  const candidates = filterTasks(listTasks({}, d).filter((t) => statuses.includes(t.status)), filter);
  const missing = findMissingDependencies(d);
  const missingByTask = new Map<string, string[]>();
  for (const m of missing) {
    if (!missingByTask.has(m.task_id)) missingByTask.set(m.task_id, []);
    missingByTask.get(m.task_id)!.push(m.missing_dep_id);
  }

  const reports: BlockedTaskReport[] = [];
  for (const task of candidates) {
    const blockers = getBlockingDeps(task.id, d);
    const extraMissing = missingByTask.get(task.id) ?? [];
    if (blockers.length === 0 && extraMissing.length === 0) continue;

    reports.push({
      schema_version: DEPENDENCY_GRAPH_SCHEMA,
      task: toNode(task),
      blockers: blockers.map(toNode),
      stale_blockers: blockers.filter(isStaleBlocker).map(toNode),
      missing_dependencies: extraMissing,
    });
  }

  return filter.limit ? reports.slice(0, filter.limit) : reports;
}

function countDownstream(taskId: string, db: Database, memo: Map<string, number>, visiting: Set<string>): number {
  if (memo.has(taskId)) return memo.get(taskId)!;
  if (visiting.has(taskId)) return 0;
  visiting.add(taskId);

  const dependents = getTaskDependents(taskId, db);
  let count = dependents.length;
  for (const dep of dependents) {
    count += countDownstream(dep.task_id, db, memo, visiting);
  }

  visiting.delete(taskId);
  memo.set(taskId, count);
  return count;
}

function dependencyDepth(taskId: string, db: Database, memo: Map<string, number>, visiting: Set<string>): number {
  if (memo.has(taskId)) return memo.get(taskId)!;
  if (visiting.has(taskId)) return 0;
  visiting.add(taskId);

  const deps = getTaskDependencies(taskId, db);
  let depth = 0;
  for (const dep of deps) {
    depth = Math.max(depth, 1 + dependencyDepth(dep.depends_on, db, memo, visiting));
  }

  visiting.delete(taskId);
  memo.set(taskId, depth);
  return depth;
}

export function getCriticalPath(filter: GraphFilter = {}, db?: Database): CriticalPathEntry[] {
  const d = db || getDatabase();
  const tasks = filterTasks(listTasks({}, d).filter((t) => t.status !== "completed" && t.status !== "cancelled"), filter);
  const downstreamMemo = new Map<string, number>();
  const depthMemo = new Map<string, number>();

  const entries: CriticalPathEntry[] = tasks.map((task) => ({
    schema_version: DEPENDENCY_GRAPH_SCHEMA,
    task: toNode(task),
    downstream_count: countDownstream(task.id, d, downstreamMemo, new Set()),
    direct_dependents: getTaskDependents(task.id, d).length,
    depth: dependencyDepth(task.id, d, depthMemo, new Set()),
  }));

  entries.sort((a, b) => b.downstream_count - a.downstream_count || b.depth - a.depth);
  return filter.limit ? entries.slice(0, filter.limit) : entries;
}

export function getUnlockImpact(taskId: string, db?: Database): UnlockImpactReport {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const dependents = getTaskDependents(taskId, d);
  const wouldUnlock: DependencyNode[] = [];
  const stillBlocked: DependencyNode[] = [];

  for (const dep of dependents) {
    const dependent = getTask(dep.task_id, d);
    if (!dependent || dependent.status === "completed" || dependent.status === "cancelled") continue;

    const blockers = getBlockingDeps(dep.task_id, d).filter((b) => b.id !== taskId);
    if (blockers.length === 0) wouldUnlock.push(toNode(dependent));
    else stillBlocked.push(toNode(dependent));
  }

  return {
    schema_version: DEPENDENCY_GRAPH_SCHEMA,
    task_id: taskId,
    currently_blocking: dependents.length,
    would_unlock: wouldUnlock,
    still_blocked_after: stillBlocked,
  };
}

export function analyzeDependencyGraph(filter: GraphFilter = {}, db?: Database): DependencyGraphAnalysis {
  const d = db || getDatabase();
  const ready = getReadyTasks(filter, d);
  const blocked = getBlockedTaskReports(filter, d);
  const critical = getCriticalPath({ ...filter, limit: filter.limit ?? 10 }, d);

  return {
    schema_version: DEPENDENCY_GRAPH_SCHEMA,
    analyzed_at: new Date().toISOString(),
    project_id: filter.project_id ?? null,
    plan_id: filter.plan_id ?? null,
    ready_count: ready.length,
    blocked_count: blocked.length,
    cycles: detectCycles(d),
    missing_dependencies: findMissingDependencies(d),
    stale_blockers: blocked.filter((b) => b.stale_blockers.length > 0),
    ready_tasks: ready,
    blocked_tasks: blocked,
    critical_path: critical,
  };
}

export function getDependents(taskId: string, db?: Database): DependencyNode[] {
  const d = db || getDatabase();
  return getTaskDependents(taskId, d)
    .map((dep) => getTask(dep.task_id, d))
    .filter(Boolean)
    .map((t) => toNode(t!));
}

export function getBlockers(taskId: string, db?: Database): BlockedTaskReport | null {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) return null;
  const blockers = getBlockingDeps(taskId, d);
  const missing = findMissingDependencies(d).filter((m) => m.task_id === taskId).map((m) => m.missing_dep_id);
  if (blockers.length === 0 && missing.length === 0) return null;

  return {
    schema_version: DEPENDENCY_GRAPH_SCHEMA,
    task: toNode(task),
    blockers: blockers.map(toNode),
    stale_blockers: blockers.filter(isStaleBlocker).map(toNode),
    missing_dependencies: missing,
  };
}
