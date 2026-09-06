// @generated from src/server/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.
// Regenerate: bun run sdk:generate

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: ConversationsClient 0.7.14

export interface Message { "id"?: number; "uuid"?: string; "session_id"?: string; "from_agent"?: string; "to_agent"?: string; "channel"?: string | null; "project_id"?: string | null; "content"?: string; "priority"?: string; "blocking"?: boolean; "reply_to"?: number | null; "created_at"?: string; "reactions"?: Array<ReactionSummary> }

export interface Reaction { "id": number; "message_id": number; "agent": string; "emoji": string; "created_at": string }

export interface ReactionSummary { "emoji": string; "count": number; "agents": Array<string> }

export interface ReactionToggleResult { "toggled": "added" | "removed"; "reaction"?: Reaction }

export interface MessagePreview { "id": number; "mention_id"?: number; "uuid"?: string; "session_id": string; "from_agent": string; "to_agent": string; "channel": string | null; "project_id": string | null; "priority": "low" | "normal" | "high" | "urgent"; "working_dir": string | null; "repository": string | null; "branch": string | null; "created_at": string; "edited_at": string | null; "pinned_at": string | null; "unread": boolean; "blocking": boolean; "reply_to": number | null; "reply_count"?: number; "attachment_count": number; "has_attachments": boolean; "has_metadata": boolean; "preview": string; "preview_bytes": number; "content_bytes": number; "truncated": boolean; "redacted": boolean; "relevance_score"?: number; "reactions"?: Array<ReactionSummary> }

export interface MessagePreviewPage { "messages": Array<MessagePreview>; "count": number; "limit": number; "cursor": number; "next_cursor": number | null; "has_more": boolean; "skipped_count": number; "byte_length": number; "max_bytes": number; "timeout_ms": number; "compact": true; "detail_path": "messages/{id}"; "query"?: string }

export interface MessageResponse { "message": Message }

export interface ChannelNotification { "message_id": number; "channel": string; "from_agent": string; "created_at": string; "priority": "low" | "normal" | "high" | "urgent"; "preview": string; "unread": boolean; "has_attachments": boolean }

export interface ChannelNotificationPage { "notifications": Array<ChannelNotification>; "count": number; "limit": number; "cursor": number; "next_cursor": number | null; "has_more": boolean; "skipped_count": number; "byte_length": number; "max_bytes": number; "timeout_ms": number; "marked_read": number; "compact": true; "detail_path": "messages/{id}" }

export interface MessageExportRequest { "channel"?: string; "session_id"?: string; "from"?: string; "since"?: string; "until"?: string; "format"?: "json" | "csv"; "detail"?: "preview"; "limit"?: number; "max_bytes"?: number; "preview_bytes"?: number; "timeout_ms"?: number }

export interface MessageExportArtifact { "artifact_id": string; "filename": string; "path": string | null; "download_path": string | null; "sha256": string; "format": "json" | "csv"; "detail": "preview"; "count": number; "has_more": boolean; "skipped_count": number; "byte_length": number; "max_bytes": number; "timeout_ms": number; "created_at": string }

export interface MessageExportArtifactResponse { "artifact": MessageExportArtifact }

export interface ProjectMessageLinkageHash { "id": number; "uuid": string; "hash": string; "preserved_hash": string }

export interface Channel { "id"?: string; "name"?: string; "description"?: string | null; "topic"?: string | null; "project_id"?: string | null; "created_by"?: string; "created_at"?: string; "archived_at"?: string | null; "metadata"?: Record<string, unknown> | null; "tags"?: Array<string> }

export interface ProjectChannelCollectionItem { "authority": string; "resource_kind": string; "scope": string; "project_id": string; "channel": string; "target_id": string; "revision": string; "digest": string }

