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
import type { Agent, Plan, Project, RegisterAgentInput, Task, TaskComment, TaskDependency, TaskFilter } from "../types/index.js";

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
  // Local-first guard (flip safety): NEVER route to cloud unless a storage MODE is
  // explicitly requested. @hasna/contracts >= 0.5.1 changed the resolver so that a
  // bare API_URL+API_KEY (no mode) resolves to cloud — which would silently drift
  // any machine that merely has those env vars present, violating the reversible
  // "unset the mode -> local" contract. Require an explicit cloud mode here so the
  // flip stays deliberate and `HASNA_TODOS_STORAGE_MODE` is the single switch.
  const mode = (env.HASNA_TODOS_STORAGE_MODE ?? env.TODOS_STORAGE_MODE ?? "").trim().toLowerCase();
  const CLOUD_MODES = new Set(["self_hosted", "cloud", "remote", "hybrid"]);
  if (!CLOUD_MODES.has(mode)) {
    _cache = { client: null };
    return _cache.client;
  }
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
  if (typeof filter.priority === "string") query["priority"] = filter.priority;
  if (filter.project_id) query["project_id"] = filter.project_id;
  if (filter.plan_id) query["plan_id"] = filter.plan_id;
  if (filter.assigned_to) query["assigned_to"] = filter.assigned_to;
  if (filter.agent_id) query["agent_id"] = filter.agent_id;
  if (typeof filter.limit === "number") query["limit"] = filter.limit;
  if (typeof filter.offset === "number") query["offset"] = filter.offset;
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

/** Queue status summary from the cloud (`GET /v1/stats`). */
export interface CloudStats {
  tasks: number;
  tasks_all?: number;
  subtasks?: number;
  projects?: number;
  [key: string]: unknown;
}

/**
 * Fetch the cloud queue summary (`GET /v1/stats`). Used by the MCP `get_status`
 * tool so a flipped machine reports the shared cloud totals rather than its
 * local SQLite island.
 */
export async function cloudGetStats(client: HasnaStorageClient): Promise<CloudStats> {
  const raw = await client.transport.get<unknown>("/stats");
  return (raw ?? {}) as CloudStats;
}

/** List registered agents from the cloud (`GET /v1/agents`). */
export async function cloudListAgents(client: HasnaStorageClient): Promise<Agent[]> {
  const res = await client.list<Agent>("agents");
  const envelope = res.raw as { agents?: Agent[] } | undefined;
  return Array.isArray(envelope?.agents) ? envelope!.agents : res.items;
}

/** List projects from the cloud (`GET /v1/projects`). */
export async function cloudListProjects(client: HasnaStorageClient): Promise<Project[]> {
  const res = await client.list<Project>("projects");
  const envelope = res.raw as { projects?: Project[] } | undefined;
  return Array.isArray(envelope?.projects) ? envelope!.projects : res.items;
}

/** List plans from the cloud (`GET /v1/plans`), optionally scoped to a project. */
export async function cloudListPlans(client: HasnaStorageClient, projectId?: string): Promise<Plan[]> {
  const query = projectId ? { project_id: projectId } : {};
  const res = await client.list<Plan>("plans", { query });
  const envelope = res.raw as { plans?: Plan[] } | undefined;
  return Array.isArray(envelope?.plans) ? envelope!.plans : res.items;
}

/**
 * Add a comment to a task in the cloud (`POST /v1/tasks/:id/comments`). The server
 * validates that the task exists and returns 404 (surfaced as a thrown error by the
 * transport) when it does not — so a comment on a missing cloud task fails loudly
 * instead of silently succeeding.
 */
