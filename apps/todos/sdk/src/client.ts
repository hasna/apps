import type {
  Task, Project, Plan, Agent, TaskHistory, Webhook, TaskTemplate,
  Stats, BulkResult, AgentProfile, ClaimResult, CompletionEvidence,
  TodosClientOptions,
} from "./types.js";

/** First non-blank value among the given env names, canonical name first. */
function env(...names: string[]): string | undefined {
  if (typeof process === "undefined") return undefined;
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/**
 * The authority names this client reads, canonical first.
 *
 * `TODOS_API_URL` and `TODOS_URL` are the package's LEGACY spellings, kept as a
 * silent fallback for ONE release under the 2026-09-04 ruling (hasna/apps#1720)
 * — which permits that only for a package that documents them, so they are
 * documented in README.md under "Configuration". The canonical
 * `HASNA_TODOS_API_URL` wins whenever it is set.
 */
export const TODOS_API_URL_ENV_KEYS = ["HASNA_TODOS_API_URL", "TODOS_API_URL", "TODOS_URL"] as const;

/** The credential names this client reads, canonical first. Same one-release rule as above. */
export const TODOS_API_KEY_ENV_KEYS = ["HASNA_TODOS_API_KEY", "TODOS_API_KEY"] as const;

/** The unhosted `todos-serve` a workstation runs. Never a hosted authority. */
export const TODOS_LOCAL_SERVE_URL = "http://localhost:19427";

let localModeAnnounced = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetTodosLocalModeNotice(): void {
  localModeAnnounced = false;
}

/**
 * Say — once per process, on stderr — that this client is local, not fleet.
 *
 * Guarded on `process` because this package ships to browsers and to non-bun
 * runtimes; where there is no stderr the notice is simply skipped rather than
 * throwing on the way to a working client.
 */
function announceLocalMode(): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  const line =
    `todos-sdk: LOCAL mode — no ${TODOS_API_URL_ENV_KEYS[0]} and no ${TODOS_API_KEY_ENV_KEYS[0]} resolved; ` +
    `reading and writing the local todos-serve at ${TODOS_LOCAL_SERVE_URL}, not the hosted fleet. ` +
    `Set ${TODOS_API_URL_ENV_KEYS[0]} and ${TODOS_API_KEY_ENV_KEYS[0]} to go hosted, or use the ` +
    `@hasna/todos "./sdk" export, which also reads the Keychain and ~/.hasna/todos/config/credentials.`;
  if (typeof process !== "undefined" && process.stderr?.write) process.stderr.write(`${line}\n`);
}

/**
 * Universal client for @hasna/todos REST API.
 * Works with any AI agent framework — Claude, Codex, Gemini, or custom.
 * Zero dependencies beyond fetch.
 */
export class TodosClient {
  private baseUrl: string;
  private agentName: string | null = null;
  private agentId: string | null = null;
  private apiKey: string | null = null;

  constructor(options: TodosClientOptions = {}) {
    // The CANONICAL fleet names win; `TODOS_URL` / `TODOS_API_KEY` remain a
    // silent, documented fallback for one release (2026-09-04 ruling,
    // hasna/apps#1720). Before this, the legacy names were the ONLY names here,
    // so an operator who exported the canonical `HASNA_TODOS_API_URL` /
    // `HASNA_TODOS_API_KEY` pair — the pair every other surface documents —
    // silently got the localhost default and no credential.
    //
    // This package is deliberately dependency-free (it ships to browsers and to
    // non-bun runtimes), so it reads the names directly rather than importing
    // the @hasna/contracts chain. It is therefore the ENV TIER ONLY: the
    // Keychain and `~/.hasna/todos/config/credentials` tiers live in
    // `@hasna/todos/sdk`, which is the surface to use on a workstation.
    const configuredUrl = options.baseUrl || env(...TODOS_API_URL_ENV_KEYS);
    this.baseUrl = (configuredUrl || TODOS_LOCAL_SERVE_URL).replace(/\/+$/, "");
    if (options.agentName) this.agentName = options.agentName;
    this.apiKey = options.apiKey || env(...TODOS_API_KEY_ENV_KEYS) || null;
    // LOCAL MODE SAYS SO (2026-09-04 ruling, hasna/apps#1720). Nothing named an
    // authority and nothing named a credential, so this client is talking to a
    // `todos-serve` on this box rather than the fleet. That is a real product
    // mode for this package, not a degradation — but a client silently reading
    // an empty local store while the operator believes it is on the fleet is
    // the false green the ruling exists to end, so it is announced once.
    if (!configuredUrl && !this.apiKey) announceLocalMode();
  }