export interface ProjectChannelCollectionPage { "authority": string; "resource_kind": string; "scope": string; "project_id": string; "collection_revision": string; "items": Array<ProjectChannelCollectionItem>; "cursor": string | null; "next_cursor": string | null; "cursor_semantics": string; "max_items": number; "item_count": number; "has_more": boolean; "complete": boolean; "truncated": boolean; "response_bytes": number; "elapsed_ms": number }

export interface ProjectChannelMessageCollectionItem { "authority": string; "resource_kind": string; "scope": string; "target_id": string; "local_id": number; "channel_id": string; "channel": string; "project_id": string; "reply_to_target_id": string | null; "revision": string; "digest": string }

export interface ProjectChannelMessageCollectionPage { "authority": string; "resource_kind": string; "scope": string; "project_id": string; "channel_id": string; "channel": string; "items": Array<ProjectChannelMessageCollectionItem>; "cursor": number | null; "next_cursor": number | null; "cursor_semantics": string; "max_items": number; "item_count": number; "has_more": boolean; "complete": boolean; "truncated": boolean; "response_bytes": number; "elapsed_ms": number }

export interface Project { "id"?: string; "name"?: string; "description"?: string | null; "path"?: string | null; "repository"?: string | null; "created_by"?: string; "status"?: string; "created_at"?: string }

