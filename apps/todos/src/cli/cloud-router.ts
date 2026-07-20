/**
 * Authenticated `/v1` routing for the open Todos CLI.
 *
 * Local mode remains SQLite-backed. An explicit remote/self-hosted mode instead
 * requires the canonical API URL and API key, validates the authority before a
 * local-capable command module can run, and never falls back to SQLite. This is
 * the repo-owned self-hosted REST contract; it has no dependency on a private
 * SaaS API or database connection string.
 */
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import { resolve as resolvePath } from "node:path";
import type { Agent, CreatePlanInput, CreateTaskListInput, Plan, Project, RegisterAgentInput, Task, TaskComment, TaskDependency, TaskFilter, TaskHistory, TaskList, UpdatePlanInput, UpdateTaskListInput } from "../types/index.js";
import { redactEvidenceText } from "../lib/redaction.js";

type Env = Record<string, string | undefined>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOUD_MODES = new Set(["self_hosted", "cloud", "remote", "hybrid"]);
const VALID_STORAGE_MODES = new Set(["local", ...CLOUD_MODES]);
const COMPLETION_EVIDENCE_FIELDS = [
  "attachment_ids",
  "files_changed",
  "test_results",
  "commit_hash",
  "notes",
  "confidence",
] as const;

export interface CloudTaskCompletionInput {
  agent_id?: string;
  attachment_ids?: string[];
  files_changed?: string[];
  test_results?: string;
  commit_hash?: string;
  notes?: string;
  confidence?: number;
}

const completionCapabilityCache = new Map<string, Promise<ReadonlySet<string>>>();

export interface TodosRemoteAuthorityConfigStatus {
  selected: boolean;
  ok: boolean;
  mode: string;
  api_url_configured: boolean;
  api_key_configured: boolean;
  v1_base_url: string | null;
  issues: string[];
  local_fallback: false;
}

export interface TodosCliStorageModeResolution {
  mode: string;
  selected: boolean;
  source: "HASNA_TODOS_STORAGE_MODE" | "TODOS_STORAGE_MODE" | "default";
}

function cleanMode(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function modeRole(mode: string): "local" | "remote" {
  return mode === "local" ? "local" : "remote";
}

/**
 * Resolve the CLI storage selector without allowing an invalid or conflicting
 * environment to drift into SQLite. Empty canonical values do not mask the
 * legacy fallback; explicit canonical/fallback disagreement is rejected.
 */
export function resolveTodosCliStorageMode(env: Env = process.env as Env): TodosCliStorageModeResolution {
  for (const source of ["HASNA_TODOS_STORAGE_MODE", "TODOS_STORAGE_MODE"] as const) {
    if (env[source] !== undefined && env[source]!.trim() === "") {
      throw new Error(
        `REMOTE_STORAGE_MODE_INVALID: ${source} must not be blank; local SQLite fallback is disabled for invalid routing state`,
      );
    }
  }
  const canonical = cleanMode(env.HASNA_TODOS_STORAGE_MODE);
  const fallback = cleanMode(env.TODOS_STORAGE_MODE);

  for (const [source, value] of [
    ["HASNA_TODOS_STORAGE_MODE", canonical],
    ["TODOS_STORAGE_MODE", fallback],
  ] as const) {
    if (value && !VALID_STORAGE_MODES.has(value)) {
      throw new Error(
        `REMOTE_STORAGE_MODE_INVALID: ${source}=${value} must be local, remote, self_hosted, cloud, or hybrid; ` +
          "local SQLite fallback is disabled for invalid routing state",
      );
    }
  }

  if (canonical && fallback && modeRole(canonical) !== modeRole(fallback)) {
    throw new Error(
      `REMOTE_STORAGE_MODE_CONFLICT: HASNA_TODOS_STORAGE_MODE=${canonical} conflicts with ` +
        `TODOS_STORAGE_MODE=${fallback}; local SQLite fallback is disabled`,
    );
  }

  const mode = canonical ?? fallback ?? "local";
  return {
    mode,
    selected: CLOUD_MODES.has(mode),
    source: canonical
      ? "HASNA_TODOS_STORAGE_MODE"
      : fallback
        ? "TODOS_STORAGE_MODE"
        : "default",
  };
}

function requestedStorageMode(env: Env): string {
  return resolveTodosCliStorageMode(env).mode;
}

function normalizeRemoteAuthorityUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      "REMOTE_API_URL_INVALID: HASNA_TODOS_API_URL must be an absolute http(s) URL; local SQLite fallback is disabled",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      "REMOTE_API_URL_INVALID: HASNA_TODOS_API_URL must be an absolute http(s) URL; local SQLite fallback is disabled",
    );
  }
  if (url.username || url.password) {
    throw new Error(
      "REMOTE_API_URL_INVALID: HASNA_TODOS_API_URL must not contain userinfo; local SQLite fallback is disabled",
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      "REMOTE_API_URL_INVALID: HASNA_TODOS_API_URL must not contain a query or fragment; local SQLite fallback is disabled",
    );
  }
  if (url.pathname !== "/" && url.pathname !== "/v1" && url.pathname !== "/v1/") {
    throw new Error(
      "REMOTE_API_URL_INVALID: HASNA_TODOS_API_URL must be an authority root or end in /v1, not /api/v1 or another path; " +
        "local SQLite fallback is disabled",
    );
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (url.protocol === "http:" && !loopback) {
    throw new Error(
      "REMOTE_API_URL_INVALID: plaintext HTTP is allowed only for loopback Todos authorities; local SQLite fallback is disabled",
    );
  }
  return url.origin;
}

