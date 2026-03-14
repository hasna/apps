/**
 * @hasna/todos REST SDK Client
 * Zero-dependency HTTP client for the todos REST API (todos serve).
 * Use when you need to interact with todos from another machine or process.
 */

export interface TodosClientOptions {
  baseUrl?: string;
  timeout?: number;
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

  async isAlive(): Promise<boolean> {
    try {
      await this.fetch("/api/stats");
      return true;
    } catch { return false; }
  }

  async getStatus(projectId?: string, agentId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (agentId) params.set("agent_id", agentId);
    return this.fetch(`/api/tasks/status?${params}`);
  }

  async listTasks(filter: { status?: string; project_id?: string; assigned_to?: string; limit?: number; offset?: number; session_id?: string } = {}): Promise<any[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined) params.set(k, String(v));
    }
    return this.fetch(`/api/tasks?${params}`);
  }

  async getTask(id: string): Promise<any> {
    return this.fetch(`/api/tasks/${id}`);
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

  async getStats(): Promise<any> {
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
}

export function createClient(options?: TodosClientOptions): TodosClient {
  return new TodosClient(options);
}
