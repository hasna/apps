import type {
  Ticket, Project, Comment, Agent, SimilarTicket,
  ApiResponse, CreateTicketInput, UpdateTicketInput, ListTicketsInput,
  Resolution,
} from "./types.ts";

export interface TicketsClientOptions {
  baseUrl?: string;
  apiKey: string;
}

class TicketsClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TicketsClientError";
  }
}

export class TicketsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: TicketsClientOptions) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:19428").replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        ...init.headers,
      },
    });

    const body = await res.json() as ApiResponse<T> | { data: null; error: { code: string; message: string } };
    if (!res.ok || body.error) {
      const err = (body as { error?: { code?: string; message?: string } }).error;
      throw new TicketsClientError(err?.code ?? "ERROR", err?.message ?? `HTTP ${res.status}`);
    }
    return (body as ApiResponse<T>).data;
  }

  private json(body: unknown): RequestInit {
    return { body: JSON.stringify(body) };
  }

  // ── Tickets ───────────────────────────────────────────────────────────────

  readonly tickets = {
    create: (input: CreateTicketInput): Promise<Ticket> =>
      this.fetch<Ticket>("/tickets", { method: "POST", ...this.json(input) }),

    get: (idOrShortId: string): Promise<Ticket> =>
      this.fetch<Ticket>(`/tickets/${encodeURIComponent(idOrShortId)}`),

    list: (filters: ListTicketsInput = {}): Promise<{ tickets: Ticket[]; total: number }> => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined) params.set(k, String(v));
      }
      return this.fetch<{ tickets: Ticket[]; total: number }>(`/tickets?${params}`);
    },

    update: (idOrShortId: string, input: UpdateTicketInput): Promise<Ticket> =>
      this.fetch<Ticket>(`/tickets/${encodeURIComponent(idOrShortId)}`, { method: "PATCH", ...this.json(input) }),

    close: (idOrShortId: string, resolution: Resolution, duplicateOf?: string): Promise<Ticket> =>
      this.fetch<Ticket>(`/tickets/${encodeURIComponent(idOrShortId)}/close`, {
        method: "POST",
        ...this.json({ resolution, duplicate_of: duplicateOf }),
      }),

    reopen: (idOrShortId: string): Promise<Ticket> =>
      this.fetch<Ticket>(`/tickets/${encodeURIComponent(idOrShortId)}/reopen`, { method: "POST" }),

    assign: (idOrShortId: string, assigneeId: string | null): Promise<Ticket> =>
      this.fetch<Ticket>(`/tickets/${encodeURIComponent(idOrShortId)}/assign`, {
        method: "POST",
        ...this.json({ assignee_id: assigneeId }),
      }),

    delete: (idOrShortId: string): Promise<null> =>
      this.fetch<null>(`/tickets/${encodeURIComponent(idOrShortId)}`, { method: "DELETE" }),

    comment: (idOrShortId: string, content: string, isInternal = false): Promise<Comment> =>
      this.fetch<Comment>(`/tickets/${encodeURIComponent(idOrShortId)}/comments`, {
        method: "POST",
        ...this.json({ content, is_internal: isInternal }),
      }),

    comments: (idOrShortId: string, includeInternal = false): Promise<Comment[]> =>
      this.fetch<Comment[]>(`/tickets/${encodeURIComponent(idOrShortId)}/comments?include_internal=${includeInternal}`),

    similar: (title: string, projectId?: string, limit = 5): Promise<SimilarTicket[]> => {
      const params = new URLSearchParams({ title, limit: String(limit) });
      if (projectId) params.set("project_id", projectId);
      return this.fetch<SimilarTicket[]>(`/tickets/similar?${params}`);
    },

    search: (query: string, filters: { project_id?: string; status?: string; limit?: number } = {}): Promise<{ tickets: Ticket[]; total: number }> => {
      const params = new URLSearchParams({ q: query });
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined) params.set(k, String(v));
      }
      return this.fetch<{ tickets: Ticket[]; total: number }>(`/tickets/search?${params}`);
    },
  };

  // ── Projects ──────────────────────────────────────────────────────────────

  readonly projects = {
    create: (input: { name: string; description?: string; ticket_prefix?: string; is_public?: boolean }): Promise<Project> =>
      this.fetch<Project>("/projects", { method: "POST", ...this.json(input) }),

    get: (id: string): Promise<Project> =>
      this.fetch<Project>(`/projects/${id}`),

    list: (): Promise<Project[]> =>
      this.fetch<Project[]>("/projects"),

    stats: (id: string): Promise<{ total: number; open: number; in_progress: number; resolved: number; closed: number }> =>
      this.fetch(`/projects/${id}/stats`),
  };

  // ── Agents ────────────────────────────────────────────────────────────────

  readonly agents = {
    register: (name: string, type: "human" | "ai_agent" = "human", email?: string): Promise<Agent> =>
      this.fetch<Agent>("/agents", { method: "POST", ...this.json({ name, type, email }) }),

    get: (nameOrId: string): Promise<Agent> =>
      this.fetch<Agent>(`/agents/${encodeURIComponent(nameOrId)}`),

    list: (): Promise<Agent[]> =>
      this.fetch<Agent[]>("/agents"),

    tickets: (agentId: string, filters: ListTicketsInput = {}): Promise<{ tickets: Ticket[]; total: number }> => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined) params.set(k, String(v));
      }
      return this.fetch<{ tickets: Ticket[]; total: number }>(`/agents/${agentId}/tickets?${params}`);
    },
  };

  // ── Webhooks ──────────────────────────────────────────────────────────────

  readonly webhooks = {
    create: (url: string, events: string[], options: { project_id?: string; workspace_id?: string } = {}) =>
      this.fetch("/webhooks", { method: "POST", ...this.json({ url, events, ...options }) }),

    list: (options: { project_id?: string } = {}) => {
      const params = new URLSearchParams();
      if (options.project_id) params.set("project_id", options.project_id);
      return this.fetch(`/webhooks?${params}`);
    },

    delete: (id: string): Promise<null> =>
      this.fetch<null>(`/webhooks/${id}`, { method: "DELETE" }),

    test: (id: string) =>
      this.fetch(`/webhooks/${id}/test`, { method: "POST" }),
  };
}

export { TicketsClientError };
export type { TicketsClientOptions };
