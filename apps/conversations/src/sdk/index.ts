// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.
// Regenerate: bun run sdk:generate

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: ConversationsClient 0.5.42

export interface Message { "id"?: number; "uuid"?: string; "session_id"?: string; "from_agent"?: string; "to_agent"?: string; "channel"?: string | null; "project_id"?: string | null; "content"?: string; "priority"?: string; "blocking"?: boolean; "reply_to"?: number | null; "created_at"?: string }

export interface ProjectMessageLinkageHash { "id": number; "uuid": string; "hash": string; "preserved_hash": string }

export interface Channel { "id"?: string; "name"?: string; "description"?: string | null; "topic"?: string | null; "project_id"?: string | null; "created_by"?: string; "created_at"?: string; "archived_at"?: string | null; "metadata"?: Record<string, unknown> | null; "tags"?: Array<string> }

export interface ProjectChannelCollectionItem { "authority": string; "resource_kind": string; "scope": string; "project_id": string; "channel": string; "target_id": string; "revision": string; "digest": string }

export interface ProjectChannelCollectionPage { "authority": string; "resource_kind": string; "scope": string; "project_id": string; "items": Array<ProjectChannelCollectionItem>; "cursor": string | null; "next_cursor": string | null; "cursor_semantics": string; "max_items": number; "item_count": number; "has_more": boolean; "complete": boolean; "truncated": boolean; "response_bytes": number; "elapsed_ms": number }

export interface ProjectChannelMessageCollectionItem { "authority": string; "resource_kind": string; "scope": string; "target_id": string; "local_id": number; "channel_id": string; "channel": string; "project_id": string; "reply_to_target_id": string | null; "revision": string; "digest": string }

export interface ProjectChannelMessageCollectionPage { "authority": string; "resource_kind": string; "scope": string; "project_id": string; "channel_id": string; "channel": string; "items": Array<ProjectChannelMessageCollectionItem>; "cursor": number | null; "next_cursor": number | null; "cursor_semantics": string; "max_items": number; "item_count": number; "has_more": boolean; "complete": boolean; "truncated": boolean; "response_bytes": number; "elapsed_ms": number }

export interface Project { "id"?: string; "name"?: string; "description"?: string | null; "path"?: string | null; "repository"?: string | null; "created_by"?: string; "status"?: string; "created_at"?: string }

export interface ProjectPage { "projects": Array<Project>; "count": number; "cursor": number; "limit"?: number | null; "has_more": boolean; "next_cursor": number | null }

export interface Agent { "agent"?: string; "session_id"?: string | null; "role"?: string; "project_id"?: string; "status"?: string; "last_seen_at"?: string }

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

