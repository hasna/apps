/**
 * Comprehensive REST SDK Client for @hasna/todos
 *
 * Zero-dependency HTTP client covering ALL REST API endpoints.
 * Typed errors, cursor pagination, batch operations, SSE subscriptions.
 *
 * @example
 * ```ts
 * import { TodosClient } from "@hasna/todos";
 *
 * const client = new TodosClient(); // uses local TODOS_URL or localhost:19427
 * const tasks = await client.tasks.list({ status: "pending", limit: 20 });
 * await client.tasks.complete(taskId);
 * ```
 */

import type {
  Task,
  Agent,
  Project,
  Plan,
  Org,
  Webhook,
  TaskTemplate,
  TaskComment,
  TaskHistory,
  CreateTaskInput,
  CreateProjectInput,
  CreatePlanInput,
  UpdatePlanInput,
  CreateOrgInput,
  CreateWebhookInput,
  CreateTemplateInput,
  RegisterAgentInput,
  DashboardStats,
  TaskSummary,
  TaskPriority,
} from "../types/index.js";

import type {
  TodosClientOptions,
  SSEEvent,
  TaskStatusResponse,
  TaskNextResponse,
  TaskActiveResponse,
  TaskStaleResponse,
  TaskChangedResponse,
  TaskContextResponse,
  TaskProgressResponse,
  TaskAttachmentsResponse,
  TaskFailResponse,
  TaskBulkResponse,
  AgentMeResponse,
  AgentQueueResponse,
  OrgNode,
  PlanWithTasks,
  ReportResponse,
  DoctorResponse,
} from "./types.js";

export type { TodosClientOptions } from "./types.js";

import {
  TodosAPIError,
  TodosNotFoundError,
  TodosConflictError,
  TodosUnauthorizedError,
  TodosRateLimitError,
  TodosTimeoutError,
} from "./types.js";
import { getLocalApiConfig, normalizeApiUrl } from "../lib/config.js";
import { resolveTodosStorageRole } from "../storage/config.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

type QueryValue = string | number | boolean | string[] | undefined;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 5;
const REDIRECT_BODY_HEADERS = [
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-type",
  "transfer-encoding",
] as const;

function isLoopbackApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (LOOPBACK_HOSTS.has(url.hostname)) return true;
    const octets = url.hostname.split(".");
    return octets.length === 4
      && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
      && Number(octets[0]) === 127;
  } catch {
    return false;
  }
}

function hasDedicatedHostedApiIntent(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.HASNA_TODOS_API_URL?.trim()
      || env.HASNA_TODOS_API_KEY?.trim(),
  );
}

function assertTodosSdkLocalAuthority(baseUrl?: string | null): void {
  const role = resolveTodosStorageRole(process.env);
  const reason = role.role !== "local"
    ? role.reason
    : hasDedicatedHostedApiIntent(process.env)
      ? "dedicated_hosted_api_intent"
      : baseUrl && !isLoopbackApiBaseUrl(baseUrl)
        ? "non_loopback_api_url"
        : null;
  if (!reason) return;
  throw new TodosAPIError(
    `HOSTED_AUTHORITY_UNAVAILABLE: ${reason}`,
    503,
    "Service Unavailable",
    { code: "HOSTED_AUTHORITY_UNAVAILABLE", reason },
  );
}

function assertTodosSdkRequestAuthority(baseUrl: string, requestUrl: string): void {
  assertTodosSdkLocalAuthority(baseUrl);
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(requestUrl, base);
  } catch {
    throwHostedSdkUnavailable("invalid_request_url");
  }
  if (!isLoopbackApiBaseUrl(target.toString()) || target.origin !== base.origin) {
    throwHostedSdkUnavailable("cross_origin_request_url");
  }
}

function throwHostedSdkUnavailable(reason: string): never {
  throw new TodosAPIError(
    `HOSTED_AUTHORITY_UNAVAILABLE: ${reason}`,
    503,
    "Service Unavailable",
    { code: "HOSTED_AUTHORITY_UNAVAILABLE", reason },
  );
}