export function getTodosRemoteAuthorityConfigStatus(
  env: Env = process.env as Env,
): TodosRemoteAuthorityConfigStatus {
  let resolution: TodosCliStorageModeResolution;
  try {
    resolution = resolveTodosCliStorageMode(env);
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    return {
      selected: true,
      ok: false,
      mode: cleanMode(env.HASNA_TODOS_STORAGE_MODE) ?? cleanMode(env.TODOS_STORAGE_MODE) ?? "invalid",
      api_url_configured: Boolean(env.HASNA_TODOS_API_URL?.trim()),
      api_key_configured: Boolean(env.HASNA_TODOS_API_KEY?.trim()),
      v1_base_url: null,
      issues: [issue],
      local_fallback: false,
    };
  }
  const { mode, selected } = resolution;
  if (!selected) {
    return {
      selected: false,
      ok: true,
      mode: mode || "local",
      api_url_configured: false,
      api_key_configured: false,
      v1_base_url: null,
      issues: [],
      local_fallback: false,
    };
  }

  const issues: string[] = [];
  let apiUrl: string | null = null;
  try {
    apiUrl = normalizeRemoteAuthorityUrl(env.HASNA_TODOS_API_URL);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  const apiKeyConfigured = Boolean(env.HASNA_TODOS_API_KEY?.trim());
  if (!apiUrl && issues.length === 0) {
    issues.push(
      "REMOTE_API_URL_MISSING: remote Todos storage requires HASNA_TODOS_API_URL; local SQLite fallback is disabled",
    );
  }
  if (!apiKeyConfigured) {
    issues.push(
      "REMOTE_API_KEY_MISSING: remote Todos storage requires HASNA_TODOS_API_KEY; local SQLite fallback is disabled",
    );
  }

  return {
    selected: true,
    ok: issues.length === 0,
    mode,
    api_url_configured: apiUrl !== null,
    api_key_configured: apiKeyConfigured,
    v1_base_url: apiUrl ? `${apiUrl}/v1` : null,
    issues,
    local_fallback: false,
  };
}

function requireTodosRemoteAuthorityEnv(env: Env): Env {
  const status = getTodosRemoteAuthorityConfigStatus(env);
  if (!status.ok) throw new Error(status.issues[0]);
  return {
    ...env,
    HASNA_TODOS_STORAGE_MODE: "cloud",
    HASNA_TODOS_API_URL: status.v1_base_url!.replace(/\/v1$/, ""),
    HASNA_TODOS_API_KEY: env.HASNA_TODOS_API_KEY!.trim(),
  };
}

function classifyRemoteRequestError(baseUrl: string, route: string, error: unknown): never {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (status === 401) {
    throw new Error(
      `REMOTE_API_UNAUTHORIZED: configured Todos authority ${baseUrl} rejected HASNA_TODOS_API_KEY for ${route}; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
  if (status === 403) {
    throw new Error(
      `REMOTE_API_FORBIDDEN: configured Todos authority ${baseUrl} denied ${route}; local SQLite fallback is disabled`,
      { cause: error },
    );
  }
  if (typeof status === "number" && status >= 300 && status < 400) {
    throw new Error(
      `REMOTE_API_REDIRECT_REJECTED: configured Todos authority ${baseUrl} redirected ${route}; ` +
        "authenticated redirects are disabled to prevent credential leakage",
      { cause: error },
    );
  }
  if (typeof status === "number" && status >= 500) {
    throw new Error(
      `REMOTE_API_UNAVAILABLE: configured Todos authority ${baseUrl} returned HTTP ${status} for ${route}; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if ((error instanceof Error && error.name === "AbortError") || /abort|timed?\s*out/i.test(message)) {
    throw new Error(
      `REMOTE_API_TIMEOUT: configured Todos authority ${baseUrl} timed out for ${route}; local SQLite fallback is disabled`,
      { cause: error },
    );
  }
  if (status === undefined) {
    throw new Error(
      `REMOTE_API_UNREACHABLE: configured Todos authority ${baseUrl} could not be reached for ${route}; ` +
        "local SQLite fallback is disabled",
      { cause: error },
    );
  }
  throw error;
}

function protectRemoteClient(client: HasnaStorageClient): HasnaStorageClient {
  const baseUrl = remoteAuthorityBase(client);
  const protect = async <T>(route: string, request: () => Promise<T>): Promise<T> => {
    try {
      return await request();
    } catch (error) {
      return classifyRemoteRequestError(baseUrl, route, error);
    }
  };
  const transport = client.transport;
  const protectedTransport = {
    baseUrl: transport.baseUrl,
    request: <T = unknown>(method: string, path: string, body?: unknown, options?: Parameters<typeof transport.request>[3]) =>
      protect(path, () => transport.request<T>(method, path, body, options)),
    get: <T = unknown>(path: string, options?: Parameters<typeof transport.get>[1]) =>
      protect(path, () => transport.get<T>(path, options)),
    post: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.post>[2]) =>
      protect(path, () => transport.post<T>(path, body, options)),
    put: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.put>[2]) =>
      protect(path, () => transport.put<T>(path, body, options)),
    patch: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.patch>[2]) =>
      protect(path, () => transport.patch<T>(path, body, options)),
    del: <T = unknown>(path: string, body?: unknown, options?: Parameters<typeof transport.del>[2]) =>
      protect(path, () => transport.del<T>(path, body, options)),
  };
  return {
    name: client.name,
    baseUrl: client.baseUrl,
    transport: protectedTransport,
    list: (resource, options) => protect(`/${resource}`, () => client.list(resource, options)),
    get: (resource, id, options) => protect(`/${resource}/${encodeURIComponent(id)}`, () => client.get(resource, id, options)),
    create: (resource, body, options) => protect(`/${resource}`, () => client.create(resource, body, options)),
    update: (resource, id, patch, options) => protect(`/${resource}/${encodeURIComponent(id)}`, () => client.update(resource, id, patch, options)),
    delete: (resource, id, options) => protect(`/${resource}/${encodeURIComponent(id)}`, () => client.delete(resource, id, options)),
  };
}

