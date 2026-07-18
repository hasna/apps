// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.
// Regenerate: bun run sdk:generate

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: ConversationsClient 0.5.6

export interface Message { "id"?: number; "uuid"?: string; "session_id"?: string; "from_agent"?: string; "to_agent"?: string; "channel"?: string | null; "project_id"?: string | null; "content"?: string; "priority"?: string; "blocking"?: boolean; "reply_to"?: number | null; "working_dir"?: string | null; "repository"?: string | null; "branch"?: string | null; "metadata"?: Record<string, unknown> | null; "attachments"?: Array<Record<string, unknown>> | null; "created_at"?: string }

export interface Channel { "name"?: string; "description"?: string | null; "topic"?: string | null; "project_id"?: string | null; "created_by"?: string; "created_at"?: string; "archived_at"?: string | null }

export interface Project { "id"?: string; "name"?: string; "description"?: string | null; "path"?: string | null; "repository"?: string | null; "created_by"?: string; "status"?: string; "created_at"?: string }

export interface Agent { "agent"?: string; "session_id"?: string | null; "role"?: string; "project_id"?: string; "status"?: string; "last_seen_at"?: string }

export interface IncidentSnapshotV1 { "id": string; "title": string; "severity": "info" | "low" | "medium" | "high" | "critical"; "status": "open" | "investigating" | "contained" | "monitoring" | "resolved" | "superseded"; "owner": string; "affected_scopes": Array<string>; "blocked_scopes": Array<string>; "containment": string | null; "next_action": string | null; "deadline": string | null; "closure_evidence": Array<string>; "supersedes_id": string | null; "superseded_by_id": string | null; "resolved_at": string | null; "version": number; "created_at": string; "updated_at": string }

export interface IncidentProjectionEventV1 { "schema_version": 1; "source": "todos"; "authority_id": string; "incident_id": string; "transition_id": string; "incident_version": number; "occurred_at": string; "event_id": string; "projection_key": string; "incident": IncidentSnapshotV1 }

export interface IncidentProjectionRecord { "id": number; "event_id": string; "projection_key": string; "message_id": number; "schema_version": 1; "source": "todos"; "tenant_id": string; "authority_id": string; "incident_id": string; "transition_id": string; "incident_version": number; "occurred_at": string; "status": "open" | "investigating" | "contained" | "monitoring" | "resolved" | "superseded"; "severity": "info" | "low" | "medium" | "high" | "critical"; "blocking": boolean; "supersedes_transition_id": string | null; "supersedes_incident_id": string | null; "superseded_by_incident_id": string | null; "canonical_payload": string; "payload_hash": string; "created_at": string; "message": Message; "replayed": boolean }

export interface IncidentProjectionResponse { "projection": IncidentProjectionRecord }

export interface IncidentProjectionError { "error": string; "code"?: string | null }

export interface ConversationsClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class ConversationsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: ConversationsClientOptions) {
    if (!options.baseUrl) throw new Error("ConversationsClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
  }

    /** Liveness probe */
    async getHealth(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe (pings Postgres) */
    async getReady(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async listAgents(query?: { "online_only"?: boolean }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/agents`, {
        body: undefined,
        query,
        init,
      });
    }

    async heartbeat(body: { "agent"?: string; "session_id"?: string; "role"?: string; "project_id"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/agents/heartbeat`, {
        body,
        query: undefined,
        init,
      });
    }

    async listChannels(query?: { "include_archived"?: boolean }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/channels`, {
        body: undefined,
        query,
        init,
      });
    }

    async createChannel(body: { "name": string; "created_by"?: string; "description"?: string; "topic"?: string; "project_id"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/channels`, {
        body,
        query: undefined,
        init,
      });
    }

    async listMemberChannels(query?: { "agent": string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/channels/mine`, {
        body: undefined,
        query,
        init,
      });
    }

    async getChannel(name: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/channels/${encodeURIComponent(String(name))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async updateChannel(name: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("PATCH", `/v1/channels/${encodeURIComponent(String(name))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Append a canonical Todos incident projection */
    async appendIncidentProjection(body: IncidentProjectionEventV1, init?: RequestInit): Promise<IncidentProjectionResponse> {
      return this.request("POST", `/v1/incident-projections`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read one canonical incident projection */
    async getIncidentProjection(eventId: string, init?: RequestInit): Promise<IncidentProjectionResponse> {
      return this.request("GET", `/v1/incident-projections/${encodeURIComponent(String(eventId))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List messages */
    async listMessages(query?: { "to"?: string; "from"?: string; "channel"?: string; "session"?: string; "limit"?: number; "count"?: boolean }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/messages`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Send a message */
    async sendMessage(body: { "from"?: string; "to": string; "content": string; "channel"?: string; "project_id"?: string; "session_id"?: string; "priority"?: string; "blocking"?: boolean; "reply_to"?: number; "metadata"?: Record<string, unknown>; "working_dir"?: string; "repository"?: string; "branch"?: string; "attachments"?: Array<Record<string, unknown>> }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/messages`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List canonical current blockers visible to one agent */
    async listUnreadBlockers(query?: { "agent": string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/messages/blockers`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Bulk-ingest messages (idempotent backfill) */
    async bulkIngestMessages(body: { "messages": Array<{ "uuid": string; "from": string; "to": string; "content": string; "channel"?: string; "project_id"?: string; "session_id"?: string; "priority"?: string; "blocking"?: boolean; "created_at"?: string; "read_at"?: string; "edited_at"?: string; "pinned_at"?: string; "working_dir"?: string; "repository"?: string; "branch"?: string; "metadata"?: string; "attachments"?: string; "reply_to"?: number }> }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/messages/bulk`, {
        body,
        query: undefined,
        init,
      });
    }

    async getMessage(id: number, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/messages/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async deleteMessage(id: number, query?: { "from"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/v1/messages/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query,
        init,
      });
    }

    async listProjects(query?: { "status"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/projects`, {
        body: undefined,
        query,
        init,
      });
    }

    async createProject(body: { "name": string; "created_by"?: string; "description"?: string; "path"?: string; "repository"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/projects`, {
        body,
        query: undefined,
        init,
      });
    }

    async getProject(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async deleteProject(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async updateProject(id: string, body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("PATCH", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Version and mode */
    async getVersion(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
