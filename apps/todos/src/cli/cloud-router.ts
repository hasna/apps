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
import { resolve as resolvePath } from "node:path";
import type { Agent, CreateTaskListInput, Plan, Project, RegisterAgentInput, Task, TaskComment, TaskDependency, TaskFilter, TaskHistory, TaskList } from "../types/index.js";
import { redactEvidenceText } from "../lib/redaction.js";

type Env = Record<string, string | undefined>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (filter.status) query["status"] = Array.isArray(filter.status) ? filter.status.join(",") : filter.status;
  if (filter.priority) query["priority"] = Array.isArray(filter.priority) ? filter.priority.join(",") : filter.priority;
  if (filter.project_id) query["project_id"] = filter.project_id;
  if (filter.parent_id !== undefined) query["parent_id"] = filter.parent_id ?? "";
  if (filter.plan_id) query["plan_id"] = filter.plan_id;
  if (filter.task_list_id) query["task_list_id"] = filter.task_list_id;
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

function cloudProjectSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cloudProjectPathBasename(value: string): string {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? value;
}

function uniqueProjectMatches(projects: Project[], predicate: (project: Project) => boolean): Project[] {
  return [...new Map(projects.filter(predicate).map((project) => [project.id, project])).values()];
}

/** Resolve a cloud project UUID, unique UUID prefix, exact name/path, or canonical slug. */
export async function cloudResolveProjectRef(client: HasnaStorageClient, ref: string): Promise<string> {
  const input = ref.trim();
  const projects = await cloudListProjects(client);
  const normalizedRef = input.toLowerCase();
  const pathLike = input.startsWith(".") || input.includes("/") || input.includes("\\");
  const normalizedPath = pathLike ? resolvePath(input) : undefined;
  const slug = cloudProjectSlug(pathLike ? cloudProjectPathBasename(input) : input);
  const matchGroups = [
    uniqueProjectMatches(projects, (project) => project.id.toLowerCase() === normalizedRef),
    uniqueProjectMatches(
      projects,
      (project) => project.path === input ||
        (normalizedPath !== undefined && resolvePath(project.path) === normalizedPath),
    ),
    uniqueProjectMatches(projects, (project) => project.name.toLowerCase() === normalizedRef),
    uniqueProjectMatches(
      projects,
      (project) => project.task_list_id === input ||
        cloudProjectSlug(project.name) === slug ||
        cloudProjectSlug(cloudProjectPathBasename(project.path)) === slug,
    ),
    uniqueProjectMatches(projects, (project) => project.id.toLowerCase().startsWith(normalizedRef)),
  ];

  for (const matches of matchGroups) {
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1) throw new Error(`Project reference is ambiguous: "${input}"`);
  }

  throw new Error(`Project not found: "${input}"`);
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
  const comment = raw && typeof raw === "object" && "comment" in (raw as Record<string, unknown>)
    ? (raw as { comment: unknown }).comment
    : raw;
  if (!isTaskComment(comment)) throw new Error("Invalid cloud comment response");
  return redactComment(comment);
}

export interface CloudCommentPage {
  /** Oldest-to-newest comments within this bounded page. */
  comments: TaskComment[];
  /** Number of comments in this page, not the total comment count. */
  count: number;
  /** True when an older page is available through `next_cursor`. */
  has_more: boolean;
  /** Opaque cursor for the next (older) page. */
  next_cursor: string | null;
  /** Maximum number of comments requested from the server. */
  limit: number;
  /** False only while talking to a predecessor server without cursor metadata. */
  pagination_supported: boolean;
}

export interface CloudCommentPageOptions {
  limit?: number;
  cursor?: string;
}

/**
 * List one bounded page of persisted comments for a cloud task. The first page
 * contains the newest comments while preserving oldest-to-newest display order;
 * `next_cursor` walks toward older comments. Callers must surface `has_more`
 * rather than silently implying that this page is the complete history.
 */