function remoteAuthorityBase(client: HasnaStorageClient): string {
  return client.baseUrl.replace(/\/v1\/?$/, "");
}

async function requiredRemoteRoute<T>(
  client: HasnaStorageClient,
  route: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    if (status === 404) {
      throw new Error(
        `REMOTE_API_INCOMPATIBLE: configured Todos authority ${remoteAuthorityBase(client)} does not expose ${route}; ` +
          "deploy the @hasna/todos /v1 server contract before retrying; local SQLite fallback is disabled",
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Resolve the Todos HTTP storage client from the environment. Returns a ready
 * client for an explicit remote mode, or `null` for local mode. A selected
 * remote mode with a missing or invalid URL/key always throws.
 */
export function getTodosCloudClient(env: Env = process.env as Env): HasnaStorageClient | null {
  // Never route over HTTP from URL/key presence alone. The mode is the explicit
  // authority selector; an absent selector preserves the local default.
  const mode = requestedStorageMode(env);
  if (!CLOUD_MODES.has(mode)) return null;
  const resolved = resolveStorageClient("todos", requireTodosRemoteAuthorityEnv(env), {
    fetchImpl: (input, init) => globalThis.fetch(input, { ...init, redirect: "manual" }),
  });
  return resolved.transport === "cloud-http" ? protectRemoteClient(resolved.client) : null;
}

/** True when the CLI should route task reads/writes to the cloud API. */
export function isCloudRouting(env: Env = process.env as Env): boolean {
  return getTodosCloudClient(env) !== null;
}

/** Backward-compatible test hook; authority clients are never process-cached. */
export function resetTodosCloudClient(): void {
  // Only protocol capabilities are cached, keyed by authority rather than credentials.
  completionCapabilityCache.clear();
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
  if (filter.include_subtasks !== undefined) query["include_subtasks"] = filter.include_subtasks ? "true" : "false";
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
  const res = await requiredRemoteRoute(client, "/v1/tasks", () =>
    client.list<Task>("tasks", { query: toListQuery(filter) }));
  const envelope = res.raw as { tasks?: Task[] } | undefined;
  return Array.isArray(envelope?.tasks) ? envelope!.tasks : res.items;
}

/**
 * Resolve an exact UUID, an exact short id, or a unique task-id prefix to a
 * canonical task UUID over `/v1` in a SINGLE bounded request. Full UUIDs
 * short-circuit with no round trip. Every other reference is resolved
 * SERVER-SIDE via `GET /v1/tasks/:ref` (an indexed short_id / id-prefix lookup),
 * so the CLI never pages the entire task set to expand a short reference — the
 * O(all-tasks) client-side download that hung on large shared datasets. A 409
 * from the authority means the prefix is ambiguous; a miss means the task is
 * absent (or the authority predates short-reference resolution, in which case
 * deploy the current `@hasna/todos` `/v1` server). No local fallback is used.
 */
export async function cloudResolveTaskRef(client: HasnaStorageClient, ref: string): Promise<string> {
  const input = ref.trim().toLowerCase();
  if (!input) throw new Error("Task reference must not be empty");
  if (UUID_RE.test(input)) return input;

  let task: Task | null;
  try {
    task = await cloudGetTask(client, input);
  } catch (error) {
    const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
    if (status === 409) throw new Error(`Task reference is ambiguous: "${ref}"`);
    throw error;
  }

  // Defend against a server returning an unrelated task: the resolved task must
  // actually carry the requested short_id or start with the requested id prefix.
  if (
    task &&
    typeof task.id === "string" &&
    (task.short_id?.toLowerCase() === input || task.id.toLowerCase().startsWith(input))
  ) {
    return task.id;
  }
  throw new Error(`Task not found: ${ref}`);
}

/** Fetch one task by id (`GET /v1/tasks/:id`); `null` on 404. */
export async function cloudGetTask(client: HasnaStorageClient, id: string): Promise<Task | null> {
  const raw = await client.get<unknown>("tasks", id);
  return raw == null ? null : unwrapTask(raw);
}

/** Create a task (`POST /v1/tasks`, retry-safe idempotency key). */
export async function cloudCreateTask(client: HasnaStorageClient, input: Record<string, unknown>): Promise<Task> {
  return unwrapTask(await requiredRemoteRoute(client, "/v1/tasks", () => client.create<unknown>("tasks", input)));
}

/** Update a task (`PATCH /v1/tasks/:id`). */
export async function cloudUpdateTask(client: HasnaStorageClient, id: string, patch: Record<string, unknown>): Promise<Task> {
  return unwrapTask(await client.update<unknown>("tasks", id, patch));
}

/** Delete a task (`DELETE /v1/tasks/:id`); resolves for 2xx and 404. */
export async function cloudDeleteTask(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del(`/tasks/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
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

function resolveOpenApiSchema(document: unknown, schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const value = schema as Record<string, unknown>;
  if (typeof value["$ref"] !== "string") return value;
  const reference = value["$ref"] as string;
  if (!reference.startsWith("#/")) return null;
  let current: unknown = document;
  for (const segment of reference.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : null;
}

async function fetchCompletionCapabilities(client: HasnaStorageClient): Promise<ReadonlySet<string>> {
  const document = await requiredRemoteRoute(client, "/v1/openapi.json", () =>
    client.transport.get<unknown>("/openapi.json"));
  if (!document || typeof document !== "object" || Array.isArray(document)) return new Set();
  const doc = document as Record<string, unknown>;
  const paths = doc["paths"];
  const completePath = paths && typeof paths === "object" && !Array.isArray(paths)
    ? (paths as Record<string, unknown>)["/v1/tasks/{id}/complete"]
    : undefined;
  const post = completePath && typeof completePath === "object" && !Array.isArray(completePath)
    ? (completePath as Record<string, unknown>)["post"]
    : undefined;
  const requestBody = post && typeof post === "object" && !Array.isArray(post)
    ? (post as Record<string, unknown>)["requestBody"]
    : undefined;
  const content = requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
    ? (requestBody as Record<string, unknown>)["content"]
    : undefined;
  const jsonContent = content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)["application/json"]
    : undefined;
  const schema = jsonContent && typeof jsonContent === "object" && !Array.isArray(jsonContent)
    ? (jsonContent as Record<string, unknown>)["schema"]
    : undefined;
  const resolved = resolveOpenApiSchema(document, schema);
  const properties = resolved?.["properties"];
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
}

async function requireCompletionCapabilities(
  client: HasnaStorageClient,
  body: CloudTaskCompletionInput,
): Promise<void> {
  const requested = COMPLETION_EVIDENCE_FIELDS.filter((field) => body[field] !== undefined);
  if (requested.length === 0) return;
  const authority = remoteAuthorityBase(client);
  let capability = completionCapabilityCache.get(authority);
  if (!capability) {
    capability = fetchCompletionCapabilities(client);
    completionCapabilityCache.set(authority, capability);
  }
  const supported = await capability;
  const missing = requested.filter((field) => !supported.has(field));
  if (missing.length > 0) {
    throw new Error(
      `REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED: configured Todos authority ${authority} does not advertise ` +
        `${missing.join(", ")} in POST /v1/tasks/{id}/complete; no completion mutation was sent`,
    );
  }
}

/** Complete a task, preflighting evidence-bearing bodies against this authority's OpenAPI contract. */
export async function cloudCompleteTask(
  client: HasnaStorageClient,
  id: string,
  body: CloudTaskCompletionInput = {},
): Promise<Task> {
  await requireCompletionCapabilities(client, body);
  return cloudTaskAction(client, id, "complete", body as Record<string, unknown>);
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
  const raw = await requiredRemoteRoute(client, "/v1/stats", () =>
    client.transport.get<unknown>("/stats"));
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
  const res = await requiredRemoteRoute(client, "/v1/projects", () => client.list<Project>("projects"));
  const envelope = res.raw as { projects?: Project[] } | undefined;
  return Array.isArray(envelope?.projects) ? envelope!.projects : res.items;
}

function unwrapProject(raw: unknown): Project {
  if (raw && typeof raw === "object" && "project" in (raw as Record<string, unknown>)) {
    return (raw as { project: Project }).project;
  }
  return raw as Project;
}

export async function cloudCreateProject(
  client: HasnaStorageClient,
  input: Record<string, unknown>,
): Promise<Project> {
  return unwrapProject(await requiredRemoteRoute(client, "/v1/projects", () => client.create("projects", input)));
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
function resolveCloudProjectRef(projects: Project[], ref: string): string {
  const input = ref.trim();
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

export async function cloudResolveProjectRef(client: HasnaStorageClient, ref: string): Promise<string> {
  return resolveCloudProjectRef(await cloudListProjects(client), ref);
}

export async function cloudResolveProject(client: HasnaStorageClient, ref: string): Promise<Project> {
  const projects = await cloudListProjects(client);
  const id = resolveCloudProjectRef(projects, ref);
  return projects.find((project) => project.id === id)!;
}

/** Update one cloud project by exact UUID (`PATCH /v1/projects/:id`). */
export async function cloudUpdateProject(
  client: HasnaStorageClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Project> {
  const raw = await client.update<unknown>("projects", id, patch);
  if (raw && typeof raw === "object" && "project" in (raw as Record<string, unknown>)) {
    return (raw as { project: Project }).project;
  }
  return raw as Project;
}

/** List plans from the cloud (`GET /v1/plans`), optionally scoped to a project. */
export async function cloudListPlans(client: HasnaStorageClient, projectId?: string): Promise<Plan[]> {
  const query = projectId ? { project_id: projectId } : {};
  const res = await requiredRemoteRoute(client, "/v1/plans", () => client.list<Plan>("plans", { query }));
  const envelope = res.raw as { plans?: Plan[] } | undefined;
  return Array.isArray(envelope?.plans) ? envelope!.plans : res.items;
}

function unwrapPlan(raw: unknown): Plan {
  if (raw && typeof raw === "object" && "plan" in (raw as Record<string, unknown>)) {
    return (raw as { plan: Plan }).plan;
  }
  return raw as Plan;
}

/** Create one cloud plan (`POST /v1/plans`). */
export async function cloudCreatePlan(client: HasnaStorageClient, input: CreatePlanInput): Promise<Plan> {
  return unwrapPlan(await requiredRemoteRoute(client, "/v1/plans", () =>
    client.create<unknown>("plans", input as unknown as Record<string, unknown>)));
}

/** Update one cloud plan (`PATCH /v1/plans/:id`). */
export async function cloudUpdatePlan(client: HasnaStorageClient, id: string, patch: UpdatePlanInput): Promise<Plan> {
  return unwrapPlan(await client.update<unknown>("plans", id, patch as unknown as Record<string, unknown>));
}

/** Delete one cloud plan (`DELETE /v1/plans/:id`). */
export async function cloudDeletePlan(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del<unknown>(`/plans/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 404) {
      return false;
    }
    throw error;
  }
  return true;
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
  const raw = await requiredRemoteRoute(client, "/v1/tasks/upsert", () =>
    client.transport.post<unknown>("/tasks/upsert", input));
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
  const res = await requiredRemoteRoute(client, "/v1/tasks", () =>
    client.list<Task>("tasks", { query: { ...toListQuery(rest), limit: 1 } }));
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
  const normalizedRef = ref.toLowerCase();
  if (UUID_RE.test(ref)) {
    const direct = await client.get<unknown>("plans", normalizedRef);
    if (direct) {
      const plan = unwrapPlan(direct);
      if (!projectId || plan.project_id === projectId) return plan;
    }
  }
  const plans = await cloudListPlans(client, projectId);
  const matchGroups = [
    plans.filter((plan) => plan.id.toLowerCase() === normalizedRef),
    plans.filter((plan) => plan.slug === ref),
    plans.filter((plan) => plan.name === ref),
    plans.filter((plan) => plan.id.toLowerCase().startsWith(normalizedRef)),
  ];
  for (const matches of matchGroups) {
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new Error(`Plan reference is ambiguous: "${ref}"`);
  }
  return null;
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
  const raw = await requiredRemoteRoute(client, "/v1/task-lists", () =>
    client.transport.get<unknown>("/task-lists", { query }));
  const envelope = (raw ?? {}) as { task_lists?: TaskList[]; taskLists?: TaskList[] };
  if (Array.isArray(envelope.task_lists)) return envelope.task_lists;
  if (Array.isArray(envelope.taskLists)) return envelope.taskLists;
  return Array.isArray(raw) ? (raw as TaskList[]) : [];
}

function unwrapTaskList(raw: unknown): TaskList {
  if (raw && typeof raw === "object" && "task_list" in (raw as Record<string, unknown>)) {
    return (raw as { task_list: TaskList }).task_list;
  }
  return raw as TaskList;
}

export async function cloudGetTaskList(client: HasnaStorageClient, id: string): Promise<TaskList | null> {
  const raw = await client.get<unknown>("task-lists", id);
  return raw == null ? null : unwrapTaskList(raw);
}

/** Resolve a cloud task-list UUID, unique UUID prefix, or project-scoped slug. */
export async function cloudResolveTaskListRef(
  client: HasnaStorageClient,
  ref: string,
  projectId?: string,
): Promise<string> {
  const input = ref.trim();
  const normalizedIdRef = input.toLowerCase();
  // An unscoped exact UUID is already canonical. A project-scoped UUID must
  // still be enumerated so create/delete callers cannot cross that boundary.
  if (UUID_RE.test(input) && !projectId) return normalizedIdRef;

  const lists = await cloudListTaskLists(client, projectId);

  const exactIds = lists.filter((list) => list.id.toLowerCase() === normalizedIdRef);
  if (exactIds.length === 1) return exactIds[0]!.id;
  if (exactIds.length > 1) {
    throw new Error(`Task list reference is ambiguous: "${input}"`);
  }

  const slugs = lists.filter((list) => list.slug === input);
  if (slugs.length === 1) return slugs[0]!.id;
  if (slugs.length > 1) {
    throw new Error(`Task list reference is ambiguous: "${input}"`);
  }

  const prefixes = lists.filter((list) => list.id.toLowerCase().startsWith(normalizedIdRef));
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
  return unwrapTaskList(await requiredRemoteRoute(client, "/v1/task-lists", () =>
    client.transport.post<unknown>("/task-lists", input as unknown as Record<string, unknown>)));
}

/** Update one cloud task list by exact UUID (`PATCH /v1/task-lists/:id`). */
export async function cloudUpdateTaskList(
  client: HasnaStorageClient,
  id: string,
  patch: UpdateTaskListInput,
): Promise<TaskList> {
  return unwrapTaskList(await client.update<unknown>("task-lists", id, patch as unknown as Record<string, unknown>));
}

/** Rename a cloud project through the server's atomic cascade operation. */
export async function cloudRenameProject(
  client: HasnaStorageClient,
  ref: string,
  newSlug: string,
  name?: string,
): Promise<{ project: Project; task_lists_updated: number }> {
  const id = await cloudResolveProjectRef(client, ref);
  const normalizedSlug = cloudProjectSlug(newSlug);
  if (!normalizedSlug) throw new Error("Invalid slug — must be non-empty kebab-case");
  return client.transport.post<{ project: Project; task_lists_updated: number }>(
    `/projects/${encodeURIComponent(id)}/rename`,
    { new_slug: normalizedSlug, ...(name !== undefined ? { name } : {}) },
  );
}

/** Delete a task list in the cloud (`DELETE /v1/task-lists/:id`). */
export async function cloudDeleteTaskList(client: HasnaStorageClient, id: string): Promise<boolean> {
  try {
    await client.transport.del(`/task-lists/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
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
  const raw = await requiredRemoteRoute(client, "/v1/next", () =>
    client.transport.get<unknown>("/next", { query }));
  if (raw == null) return null;
  const task = unwrapTask(raw);
  return task && (task as Task).id ? task : null;
}

/** Atomically claim the shared queue's next task (`POST /v1/tasks/next/claim`). */
export async function cloudClaimNext(client: HasnaStorageClient, agentId: string): Promise<Task | null> {
  const raw = await requiredRemoteRoute(client, "/v1/tasks/next/claim", () =>
    client.transport.post<unknown>("/tasks/next/claim", { agent_id: agentId }));
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
