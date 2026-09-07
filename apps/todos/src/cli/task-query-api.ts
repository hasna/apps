import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Task } from "../types/index.js";
import { isBlockingDependencyStatus } from "../types/index.js";
import { cloudGetDependencies, cloudGetTask } from "./cloud-router.js";

type Query = { project_id?: string; status?: string; assigned_to?: string; agent_id?: string; include_subtasks?: boolean };
/** Exhaust an advertised total; never present a capped or changing page as complete. */
export async function cloudQueryTasks(client: HasnaStorageClient, query: Query = {}): Promise<Task[]> {
  const tasks: Task[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  do {
    const params = Object.fromEntries(Object.entries(query).map(([key,value])=>[key,typeof value === "boolean" ? String(value) : value])) as Record<string,string|number>;
    const page = await client.list<Task>("tasks", { query: { ...params, limit: 200, offset: tasks.length } });
    const raw = page.raw as {tasks?:unknown;total?:unknown} | undefined;
    if (!raw || !Array.isArray(raw.tasks) || !Number.isSafeInteger(raw.total) || (raw.total as number) < 0) throw new Error("REMOTE_TASK_QUERY_INCOMPLETE: upgrade the Todos API to advertise tasks and total; no incomplete result displayed");
    if ((raw.total as number) > 10000) throw new Error("Task query exceeds 10000 rows; narrow it with --project");
    if (total !== undefined && raw.total !== total) throw new Error("Task query changed while paging; retry the read");
    total = raw.total as number;
    if (raw.tasks.length === 0 && tasks.length < total) throw new Error("Task query pagination stalled; no incomplete result displayed");
    for (const row of raw.tasks as Task[]) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error("Task query returned an invalid or repeated identity");
      if (query.project_id !== undefined && row.project_id !== query.project_id || query.status !== undefined && row.status !== query.status) throw new Error("Task query returned rows outside the requested filter");
      ids.add(row.id);tasks.push(row);
    }
    if (tasks.length > total) throw new Error("Task query returned more rows than its advertised total");
  } while (tasks.length < total);
  return tasks;
}

export async function cloudQueryBlockingDeps(client:HasnaStorageClient,tasks:readonly Task[]) {
  const result = new Map<string,Task[]>();
  const cache = new Map<string,Task>();
  for (const task of tasks) {
    const edges = await cloudGetDependencies(client,task.id);
    const blockers:Task[]=[];
    for (const edge of edges.dependencies) {
      let dependency = cache.get(edge.depends_on);
      if (!dependency) {
        dependency = await cloudGetTask(client,edge.depends_on) ?? undefined;
        if (!dependency || dependency.id !== edge.depends_on) throw new Error("Dependency task is unavailable; cannot report a complete blocked-task query");
        cache.set(dependency.id,dependency);
      }
      if (isBlockingDependencyStatus(dependency.status)) blockers.push(dependency);
    }
    if (blockers.length) result.set(task.id,blockers);
  }
  return result;
}
export function taskTimestamp(value: unknown): number {
  if (typeof value !== "string" || !value) throw new Error("Task query contains an invalid timestamp");
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value.replace(" ","T")+"Z";
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) throw new Error("Task query contains an invalid timestamp");
  return ms;
}