function snapshotTodosClientOptions(options: TodosClientOptions): TodosClientOptions {
  const snapshot: TodosClientOptions = {};
  for (const key of ["baseUrl", "apiKey", "timeout", "maxRetries", "retryDelay"] as const) {
    let value: unknown;
    try {
      value = Reflect.get(options, key);
    } catch {
      throwHostedSdkUnavailable("unreadable_options");
    }
    if (
      value !== undefined &&
      ((key === "baseUrl" || key === "apiKey")
        ? typeof value !== "string"
        : typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "maxRetries" ? 0 : 1))
    ) {
      throwHostedSdkUnavailable("invalid_options");
    }
    if (value !== undefined) {
      (snapshot as Record<string, unknown>)[key] = value;
      // A remote base URL is already sufficient to deny construction. Do not
      // inspect apiKey, retry, or timeout getters after that decision exists.
      if (key === "baseUrl") assertTodosSdkLocalAuthority(normalizeApiUrl(value as string));
    }
  }
  return snapshot;
}

function isHostedAuthorityUnavailable(error: unknown): boolean {
  try {
    if (!(error instanceof TodosAPIError) || error.status !== 503) return false;
    const body = error.body;
    return Boolean(
      body
        && typeof body === "object"
        && Reflect.get(body, "code") === "HOSTED_AUTHORITY_UNAVAILABLE",
    );
  } catch {
    return false;
  }
}

/**
 * Follow only bounded, same-origin redirects under explicit manual control.
 * Kept outside the public class prototype so Stage-A hardening does not change
 * the reflection surface shipped at the pinned base.
 */
async function fetchFollowingSafeRedirects(
  baseUrl: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let currentUrl = url;
  let currentInit = init;
  let redirectHops = 0;

  while (true) {
    assertTodosSdkRequestAuthority(baseUrl, currentUrl);
    const response = await fetch(currentUrl, {
      ...currentInit,
      redirect: "manual",
    });
    if (!REDIRECT_STATUS_CODES.has(response.status)) return response;

    // Cleanup is best-effort and deliberately detached. A hostile body can
    // return a never-settling cancellation promise; that secondary cleanup
    // must not bypass the request timeout or delay the typed redirect decision.
    cancelRedirectResponseBody(response);
    if (redirectHops >= MAX_REDIRECT_HOPS) {
      throwHostedSdkUnavailable("too_many_redirects");
    }

    const location = response.headers.get("location");
    if (!location) throwHostedSdkUnavailable("invalid_redirect_url");
    let target: URL;
    try {
      target = new URL(location, currentUrl);
    } catch {
      throwHostedSdkUnavailable("invalid_redirect_url");
    }

    // This check must precede the next fetch. The headers already contain the
    // API key, so following first and validating afterward would leak it.
    assertTodosSdkRequestAuthority(baseUrl, target.toString());

    const method = (currentInit.method ?? "GET").toUpperCase();
    const switchToGet = (response.status === 303 && method !== "GET" && method !== "HEAD")
      || ((response.status === 301 || response.status === 302) && method === "POST");
    if (switchToGet) {
      const headers = new Headers(currentInit.headers);
      for (const name of REDIRECT_BODY_HEADERS) headers.delete(name);
      currentInit = {
        ...currentInit,
        method: "GET",
        body: undefined,
        headers,
      };
    } else if (currentInit.body instanceof ReadableStream) {
      throwHostedSdkUnavailable("unreplayable_redirect_body");
    }

    currentUrl = target.toString();
    redirectHops += 1;
  }
}

function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// ── Namespaced sub-clients ───────────────────────────────────────────────────

class TasksResource {
  constructor(private client: TodosClient) {}

  /** List tasks with optional filters. Supports cursor pagination. */
  async list(options?: {
    status?: string;
    project_id?: string;
    session_id?: string;
    agent_id?: string;
    assigned_to?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
    fields?: string | string[];
  }): Promise<TaskSummary[]> {
    return this.client._get<TaskSummary[]>("/api/tasks", buildQuery(options || {}));
  }

