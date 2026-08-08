// @generated from the projects-serve OpenAPI document by scripts/generate-sdk.ts.
// DO NOT EDIT BY HAND. Regenerate: bun run sdk:generate
// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Projects API 0.1.107

export interface Root { "id": string; "slug": string; "name": string; "base_path": string; "tags"?: Array<string>; "default_kind"?: string | null; "repo_visibility"?: string | null; "allowed_recipes"?: Array<string>; "allowed_agents"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateRoot { "name": string; "base_path": string; "slug"?: string; "tags"?: Array<string>; "default_kind"?: string; "repo_visibility"?: "public" | "private"; "github_org"?: string; "metadata"?: Record<string, unknown> }

export interface UpdateRoot { "name"?: string; "base_path"?: string; "slug"?: string; "tags"?: Array<string>; "default_kind"?: string; "repo_visibility"?: "public" | "private"; "github_org"?: string; "metadata"?: Record<string, unknown> }

export interface Agent { "id": string; "slug": string; "name": string; "kind": "human" | "ai" | "service" | "cli"; "provider"?: string | null; "model"?: string | null; "role"?: string | null; "permissions"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateAgent { "name": string; "kind"?: "human" | "ai" | "service" | "cli"; "slug"?: string; "provider"?: string; "model"?: string; "role"?: string; "permissions"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface Recipe { "id": string; "slug": string; "name": string; "description"?: string | null; "kind"?: string | null; "version"?: number; "steps"?: Array<Record<string, unknown>>; "default_tags"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateRecipe { "name": string; "slug"?: string; "description"?: string; "kind"?: string; "version"?: number; "steps"?: Array<Record<string, unknown>>; "default_tags"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface Workspace { "id": string; "slug": string; "name": string; "description"?: string | null; "kind": string; "status": "active" | "archived" | "deleted"; "root_id"?: string | null; "recipe_id"?: string | null; "canonical_machine"?: string | null; "primary_path"?: string | null; "git_remote"?: string | null; "s3_bucket": string | null; "s3_prefix": string | null; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "last_opened_at": string | null; "created_at"?: string; "updated_at"?: string; "synced_at": string | null }

export interface CreateWorkspace { "name": string; "slug"?: string; "description"?: string; "kind"?: string; "root_id"?: string; "recipe_id"?: string; "primary_path"?: string; "git_remote"?: string; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "agent_id"?: string }

export interface UpdateWorkspace { "name"?: string; "slug"?: string; "description"?: string | null; "kind"?: string; "status"?: "active" | "archived" | "deleted"; "root_id"?: string | null; "recipe_id"?: string | null; "canonical_machine"?: string | null; "primary_path"?: string | null; "git_remote"?: string | null; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "last_opened_at"?: string | null; "agent_id"?: string }

export interface WorkspaceEvent { "id": string; "workspace_id"?: string | null; "agent_id"?: string | null; "event_type": string; "source": string; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface WorkspaceList { "workspaces": Array<Workspace>; "count": number; "total": number; "offset": number; "limit": number; "has_more": boolean; "complete": boolean }

export interface GuardedResponseControl { "response_byte_limit": number; "time_budget_ms": number; "response_bytes": number; "elapsed_ms": number; "complete": boolean; "truncated": boolean }

export interface GuardedProjectRead { "ok": boolean; "project_id": string; "project": Workspace; "current_revision": string; "resource_links": Array<ProjectResourceLink>; "resource_link_count": number; "resource_link_max_items": number; "resource_link_collection_digest": string; "response_control": GuardedResponseControl }

export interface ProjectResourceLinkLabels { "name"?: string; "channel_name"?: string; "path"?: string; "tags"?: Array<string> }

export interface ProjectResourceLinkLocator { "kind": "external_uuid" | "canonical_uri" | "conversations_channel_id"; "value": string }

export interface ProjectResourceLinkInput { "authority": "todos" | "conversations" | "knowledge" | "mementos" | "orgs"; "service_instance": string; "source_package": "@hasna/todos" | "@hasna/conversations" | "@hasna/knowledge" | "@hasna/mementos" | "@hasna/orgs"; "target_kind": "org" | "project" | "task_list" | "plan" | "channel" | "collection" | "item"; "locator": ProjectResourceLinkLocator; "scope": "resource" | "collection"; "labels"?: ProjectResourceLinkLabels }

export type ProjectResourceLink = ProjectResourceLinkInput & { "id": string; "project_id": string; "labels": ProjectResourceLinkLabels; "created_at": string; "updated_at": string };

export interface ProjectResourceLinkSnapshot { "project": Workspace; "links": Array<ProjectResourceLink>; "collection_digest": string }

export interface ProjectResourceLinkRead { "ok": boolean; "project_id": string; "project": Workspace; "current_revision": string; "links": Array<ProjectResourceLink>; "link_count": number; "max_items": number; "collection_digest": string; "complete": boolean; "truncated": boolean; "response_control": GuardedResponseControl }

export interface ProjectResourceLinkMutationRequest { "operation_id": string; "step_id": string; "mode"?: "add" | "reconcile"; "expected_revision": string; "links": Array<ProjectResourceLinkInput>; "max_items"?: number; "dry_run"?: boolean; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

export interface ProjectResourceLinkMutationResult { "ok": boolean; "dry_run": boolean; "outcome": "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance" | "planned"; "mode": "add" | "reconcile"; "idempotency_key": string; "request_digest": string; "precondition_digest": string; "project_id": string; "expected_revision": string; "current_revision": string; "before": ProjectResourceLinkSnapshot; "after": ProjectResourceLinkSnapshot | null; "receipt": GuardedProjectMutationReceipt | null; "response_control": GuardedResponseControl }

export interface ProjectResourceLinkRollbackRequest { "operation_id": string; "step_id": string; "accepted_receipt_id": string; "expected_current_revision": string; "max_items"?: number; "agent_id"?: string; "source"?: string; "command"?: string; "response_byte_limit": number; "time_budget_ms": number }

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

export interface Health { "status": string; "version": string; "mode": string }

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
    async guardedReadProject(id: string, query?: { "response_byte_limit": number; "time_budget_ms": number; "resource_link_max_items"?: number }, init?: RequestInit): Promise<GuardedProjectRead> {
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
    async lookupGuardedProjectMutationReceipt(id: string, query?: { "operation_id": string; "step_id": string; "direction": "forward" | "inverse"; "idempotency_key": string; "max_items": number; "response_byte_limit": number; "time_budget_ms": number }, init?: RequestInit): Promise<GuardedProjectMutationReceiptLookup> {
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

    /** Read the complete typed project resource-link collection under explicit bounds */
    async readProjectResourceLinks(id: string, query?: { "max_items": number; "response_byte_limit": number; "time_budget_ms": number }, init?: RequestInit): Promise<ProjectResourceLinkRead> {
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
    async getVersion(init?: RequestInit): Promise<Health> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