export async function cloudListComments(
  client: HasnaStorageClient,
  taskId: string,
  options: CloudCommentPageOptions = {},
): Promise<CloudCommentPage> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Cloud comment limit must be an integer between 1 and 500");
  }
  if (options.cursor !== undefined &&
      (typeof options.cursor !== "string" || !options.cursor || options.cursor.length > 1_024)) {
    throw new Error("Cloud comment cursor must be a non-empty string");
  }
  let raw: unknown;
  try {
    raw = await client.transport.get<unknown>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
      query: { limit, ...(options.cursor ? { cursor: options.cursor } : {}) },
    });
  } catch (error) {
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    if (status === 404 || status === 405) {
      throw new Error(
        "Cloud task comments require a compatible @hasna/todos server; deploy the server endpoint before this CLI.",
        { cause: error },
      );
    }
    throw error;
  }

  const envelope = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { comments?: unknown; count?: unknown; has_more?: unknown; next_cursor?: unknown })
    : null;
  const candidate = Array.isArray(raw) ? raw : envelope?.comments;
  if (!Array.isArray(candidate) || !candidate.every(isTaskComment)) {
    throw new Error("Invalid cloud comments response");
  }
  if (envelope?.count !== undefined &&
      (!Number.isSafeInteger(envelope.count) || (envelope.count as number) < 0 || envelope.count !== candidate.length)) {
    throw new Error("Invalid cloud comments response count");
  }
  const hasHasMore = envelope ? Object.prototype.hasOwnProperty.call(envelope, "has_more") : false;
  const hasNextCursor = envelope ? Object.prototype.hasOwnProperty.call(envelope, "next_cursor") : false;
  if (hasHasMore !== hasNextCursor) throw new Error("Invalid cloud comments pagination response");
  const paginationSupported = hasHasMore && hasNextCursor;

  if (!paginationSupported) {
    const comments = candidate.slice(-limit).map(redactComment);
    return {
      comments,
      count: comments.length,
      has_more: candidate.length > limit,
      next_cursor: null,
      limit,
      pagination_supported: false,
    };
  }
  if (candidate.length > limit) throw new Error("Invalid cloud comments response: page exceeds requested limit");

  const hasMore = envelope!.has_more;
  const nextCursor = envelope!.next_cursor;
  if (typeof hasMore !== "boolean" || (nextCursor !== null && (typeof nextCursor !== "string" || !nextCursor))) {
    throw new Error("Invalid cloud comments pagination response");
  }
  if ((hasMore && nextCursor === null) || (!hasMore && nextCursor !== null)) {
    throw new Error("Invalid cloud comments pagination response");
  }
  return {
    comments: candidate.map(redactComment),
    count: candidate.length,
    has_more: hasMore,
    next_cursor: nextCursor,
    limit,
    pagination_supported: true,
  };
}

function isTaskComment(value: unknown): value is TaskComment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const comment = value as Record<string, unknown>;
  return typeof comment["id"] === "string"
    && typeof comment["task_id"] === "string"
    && (comment["agent_id"] === null || typeof comment["agent_id"] === "string")
    && (comment["session_id"] === null || typeof comment["session_id"] === "string")
    && typeof comment["content"] === "string"
    && (comment["type"] === "comment" || comment["type"] === "progress" || comment["type"] === "note")
    && (comment["progress_pct"] === null || typeof comment["progress_pct"] === "number")
    && typeof comment["created_at"] === "string";
}

function redactComment(comment: TaskComment): TaskComment {
  return { ...comment, content: redactEvidenceText(comment.content) };
}

/**
 * Per-task audit trail (`GET /v1/tasks/:id/history`). The CLI `history` command
 * read this machine's LOCAL sqlite, so a flipped machine reported "No history" for
 * a cloud task whose trail lives in the shared dataset. Requires the
 * `/v1/tasks/:id/history` server route (ECS redeploy).
 */
export async function cloudTaskHistory(client: HasnaStorageClient, taskId: string): Promise<TaskHistory[]> {
  const raw = await client.transport.get<unknown>(`/tasks/${encodeURIComponent(taskId)}/history`);
  const envelope = (raw ?? {}) as { history?: TaskHistory[] };
  if (Array.isArray(envelope.history)) return envelope.history;
  return Array.isArray(raw) ? (raw as TaskHistory[]) : [];
}

