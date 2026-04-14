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
 * const client = new TodosClient(); // uses TODOS_URL or localhost:19427
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
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
    fields?: string;
  }): Promise<TaskSummary[]> {
    return this.client._get<TaskSummary[]>("/api/tasks", buildQuery(options || {}));
  }

  /** Get a single task by ID */
  async get(id: string): Promise<TaskSummary> {
    return this.client._get<TaskSummary>(`/api/tasks/${id}`);
  }

  /** Get task with full relations (subtasks, dependencies, comments, checklist) */
  async getWithRelations(id: string): Promise<Task> {
    return this.client._get<Task>(`/api/tasks/${id}`);
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
  async getProgress(id: string): Promise<TaskProgressResponse> {
    return this.client._get(`/api/tasks/${id}/progress`);
  }

  /** Get task history (audit log) */
  async getHistory(id: string): Promise<TaskHistory[]> {
    return this.client._get(`/api/tasks/${id}/history`);
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
  async next(options?: { project_id?: string; agent_id?: string }): Promise<TaskNextResponse> {
    return this.client._get("/api/tasks/next", buildQuery(options || {}));
  }

  /** Get active (in-progress) work */
  async active(projectId?: string): Promise<TaskActiveResponse> {
    return this.client._get("/api/tasks/active", projectId ? `?project_id=${projectId}` : "");
  }

  /** Get stale tasks (in_progress > N minutes) */
  async stale(options?: { project_id?: string; minutes?: number }): Promise<TaskStaleResponse> {
    return this.client._get("/api/tasks/stale", buildQuery(options || {}));
  }

  /** Get tasks changed since a timestamp */
  async changedSince(since: string, projectId?: string): Promise<TaskChangedResponse> {
    return this.client._get("/api/tasks/changed", buildQuery({ since, project_id: projectId }));
  }

  /** Get task context (summary text or JSON for agent prompt injection) */
  async context(options?: {
    agentId?: string;
    projectId?: string;
    format?: "text" | "compact" | "json";
  }): Promise<TaskContextResponse | string> {
    const q = buildQuery({
      agent_id: options?.agentId,
      project_id: options?.projectId,
      format: options?.format,
    });
    const url = `${this.client.baseUrl}/api/tasks/context${q}`;
    const res = await this.client._fetchRaw(url);
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
    const resp = await fetch(url);
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
    this.baseUrl = options.baseUrl || process.env["TODOS_URL"] || "http://localhost:19427";
    this.baseUrl = this.baseUrl.replace(/\/+$/, ""); // strip trailing slash
    this.timeout = options.timeout ?? 10000;
    this.apiKey = options.apiKey || process.env["TODOS_API_KEY"] || null;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelay = options.retryDelay ?? 1000;

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const headers = this._buildHeaders(init?.headers);
      return await fetch(url, { ...init, headers, signal: controller.signal });
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const url = `${this.baseUrl}${path}`;
      const headers = this._buildHeaders(init?.headers);
      const res = await fetch(url, { ...init, headers, signal: controller.signal });

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

      const contentLength = res.headers.get("content-length");
      if (contentLength === "0" || contentLength === "4") return null as T;

      return res.json() as Promise<T>;
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
  async listTasks(filter: { status?: string; project_id?: string; assigned_to?: string; limit?: number; offset?: number; session_id?: string; due_today?: boolean; overdue?: boolean } = {}): Promise<TaskSummary[]> {
    return this.tasks.list(filter);
  }

  /** @deprecated Use client.tasks.get() instead */
  async getTask(id: string): Promise<TaskSummary> {
    return this.tasks.get(id);
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
  async getTaskHistory(id: string): Promise<any[]> {
    return this.tasks.getHistory(id);
  }

  /** @deprecated Use client.tasks.getAttachments() instead */
  async getTaskAttachments(id: string): Promise<any> {
    return this.tasks.getAttachments(id);
  }

  /** @deprecated Use client.tasks.getProgress() instead */
  async getTaskProgress(id: string): Promise<any> {
    return this.tasks.getProgress(id);
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

/** Create a new TodosClient instance */
export function createClient(options?: TodosClientOptions): TodosClient {
  return new TodosClient(options);
}