function apiErrorMessage(method: string, path: string, status: number, body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return `${method} ${path} failed: ${status}`;
  }
  const record = body as Record<string, unknown>;
  const parts = [
    typeof record.error === "string" ? record.error : null,
    typeof record.field === "string" ? `field=${record.field}` : null,
    typeof record.reason === "string" ? record.reason : null,
    typeof record.hint === "string" ? `hint: ${record.hint}` : null,
  ].filter(Boolean);
  return `${method} ${path} failed: ${status}${parts.length ? `: ${parts.join("; ")}` : ""}`;
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

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit; responseType?: "json" | "arrayBuffer" }): Promise<T> {
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
    if (response.ok && opts.responseType === "arrayBuffer" && !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return await response.arrayBuffer() as T;
    }
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, apiErrorMessage(method, path, response.status, data), data);
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

    async listChannels(query?: { "include_archived"?: boolean; "project_id"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/channels`, {
        body: undefined,
        query,
        init,
      });
    }

    async createChannel(body: { "name": string; "created_by"?: string; "description"?: string; "topic"?: string; "project_id"?: string; "metadata"?: Record<string, unknown>; "tags"?: Array<string> }, init?: RequestInit): Promise<Record<string, unknown>> {
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

    /** Plan or apply an exact conditional rollback from an immutable linkage receipt */
    async rollbackChannelProjectMessageLinkage(body: { "receipt_id": string; "expected_revision": string; "idempotency_key": string; "apply": boolean }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/channels/project-message-linkage/rollback`, {
        body,
        query: undefined,
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

    /** Plan or apply guarded project linkage for every message in one exact project-linked channel */
    async applyChannelProjectMessageLinkage(name: string, body: { "project_id": string; "apply": boolean; "expected_revision"?: string; "idempotency_key"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/channels/${encodeURIComponent(String(name))}/project-message-linkage`, {
        body,
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
    async sendMessage(body: { "uuid"?: string; "from"?: string; "to": string; "content": string; "channel"?: string; "project_id"?: string; "session_id"?: string; "priority"?: string; "blocking"?: boolean; "working_dir"?: string; "repository"?: string; "branch"?: string; "reply_to"?: number; "reply_to_uuid"?: string; "attachments"?: Array<{ "name": string; "content_base64": string }> }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/messages`, {
        body,
        query: undefined,
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

    async getMessageByUuid(uuid: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/messages/by-uuid/${encodeURIComponent(String(uuid))}`, {
        body: undefined,
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

    /** Download one message attachment */
    async downloadMessageAttachment(id: number, name: string, query: { "encoding": "base64" }, init?: RequestInit): Promise<{ "name": string; "mime_type": string; "size": number; "content_base64": string }>;
    async downloadMessageAttachment(id: number, name: string, query?: { "encoding"?: undefined }, init?: RequestInit): Promise<ArrayBuffer>;
    async downloadMessageAttachment(id: number, name: string, query?: { "encoding"?: "base64" }, init?: RequestInit): Promise<ArrayBuffer | { "name": string; "mime_type": string; "size": number; "content_base64": string }> {
      return this.request("GET", `/v1/messages/${encodeURIComponent(String(id))}/attachments/${encodeURIComponent(String(name))}`, {
        body: undefined,
        query,
        init,
        responseType: "arrayBuffer",
      });
    }

    /** List one bounded page of project-owned channel registrations */
    async listProjectChannelRegistrations(query?: { "project_id": string; "cursor"?: string; "max_items": number; "response_byte_limit": number; "time_budget_ms": number; "call_limit": number }, init?: RequestInit): Promise<ProjectChannelCollectionPage> {
      return this.request("GET", `/v1/project-registration/channels`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Conditionally register one absent canonical project channel */
    async registerProjectChannel(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read the package-owned conditional channel registration capability */
    async getProjectChannelRegistrationCapability(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/project-registration/channels/capability`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Conditionally remove only the channel created by one accepted receipt */
    async compensateProjectChannelRegistration(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels/inverse`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Verify exact target absence against the accepted forward receipt */
    async verifyProjectChannelRegistrationInverse(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels/inverse/verify`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Bounded exact terminal receipt lookup */
    async lookupProjectChannelRegistrationReceipt(query?: { "operation_id": string; "step_id": string; "resource_kind": "channel"; "direction": "forward" | "inverse"; "authority": "conversations"; "authority_route": string; "package_version": string; "authority_id": string; "tenant_id": string; "corpus_id": string; "target_selector": string; "idempotency_key": string; "request_digest": string; "precondition_digest": string; "target_id"?: string; "max_items": number; "response_byte_limit": number; "time_budget_ms": number; "call_limit": number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/project-registration/channels/receipts/terminal`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Read one exact immutable channel id and canonical name */
    async readProjectChannelRegistrationExact(id: string, query?: { "resource_kind": "channel"; "target_selector"?: string; "target_digest": string; "response_byte_limit": number; "time_budget_ms": number; "call_limit": number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/project-registration/channels/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List one bounded page of messages inherited from a project-owned channel */
    async listProjectChannelMessages(id: string, query?: { "project_id": string; "cursor"?: number; "max_items": number; "response_byte_limit": number; "time_budget_ms": number; "call_limit": number }, init?: RequestInit): Promise<ProjectChannelMessageCollectionPage> {
      return this.request("GET", `/v1/project-registration/channels/${encodeURIComponent(String(id))}/messages`, {
        body: undefined,
        query,
        init,
      });
    }

    async listProjects(query?: { "status"?: string; "limit"?: number; "cursor"?: number; "offset"?: number }, init?: RequestInit): Promise<ProjectPage> {
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

    /** Package version and artifact-baked source SHA */
    async getVersion(init?: RequestInit): Promise<{ "status": string; "version": string; "app": string; "build_sha": string | null }> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}

export { IdentityError } from "../lib/identity.js";