  /** Get a single task by ID */
  async get(id: string, options?: { fields?: string | string[] }): Promise<TaskSummary> {
    return this.client._get<TaskSummary>(`/api/tasks/${id}`, buildQuery(options || {}));
  }

  /** Get task with full relations (subtasks, dependencies, comments, checklist) */
  async getWithRelations(id: string): Promise<Task> {
    return this.client._get<Task>(`/api/tasks/${id}`, buildQuery({ format: "full" }));
  }

  /** Create a new task */
  async create(data: CreateTaskInput & { agent_id?: string }): Promise<TaskSummary> {
    return this.client._post<TaskSummary>("/api/tasks", data as unknown as Record<string, unknown>);
  }

  /** Update a task (PATCH — only allowed fields) */
  async update(id: string, data: Record<string, unknown>): Promise<TaskSummary> {
    return this.client._patch<TaskSummary>(`/api/tasks/${id}`, data);
  }

  /** Delete a task */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/tasks/${id}`);
  }

  /** Start a task (pending → in_progress) */
  async start(id: string, agentId?: string): Promise<TaskSummary> {
    return this.client._post<TaskSummary>(`/api/tasks/${id}/start`, { agent_id: agentId });
  }

  /** Complete a task */
  async complete(id: string, agentId?: string): Promise<TaskSummary> {
    return this.client._post<TaskSummary>(`/api/tasks/${id}/complete`, { agent_id: agentId });
  }

  /** Fail a task with optional retry */
  async fail(id: string, options?: {
    reason?: string;
    agent_id?: string;
    retry?: boolean;
    error_code?: string;
  }): Promise<TaskFailResponse> {
    return this.client._post<TaskFailResponse>(`/api/tasks/${id}/fail`, options || {});
  }

  /** Log progress on a task */
  async logProgress(taskId: string, message: string, pctComplete?: number, agentId?: string): Promise<TaskComment> {
    return this.client._post<TaskComment>(`/api/tasks/${taskId}/progress`, {
      message,
      pct_complete: pctComplete,
      agent_id: agentId,
    });
  }

  /** Get progress entries for a task */
  async getProgress(id: string, options?: { limit?: number; format?: "compact" | "full" }): Promise<TaskProgressResponse> {
    return this.client._get(`/api/tasks/${id}/progress`, buildQuery(options || {}));
  }

  /** Get task history (audit log) */
  async getHistory(id: string, options?: { limit?: number; format?: "compact" | "full" }): Promise<TaskHistory[]> {
    return this.client._get(`/api/tasks/${id}/history`, buildQuery(options || {}));
  }

  /** Get task attachments */
  async getAttachments(id: string): Promise<TaskAttachmentsResponse> {
    return this.client._get(`/api/tasks/${id}/attachments`);
  }

  /** Get task status summary (counts by status, active work, next task) */
  async status(options?: { project_id?: string; agent_id?: string }): Promise<TaskStatusResponse> {
    return this.client._get("/api/tasks/status", buildQuery(options || {}));
  }

  /** Get next available task for an agent */
  async next(options?: { project_id?: string; agent_id?: string; fields?: string | string[] }): Promise<TaskNextResponse> {
    return this.client._get("/api/tasks/next", buildQuery(options || {}));
  }

  /** Get active (in-progress) work */
  async active(projectId?: string): Promise<TaskActiveResponse> {
    return this.client._get("/api/tasks/active", projectId ? `?project_id=${projectId}` : "");
  }

  /** Get stale tasks (in_progress > N minutes) */
  async stale(options?: { project_id?: string; minutes?: number; fields?: string | string[] }): Promise<TaskStaleResponse> {
    return this.client._get("/api/tasks/stale", buildQuery(options || {}));
  }

  /** Get tasks changed since a timestamp */
  async changedSince(since: string, projectId?: string, options?: { fields?: string | string[] }): Promise<TaskChangedResponse> {
    return this.client._get("/api/tasks/changed", buildQuery({ since, project_id: projectId, fields: options?.fields }));
  }

  /** Get task context (summary text or JSON for agent prompt injection) */
  async context(options?: {
    agentId?: string;
    projectId?: string;
    format?: "text" | "compact" | "json";
    fields?: string | string[];
  }): Promise<TaskContextResponse | string> {
    const q = buildQuery({
      agent_id: options?.agentId,
      project_id: options?.projectId,
      format: options?.format,
      fields: options?.fields,
    });
    const url = `${this.client.baseUrl}/api/tasks/context${q}`;
    let res: Response;
    try {
      res = await this.client._fetchRaw(url);
    } catch (error) {
      // Base SDK compatibility treats local transport failures the same as a
      // non-success response. The Stage-A authority floor remains terminal.
      if (isHostedAuthorityUnavailable(error)) throw error;
      return options?.format === "json" ? {} as TaskContextResponse : "";
    }
    if (!res.ok) return options?.format === "json" ? {} as TaskContextResponse : "";
    if (options?.format === "json") return res.json() as Promise<TaskContextResponse>;
    return res.text();
  }

  /** Export tasks as JSON or CSV */
  async export(options?: {
    status?: string;
    project_id?: string;
    format?: "json" | "csv";
  }): Promise<TaskSummary[] | string> {
    const q = buildQuery(options || {});
    const url = `${this.client.baseUrl}/api/tasks/export${q}`;
    const res = await this.client._fetchRaw(url);
    if (!res.ok) throw new TodosAPIError("Export failed", res.status, res.statusText, null);
    if (options?.format === "csv") return res.text();
    return res.json();
  }

  /** Bulk operations: complete, start, or delete multiple tasks */
  async bulk(ids: string[], action: "complete" | "start" | "delete"): Promise<TaskBulkResponse> {
    return this.client._post("/api/tasks/bulk", { ids, action });
  }

  /** Claim the next available task for an agent */
  async claim(agentId: string, projectId?: string): Promise<{ task: TaskSummary | null }> {
    return this.client._post("/api/tasks/claim", { agent_id: agentId, project_id: projectId });
  }

  /** Subscribe to task events via SSE. Returns an AsyncGenerator. */
  async *subscribe(options: {
    agentId?: string;
    projectId?: string;
    events?: string[];
  } = {}): AsyncGenerator<SSEEvent, void, unknown> {
    const q = buildQuery({
      agent_id: options.agentId,
      project_id: options.projectId,
      events: options.events?.join(","),
    });
    const url = `${this.client.baseUrl}/api/tasks/stream${q}`;
    // Use _fetchRaw so the request carries auth headers (x-api-key). A bare
    // fetch() has no headers and gets a 401 against an api-key-secured server.
    const resp = await this.client._fetchRaw(url);
    if (!resp.ok || !resp.body) throw new Error(`SSE connection failed: ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type !== "connected") yield data;
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

