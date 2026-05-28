/**
 * @hasna/todos REST SDK Client
 * Zero-dependency HTTP client for the todos REST API (todos serve).
 * Use when you need to interact with todos from another machine or process.
 *
 * Default port: 19427
 * Env var: TODOS_URL (e.g. http://localhost:19427)
 */

export interface TodosClientOptions {
  baseUrl?: string;
  timeout?: number;
}

export interface TaskSummary {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  project_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  assigned_to: string | null;
  locked_by: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  due_at: string | null;
  recurrence_rule: string | null;
}

export interface StatusSummaryResponse {
  pending: number;
  in_progress: number;
  completed: number;
  total: number;
  active_work: { id: string; short_id: string | null; title: string; priority: string; assigned_to: string | null; locked_by: string | null; updated_at: string }[];
  next_task: TaskSummary | null;
  stale_count: number;
  overdue_recurring: number;
}

export interface ProgressEntry {
  id: string;
  task_id: string;
  content: string;
  type: "comment" | "progress" | "note";
  progress_pct: number | null;
  agent_id: string | null;
  created_at: string;
}

export interface DashboardStats {
  total_tasks: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  projects: number;
  agents: number;
  stale_count?: number;
  overdue_recurring?: number;
  recurring_tasks?: number;
}

export class TodosClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: TodosClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env["TODOS_URL"] || "http://localhost:19427";
    this.timeout = options.timeout || 10000;
  }

  static fromEnv(): TodosClient {
    return new TodosClient({ baseUrl: process.env["TODOS_URL"] });
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  async getHealth(): Promise<{ status: "ok" | "warn"; tasks: number; stale: number; overdue_recurring: number; timestamp: string }> {
    return this.fetch("/api/health");
  }

  async isAlive(): Promise<boolean> {
    try {
      await this.fetch("/api/stats");
      return true;
    } catch { return false; }
  }

  async getStatus(projectId?: string, agentId?: string): Promise<StatusSummaryResponse> {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (agentId) params.set("agent_id", agentId);
    return this.fetch(`/api/tasks/status?${params}`);
  }

  async listTasks(filter: { status?: string; project_id?: string; assigned_to?: string; limit?: number; offset?: number; session_id?: string; due_today?: boolean; overdue?: boolean } = {}): Promise<TaskSummary[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined) params.set(k, String(v));
    }
    return this.fetch(`/api/tasks?${params}`);
  }

  async getTask(id: string): Promise<TaskSummary> {
    return this.fetch(`/api/tasks/${id}`);
  }

  async getTaskAttachments(id: string): Promise<{ task_id: string; short_id: string | null; attachment_ids: string[]; count: number; files_changed?: string[]; commit_hash?: string; notes?: string }> {
    return this.fetch(`/api/tasks/${id}/attachments`);
  }

  async getTaskHistory(id: string): Promise<any[]> {
    return this.fetch(`/api/tasks/${id}/history`);
  }

  async getTaskProgress(id: string): Promise<any> {
    return this.fetch(`/api/tasks/${id}/progress`);
  }

  async claimNextTask(agentId: string, projectId?: string): Promise<any> {
    return this.fetch("/api/tasks/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, project_id: projectId }),
    });
  }

  async completeTask(id: string, agentId?: string): Promise<any> {
    return this.fetch(`/api/tasks/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId }),
    });
  }

  async createTask(data: { title: string; description?: string; priority?: string; project_id?: string; assigned_to?: string; tags?: string[]; recurrence_rule?: string; due_at?: string }): Promise<any> {
    return this.fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateTask(id: string, data: Record<string, unknown>): Promise<any> {
    return this.fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteTask(id: string): Promise<void> {
    await this.fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  async getStats(): Promise<DashboardStats> {
    return this.fetch("/api/stats");
  }

  async getActiveWork(projectId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    return this.fetch(`/api/tasks/active?${params}`);
  }

  async getTasksChangedSince(since: string, projectId?: string): Promise<any> {
    const params = new URLSearchParams({ since });
    if (projectId) params.set("project_id", projectId);
    return this.fetch(`/api/tasks/changed?${params}`);
  }

  async startTask(id: string, agentId: string): Promise<any> {
    return this.fetch(`/api/tasks/${id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId }),
    });
  }

  async failTask(id: string, options: { reason?: string; agent_id?: string; retry?: boolean; error_code?: string } = {}): Promise<{ task: TaskSummary; retry_task: TaskSummary | null }> {
    return this.fetch(`/api/tasks/${id}/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
  }

  async logProgress(taskId: string, message: string, pctComplete?: number, agentId?: string): Promise<any> {
    return this.fetch(`/api/tasks/${taskId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, pct_complete: pctComplete, agent_id: agentId }),
    });
  }

  async exportTasks(filter: { status?: string; project_id?: string; format?: "json" | "csv" } = {}): Promise<any> {
    const params = new URLSearchParams();
    if (filter.status) params.set("status", filter.status);
    if (filter.project_id) params.set("project_id", filter.project_id);
    const fmt = filter.format || "json";
    if (fmt === "csv") params.set("format", "csv");
    return this.fetch(`/api/tasks/export?${params}`);
  }

  async getProjects(): Promise<any[]> {
    return this.fetch("/api/projects");
  }

  async getContext(options: { agentId?: string; projectId?: string; format?: "text" | "compact" | "json" } = {}): Promise<string | any> {
    const params = new URLSearchParams();
    if (options.agentId) params.set("agent_id", options.agentId);
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.format) params.set("format", options.format);
    const url = `${this.baseUrl}/api/tasks/context?${params}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return options.format === "json" ? {} : "";
      if (options.format === "json") return res.json();
      return res.text();
    } catch { return options.format === "json" ? {} : ""; }
    finally { clearTimeout(timer); }
  }

  async getReport(options: { days?: number; projectId?: string } = {}): Promise<{ days: number; period_since: string; total: number; changed: number; completed: number; failed: number; completion_rate: number; stats: any; by_day: Record<string, number> }> {
    const params = new URLSearchParams();
    if (options.days) params.set("days", String(options.days));
    if (options.projectId) params.set("project_id", options.projectId);
    return this.fetch(`/api/report?${params}`);
  }

  /**
   * Subscribe to task events via SSE. Returns an AsyncGenerator that yields events.
   * Events: task.created, task.started, task.completed, task.failed, task.assigned, task.status_changed
   *
   * @example
   * for await (const event of client.subscribeToStream({ agentId: "aurelius" })) {
   *   console.log(event.action, event.task_id);
   * }
   */
  async *subscribeToStream(options: {
    agentId?: string;
    projectId?: string;
    events?: string[];
  } = {}): AsyncGenerator<{ type: string; action: string; task_id?: string; agent_id?: string | null; timestamp: string }, void, unknown> {
    const params = new URLSearchParams();
    if (options.agentId) params.set("agent_id", options.agentId);
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.events) params.set("events", options.events.join(","));
    const url = `${this.baseUrl}/api/tasks/stream?${params}`;
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) throw new Error(`SSE connection failed: ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
  }
}

export function createClient(options?: TodosClientOptions): TodosClient {
  return new TodosClient(options);
}