export interface ProjectPage { "projects": Array<Project>; "count": number; "cursor": number; "limit"?: number | null; "has_more": boolean; "next_cursor": number | null }

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
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
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

    /** Flag — and only with apply:true, remove — registrations created once and never seen again whose last heartbeat is older than the retention window. */
    async reapStaleSingleTouch(body: { "apply"?: boolean; "older_than_seconds"?: number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/agents/reap-stale`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read a bounded, cursored page of notifications for the authenticated principal */
    async readChannelNotifications(query?: { "agent": string; "channel"?: string; "since"?: string; "unread_only"?: boolean; "mark_read"?: boolean; "limit"?: number; "cursor"?: number; "max_bytes"?: number; "preview_bytes"?: number; "timeout_ms"?: number }, init?: RequestInit): Promise<ChannelNotificationPage> {
      return this.request("GET", `/v1/channel-notifications/inbox`, {
        body: undefined,
        query,
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

    /** Plan or apply an atomic merge of a source channel into this destination channel, preserving message ids */
    async mergeChannel(name: string, body: { "source_channel": string; "dry_run"?: boolean; "archive_source"?: boolean; "expected_revision"?: string; "idempotency_key"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/channels/${encodeURIComponent(String(name))}/merge`, {
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

    /** List bounded, redacted message previews */
    async listMessages(query?: { "to"?: string; "from"?: string; "channel"?: string; "session"?: string; "project_id"?: string; "id"?: number; "uuid"?: string; "since_id"?: number; "since"?: string; "until"?: string; "limit"?: number; "offset"?: number; "order"?: "asc" | "desc"; "q"?: string; "mentions_only"?: string; "unread_only"?: boolean; "threads_only"?: boolean; "pinned_only"?: boolean; "blocking_only"?: boolean; "reply_to"?: number; "include_reply_counts"?: boolean; "max_bytes"?: number; "preview_bytes"?: number; "timeout_ms"?: number; "count"?: boolean }, init?: RequestInit): Promise<MessagePreviewPage> {
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

    /** List bounded, redacted current-blocker previews visible to one agent */
    async listUnreadBlockers(query?: { "agent"?: string; "limit"?: number; "offset"?: number; "max_bytes"?: number; "preview_bytes"?: number; "timeout_ms"?: number }, init?: RequestInit): Promise<MessagePreviewPage> {
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

    async getMessageByUuid(uuid: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/messages/by-uuid/${encodeURIComponent(String(uuid))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a bounded preview-only message export artifact */
    async createMessageExport(body?: MessageExportRequest, init?: RequestInit): Promise<MessageExportArtifactResponse> {
      return this.request("POST", `/v1/messages/exports`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Download one bounded preview artifact owned by the authenticated principal */
    async downloadMessageExport(artifactId: string, init?: RequestInit): Promise<Array<MessagePreview> | string> {
      return this.request("GET", `/v1/messages/exports/${encodeURIComponent(String(artifactId))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    async getMessage(id: number, init?: RequestInit): Promise<MessageResponse> {
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

    /** List emoji reactions on a message, or the grouped summary with ?summary=true */
    async listReactions(id: number, query?: { "summary"?: boolean }, init?: RequestInit): Promise<{ "reactions"?: Array<Reaction>; "summary"?: Array<ReactionSummary> }> {
      return this.request("GET", `/v1/messages/${encodeURIComponent(String(id))}/reactions`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Toggle an emoji reaction (same actor + emoji adds then removes) */
    async react(id: number, body: { "agent"?: string; "emoji": string }, init?: RequestInit): Promise<ReactionToggleResult> {
      return this.request("POST", `/v1/messages/${encodeURIComponent(String(id))}/reactions`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Explicitly remove an emoji reaction (404 when absent) */
    async removeReaction(id: number, query?: { "agent"?: string; "emoji": string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/v1/messages/${encodeURIComponent(String(id))}/reactions`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List one bounded page of project-owned channel registrations */
    async listProjectChannelRegistrations(query?: { "project_id": string; "cursor"?: string; "collection_revision"?: string; "max_items": number; "response_byte_limit": number; "time_budget_ms": number; "call_limit": number }, init?: RequestInit): Promise<ProjectChannelCollectionPage> {
      return this.request("GET", `/v1/project-registration/channels`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Conditionally create one absent canonical project channel */
    async registerProjectChannel(body: { "operation_intent"?: "create" } & Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Conditionally adopt one exact pre-bound channel without changing its content */
    async adoptExistingProjectChannel(body: { "operation_intent": "adopt_existing"; "adopt_existing": { "target_id": string; "expected_project_id": string; "expected_revision": string; "expected_digest": string; "expected_message_ownership": { "message_count": number; "first_message_id": number | null; "last_message_id": number | null; "message_ids_digest": string; "message_project_digest": string; "digest": string; "preserved_digest": string } } } & Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels/adopt-existing`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Conditionally bind one exact existing channel to a Projects workspace */
    async bindExistingProjectChannel(body: { "operation_intent": "bind_existing"; "bind_existing": Record<string, unknown> } & Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels/bind-existing`, {
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

    /** Conditionally remove an operation-created channel or restore prior ownership */
    async compensateProjectChannelRegistration(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels/inverse`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Verify exact target absence or restored ownership against the accepted receipt */
    async verifyProjectChannelRegistrationInverse(body: Record<string, unknown>, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/project-registration/channels/inverse/verify`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Bounded exact terminal receipt lookup */
    async lookupProjectChannelRegistrationReceipt(query?: { "operation_id": string; "step_id": string; "resource_kind": "channel"; "direction": "forward" | "inverse"; "authority": "conversations"; "authority_route": string; "package_version": string; "authority_id": string; "tenant_id": string; "corpus_id": string; "target_selector": string; "idempotency_key": string; "request_digest": string; "precondition_digest": string; "precondition_kind"?: "absent" | "bind_existing" | "adopt_existing"; "target_id"?: string; "max_items": number; "response_byte_limit": number; "time_budget_ms": number; "call_limit": number }, init?: RequestInit): Promise<Record<string, unknown>> {
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

    /** List reply threads in a channel */
    async listThreads(query?: { "channel": string; "from"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/threads`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Expand one thread into its full nested reply tree */
    async expandThread(id: number, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/threads/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Close or reopen a thread */
    async setThreadStatus(id: number, body: { "status": "open" | "closed" }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/threads/${encodeURIComponent(String(id))}/status`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Per-agent unread count for one thread */
    async getThreadUnread(id: number, query?: { "agent": string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/threads/${encodeURIComponent(String(id))}/unread`, {
        body: undefined,
        query,
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