class AgentsResource {
  constructor(private client: TodosClient) {}

  /** List all agents */
  async list(options?: { fields?: string }): Promise<Agent[]> {
    return this.client._get("/api/agents", buildQuery(options || {}));
  }

  /** Register a new agent (or heartbeat existing) */
  async register(data: { name: string; description?: string; role?: string; session_id?: string; working_dir?: string }): Promise<Agent> {
    return this.client._post("/api/agents", data);
  }

  /** Full agent registration with all fields */
  async fullRegister(data: RegisterAgentInput): Promise<Agent | { conflict: true; message: string }> {
    return this.client._post("/api/agents", data as unknown as Record<string, unknown>);
  }

  /** Update an agent */
  async update(id: string, data: { name?: string; description?: string; role?: string }): Promise<Agent> {
    return this.client._patch(`/api/agents/${id}`, data);
  }

  /** Delete an agent */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/agents/${id}`);
  }

  /** Bulk delete agents */
  async bulkDelete(ids: string[]): Promise<{ succeeded: number; failed: number }> {
    return this.client._post("/api/agents/bulk", { ids, action: "delete" });
  }

  /** Get agent info + their tasks (as if they just registered) */
  async me(name: string): Promise<AgentMeResponse> {
    return this.client._get("/api/agents/me", `?name=${encodeURIComponent(name)}`);
  }

  /** Get pending task queue for an agent */
  async queue(agentId: string): Promise<AgentQueueResponse> {
    return this.client._get(`/api/agents/${encodeURIComponent(agentId)}/queue`);
  }

  /** Get direct reports (team) for an agent */
  async team(agentId: string): Promise<Agent[]> {
    return this.client._get(`/api/agents/${encodeURIComponent(agentId)}/team`);
  }

  /** Get full org chart */
  async orgChart(): Promise<OrgNode[]> {
    return this.client._get("/api/org");
  }
}

class ProjectsResource {
  constructor(private client: TodosClient) {}

  /** List all projects */
  async list(options?: { fields?: string }): Promise<Project[]> {
    return this.client._get("/api/projects", buildQuery(options || {}));
  }

  /** Create a project */
  async create(data: CreateProjectInput): Promise<Project> {
    return this.client._post("/api/projects", data as unknown as Record<string, unknown>);
  }

  /** Delete a project */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/projects/${id}`);
  }

  /** Bulk delete projects */
  async bulkDelete(ids: string[]): Promise<{ succeeded: number; failed: number }> {
    return this.client._post("/api/projects/bulk", { ids, action: "delete" });
  }
}