/** Result of an idempotent fingerprint upsert (`POST /v1/tasks/upsert`). */
export interface CloudUpsertTaskResult {
  task: Task;
  created: boolean;
}

/**
 * Idempotent create-or-update a task by stable fingerprint on the SHARED dataset
 * (`POST /v1/tasks/upsert`). Fixes the split-brain write where `task upsert` wrote
 * to this machine's LOCAL sqlite (absent from the cloud /v1 API). Requires the
 * `/v1/tasks/upsert` server route (ECS redeploy).
 */
export async function cloudUpsertTaskByFingerprint(
  client: HasnaStorageClient,
  input: Record<string, unknown> & { fingerprint: string; title: string },
): Promise<CloudUpsertTaskResult> {
  const raw = await client.transport.post<unknown>("/tasks/upsert", input);
  const envelope = (raw ?? {}) as { task?: unknown; created?: boolean };
  return {
    task: unwrapTask(envelope.task ?? raw),
    created: Boolean(envelope.created),
  };
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

/**
 * Refresh an agent's `last_seen_at` in the shared cloud roster
 * (`POST /v1/agents/:id/heartbeat`). Resolves by id OR name server-side. Returns
 * `null` when the agent does not exist in the cloud roster. This is the fix for
 * the heartbeat misroute: the CLI/MCP used to read LOCAL sqlite and 404 a
 * cloud-only agent ("Agent not found") on a flipped machine.
 */
export async function cloudHeartbeatAgent(client: HasnaStorageClient, idOrName: string): Promise<Agent | null> {
  const raw = await client.transport.post<unknown>(`/agents/${encodeURIComponent(idOrName)}/heartbeat`, {});
  if (raw && typeof raw === "object" && "agent" in (raw as Record<string, unknown>)) {
    return (raw as { agent: Agent }).agent;
  }
  return (raw as Agent) ?? null;
}

/** Result of a cloud agent release (`POST /v1/agents/:id/release`). */
export interface CloudReleaseResult {
  agent: Agent | null;
  released: boolean;
}

/**
 * Release/logout an agent in the shared cloud roster (`POST /v1/agents/:id/release`).
 * Clears the agent's session binding so the name is immediately available. When
 * `sessionId` is provided the server only releases on a match (else HTTP 409,
 * surfaced as a thrown error by the transport).
 */
export async function cloudReleaseAgent(
  client: HasnaStorageClient,
  idOrName: string,
  sessionId?: string,
): Promise<CloudReleaseResult> {
  const raw = await client.transport.post<unknown>(
    `/agents/${encodeURIComponent(idOrName)}/release`,
    sessionId ? { session_id: sessionId } : {},
  );
  const env = (raw ?? {}) as { agent?: Agent; released?: boolean };
  return { agent: env.agent ?? null, released: env.released !== false };
}

/** A git commit link stored in the cloud. */
export interface CloudTaskCommit {
  id: string;
  task_id: string;
  sha: string;
  message: string | null;
  author: string | null;
  files_changed: string[] | null;
  created_at: string;
}

/**
 * Link a git commit to a cloud task (`POST /v1/tasks/:id/commits`). The previous
 * local path wrote the row to this machine's sqlite where the cloud task does not
 * exist, tripping a FOREIGN KEY constraint; routing to the shared store attaches
 * it to the real task.
 */
export async function cloudLinkCommit(
  client: HasnaStorageClient,
  taskId: string,
  input: { sha: string; message?: string; author?: string; files_changed?: string[] },
): Promise<CloudTaskCommit> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/commits`, input);
  if (raw && typeof raw === "object" && "commit" in (raw as Record<string, unknown>)) {
    return (raw as { commit: CloudTaskCommit }).commit;
  }
  return raw as CloudTaskCommit;
}

/** Find the task that explains a commit SHA (`GET /v1/commits/:sha`); `null` if none. */
export async function cloudFindCommit(client: HasnaStorageClient, sha: string): Promise<CloudTaskCommit | null> {
  const raw = await client.transport.get<unknown>(`/commits/${encodeURIComponent(sha)}`);
  const env = (raw ?? {}) as { commit?: CloudTaskCommit | null };
  return env.commit ?? null;
}

/** A git branch/PR ref link stored in the cloud. */
export interface CloudTaskGitRef {
  id: string;
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url: string | null;
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Link a git branch or pull request to a cloud task (`POST /v1/tasks/:id/refs`). */
export async function cloudLinkRef(
  client: HasnaStorageClient,
  taskId: string,
  input: { ref_type: "branch" | "pull_request"; name: string; url?: string; provider?: string; metadata?: Record<string, unknown> },
): Promise<CloudTaskGitRef> {
  const raw = await client.transport.post<unknown>(`/tasks/${encodeURIComponent(taskId)}/refs`, input);
  if (raw && typeof raw === "object" && "ref" in (raw as Record<string, unknown>)) {
    return (raw as { ref: CloudTaskGitRef }).ref;
  }
  return raw as CloudTaskGitRef;
}

/** Find every task linked to a branch/PR ref by name (`GET /v1/refs/:ref`). */
export async function cloudFindRefs(client: HasnaStorageClient, ref: string): Promise<CloudTaskGitRef[]> {
  const raw = await client.transport.get<unknown>(`/refs/${encodeURIComponent(ref)}`);
  const env = (raw ?? {}) as { refs?: CloudTaskGitRef[] };
  return Array.isArray(env.refs) ? env.refs : [];
}

/**
 * Fetch one plan by id (`GET /v1/plans/:id`); `null` on 404. Also resolves a
 * partial id / slug / name by first checking `/v1/plans` — the `plans --show`
 * path historically resolved the ref against LOCAL sqlite (which does not carry
 * cloud plans), so it could not open a plan its own cloud `plans` list returned.
 */
export async function cloudResolvePlan(client: HasnaStorageClient, ref: string, projectId?: string): Promise<Plan | null> {
  const direct = await client.get<unknown>("plans", ref).catch(() => null);
  if (direct) {
    const env = direct as { plan?: Plan };
    if (env.plan) return env.plan;
    if ((direct as Plan).id) return direct as Plan;
  }
  const plans = await cloudListPlans(client, projectId);
  return (
    plans.find((p) => p.id === ref) ??
    plans.find((p) => p.slug === ref) ??
    plans.find((p) => p.name === ref) ??
    plans.find((p) => p.id.startsWith(ref)) ??
    null
  );
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
export async function cloudUnlockTask(
  client: HasnaStorageClient,
  id: string,
  agentId?: string,
  force = false,
): Promise<boolean> {
  const raw = await client.transport.post<unknown>(
    `/tasks/${encodeURIComponent(id)}/unlock`,
    { ...(agentId ? { agent_id: agentId } : {}), ...(force ? { force: true } : {}) },
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

// ───────────────────────────────────────────────────────────────────────────
// Read/analytics routing (B2 continued)
//
// The query/reporting commands (`active`, `stale`, `overdue`, `sla`, `sprint`,
// `blocked`, `ready`, `next`, `priorities`, `week`, `today`, `yesterday`,
// `summary`, `report`, `recap`, `standup`, `log`, `burndown`, `lists`, `agent`,
// `mine`) historically read this machine's LOCAL sqlite even on a flipped
// machine, so a `self_hosted` box reported its private island instead of the
// shared cloud dataset. The helpers below re-derive each of those views from the
// cloud `/v1` API so a flipped machine reports the SAME numbers as every other
// agent. Analytics that the local `db/*` helpers compute in SQL are recomputed
// client-side over the cloud task set (parity with the local full-scan
// behaviour); the few that need data the task list does not carry (activity
// history, task lists, dependency edges, the priority-ranked "next" pick) route
// to dedicated `/v1` endpoints.
// ───────────────────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
function priorityRank(priority?: string | null): number {
  return PRIORITY_RANK[priority ?? ""] ?? 4;
}

/** All non-terminal tasks (pending + in_progress) — the "active" working set. */
export async function cloudActiveTasks(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<Task[]> {
  const [pending, inProgress] = await Promise.all([
    cloudListTasks(client, { ...filter, status: "pending" as never }),
    cloudListTasks(client, { ...filter, status: "in_progress" as never }),
  ]);
  return [...pending, ...inProgress];
}

/** In-progress tasks, priority- then recency-sorted (parity with `getActiveWork`). */
export async function cloudActiveWork(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<Task[]> {
  const tasks = await cloudListTasks(client, { ...filter, status: "in_progress" as never });
  return tasks.sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
}

/** In-progress tasks whose last update (or lock) is older than `minutes` (parity with `getStaleTasks`). */
export async function cloudStaleTasks(client: HasnaStorageClient, minutes: number, filter: TaskFilter = {}): Promise<Task[]> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const tasks = await cloudListTasks(client, { ...filter, status: "in_progress" as never });
  return tasks
    .filter((t) => (t.updated_at ?? "") < cutoff || (t.locked_at != null && t.locked_at < cutoff))
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
}

/** Non-terminal tasks past their due date (parity with `getOverdueTasks`). */
export async function cloudOverdueTasks(client: HasnaStorageClient, projectId?: string, at: Date = new Date()): Promise<Task[]> {
  const nowStr = at.toISOString();
  const filter: TaskFilter = projectId ? ({ project_id: projectId } as TaskFilter) : {};
  const active = await cloudActiveTasks(client, filter);
  return active
    .filter((t) => !t.archived_at && t.due_at != null && t.due_at < nowStr)
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
}

export interface CloudEscalatedTask {
  task: Task;
  reasons: Array<"overdue" | "sla_breached">;
  breached_at: string;
}

/** Overdue or SLA-breached non-terminal tasks (parity with `getEscalatedTasks`). */
export async function cloudEscalatedTasks(
  client: HasnaStorageClient,
  opts: { project_id?: string; agent_id?: string } = {},
  at: Date = new Date(),
): Promise<CloudEscalatedTask[]> {
  const nowMs = at.getTime();
  const filter: TaskFilter = {};
  if (opts.project_id) (filter as TaskFilter).project_id = opts.project_id;
  const active = await cloudActiveTasks(client, filter);
  return active
    .filter((t) => !t.archived_at && (opts.agent_id ? t.assigned_to === opts.agent_id : true))
    .map((task) => {
      const reasons: CloudEscalatedTask["reasons"] = [];
      const breachedTimes: number[] = [];
      if (task.due_at) {
        const dueMs = new Date(task.due_at).getTime();
        if (Number.isFinite(dueMs) && dueMs < nowMs) {
          reasons.push("overdue");
          breachedTimes.push(dueMs);
        }
      }
      if (task.sla_minutes != null) {
        const startMs = new Date(task.started_at ?? task.created_at).getTime();
        const breachedMs = startMs + task.sla_minutes * 60_000;
        if (Number.isFinite(breachedMs) && breachedMs < nowMs) {
          reasons.push("sla_breached");
          breachedTimes.push(breachedMs);
        }
      }
      if (reasons.length === 0) return null;
      return { task, reasons, breached_at: new Date(Math.min(...breachedTimes)).toISOString() } satisfies CloudEscalatedTask;
    })
    .filter((item): item is CloudEscalatedTask => item !== null)
    .sort((a, b) => (a.task.due_at ?? "").localeCompare(b.task.due_at ?? "") || a.task.created_at.localeCompare(b.task.created_at));
}

/** Tasks updated since `since` (parity with `getTasksChangedSince`). */
export async function cloudChangedSince(client: HasnaStorageClient, since: string, filter: TaskFilter = {}): Promise<Task[]> {
  const tasks = await cloudListTasks(client, filter);
  return tasks
    .filter((t) => (t.updated_at ?? "") > since)
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
}

export interface CloudTaskStats {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  completion_rate: number;
  by_agent: Record<string, number>;
}

/** Task counts grouped by status/priority/agent (parity with `getTaskStats`). */
export async function cloudTaskStats(client: HasnaStorageClient, filter: TaskFilter = {}): Promise<CloudTaskStats> {
  const tasks = await cloudListTasks(client, filter);
  const by_status: Record<string, number> = {};
  const by_priority: Record<string, number> = {};
  const by_agent: Record<string, number> = {};
  for (const t of tasks) {
    by_status[t.status] = (by_status[t.status] ?? 0) + 1;
    by_priority[t.priority] = (by_priority[t.priority] ?? 0) + 1;
    const agent = t.assigned_to ?? t.agent_id ?? "unassigned";
    by_agent[agent] = (by_agent[agent] ?? 0) + 1;
  }
  const completed = by_status["completed"] ?? 0;
  return {
    total: tasks.length,
    by_status,
    by_priority,
    by_agent,
    completion_rate: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
  };
}

/**
 * Recent task-history entries (`GET /v1/activity`). Powers `log` and `burndown`.
 * Requires the `/v1/activity` server route (ECS redeploy).
 */
export async function cloudRecentActivity(client: HasnaStorageClient, limit = 50): Promise<TaskHistory[]> {
  const raw = await client.transport.get<unknown>("/activity", { query: { limit } });
  const envelope = (raw ?? {}) as { activity?: TaskHistory[]; entries?: TaskHistory[] };
  if (Array.isArray(envelope.activity)) return envelope.activity;
  if (Array.isArray(envelope.entries)) return envelope.entries;
  return Array.isArray(raw) ? (raw as TaskHistory[]) : [];
}

/**
 * Task lists (`GET /v1/task-lists`). Powers `lists`. Requires the
 * `/v1/task-lists` server route (ECS redeploy).
 */
export async function cloudListTaskLists(client: HasnaStorageClient, projectId?: string): Promise<TaskList[]> {
  const query = projectId ? { project_id: projectId } : {};
  const raw = await client.transport.get<unknown>("/task-lists", { query });
  const envelope = (raw ?? {}) as { task_lists?: TaskList[]; taskLists?: TaskList[] };
  if (Array.isArray(envelope.task_lists)) return envelope.task_lists;
  if (Array.isArray(envelope.taskLists)) return envelope.taskLists;
  return Array.isArray(raw) ? (raw as TaskList[]) : [];
}

/** Resolve a cloud task-list UUID, unique UUID prefix, or project-scoped slug. */
export async function cloudResolveTaskListRef(
  client: HasnaStorageClient,
  ref: string,
  projectId?: string,
): Promise<string> {
  const input = ref.trim();
  // An unscoped exact UUID is already canonical. A project-scoped UUID must
  // still be enumerated so create/delete callers cannot cross that boundary.
  if (UUID_RE.test(input) && !projectId) return input.toLowerCase();

  const lists = await cloudListTaskLists(client, projectId);

  const exactIds = lists.filter((list) => list.id === input);
  if (exactIds.length === 1) return exactIds[0]!.id;
  if (exactIds.length > 1) {
    throw new Error(`Task list reference is ambiguous: "${input}"`);
  }

  const slugs = lists.filter((list) => list.slug === input);
  if (slugs.length === 1) return slugs[0]!.id;
  if (slugs.length > 1) {
    throw new Error(`Task list reference is ambiguous: "${input}"`);
  }

  const prefixes = lists.filter((list) => list.id.startsWith(input));
  if (prefixes.length === 1) return prefixes[0]!.id;
  if (prefixes.length > 1) {
    throw new Error(`Task list reference is ambiguous: "${input}"`);
  }

  throw new Error(`Task list not found: "${input}"`);
}

/** Create a task list in the cloud (`POST /v1/task-lists`). */
export async function cloudCreateTaskList(
  client: HasnaStorageClient,
  input: CreateTaskListInput,
): Promise<TaskList> {
  const raw = await client.transport.post<unknown>("/task-lists", input as unknown as Record<string, unknown>);
  if (raw && typeof raw === "object" && "task_list" in (raw as Record<string, unknown>)) {
    return (raw as { task_list: TaskList }).task_list;
  }
  return raw as TaskList;
}

/** Delete a task list in the cloud (`DELETE /v1/task-lists/:id`). */
export async function cloudDeleteTaskList(client: HasnaStorageClient, id: string): Promise<boolean> {
  await client.delete("task-lists", id);
  return true;
}

/**
 * The single best pending task to work on next (`GET /v1/next`) — the server
 * applies the same agent-affinity + priority ranking + blocked-exclusion as the
 * local `getNextTask`. Powers `next`. Requires the `/v1/next` route (ECS redeploy).
 */
export async function cloudNextTask(
  client: HasnaStorageClient,
  agent?: string,
  filters?: { project_id?: string; task_list_id?: string; plan_id?: string },
): Promise<Task | null> {
  const query: Record<string, string> = {};
  if (agent) query["agent"] = agent;
  if (filters?.project_id) query["project_id"] = filters.project_id;
  if (filters?.task_list_id) query["task_list_id"] = filters.task_list_id;
  if (filters?.plan_id) query["plan_id"] = filters.plan_id;
  const raw = await client.transport.get<unknown>("/next", { query });
  if (raw == null) return null;
  const task = unwrapTask(raw);
  return task && (task as Task).id ? task : null;
}

/**
 * Every dependency edge in the shared dataset (`GET /v1/dependencies`). Edges are
 * far fewer than tasks, so this stays cheap even on the full cloud set. Powers the
 * blocked/ready/sprint/recap dependency analytics. Requires the `/v1/dependencies`
 * route (ECS redeploy).
 */
export async function cloudAllDependencies(client: HasnaStorageClient): Promise<TaskDependency[]> {
  const raw = await client.transport.get<unknown>("/dependencies");
  const envelope = (raw ?? {}) as { dependencies?: TaskDependency[] };
  if (Array.isArray(envelope.dependencies)) return envelope.dependencies;
  return Array.isArray(raw) ? (raw as TaskDependency[]) : [];
}

/** Fetch a set of tasks by id via bounded parallel `GET /v1/tasks/:id`. */
export async function cloudGetTasksByIds(client: HasnaStorageClient, ids: readonly string[]): Promise<Map<string, Task>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, Task>();
  const CONCURRENCY = 8;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const tasks = await Promise.all(batch.map((id) => cloudGetTask(client, id)));
    for (const task of tasks) if (task && task.id) map.set(task.id, task);
  }
  return map;
}