  // ── Agent Identity ──────────────────────────────────────────────────────

  /** Register this agent and get its profile. Idempotent. */
  async init(opts?: { name?: string; role?: string; description?: string }): Promise<Agent> {
    const name = opts?.name || this.agentName;
    if (!name) throw new Error("Agent name required — pass to constructor or init()");
    this.agentName = name;

    const agent = await this.post<Agent>("/api/agents", {
      name,
      role: opts?.role || "agent",
      description: opts?.description,
    });
    this.agentId = agent.id;
    return agent;
  }

  /** Get this agent's profile with assigned tasks and stats. */
  async me(): Promise<AgentProfile> {
    if (!this.agentName) throw new Error("Call init() first");
    return this.get<AgentProfile>(`/api/agents/me?name=${encodeURIComponent(this.agentName)}`);
  }

  /** Get this agent's task queue — what to work on next. */
  async myQueue(): Promise<Task[]> {
    if (!this.agentName) throw new Error("Call init() first");
    const agentId = this.agentId || this.agentName;
    return this.get<Task[]>(`/api/agents/${encodeURIComponent(agentId)}/queue`);
  }

  // ── Tasks ───────────────────────────────────────────────────────────────

  private buildQuery(values: Record<string, string | number | boolean | string[] | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) params.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  async listTasks(filters?: { status?: string; project_id?: string; plan_id?: string; limit?: number; fields?: string | string[] }): Promise<Task[]> {
    const qs = this.buildQuery({
      status: filters?.status,
      project_id: filters?.project_id,
      plan_id: filters?.plan_id,
      limit: filters?.limit,
      fields: filters?.fields,
    });
    return this.get<Task[]>(`/api/tasks${qs}`);
  }

  async getTask(id: string, options?: { fields?: string | string[] }): Promise<Task> {
    const qs = this.buildQuery({ fields: options?.fields });
    return this.get<Task>(`/api/tasks/${id}${qs}`);
  }

  async getTaskHistory(id: string, options?: { limit?: number; format?: "compact" | "full" }): Promise<TaskHistory[]> {
    const qs = this.buildQuery({ limit: options?.limit, format: options?.format });
    return this.get<TaskHistory[]>(`/api/tasks/${id}/history${qs}`);
  }

  async getTaskProgress(id: string, options?: { limit?: number; format?: "compact" | "full" }): Promise<{
    task_id: string;
    progress_entries: unknown[];
    latest: unknown | null;
    count: number;
    summary?: { total: number; returned: number; omitted: number; format: string };
  }> {
    const qs = this.buildQuery({ limit: options?.limit, format: options?.format });
    return this.get(`/api/tasks/${id}/progress${qs}`);
  }

  async searchTasks(query: string): Promise<Task[]> {
    return this.get<Task[]>(`/api/tasks?search=${encodeURIComponent(query)}`);
  }

  async createTask(input: {
    title: string; description?: string; priority?: string; project_id?: string;
    plan_id?: string; tags?: string[]; assigned_to?: string;
    estimated_minutes?: number; requires_approval?: boolean;
  }): Promise<Task> {
    return this.post<Task>("/api/tasks", { ...input, agent_id: this.agentId });
  }

  async updateTask(id: string, input: Record<string, unknown>): Promise<Task> {
    return this.patch<Task>(`/api/tasks/${id}`, input);
  }