class PlansResource {
  constructor(private client: TodosClient) {}

  /** List plans, optionally filtered by project */
  async list(projectId?: string): Promise<Plan[]> {
    return this.client._get("/api/plans", projectId ? `?project_id=${projectId}` : "");
  }

  /** Create a plan */
  async create(data: CreatePlanInput): Promise<Plan> {
    return this.client._post("/api/plans", data as unknown as Record<string, unknown>);
  }

  /** Get a plan with its tasks */
  async get(id: string): Promise<PlanWithTasks> {
    return this.client._get(`/api/plans/${id}`);
  }

  /** Update a plan */
  async update(id: string, data: UpdatePlanInput): Promise<Plan> {
    return this.client._patch(`/api/plans/${id}`, data as unknown as Record<string, unknown>);
  }

  /** Delete a plan */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/plans/${id}`);
  }

  /** Bulk delete plans */
  async bulkDelete(ids: string[]): Promise<{ succeeded: number; failed: number }> {
    return this.client._post("/api/plans/bulk", { ids, action: "delete" });
  }
}

class OrgsResource {
  constructor(private client: TodosClient) {}

  /** List all orgs */
  async list(): Promise<Org[]> {
    return this.client._get("/api/orgs");
  }

  /** Create an org */
  async create(data: CreateOrgInput): Promise<Org> {
    return this.client._post("/api/orgs", data as unknown as Record<string, unknown>);
  }

  /** Update an org */
  async update(id: string, data: Record<string, unknown>): Promise<Org> {
    return this.client._patch(`/api/orgs/${id}`, data);
  }

  /** Delete an org */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/orgs/${id}`);
  }
}

class WebhooksResource {
  constructor(private client: TodosClient) {}

  /** List all webhooks */
  async list(): Promise<Webhook[]> {
    return this.client._get("/api/webhooks");
  }

  /** Create a webhook */
  async create(data: CreateWebhookInput): Promise<Webhook> {
    return this.client._post("/api/webhooks", data as unknown as Record<string, unknown>);
  }