/**
 * For each candidate task, its incomplete blocking dependencies (parity with
 * `getBlockingDeps`): the tasks it depends on whose status is not `completed`.
 */
export async function cloudBlockingDepsMap(
  client: HasnaStorageClient,
  candidates: readonly Task[],
): Promise<Map<string, Task[]>> {
  const result = new Map<string, Task[]>();
  if (candidates.length === 0) return result;
  const edges = await cloudAllDependencies(client);
  const dependsByTask = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.task_id || !edge.depends_on) continue;
    const arr = dependsByTask.get(edge.task_id) ?? [];
    arr.push(edge.depends_on);
    dependsByTask.set(edge.task_id, arr);
  }
  const candidateIds = new Set(candidates.map((t) => t.id));
  const blockerIds = new Set<string>();
  for (const id of candidateIds) for (const dep of dependsByTask.get(id) ?? []) blockerIds.add(dep);
  const blockers = await cloudGetTasksByIds(client, Array.from(blockerIds));
  for (const task of candidates) {
    const deps = dependsByTask.get(task.id) ?? [];
    const incomplete = deps
      .map((depId) => blockers.get(depId))
      .filter((b): b is Task => b != null && b.status !== "completed");
    if (incomplete.length > 0) result.set(task.id, incomplete);
  }
  return result;
}

