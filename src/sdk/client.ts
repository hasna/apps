// @generated from the projects-serve OpenAPI document by scripts/generate-sdk.ts.
// DO NOT EDIT BY HAND. Regenerate: bun run sdk:generate
// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Projects API 0.1.117

export interface Root { "id": string; "slug": string; "name": string; "base_path": string; "tags"?: Array<string>; "default_kind"?: string | null; "repo_visibility"?: string | null; "allowed_recipes"?: Array<string>; "allowed_agents"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateRoot { "name": string; "base_path": string; "slug"?: string; "tags"?: Array<string>; "default_kind"?: string; "repo_visibility"?: "public" | "private"; "github_org"?: string; "metadata"?: Record<string, unknown> }

export interface UpdateRoot { "name"?: string; "base_path"?: string; "slug"?: string; "tags"?: Array<string>; "default_kind"?: string; "repo_visibility"?: "public" | "private"; "github_org"?: string; "metadata"?: Record<string, unknown> }

export interface Agent { "id": string; "slug": string; "name": string; "kind": "human" | "ai" | "service" | "cli"; "provider"?: string | null; "model"?: string | null; "role"?: string | null; "permissions"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateAgent { "name": string; "kind"?: "human" | "ai" | "service" | "cli"; "slug"?: string; "provider"?: string; "model"?: string; "role"?: string; "permissions"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface Recipe { "id": string; "slug": string; "name": string; "description"?: string | null; "kind"?: string | null; "version"?: number; "steps"?: Array<Record<string, unknown>>; "default_tags"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateRecipe { "name": string; "slug"?: string; "description"?: string; "kind"?: string; "version"?: number; "steps"?: Array<Record<string, unknown>>; "default_tags"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface Workspace { "id": string; "slug": string; "name": string; "description"?: string | null; "kind": string; "status": "active" | "archived" | "deleted"; "root_id"?: string | null; "recipe_id"?: string | null; "canonical_machine"?: string | null; "primary_path"?: string | null; "git_remote"?: string | null; "s3_bucket": string | null; "s3_prefix": string | null; "tags"?: Array<string>; "integrations"?: Record<string, string>; "metadata"?: Record<string, unknown>; "last_opened_at": string | null; "created_at"?: string; "updated_at"?: string; "synced_at": string | null }

export interface CreateWorkspace { "name": string; "slug"?: string; "description"?: string; "kind"?: string; "root_id"?: string; "recipe_id"?: string; "primary_path"?: string; "git_remote"?: string; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "agent_id"?: string }

export interface UpdateWorkspace { "name"?: string; "slug"?: string; "description"?: string | null; "kind"?: string; "status"?: "active" | "archived" | "deleted"; "root_id"?: string | null; "recipe_id"?: string | null; "canonical_machine"?: string | null; "primary_path"?: string | null; "git_remote"?: string | null; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "last_opened_at"?: string | null; "agent_id"?: string }

export interface WorkspaceEvent { "id": string; "workspace_id"?: string | null; "agent_id"?: string | null; "event_type": string; "source": string; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface WorkspaceList { "workspaces": Array<Workspace>; "count": number; "total": number; "offset": number; "limit": number; "has_more": boolean; "complete": boolean }

export interface GuardedResponseControl { "response_byte_limit": number; "time_budget_ms": number; "response_bytes": number; "elapsed_ms": number; "complete": boolean; "truncated": boolean }

export interface GuardedProjectRead { "ok": boolean; "project_id": string; "project": Workspace; "current_revision": string; "resource_links": Array<ProjectResourceLink>; "resource_link_count": number; "resource_link_max_items": number; "resource_link_collection_digest": string; "response_control": GuardedResponseControl }

export interface ProjectResourceLinkLabels { "name"?: string; "channel_name"?: string; "path"?: string; "tags"?: Array<string> }

export interface ProjectResourceConversationsChannelLabels { "name"?: string; "channel_name": string; "path"?: string; "tags"?: Array<string> }

export interface ProjectResourceExternalUuidLocator { "kind": "external_uuid"; "value": string }

export interface ProjectResourceCanonicalUriLocator { "kind": "canonical_uri"; "value": string }

export interface ProjectResourceConversationsChannelLocator { "kind": "conversations_channel_id"; "value": string }

export type ProjectResourceLinkLocator = ProjectResourceExternalUuidLocator | ProjectResourceCanonicalUriLocator | ProjectResourceConversationsChannelLocator;

export type ProjectResourcePortableLocator = ProjectResourceExternalUuidLocator | ProjectResourceCanonicalUriLocator;

export type ProjectResourceConversationsChannelLinkLocator = ProjectResourceExternalUuidLocator | ProjectResourceConversationsChannelLocator;

export type ProjectResourceLinkInput = { "authority": "todos"; "service_instance": string; "source_package": "@hasna/todos"; "target_kind": "project" | "task_list" | "plan"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels } | { "authority": "todos"; "service_instance": string; "source_package": "@hasna/todos"; "target_kind": "task"; "locator": ProjectResourceExternalUuidLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels } | { "authority": "conversations"; "service_instance": string; "source_package": "@hasna/conversations"; "target_kind": "project"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels } | { "authority": "conversations"; "service_instance": string; "source_package": "@hasna/conversations"; "target_kind": "channel"; "locator": ProjectResourceConversationsChannelLinkLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceConversationsChannelLabels } | { "authority": "knowledge"; "service_instance": string; "source_package": "@hasna/knowledge"; "target_kind": "collection" | "item"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels } | { "authority": "mementos"; "service_instance": string; "source_package": "@hasna/mementos"; "target_kind": "project" | "item"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels } | { "authority": "orgs"; "service_instance": string; "source_package": "@hasna/orgs"; "target_kind": "org" | "project"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels } | { "authority": "contacts"; "service_instance": string; "source_package": "@hasna/contacts"; "target_kind": "contact"; "locator": ProjectResourceExternalUuidLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels };

export type ProjectResourceLink = { "authority": "todos"; "service_instance": string; "source_package": "@hasna/todos"; "target_kind": "project" | "task_list" | "plan"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "todos"; "service_instance": string; "source_package": "@hasna/todos"; "target_kind": "task"; "locator": ProjectResourceExternalUuidLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "conversations"; "service_instance": string; "source_package": "@hasna/conversations"; "target_kind": "project"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "conversations"; "service_instance": string; "source_package": "@hasna/conversations"; "target_kind": "channel"; "locator": ProjectResourceConversationsChannelLinkLocator; "scope": "resource" | "collection"; "labels": ProjectResourceConversationsChannelLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "knowledge"; "service_instance": string; "source_package": "@hasna/knowledge"; "target_kind": "collection" | "item"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "mementos"; "service_instance": string; "source_package": "@hasna/mementos"; "target_kind": "project" | "item"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "orgs"; "service_instance": string; "source_package": "@hasna/orgs"; "target_kind": "org" | "project"; "locator": ProjectResourcePortableLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string } | { "authority": "contacts"; "service_instance": string; "source_package": "@hasna/contacts"; "target_kind": "contact"; "locator": ProjectResourceExternalUuidLocator; "scope": "resource" | "collection"; "labels": ProjectResourceLinkLabels; "id": string; "project_id": string; "created_at": string; "updated_at": string };

export interface ProjectResourceLinkCollectionV1 { "schema": "hasna.project_resource_link_collection.v1"; "project_id": string; "current_revision": string; "links": Array<ProjectResourceLink>; "link_count": number; "max_items": number; "collection_digest": string; "complete": true; "truncated": false }

export interface ProjectResourceLinkSnapshot { "project": Workspace; "links": Array<ProjectResourceLink>; "collection_digest": string }

export interface ProjectResourceLinkRead { "ok": boolean; "project_id": string; "project": Workspace; "current_revision": string; "links": Array<ProjectResourceLink>; "link_count": number; "max_items": number; "collection_digest": string; "complete": boolean; "truncated": boolean; "contract": ProjectResourceLinkCollectionV1; "response_control": GuardedResponseControl }

export interface ProjectResourceLinkMutationRequest { "operation_id": string; "step_id": string; "mode"?: "add" | "reconcile"; "expected_revision": string; "links": Array<ProjectResourceLinkInput>; "integrations"?: Record<string, unknown>; "max_items"?: number; "dry_run"?: boolean; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectResourceLinkMutationResult { "ok": boolean; "dry_run": boolean; "outcome": "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance" | "planned"; "mode": "add" | "reconcile"; "idempotency_key": string; "request_digest": string; "precondition_digest": string; "project_id": string; "expected_revision": string; "current_revision": string; "before": ProjectResourceLinkSnapshot; "after": ProjectResourceLinkSnapshot | null; "receipt": GuardedProjectMutationReceipt | null; "response_control": GuardedResponseControl }

export interface ContactProjectMembershipSnapshot { "contact_id": string; "project_id": string; "linked": boolean; "version": string }

export interface ProjectContactLinkEvidence { "system": "contacts" | "projects"; "step_id": string; "outcome": string; "receipt_id": string; "compensated": boolean }

export interface ProjectContactLinkMutationRequest { "operation_id": string; "labels"?: ProjectResourceLinkLabels; "max_items": number; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectContactLinkMutationResult { "ok": boolean; "outcome": "accepted" | "duplicate_of_accepted"; "authority": string; "project_id": string; "contact_id": string; "membership": ContactProjectMembershipSnapshot; "project_link": ProjectResourceLink | null; "evidence": Array<ProjectContactLinkEvidence>; "response_control": GuardedResponseControl }

export interface ProjectContactLinkListResult { "ok": boolean; "authority": string; "project_id": string; "membership_revision": string; "project_revision": string; "contact_ids": Array<string>; "synchronized_contact_ids": Array<string>; "missing_project_link_contact_ids": Array<string>; "stale_project_link_contact_ids": Array<string>; "project_links": Array<ProjectResourceLink>; "response_control": GuardedResponseControl }

export interface ProjectResourceLinkRollbackRequest { "operation_id": string; "step_id": string; "accepted_receipt_id": string; "expected_current_revision": string; "max_items"?: number; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectResourceLinkProducerBinding { "authority_id": string; "tenant_id": string; "corpus_id": string | null; "capability_digest": string }

export interface ProjectResourceLinkProducerEvidence { "created_by_operation": boolean; "forward_receipt_id": string | null; "child_link_receipt_ids": Array<string>; "target_revision": string; "target_digest": string; "inverse_verified": boolean | null; "inverse_outcome": string | null }

export interface ProjectResourceLinkMigrationItemInput { "link": ProjectResourceLinkInput; "producer_resource_kind": string; "producer_binding": ProjectResourceLinkProducerBinding }

export interface ProjectResourceLinkMigrationItem { "link": ProjectResourceLinkInput; "link_id": string; "producer_resource_kind": string; "producer_binding": ProjectResourceLinkProducerBinding; "producer_evidence": ProjectResourceLinkProducerEvidence | null }

export type ProjectResourceLinkProjectsReferenceProof = { "kind": "accepted_inverse"; "forward_receipt_id": string; "inverse_receipt_id": string; "verified_revision": string; "collection_digest": string; "link_ids_checked": Array<string>; "complete": true; "truncated": false; "request_digest": string; "precondition_digest": string } | { "kind": "no_projects_write"; "verified_revision": string; "collection_digest": string; "link_ids_checked": Array<string>; "complete": true; "truncated": false; "request_digest": string; "precondition_digest": string };

export interface ProjectResourceLinkMigrationManifestV1 { "schema": "projects.project_resource_link_migration_manifest.v1"; "manifest_id": string; "project_id": string; "operation_id": string; "step_id": string; "state": "planned" | "producer_applied" | "projects_applied" | "verified" | "rollback_in_progress" | "rolled_back" | "retained_target" | "failed_reconcilable"; "expected_project_revision": string; "desired_collection_digest": string; "links": Array<ProjectResourceLinkMigrationItem>; "projects_forward_receipt_id": string | null; "projects_inverse_receipt_id": string | null; "projects_reference_proof": ProjectResourceLinkProjectsReferenceProof | null; "last_verified_projects_revision": string | null; "last_verified_projects_digest": string | null; "transition_version": number; "created_at": string; "updated_at": string }

export interface ProjectResourceLinkMigrationEvent { "event_id": string; "manifest_id": string; "transition_version": number; "from_state": string | null; "to_state": string; "request_digest": string; "precondition_digest": string; "evidence": Record<string, unknown>; "created_at": string }

export interface ProjectResourceLinkMigrationPlanRequest { "operation_id": string; "step_id": string; "expected_project_revision": string; "links": Array<ProjectResourceLinkMigrationItemInput>; "max_items"?: number; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectResourceLinkMigrationAdvanceRequest { "expected_transition_version": number; "next_state": "producer_applied" | "projects_applied" | "verified" | "failed_reconcilable"; "max_items"?: number; "producer_evidence"?: Array<ProjectResourceLinkProducerEvidence>; "projects_forward_receipt_id"?: string; "last_verified_projects_revision"?: string; "last_verified_projects_digest"?: string; "evidence": Record<string, unknown>; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectResourceLinkMigrationRollbackRequest { "expected_transition_version": number; "max_items"?: number; "producer_outcome": "pending" | "complete" | "retained_target" | "failed_reconcilable"; "producer_evidence"?: Array<ProjectResourceLinkProducerEvidence>; "evidence": Record<string, unknown>; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectResourceLinkMigrationResult { "ok": boolean; "outcome": "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance"; "manifest": ProjectResourceLinkMigrationManifestV1; "events": Array<ProjectResourceLinkMigrationEvent>; "response_control": GuardedResponseControl }

export interface GuardedProjectMutationReceipt { "receipt_id": string; "operation_id": string; "step_id": string; "direction": "forward" | "inverse"; "idempotency_key": string; "target_id": string; "request_digest": string; "precondition_digest": string; "expected_revision": string; "outcome": "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance"; "reason": string | null; "result_project_id": string | null; "duplicate_of_receipt_id": string | null; "before": Record<string, unknown> | null; "after": Record<string, unknown> | null; "post_revision": string | null; "created_at": string }

export interface GuardedProjectMutationRequest { "operation_id": string; "step_id": string; "direction"?: "forward" | "inverse"; "expected_revision": string; "patch": UpdateWorkspace; "dry_run"?: boolean; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

export interface GuardedProjectMutationResult { "ok": boolean; "dry_run": boolean; "outcome": "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance" | "planned"; "idempotency_key": string; "request_digest": string; "precondition_digest": string; "project_id": string; "expected_revision": string; "current_revision": string; "before": Workspace; "after": Workspace | null; "receipt": GuardedProjectMutationReceipt | null; "response_control": GuardedResponseControl }

export interface GuardedProjectMutationReceiptLookup { "receipt": GuardedProjectMutationReceipt; "response_control": GuardedResponseControl }

export interface GuardedProjectMutationRollbackRequest { "operation_id": string; "step_id": string; "accepted_receipt_id": string; "expected_current_revision": string; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

export interface RootList { "roots": Array<Root>; "count": number }

export interface AgentList { "agents": Array<Agent>; "count": number }

export interface RecipeList { "recipes": Array<Recipe>; "count": number }

export interface EventList { "events": Array<WorkspaceEvent>; "count": number }

export interface RecordEvent { "event_type": string; "source"?: string; "agent_id"?: string; "prompt"?: string; "command"?: string; "before"?: Record<string, unknown> | null; "after"?: Record<string, unknown> | null; "metadata"?: Record<string, unknown> }

export interface EventRecorded { "event": WorkspaceEvent }

export interface DeleteResult { "deleted": boolean; "hard"?: boolean; "id"?: string }

export interface Health { "status": string; "version": string }

export interface LegacyVersionResponse { "status": string; "version": string; "mode": string }

export interface Error { "error": string; "reason"?: string }

export interface ProjectsClientOptions {
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

export class ProjectsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: ProjectsClientOptions) {
    if (!options.baseUrl) throw new Error("ProjectsClient requires a baseUrl.");
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
    async getHealth(init?: RequestInit): Promise<Health> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe (checks DB connectivity) */
    async getReady(init?: RequestInit): Promise<Health> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List agents */
    async listAgents(init?: RequestInit): Promise<AgentList> {
      return this.request("GET", `/v1/agents`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create an agent */
    async createAgent(body: CreateAgent, init?: RequestInit): Promise<Agent> {
      return this.request("POST", `/v1/agents`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get an agent by id or slug */
    async getAgent(id: string, init?: RequestInit): Promise<Agent> {
      return this.request("GET", `/v1/agents/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List projects (workspaces) */
    async listProjects(query?: { "status"?: string; "kind"?: string; "root_id"?: string; "query"?: string; "tag"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<WorkspaceList> {
      return this.request("GET", `/v1/projects`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a project (workspace) */
    async createProject(body: CreateWorkspace, init?: RequestInit): Promise<Workspace> {
      return this.request("POST", `/v1/projects`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a project by id or slug */
    async getProject(id: string, init?: RequestInit): Promise<Workspace> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a project (soft by default, ?hard=true for hard delete) */
    async deleteProject(id: string, query?: { "hard"?: boolean }, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Update a project */
    async updateProject(id: string, body: UpdateWorkspace, init?: RequestInit): Promise<Workspace> {
      return this.request("PATCH", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Archive a project */
    async archiveProject(id: string, init?: RequestInit): Promise<Workspace> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/archive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List Contacts-authoritative project memberships and compare synchronized Project resource links */
    async listProjectContacts(id: string, query?: { "max_items": number; "response_byte_limit": number; "time_budget_ms": number }, init?: RequestInit): Promise<ProjectContactLinkListResult> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/contacts`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Attach a Contact through Contacts-authoritative compensation-safe coordination */
    async attachProjectContact(id: string, contactId: string, body: ProjectContactLinkMutationRequest, init?: RequestInit): Promise<ProjectContactLinkMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/contacts/${encodeURIComponent(String(contactId))}/attach`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Detach a Contact through Contacts-authoritative compensation-safe coordination */
    async detachProjectContact(id: string, contactId: string, body: ProjectContactLinkMutationRequest, init?: RequestInit): Promise<ProjectContactLinkMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/contacts/${encodeURIComponent(String(contactId))}/detach`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List a project's events */
    async listProjectEvents(id: string, query?: { "limit"?: number }, init?: RequestInit): Promise<EventList> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/events`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Record a custom audit event for a project */
    async recordProjectEvent(id: string, body: RecordEvent, init?: RequestInit): Promise<EventRecorded> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/events`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read one project by exact stable id with bounded complete JSON and its current mutation revision */
    async guardedReadProject(id: string, query: { "response_byte_limit": number; "time_budget_ms": number; "resource_link_max_items"?: number }, init?: RequestInit): Promise<GuardedProjectRead> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/guarded-metadata`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Conditionally update one exact project and return a deterministic terminal receipt */
    async guardedUpdateProject(id: string, body: GuardedProjectMutationRequest, init?: RequestInit): Promise<GuardedProjectMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/guarded-metadata`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Look up exactly one terminal guarded mutation receipt */
    async lookupGuardedProjectMutationReceipt(id: string, query: { "operation_id": string; "step_id": string; "direction": "forward" | "inverse"; "idempotency_key": string; "max_items": number; "response_byte_limit": number; "time_budget_ms": number }, init?: RequestInit): Promise<GuardedProjectMutationReceiptLookup> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/guarded-metadata/receipts`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Conditionally roll back one accepted guarded mutation receipt */
    async rollbackGuardedProjectMutation(id: string, body: GuardedProjectMutationRollbackRequest, init?: RequestInit): Promise<GuardedProjectMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/guarded-metadata/rollback`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Persist a durable resource-link migration manifest before any authority write */
    async planProjectResourceLinkMigration(id: string, body: ProjectResourceLinkMigrationPlanRequest, init?: RequestInit): Promise<ProjectResourceLinkMigrationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/resource-link-migrations/plan`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read one durable migration manifest and its complete immutable event history */
    async readProjectResourceLinkMigration(id: string, manifestId: string, query: { "max_items": number; "response_byte_limit": number; "time_budget_ms": number }, init?: RequestInit): Promise<ProjectResourceLinkMigrationResult> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/resource-link-migrations/${encodeURIComponent(String(manifestId))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** CAS-advance a manifest after reconciling exact producer or Projects evidence */
    async advanceProjectResourceLinkMigration(id: string, manifestId: string, body: ProjectResourceLinkMigrationAdvanceRequest, init?: RequestInit): Promise<ProjectResourceLinkMigrationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/resource-link-migrations/${encodeURIComponent(String(manifestId))}/advance`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Remove Projects references first, persist proof, then record producer rollback outcome */
    async rollbackProjectResourceLinkMigration(id: string, manifestId: string, body: ProjectResourceLinkMigrationRollbackRequest, init?: RequestInit): Promise<ProjectResourceLinkMigrationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/resource-link-migrations/${encodeURIComponent(String(manifestId))}/rollback`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read the complete typed project resource-link collection under explicit bounds */
    async readProjectResourceLinks(id: string, query: { "max_items": number; "response_byte_limit": number; "time_budget_ms": number }, init?: RequestInit): Promise<ProjectResourceLinkRead> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/resource-links`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Idempotently add typed resource links under a project revision CAS */
    async addProjectResourceLinks(id: string, body: ProjectResourceLinkMutationRequest, init?: RequestInit): Promise<ProjectResourceLinkMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/resource-links/add`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Reconcile the complete typed resource-link collection under a project revision CAS */
    async reconcileProjectResourceLinks(id: string, body: ProjectResourceLinkMutationRequest, init?: RequestInit): Promise<ProjectResourceLinkMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/resource-links/reconcile`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Restore the exact pre-mutation typed resource-link collection from an accepted receipt */
    async rollbackProjectResourceLinks(id: string, body: ProjectResourceLinkRollbackRequest, init?: RequestInit): Promise<ProjectResourceLinkMutationResult> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/resource-links/rollback`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Unarchive a project */
    async unarchiveProject(id: string, init?: RequestInit): Promise<Workspace> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/unarchive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List recipes */
    async listRecipes(init?: RequestInit): Promise<RecipeList> {
      return this.request("GET", `/v1/recipes`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a recipe */
    async createRecipe(body: CreateRecipe, init?: RequestInit): Promise<Recipe> {
      return this.request("POST", `/v1/recipes`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a recipe by id or slug */
    async getRecipe(id: string, init?: RequestInit): Promise<Recipe> {
      return this.request("GET", `/v1/recipes/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List roots */
    async listRoots(init?: RequestInit): Promise<RootList> {
      return this.request("GET", `/v1/roots`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a root */
    async createRoot(body: CreateRoot, init?: RequestInit): Promise<Root> {
      return this.request("POST", `/v1/roots`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a root by id or slug */
    async getRoot(id: string, init?: RequestInit): Promise<Root> {
      return this.request("GET", `/v1/roots/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a root */
    async deleteRoot(id: string, query?: { "detach"?: boolean }, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/roots/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Update a root */
    async updateRoot(id: string, body: UpdateRoot, init?: RequestInit): Promise<Root> {
      return this.request("PATCH", `/v1/roots/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Service version */
    async getVersion(init?: RequestInit): Promise<LegacyVersionResponse> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