  /** Delete a webhook */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/webhooks/${id}`);
  }
}

class TemplatesResource {
  constructor(private client: TodosClient) {}

  /** List all templates */
  async list(): Promise<TaskTemplate[]> {
    return this.client._get("/api/templates");
  }

  /** Create a template */
  async create(data: CreateTemplateInput): Promise<TaskTemplate> {
    return this.client._post("/api/templates", data as unknown as Record<string, unknown>);
  }

  /** Delete a template */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client._delete(`/api/templates/${id}`);
  }
}

// ── Main Client ──────────────────────────────────────────────────────────────

export class TodosClient {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly apiKey: string | null;
  readonly maxRetries: number;
  readonly retryDelay: number;

  /** Namespaced resource accessors */
  readonly tasks: TasksResource;
  readonly agents: AgentsResource;
  readonly projects: ProjectsResource;
  readonly plans: PlansResource;
  readonly orgs: OrgsResource;
  readonly webhooks: WebhooksResource;
  readonly templates: TemplatesResource;

  constructor(options: TodosClientOptions = {}) {
    // The real process role is authoritative and must be checked before any
    // caller-controlled option getter, ownKeys trap, or local config read.
    assertTodosSdkLocalAuthority();
    const safeOptions = snapshotTodosClientOptions(options);
    const explicitBaseUrl = normalizeApiUrl(safeOptions.baseUrl);
    assertTodosSdkLocalAuthority(explicitBaseUrl);
    let localConfig: ReturnType<typeof getLocalApiConfig>;
    try {
      localConfig = getLocalApiConfig();
    } catch {
      throwHostedSdkUnavailable("unreadable_config");
    }
    if (!localConfig || typeof localConfig !== "object") {
      throwHostedSdkUnavailable("unreadable_config");
    }
    let localApiUrlValue: unknown;
    try {
      localApiUrlValue = Reflect.get(localConfig, "apiUrl");
    } catch {
      throwHostedSdkUnavailable("unreadable_config");
    }
    if (
      localApiUrlValue !== null
      && localApiUrlValue !== undefined
      && typeof localApiUrlValue !== "string"
    ) {
      throwHostedSdkUnavailable("unreadable_config");
    }
    const localApiUrl = normalizeApiUrl(localApiUrlValue as string | null | undefined);
    assertTodosSdkLocalAuthority(localApiUrl);
    let localApiKeyValue: unknown;
    try {
      localApiKeyValue = Reflect.get(localConfig, "apiKey");
    } catch {
      throwHostedSdkUnavailable("unreadable_config");
    }
    if (
      localApiKeyValue !== null
      && localApiKeyValue !== undefined
      && typeof localApiKeyValue !== "string"
    ) {
      throwHostedSdkUnavailable("unreadable_config");
    }
    const localApiKey = (localApiKeyValue as string | null | undefined) ?? null;
    this.baseUrl = explicitBaseUrl
      || localApiUrl
      || "http://localhost:19427";
    assertTodosSdkLocalAuthority(this.baseUrl);
    this.timeout = safeOptions.timeout ?? 10000;
    this.apiKey = safeOptions.apiKey || localApiKey;
    this.maxRetries = safeOptions.maxRetries ?? 0;
    this.retryDelay = safeOptions.retryDelay ?? 1000;

    this.tasks = new TasksResource(this);
    this.agents = new AgentsResource(this);
    this.projects = new ProjectsResource(this);
    this.plans = new PlansResource(this);
    this.orgs = new OrgsResource(this);
    this.webhooks = new WebhooksResource(this);
    this.templates = new TemplatesResource(this);
  }

  /** Create a client from TODOS_URL env var */
  static fromEnv(apiKey?: string): TodosClient {
    return new TodosClient({ apiKey });
  }

  // ── Low-level fetch with error handling ──────────────────────────────────

  /** Raw fetch — for endpoints that don't return JSON (text, CSV, SSE) */
  async _fetchRaw(url: string, init?: RequestInit): Promise<Response> {
    // Validate the supplied URL, not only the configured base. This must run
    // before headers are constructed so a local key can never be forwarded.
    assertTodosSdkRequestAuthority(this.baseUrl, url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const headers = this._buildHeaders(init?.headers);
      return await fetchFollowingSafeRedirects(this.baseUrl, url, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TodosTimeoutError(this.timeout);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private _buildHeaders(existing?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    if (existing) {
      if (existing instanceof Headers) {
        existing.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(existing)) {
        for (const [k, v] of existing) headers[k] = v;
      } else {
        Object.assign(headers, existing);
      }
    }
    return headers;
  }

  private async _fetchWithRetry<T>(path: string, init?: RequestInit): Promise<T> {
    let lastError: Error | null = null;
    const maxAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this._fetch<T>(path, init);
      } catch (e) {
        lastError = e as Error;
        if (
          e instanceof TodosAPIError &&
          e.status === 503 &&
          (e.body as { code?: unknown } | null)?.code === "HOSTED_AUTHORITY_UNAVAILABLE"
        ) throw e;
        if (e instanceof TodosAPIError && e.status < 500 && e.status !== 429) throw e;
        if (e instanceof TodosUnauthorizedError || e instanceof TodosNotFoundError || e instanceof TodosConflictError) throw e;

        if (attempt < maxAttempts - 1) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          if (e instanceof TodosRateLimitError) {
            await this._sleep((e as TodosRateLimitError).retryAfter * 1000);
          } else {
            await this._sleep(delay);
          }
        }
      }
    }
    throw lastError || new Error("Request failed after retries");
  }

  private async _fetch<T>(path: string, init?: RequestInit): Promise<T> {
    assertTodosSdkLocalAuthority(this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const url = `${this.baseUrl}${path}`;
      const headers = this._buildHeaders(init?.headers);
      const res = await fetchFollowingSafeRedirects(this.baseUrl, url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        const message = body.error || `HTTP ${res.status}: ${res.statusText}`;

        if (res.status === 401) throw new TodosUnauthorizedError(message, body);
        if (res.status === 404) throw new TodosNotFoundError(message, body);
        if (res.status === 409) throw new TodosConflictError(message, body);
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
          throw new TodosRateLimitError(message, retryAfter, body);
        }
        throw new TodosAPIError(message, res.status, res.statusText, body);
      }

      // Only treat a genuinely empty body as null. Do NOT key off the byte
      // length: a valid JSON body of `true` is exactly 4 bytes and must parse to
      // the boolean, not be dropped as null.
      if (res.status === 204) return null as T;
      const text = await res.text();
      if (text.length === 0) return null as T;
      return JSON.parse(text) as T;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new TodosTimeoutError(this.timeout);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── HTTP verb helpers (internal, used by sub-resources) ──────────────────

  async _get<T>(path: string, query = ""): Promise<T> {
    return this._fetchWithRetry<T>(`${path}${query}`);
  }

  async _post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this._fetchWithRetry<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async _patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this._fetchWithRetry<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async _delete<T>(path: string): Promise<T> {
    return this._fetchWithRetry<T>(path, { method: "DELETE" });
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Top-level convenience methods ───────────────────────────────────────

  /** Health check */
  async getHealth(): Promise<{ status: "ok" | "warn"; tasks: number; stale: number; overdue_recurring: number; timestamp: string }> {
    return this._get("/api/health");
  }

  /** Quick alive check */
  async isAlive(): Promise<boolean> {
    assertTodosSdkLocalAuthority(this.baseUrl);
    try {
      await this._get("/api/stats");
      return true;
    } catch {
      return false;
    }
  }

  /** Dashboard stats */
  async getStats(): Promise<DashboardStats> {
    return this._get("/api/stats");
  }

  /** Report for the last N days */
  async getReport(options?: { days?: number; projectId?: string }): Promise<ReportResponse> {
    return this._get("/api/report", buildQuery({ days: options?.days, project_id: options?.projectId }));
  }

  /** Doctor — health diagnostics */
  async doctor(): Promise<DoctorResponse> {
    return this._get("/api/doctor");
  }

  /** Recent activity */
  async activity(limit?: number): Promise<any[]> {
    return this._get("/api/activity", limit ? `?limit=${limit}` : "");
  }

  // ── Backward-compatible methods (match old TodosClient API) ──────────────

  /** @deprecated Use client.tasks.list() instead */
  async listTasks(filter: { status?: string; project_id?: string; assigned_to?: string; limit?: number; offset?: number; session_id?: string; due_today?: boolean; overdue?: boolean; fields?: string | string[] } = {}): Promise<TaskSummary[]> {
    return this.tasks.list(filter);
  }

  /** @deprecated Use client.tasks.get() instead */
  async getTask(id: string, options?: { fields?: string | string[] }): Promise<TaskSummary> {
    return this.tasks.get(id, options);
  }

  /** @deprecated Use client.tasks.create() instead */
  async createTask(data: { title: string; description?: string; priority?: TaskPriority; project_id?: string; assigned_to?: string; tags?: string[]; recurrence_rule?: string; due_at?: string }): Promise<any> {
    return this.tasks.create(data as unknown as CreateTaskInput & { agent_id?: string });
  }

  /** @deprecated Use client.tasks.update() instead */
  async updateTask(id: string, data: Record<string, unknown>): Promise<any> {
    return this.tasks.update(id, data);
  }

  /** @deprecated Use client.tasks.delete() instead */
  async deleteTask(id: string): Promise<void> {
    await this.tasks.delete(id);
  }

  /** @deprecated Use client.tasks.start() instead */
  async startTask(id: string, agentId: string): Promise<any> {
    return this.tasks.start(id, agentId);
  }

  /** @deprecated Use client.tasks.complete() instead */
  async completeTask(id: string, agentId?: string): Promise<any> {
    return this.tasks.complete(id, agentId);
  }

  /** @deprecated Use client.tasks.fail() instead */
  async failTask(id: string, options: { reason?: string; agent_id?: string; retry?: boolean; error_code?: string } = {}): Promise<any> {
    return this.tasks.fail(id, options);
  }

  /** @deprecated Use client.tasks.logProgress() instead */
  async logProgress(taskId: string, message: string, pctComplete?: number, agentId?: string): Promise<any> {
    return this.tasks.logProgress(taskId, message, pctComplete, agentId);
  }

  /** @deprecated Use client.tasks.status() instead */
  async getStatus(projectId?: string, agentId?: string): Promise<TaskStatusResponse> {
    return this.tasks.status({ project_id: projectId, agent_id: agentId });
  }

  /** @deprecated Use client.tasks.active() instead */
  async getActiveWork(projectId?: string): Promise<any[]> {
    const res = await this.tasks.active(projectId);
    return res.active;
  }

  /** @deprecated Use client.tasks.changedSince() instead */
  async getTasksChangedSince(since: string, projectId?: string): Promise<any> {
    return this.tasks.changedSince(since, projectId);
  }

  /** @deprecated Use client.tasks.stale() instead */
  async getStaleTasks(minutes?: number, projectId?: string): Promise<any> {
    return this.tasks.stale({ minutes, project_id: projectId });
  }

  /** @deprecated Use client.tasks.context() instead */
  async getContext(options: { agentId?: string; projectId?: string; format?: "text" | "compact" | "json" } = {}): Promise<string | any> {
    return this.tasks.context(options);
  }

  /** @deprecated Use client.tasks.export() instead */
  async exportTasks(filter: { status?: string; project_id?: string; format?: "json" | "csv" } = {}): Promise<any> {
    return this.tasks.export(filter);
  }

  /** @deprecated Use client.tasks.claim() instead */
  async claimNextTask(agentId: string, projectId?: string): Promise<any> {
    return this.tasks.claim(agentId, projectId);
  }

  /** @deprecated Use client.tasks.getHistory() instead */
  async getTaskHistory(id: string, options?: { limit?: number; format?: "compact" | "full" }): Promise<any[]> {
    return this.tasks.getHistory(id, options);
  }

  /** @deprecated Use client.tasks.getAttachments() instead */
  async getTaskAttachments(id: string): Promise<any> {
    return this.tasks.getAttachments(id);
  }

  /** @deprecated Use client.tasks.getProgress() instead */
  async getTaskProgress(id: string, options?: { limit?: number; format?: "compact" | "full" }): Promise<any> {
    return this.tasks.getProgress(id, options);
  }

  /** @deprecated Use client.tasks.subscribe() instead */
  async *subscribeToStream(options: { agentId?: string; projectId?: string; events?: string[] } = {}): AsyncGenerator<SSEEvent, void, unknown> {
    yield* this.tasks.subscribe(options);
  }

  /** @deprecated Use client.projects.list() instead */
  async getProjects(): Promise<Project[]> {
    return this.projects.list();
  }
}

function cancelRedirectResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => {});
  } catch {
    // Preserve the primary follow/reject outcome.
  }
}

/** Create a new TodosClient instance */
export function createClient(options?: TodosClientOptions): TodosClient {
  return new TodosClient(options);
}