export interface CloudRecapSummary {
  hours: number;
  since: string;
  completed: Array<Task & { duration_minutes: number | null }>;
  created: Task[];
  in_progress: Task[];
  blocked: Task[];
  stale: Task[];
  agents: { name: string; completed_count: number; in_progress_count: number; last_seen_at: string }[];
}

/**
 * The `recap`/`standup` summary computed over the shared cloud dataset (parity
 * with `getRecap`): completed/created in the window, current in-progress, blocked
 * (incomplete deps), stale, and per-agent activity. Uses `/v1/dependencies` for
 * the blocked set and `/v1/agents` for the roster.
 */
export async function cloudRecap(client: HasnaStorageClient, hours: number, projectId?: string): Promise<CloudRecapSummary> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const staleWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const filter: TaskFilter = projectId ? ({ project_id: projectId } as TaskFilter) : {};
  const [all, agents] = await Promise.all([cloudListTasks(client, filter), cloudListAgents(client)]);

  const completed = all
    .filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at > since)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .map((t) => ({
      ...t,
      duration_minutes:
        t.started_at && t.completed_at
          ? Math.round((new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()) / 60000)
          : null,
    }));
  const created = all.filter((t) => t.created_at > since).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const in_progress = all
    .filter((t) => t.status === "in_progress")
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const stale = in_progress
    .filter((t) => (t.updated_at ?? "") < staleWindow)
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));

  const pending = all.filter((t) => t.status === "pending");
  const blockedMap = await cloudBlockingDepsMap(client, pending);
  const blocked = pending.filter((t) => blockedMap.has(t.id));

  const sinceMs = new Date(since).getTime();
  const agentSummaries = agents
    .map((agent) => {
      const owned = all.filter((t) => t.assigned_to === agent.id || t.agent_id === agent.id);
      return {
        name: agent.name,
        completed_count: owned.filter((t) => t.status === "completed" && t.completed_at != null && t.completed_at > since).length,
        in_progress_count: owned.filter((t) => t.status === "in_progress").length,
        last_seen_at: agent.last_seen_at,
      };
    })
    .filter((a) => a.last_seen_at != null && new Date(a.last_seen_at).getTime() > sinceMs)
    .sort((a, b) => b.completed_count - a.completed_count);

  return { hours, since, completed, created, in_progress, blocked, stale, agents: agentSummaries };
}