  async deleteTask(id: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/api/tasks/${id}`);
  }

  async startTask(id: string): Promise<Task> {
    return this.post<Task>(`/api/tasks/${id}/start`, {});
  }

  async completeTask(id: string, evidence?: CompletionEvidence): Promise<Task> {
    return this.post<Task>(`/api/tasks/${id}/complete`, evidence ? { evidence } : {});
  }

  /** Atomically claim the next available task. */
  async claimTask(filters?: { project_id?: string; priority?: string; tags?: string[] }): Promise<ClaimResult> {
    return this.post<ClaimResult>("/api/tasks/claim", {
      agent_id: this.agentId || this.agentName,
      ...filters,
    });
  }

  async bulkTasks(ids: string[], action: "start" | "complete" | "delete"): Promise<BulkResult> {
    return this.post<BulkResult>("/api/tasks/bulk", { ids, action });
  }

  // ── Projects ────────────────────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    return this.get<Project[]>("/api/projects");
  }

  async createProject(input: { name: string; path: string; description?: string }): Promise<Project> {
    return this.post<Project>("/api/projects", input);
  }

  async deleteProject(id: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/api/projects/${id}`);
  }

  // ── Plans ───────────────────────────────────────────────────────────────

  async listPlans(projectId?: string): Promise<Plan[]> {
    const qs = projectId ? `?project_id=${projectId}` : "";
    return this.get<Plan[]>(`/api/plans${qs}`);
  }

  async getPlan(id: string): Promise<Plan & { tasks: Task[] }> {
    return this.get<Plan & { tasks: Task[] }>(`/api/plans/${id}`);
  }

  async createPlan(input: {
    name: string; description?: string; project_id?: string;
    task_list_id?: string; agent_id?: string; status?: string;
  }): Promise<Plan> {
    return this.post<Plan>("/api/plans", { ...input, agent_id: input.agent_id || this.agentId });
  }

  async updatePlan(id: string, input: Record<string, unknown>): Promise<Plan> {
    return this.patch<Plan>(`/api/plans/${id}`, input);
  }

  async deletePlan(id: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/api/plans/${id}`);
  }

  // ── Agents ──────────────────────────────────────────────────────────────

  async listAgents(): Promise<Agent[]> {
    return this.get<Agent[]>("/api/agents");
  }

  async updateAgent(id: string, input: { name?: string; description?: string; role?: string }): Promise<Agent> {
    return this.patch<Agent>(`/api/agents/${id}`, input);
  }

  async deleteAgent(id: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/api/agents/${id}`);
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  async listWebhooks(): Promise<Webhook[]> {
    return this.get<Webhook[]>("/api/webhooks");
  }

  async createWebhook(input: { url: string; events?: string[]; secret?: string }): Promise<Webhook> {
    return this.post<Webhook>("/api/webhooks", input);
  }

  async deleteWebhook(id: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/api/webhooks/${id}`);
  }

  // ── Templates ───────────────────────────────────────────────────────────

  async listTemplates(): Promise<TaskTemplate[]> {
    return this.get<TaskTemplate[]>("/api/templates");
  }

  async createTemplate(input: {
    name: string; title_pattern: string; description?: string;
    priority?: string; tags?: string[];
  }): Promise<TaskTemplate> {
    return this.post<TaskTemplate>("/api/templates", input);
  }

  async deleteTemplate(id: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/api/templates/${id}`);
  }

  // ── Stats & Activity ──────────────────────────────────────────────────

  async stats(): Promise<Stats> {
    return this.get<Stats>("/api/stats");
  }

  async recentActivity(limit = 50): Promise<TaskHistory[]> {
    return this.get<TaskHistory[]>(`/api/activity?limit=${limit}`);
  }

  // ── Events (SSE) ────────────────────────────────────────────────────────

  /** Subscribe to real-time task events via Server-Sent Events. */
  subscribeEvents(onEvent: (event: { type: string; data: unknown }) => void): { close: () => void } {
    const es = new EventSource(`${this.baseUrl}/api/events`);
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {}
    };
    return { close: () => es.close() };
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(body.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(data.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(data.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async del<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE", headers: this.authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(data.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  private authHeaders(headers: Record<string, string> = {}): Record<string, string> {
    if (!this.apiKey) return headers;
    return { ...headers, Authorization: `Bearer ${this.apiKey}` };
  }
}

export class TodosError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "TodosError";
  }
}
