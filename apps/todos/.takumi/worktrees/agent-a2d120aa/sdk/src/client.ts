import type {
  Task, Project, Plan, Agent, TaskHistory, Webhook, TaskTemplate,
  Stats, BulkResult, AgentProfile, ClaimResult, CompletionEvidence,
  TodosClientOptions,
} from "./types.js";

/**
 * Universal client for @hasna/todos REST API.
 * Works with any AI agent framework — Claude, Codex, Gemini, or custom.
 * Zero dependencies beyond fetch.
 */
export class TodosClient {
  private baseUrl: string;
  private agentName: string | null = null;
  private agentId: string | null = null;

  constructor(options: TodosClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:19427").replace(/\/$/, "");
    if (options.agentName) this.agentName = options.agentName;
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

  async listTasks(filters?: { status?: string; project_id?: string; plan_id?: string; limit?: number }): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.project_id) params.set("project_id", filters.project_id);
    if (filters?.plan_id) params.set("plan_id", filters.plan_id);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return this.get<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
  }

  async getTask(id: string): Promise<Task> {
    return this.get<Task>(`/api/tasks/${id}`);
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

  async getTaskHistory(id: string): Promise<TaskHistory[]> {
    return this.get<TaskHistory[]>(`/api/tasks/${id}/history`);
  }

  async searchTasks(query: string): Promise<Task[]> {
    return this.get<Task[]>(`/api/tasks?search=${encodeURIComponent(query)}`);
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
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(body.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(data.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async del<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TodosError(data.error || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }
}

export class TodosError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "TodosError";
  }
}
