import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { TaskGraph, TaskGraphNode } from "../db/task-graph.js";
import type { Task } from "../types/index.js";
import { isBlockingDependencyStatus } from "../types/index.js";
import { LOCK_EXPIRY_MINUTES } from "../db/database.js";
import { cloudGetTask, cloudGetDependencies, cloudUpdateTask } from "../cli/cloud-router.js";

async function requiredTask(client: HasnaStorageClient, id: string): Promise<Task> {
  const task = await cloudGetTask(client, id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.id !== id || typeof task.status !== "string" || typeof task.title !== "string") throw new Error("REMOTE_API_INCOMPATIBLE: task response does not match the requested task");
  return task;
}

export async function cloudTaskLockStatus(client: HasnaStorageClient, id: string, nowMs = Date.now()) {
  const task = await requiredTask(client, id);
  if (task.locked_by !== null && typeof task.locked_by !== "string" || task.locked_at !== null && typeof task.locked_at !== "string") throw new Error("REMOTE_API_INCOMPATIBLE: task lock fields are missing");
  const lockMs = task.locked_at === null ? null : Date.parse(task.locked_at);
  if (lockMs !== null && !Number.isFinite(lockMs)) throw new Error("REMOTE_API_INCOMPATIBLE: task lock timestamp is invalid");
  const expiresMs = lockMs === null ? null : lockMs + LOCK_EXPIRY_MINUTES * 60_000;
  const expired = expiresMs === null || nowMs > expiresMs;
  return { task_id: id, locked: !!task.locked_by && !expired, locked_by: task.locked_by, locked_at: task.locked_at, expires_at: expiresMs === null ? null : new Date(expiresMs).toISOString(), expired };
}

export async function cloudPrioritizeTask(client: HasnaStorageClient, id: string, priority: Task["priority"], version?: number) {
  const expectedVersion = version ?? (await requiredTask(client, id)).version;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error("A valid expected task version is required");
  const task = await cloudUpdateTask(client, id, { priority, version: expectedVersion });
  if (!task || task.id !== id || task.priority !== priority || !Number.isInteger(task.version) || task.version <= expectedVersion) throw new Error("REMOTE_API_INCOMPATIBLE: priority receipt is incomplete; inspect before retrying");
  return task;
}

/** Full graph, bounded to prevent unbounded API walks. Limits fail visibly, never truncate. */
export async function cloudTaskGraph(client: HasnaStorageClient, id: string, direction: "up" | "down" | "both" = "both"): Promise<TaskGraph> {
  const tasks = new Map<string, Promise<Task>>();
  const edges = new Map<string, ReturnType<typeof cloudGetDependencies>>();
  const getTask = (key: string) => {
    if (!tasks.has(key)) {
      if (tasks.size >= 1000) throw new Error("Dependency graph exceeds 1000 tasks; narrow the requested graph");
      tasks.set(key, requiredTask(client, key));
    }
    return tasks.get(key)!;
  };
  const getEdges = (key: string) => {
    if (!edges.has(key)) edges.set(key, cloudGetDependencies(client, key));
    return edges.get(key)!;
  };
  const toNode = async (key: string): Promise<TaskGraphNode> => {
    const task = await getTask(key);
    const deps = await getEdges(key);
    let blocked = false;
    for (const edge of deps.dependencies) if (isBlockingDependencyStatus((await getTask(edge.depends_on)).status)) blocked = true;
    return { id: task.id, short_id: task.short_id, title: task.title, status: task.status, priority: task.priority, is_blocked: blocked };
  };
  const walk = async (key: string, side: "up" | "down", seen: Set<string>, depth: number): Promise<TaskGraph[]> => {
    if (seen.has(key)) return [];
    if (depth > 100) throw new Error("Dependency graph exceeds 100 levels; narrow the requested graph");
    seen.add(key);
    const dep = await getEdges(key);
    const result: TaskGraph[] = [];
    for (const edge of side === "up" ? dep.dependencies : dep.blocks) {
      const next = side === "up" ? edge.depends_on : edge.task_id;
      const task = await toNode(next);
      const children = await walk(next, side, seen, depth + 1);
      result.push({ task, depends_on: side === "up" ? children : [], blocks: side === "down" ? children : [] });
    }
    return result;
  };
  return { task: await toNode(id), depends_on: direction !== "down" ? await walk(id, "up", new Set(), 0) : [], blocks: direction !== "up" ? await walk(id, "down", new Set(), 0) : [] };
}
