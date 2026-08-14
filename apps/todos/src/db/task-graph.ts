import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
  CreateTaskInput,
  Task,
  TaskDependency,
} from "../types/index.js";
import {
  DependencyCycleError,
  TaskNotFoundError,
} from "../types/index.js";
import { getDatabase, now } from "./database.js";
import { createTask, getTask } from "./task-crud.js";

// Dependencies

export function addDependency(
  taskId: string,
  dependsOn: string,
  db?: Database,
): void {
  const d = db || getDatabase();

  // Verify both tasks exist
  if (!getTask(taskId, d)) throw new TaskNotFoundError(taskId);
  if (!getTask(dependsOn, d)) throw new TaskNotFoundError(dependsOn);

  // Check for cycles using BFS
  if (wouldCreateCycle(taskId, dependsOn, d)) {
    throw new DependencyCycleError(taskId, dependsOn);
  }

  d.run(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
    [taskId, dependsOn],
  );
}

export function removeDependency(
  taskId: string,
  dependsOn: string,
  db?: Database,
): boolean {
  const d = db || getDatabase();
  const result = d.run(
    "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?",
    [taskId, dependsOn],
  );
  return result.changes > 0;
}

export function getTaskDependencies(
  taskId: string,
  db?: Database,
): TaskDependency[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM task_dependencies WHERE task_id = ?")
    .all(taskId) as TaskDependency[];
}

export function getTaskDependents(
  taskId: string,
  db?: Database,
): TaskDependency[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM task_dependencies WHERE depends_on = ?")
    .all(taskId) as TaskDependency[];
}

export function cloneTask(
  taskId: string,
  overrides?: Partial<CreateTaskInput>,
  db?: Database,
): Task {
  const d = db || getDatabase();
  const source = getTask(taskId, d);
  if (!source) throw new TaskNotFoundError(taskId);

  const input: CreateTaskInput = {
    title: overrides?.title ?? source.title,
    description: overrides?.description ?? source.description ?? undefined,
    priority: overrides?.priority ?? source.priority,
    project_id: overrides?.project_id ?? source.project_id ?? undefined,
    parent_id: overrides?.parent_id ?? source.parent_id ?? undefined,
    plan_id: overrides?.plan_id ?? source.plan_id ?? undefined,
    task_list_id: overrides?.task_list_id ?? source.task_list_id ?? undefined,
    status: overrides?.status ?? "pending",
    agent_id: overrides?.agent_id ?? source.agent_id ?? undefined,
    assigned_to: overrides?.assigned_to ?? source.assigned_to ?? undefined,
    tags: overrides?.tags ?? source.tags,
    metadata: overrides?.metadata ?? source.metadata,
    estimated_minutes: overrides?.estimated_minutes ?? source.estimated_minutes ?? undefined,
    recurrence_rule: overrides?.recurrence_rule ?? source.recurrence_rule ?? undefined,
  };

  return createTask(input, d);
}

// Task Graph

export interface TaskGraphNode {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  is_blocked: boolean;
}

export interface TaskGraph {
  task: TaskGraphNode;
  depends_on: TaskGraph[];
  blocks: TaskGraph[];
}

export function getTaskGraph(
  taskId: string,
  direction: "up" | "down" | "both" = "both",
  db?: Database,
): TaskGraph {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);

  function toNode(t: Task): TaskGraphNode {
    const deps = getTaskDependencies(t.id, d);
    const hasUnfinishedDeps = deps.some(dep => {
      const depTask = getTask(dep.depends_on, d);
      return depTask && depTask.status !== "completed";
    });
    return { id: t.id, short_id: t.short_id, title: t.title, status: t.status, priority: t.priority, is_blocked: hasUnfinishedDeps };
  }

  function buildUp(id: string, visited: Set<string>): TaskGraph[] {
    if (visited.has(id)) return [];
    visited.add(id);
    const deps = d.query("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(id) as { depends_on: string }[];
    return deps.map(dep => {
      const depTask = getTask(dep.depends_on, d);
      if (!depTask) return null;
      return { task: toNode(depTask), depends_on: buildUp(dep.depends_on, visited), blocks: [] };
    }).filter(Boolean) as TaskGraph[];
  }

  function buildDown(id: string, visited: Set<string>): TaskGraph[] {
    if (visited.has(id)) return [];
    visited.add(id);
    const dependents = d.query("SELECT task_id FROM task_dependencies WHERE depends_on = ?").all(id) as { task_id: string }[];
    return dependents.map(dep => {
      const depTask = getTask(dep.task_id, d);
      if (!depTask) return null;
      return { task: toNode(depTask), depends_on: [], blocks: buildDown(dep.task_id, visited) };
    }).filter(Boolean) as TaskGraph[];
  }

  const rootNode = toNode(task);
  const depends_on = (direction === "up" || direction === "both") ? buildUp(taskId, new Set()) : [];
  const blocks = (direction === "down" || direction === "both") ? buildDown(taskId, new Set()) : [];

  return { task: rootNode, depends_on, blocks };
}

export function moveTask(
  taskId: string,
  target: { task_list_id?: string | null; project_id?: string | null; plan_id?: string | null },
  db?: Database,
): Task {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new TaskNotFoundError(taskId);

  const sets: string[] = ["updated_at = ?", "version = version + 1"];
  const params: SQLQueryBindings[] = [now()];

  if (target.task_list_id !== undefined) {
    sets.push("task_list_id = ?");
    params.push(target.task_list_id);
  }
  if (target.project_id !== undefined) {
    sets.push("project_id = ?");
    params.push(target.project_id);
  }
  if (target.plan_id !== undefined) {
    sets.push("plan_id = ?");
    params.push(target.plan_id);
  }

  params.push(taskId);
  d.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);

  return getTask(taskId, d)!;
}

// Internal helper — cycle detection via BFS

function wouldCreateCycle(
  taskId: string,
  dependsOn: string,
  db: Database,
): boolean {
  // BFS from dependsOn to see if we can reach taskId
  const visited = new Set<string>();
  const queue = [dependsOn];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = db
      .query("SELECT depends_on FROM task_dependencies WHERE task_id = ?")
      .all(current) as { depends_on: string }[];

    for (const dep of deps) {
      queue.push(dep.depends_on);
    }
  }

  return false;
}