export interface CloudTimelineEntry {
  id: string;
  source: string;
  event_type: string;
  entity_type: "task";
  entity_id: string;
  task_id: string;
  project_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  created_at: string;
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
}

export interface CloudTimelinePage {
  entries: CloudTimelineEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface CloudTimelineOptions {
  entity_type?: "task" | "run" | "project" | "plan";
  entity_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

/**
 * A cloud activity timeline built from the shared task-history ledger
 * (`GET /v1/activity`). The shared cloud dataset only carries task history (not the
 * local run-ledger / project / plan sources), so `entity_type` filters other than
 * `task` return no rows — a documented degradation from the richer local timeline.
 */
export async function cloudTimeline(client: HasnaStorageClient, options: CloudTimelineOptions = {}): Promise<CloudTimelinePage> {
  const activity = await cloudRecentActivity(client, 5000);
  let entries: CloudTimelineEntry[] = activity.map((h) => ({
    id: h.id,
    source: "task_history",
    event_type: h.action,
    entity_type: "task" as const,
    entity_id: h.task_id,
    task_id: h.task_id,
    project_id: null,
    plan_id: null,
    run_id: null,
    agent_id: h.agent_id ?? null,
    created_at: h.created_at,
    title: "",
    message: h.field
      ? `${h.field}: ${h.old_value ?? ""}${h.new_value != null ? ` -> ${h.new_value}` : ""}`.trim()
      : null,
    metadata: {},
  }));
  if (options.entity_type && options.entity_type !== "task") {
    entries = [];
  } else if (options.entity_type === "task" && options.entity_id) {
    entries = entries.filter((e) => e.task_id === options.entity_id);
  }
  if (options.since) entries = entries.filter((e) => e.created_at >= options.since!);
  if (options.until) entries = entries.filter((e) => e.created_at <= options.until!);
  entries.sort((a, b) => (options.order === "asc" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  const total = entries.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  return { entries: entries.slice(offset, offset + limit), total, limit, offset };
}