export async function cloudAddComment(
  client: HasnaStorageClient,
  taskId: string,
  input: { content: string; agent_id?: string; session_id?: string; type?: string; progress_pct?: number },
): Promise<TaskComment> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/comments`, input);
  if (raw && typeof raw === "object" && "comment" in (raw as Record<string, unknown>)) {
    return (raw as { comment: TaskComment }).comment;
  }
  return raw as TaskComment;
}

/**
 * Count tasks matching a filter. The `/v1/tasks` list response now returns a
 * SQL-side `total` (full match count, independent of limit/offset), so we ask for
 * a single row and read `total` instead of pulling the whole result set into the
 * client (which previously loaded every matching task over HTTP just to count).
 */
export async function cloudCountTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<number> {
  const { limit: _drop, offset: _o, ...rest } = filter;
  const res = await client.list<Task>("tasks", { query: { ...toListQuery(rest), limit: 1 } });
  const envelope = res.raw as { total?: number; count?: number; tasks?: Task[] } | undefined;
  if (typeof envelope?.total === "number") return envelope.total;
  // Fallback for older servers without `total`: list everything and count.
  const tasks = await cloudListTasks(client, rest);
  return tasks.length;
}

/**
 * Register (or renew) an agent in the shared cloud roster (`POST /v1/agents`).
 * This is the fix for the agent-identity misroute: `todos init` and the MCP
 * `register_agent` tool historically wrote the agent to LOCAL sqlite even on a
 * flipped machine, so the cloud `/v1/agents` roster never saw it. Routing through
 * here writes the agent to the shared dataset with the bearer key. A name that is
 * already actively held by another session comes back as HTTP 409, which the
 * transport throws — surfaced to the caller as a conflict error (parity with the
 * local conflict path) rather than a silent duplicate.
 */
export async function cloudRegisterAgent(client: HasnaStorageClient, input: RegisterAgentInput): Promise<Agent> {
  const raw = await client.transport.post<unknown>("/agents", input as unknown as Record<string, unknown>);
  if (raw && typeof raw === "object" && "agent" in (raw as Record<string, unknown>)) {
    return (raw as { agent: Agent }).agent;
  }
  return raw as Agent;
}

/** Result of a cloud lock/unlock action (mirrors the local `LockResult` shape). */
export interface CloudLockResult {
  success: boolean;
  locked_by?: string;
  locked_at?: string;
  expires_at?: string;
  error?: string;
}

/**
 * Acquire an exclusive lock on a cloud task (`POST /v1/tasks/:id/lock`). Locking is
 * a task-field operation (`locked_by`/`locked_at`) resolved server-side against the
 * shared dataset so a flipped machine coordinates on the SAME lock as every other
 * agent — the previous local-sqlite lookup 404'd cloud tasks ("Task not found").
 */
export async function cloudLockTask(client: HasnaStorageClient, id: string, agentId: string): Promise<CloudLockResult> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/lock`, { agent_id: agentId });
  if (raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    return (raw as { result: CloudLockResult }).result;
  }
  return (raw ?? { success: true }) as CloudLockResult;
}

/** Release a lock on a cloud task (`POST /v1/tasks/:id/unlock`). */
export async function cloudUnlockTask(client: HasnaStorageClient, id: string, agentId?: string): Promise<boolean> {
  const raw = await client.transport.post<unknown>(
    `/tasks/${encodeURIComponent(id)}/unlock`,
    agentId ? { agent_id: agentId } : {},
  );
  if (raw && typeof raw === "object" && "success" in (raw as Record<string, unknown>)) {
    return Boolean((raw as { success: unknown }).success);
  }
  return true;
}

/** A task's dependency edges from the cloud (`GET /v1/tasks/:id/dependencies`). */
export interface CloudTaskDependencies {
  dependencies: TaskDependency[];
  blocked_by: TaskDependency[];
}

/** List a cloud task's dependency edges (`GET /v1/tasks/:id/dependencies`). */
export async function cloudGetDependencies(client: HasnaStorageClient, id: string): Promise<CloudTaskDependencies> {
  const raw = await client.transport.get<unknown>(`/tasks/${encodeURIComponent(id)}/dependencies`);
  const env = (raw ?? {}) as Partial<CloudTaskDependencies>;
  return { dependencies: env.dependencies ?? [], blocked_by: env.blocked_by ?? [] };
}

/** Add a dependency edge to a cloud task (`POST /v1/tasks/:id/dependencies`). */
export async function cloudAddDependency(client: HasnaStorageClient, id: string, dependsOn: string): Promise<TaskDependency> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/dependencies`, { depends_on: dependsOn });
  if (raw && typeof raw === "object" && "dependency" in (raw as Record<string, unknown>)) {
    return (raw as { dependency: TaskDependency }).dependency;
  }
  return raw as TaskDependency;
}

/** Remove a dependency edge from a cloud task (`DELETE /v1/tasks/:id/dependencies/:dep`). */
export async function cloudRemoveDependency(client: HasnaStorageClient, id: string, dependsOn: string): Promise<boolean> {
  const raw = await client.transport.del<unknown>(
    `/tasks/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(dependsOn)}`,
  );
  if (raw && typeof raw === "object" && "removed" in (raw as Record<string, unknown>)) {
    return Boolean((raw as { removed: unknown }).removed);
  }
  return true;
}

/** A verification record returned by the cloud. */
export interface CloudTaskVerification {
  id: string;
  task_id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  run_at: string;
  created_at: string;
}

/**
 * Record a verification command + result against a cloud task
 * (`POST /v1/tasks/:id/verifications`). The previous local path wrote the row to
 * this machine's sqlite where the cloud task does not exist, tripping a FOREIGN
 * KEY constraint; routing to the shared store attaches it to the real task.
 */
export async function cloudRecordVerification(
  client: HasnaStorageClient,
  id: string,
  input: { command: string; status?: string; output_summary?: string; artifact_path?: string; agent_id?: string },
): Promise<CloudTaskVerification> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(id)}/verifications`, input);
  if (raw && typeof raw === "object" && "verification" in (raw as Record<string, unknown>)) {
    return (raw as { verification: CloudTaskVerification }).verification;
  }
  return raw as CloudTaskVerification;
}
