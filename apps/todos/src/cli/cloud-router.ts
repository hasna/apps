/**
 * Client-side self_hosted cloud routing for the `todos` CLI.
 *
 * THE MISSING PIECE (B2): historically the CLI always read/wrote the local
 * SQLite store even when a machine was flipped to `self_hosted` — there was
 * ZERO `/v1` / bearer / API-URL code on the client, so `HASNA_TODOS_*` env had
 * no effect. This module wires the CLI's task data path to the cloud HTTP API
 * (`https://todos.hasna.xyz/v1`) via the LOCKED `@hasna/contracts` HTTP storage
 * client whenever the client-flip contract resolves to `cloud-http`:
 *
 *   mode = self_hosted (or cloud)  AND  HASNA_TODOS_API_URL  AND  HASNA_TODOS_API_KEY
 *
 * When those are set, ALL task reads and writes go to the cloud with the bearer
 * key — NOT local, NOT a DSN. When they are unset, the client falls straight
 * back to the local SQLite store. Misconfigured cloud (mode set but URL/key
 * missing) THROWS via the contracts resolver so we never silently drift back to
 * the wrong dataset.
 *
 * SAFETY: reversible by construction (unset the two env vars -> local). Never
 * logs or embeds the API key (it lives only inside the transport). No DSN, no
 * subnet routing — pure API-client path per the locked architecture.
 */
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Task, TaskFilter } from "../types/index.js";

type Env = Record<string, string | undefined>;

let _cache: { client: HasnaStorageClient | null } | undefined;

/**
 * Resolve the todos cloud storage client from the environment. Returns a ready
 * client when the flip resolves to `cloud-http`, or `null` for local. Throws
 * when cloud is requested (mode=self_hosted/cloud) but the URL or key is missing
 * — no silent local fallback for a misconfigured cloud request.
 */
export function getTodosCloudClient(env: Env = process.env as Env): HasnaStorageClient | null {
  if (_cache !== undefined) return _cache.client;
  const resolved = resolveStorageClient("todos", env);
  _cache = { client: resolved.transport === "cloud-http" ? resolved.client : null };
  return _cache.client;
}

/** True when the CLI should route task reads/writes to the cloud API. */
export function isCloudRouting(env: Env = process.env as Env): boolean {
  return getTodosCloudClient(env) !== null;
}

/** Test hook: clear the memoized client (e.g. after mutating env in a test). */
export function resetTodosCloudClient(): void {
  _cache = undefined;
}

/** Unwrap the `{ task }` envelope the todos `/v1` API returns for single tasks. */
function unwrapTask(raw: unknown): Task {
  if (raw && typeof raw === "object" && "task" in (raw as Record<string, unknown>)) {
    return (raw as { task: Task }).task;
  }
  return raw as Task;
}

/** Map a local TaskFilter onto the query params the `/v1/tasks` list route honors. */
function toListQuery(filter: TaskFilter = {}): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (typeof filter.status === "string") query["status"] = filter.status;
  if (filter.project_id) query["project_id"] = filter.project_id;
  if (filter.assigned_to) query["assigned_to"] = filter.assigned_to;
  if (typeof filter.limit === "number") query["limit"] = filter.limit;
  return query;
}

/** List tasks from the cloud (`GET /v1/tasks`). Returns the `tasks` array. */
export async function cloudListTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<Task[]> {
  const res = await client.list<Task>("tasks", { query: toListQuery(filter) });
  const envelope = res.raw as { tasks?: Task[] } | undefined;
  return Array.isArray(envelope?.tasks) ? envelope!.tasks : res.items;
}

/** Fetch one task by id (`GET /v1/tasks/:id`); `null` on 404. */
export async function cloudGetTask(client: HasnaStorageClient, id: string): Promise<Task | null> {
  const raw = await client.get<unknown>("tasks", id);
  return raw == null ? null : unwrapTask(raw);
}

/** Create a task (`POST /v1/tasks`, retry-safe idempotency key). */
export async function cloudCreateTask(client: HasnaStorageClient, input: Record<string, unknown>): Promise<Task> {
  return unwrapTask(await client.create<unknown>("tasks", input));
}

/** Update a task (`PATCH /v1/tasks/:id`). */
export async function cloudUpdateTask(client: HasnaStorageClient, id: string, patch: Record<string, unknown>): Promise<Task> {
  return unwrapTask(await client.update<unknown>("tasks", id, patch));
}

/** Delete a task (`DELETE /v1/tasks/:id`); resolves for 2xx and 404. */
export async function cloudDeleteTask(client: HasnaStorageClient, id: string): Promise<boolean> {
  await client.delete("tasks", id);
  return true;
}

/** Run a task lifecycle action (`POST /v1/tasks/:id/{start|complete|fail|claim}`). */
export async function cloudTaskAction(
  client: HasnaStorageClient,
  id: string,
  action: "start" | "complete" | "fail" | "claim",
  body: Record<string, unknown> = {},
): Promise<Task> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/${action}`, body);
  return unwrapTask(raw);
}

/** Count tasks matching a filter by listing (the `/v1` API has no count route for filters). */
export async function cloudCountTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<number> {
  const { limit: _drop, ...rest } = filter;
  const tasks = await cloudListTasks(client, rest);
  return tasks.length;
}
