// @generated from the projects-serve OpenAPI document by scripts/generate-sdk.ts.
// DO NOT EDIT BY HAND. Regenerate: bun run sdk:generate
// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Projects API 1.0.0-rc.1

export interface Root { "id": string; "slug": string; "name": string; "base_path": string; "tags"?: Array<string>; "default_kind"?: string | null; "repo_visibility"?: string | null; "allowed_recipes"?: Array<string>; "allowed_agents"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateRoot { "name": string; "base_path": string; "slug"?: string; "tags"?: Array<string>; "default_kind"?: string; "repo_visibility"?: "public" | "private"; "github_org"?: string; "metadata"?: Record<string, unknown> }

export interface UpdateRoot { "name"?: string; "base_path"?: string; "slug"?: string; "tags"?: Array<string>; "default_kind"?: string; "repo_visibility"?: "public" | "private"; "github_org"?: string; "metadata"?: Record<string, unknown> }

export interface Agent { "id": string; "slug": string; "name": string; "kind": "human" | "ai" | "service" | "cli"; "provider"?: string | null; "model"?: string | null; "role"?: string | null; "permissions"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateAgent { "name": string; "kind"?: "human" | "ai" | "service" | "cli"; "slug"?: string; "provider"?: string; "model"?: string; "role"?: string; "permissions"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface Recipe { "id": string; "slug": string; "name": string; "description"?: string | null; "kind"?: string | null; "version"?: number; "steps"?: Array<Record<string, unknown>>; "default_tags"?: Array<string>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateRecipe { "name": string; "slug"?: string; "description"?: string; "kind"?: string; "version"?: number; "steps"?: Array<Record<string, unknown>>; "default_tags"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface Workspace { "id": string; "slug": string; "name": string; "description"?: string | null; "kind": string; "status": "active" | "archived" | "deleted"; "root_id"?: string | null; "recipe_id"?: string | null; "primary_path"?: string | null; "git_remote"?: string | null; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateWorkspace { "name": string; "slug"?: string; "description"?: string; "kind"?: string; "root_id"?: string; "recipe_id"?: string; "primary_path"?: string; "git_remote"?: string; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "agent_id"?: string }

export interface UpdateWorkspace { "name"?: string; "slug"?: string; "description"?: string | null; "kind"?: string; "status"?: "active" | "archived" | "deleted"; "root_id"?: string | null; "recipe_id"?: string | null; "primary_path"?: string | null; "git_remote"?: string | null; "tags"?: Array<string>; "integrations"?: Record<string, unknown>; "metadata"?: Record<string, unknown>; "agent_id"?: string }

export interface WorkspaceEvent { "id": string; "workspace_id"?: string | null; "agent_id"?: string | null; "event_type": string; "source": string; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface WorkspaceList { "workspaces": Array<Workspace>; "count": number }

export interface RootList { "roots": Array<Root>; "count": number }

export interface AgentList { "agents": Array<Agent>; "count": number }

export interface RecipeList { "recipes": Array<Recipe>; "count": number }

export interface EventList { "events": Array<WorkspaceEvent>; "count": number }

export interface DeleteResult { "deleted": boolean; "hard"?: boolean; "id"?: string }

export interface Health { "status": string; "version": string; "mode": string }

export interface Error { "error": string; "reason"?: string }

export interface AgentRun { "id": string; "agent_id"?: string | null; "workspace_id"?: string | null; "provider"?: string | null; "model"?: string | null; "prompt": string; "status": "planned" | "running" | "completed" | "failed"; "plan_json"?: Record<string, unknown> | null; "tool_calls_json"?: Array<Record<string, unknown>>; "result_json"?: Record<string, unknown> | null; "error"?: string | null; "metadata"?: Record<string, unknown>; "started_at"?: string; "completed_at"?: string | null }

export interface CreateAgentRun { "agent_id"?: string; "workspace_id"?: string; "provider"?: string; "model"?: string; "prompt": string; "status"?: "planned" | "running" | "completed" | "failed"; "plan"?: Record<string, unknown>; "tool_calls"?: Array<Record<string, unknown>>; "result"?: Record<string, unknown>; "error"?: string; "metadata"?: Record<string, unknown> }

export interface UpdateAgentRun { "status"?: "planned" | "running" | "completed" | "failed"; "provider"?: string; "model"?: string; "plan"?: Record<string, unknown>; "tool_calls"?: Array<Record<string, unknown>>; "result"?: Record<string, unknown>; "error"?: string; "metadata"?: Record<string, unknown>; "completed_at"?: string }

export interface AgentRunList { "runs": Array<AgentRun>; "count": number }

export interface Budget { "id": string; "scope_type": "project" | "run"; "scope_id": string; "window": "daily" | "monthly" | "lifetime"; "mode": "hard" | "soft"; "max_usd"?: number | null; "max_input_tokens"?: number | null; "max_output_tokens"?: number | null; "max_total_tokens"?: number | null; "warning_threshold"?: number | null; "reset_at"?: string | null; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateBudget { "scope_type": "project" | "run"; "scope_id": string; "window": "daily" | "monthly" | "lifetime"; "mode"?: "hard" | "soft"; "max_usd"?: number; "max_input_tokens"?: number; "max_output_tokens"?: number; "max_total_tokens"?: number; "warning_threshold"?: number; "reset_at"?: string; "metadata"?: Record<string, unknown> }

export interface BudgetList { "budgets": Array<Budget>; "count": number }

export interface Spend { "id": string; "workspace_id"?: string | null; "run_id"?: string | null; "provider"?: string | null; "model"?: string | null; "usd": number; "input_tokens"?: number; "output_tokens"?: number; "total_tokens"?: number; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface RecordSpend { "workspace_id"?: string; "run_id"?: string; "provider"?: string; "model"?: string; "usd"?: number; "input_tokens"?: number; "output_tokens"?: number; "total_tokens"?: number; "metadata"?: Record<string, unknown> }

export interface SpendList { "spend": Array<Spend>; "count": number }

export interface WorkspaceLocation { "id": string; "workspace_id": string; "path": string; "machine_id": string; "label"?: string; "kind"?: string; "is_primary"?: boolean; "exists_at_create"?: boolean; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface AddWorkspaceLocation { "path": string; "machine_id": string; "label"?: string; "kind"?: string; "is_primary"?: boolean; "exists_at_create"?: boolean; "metadata"?: Record<string, unknown> }

export interface LocationList { "locations": Array<WorkspaceLocation>; "count": number }

export interface WorkspaceAgentAssignment { "id": string; "workspace_id": string; "agent_id": string; "role": string; "assigned_by"?: string | null; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface AssignWorkspaceAgent { "agent_id": string; "role"?: string; "assigned_by"?: string; "metadata"?: Record<string, unknown> }

export interface WorkspaceAgentList { "agents": Array<WorkspaceAgentAssignment>; "count": number }

export interface TmuxProfileWindow { "id": string; "profile_id": string; "window_name_template": string; "path_template"?: string | null; "command"?: string | null; "window_index"?: number | null; "detached"?: boolean; "env"?: Record<string, unknown>; "revive"?: boolean; "created_at"?: string }

export interface CreateTmuxProfileWindow { "window_name_template": string; "path_template"?: string; "command"?: string; "window_index"?: number; "detached"?: boolean; "env"?: Record<string, unknown>; "revive"?: boolean }

export interface TmuxProfileWindowList { "windows": Array<TmuxProfileWindow>; "count": number }

export interface TmuxProfile { "id": string; "slug": string; "name": string; "description"?: string | null; "session_template"?: string; "attach"?: boolean; "metadata"?: Record<string, unknown>; "created_at"?: string; "updated_at"?: string }

export interface CreateTmuxProfile { "name": string; "slug"?: string; "description"?: string; "session_template"?: string; "attach"?: boolean; "metadata"?: Record<string, unknown>; "windows"?: Array<CreateTmuxProfileWindow> }

export interface TmuxProfileList { "profiles": Array<TmuxProfile>; "count": number }

export interface WorkspaceTmuxSession { "id": string; "workspace_id": string; "profile_id"?: string | null; "session_name": string; "metadata"?: Record<string, unknown>; "created_at"?: string }

export interface RecordWorkspaceTmuxSession { "profile_id"?: string; "session_name": string; "metadata"?: Record<string, unknown> }

export interface SessionList { "sessions": Array<WorkspaceTmuxSession>; "count": number }

export interface WorkspaceLock { "id": string; "lock_key": string; "workspace_id"?: string | null; "agent_id"?: string | null; "reason"?: string | null; "created_at"?: string; "expires_at"?: string | null }

export interface AcquireWorkspaceLock { "lock_key": string; "workspace_id"?: string; "agent_id"?: string; "reason"?: string; "expires_at"?: string }

export interface LockList { "locks": Array<WorkspaceLock>; "count": number }

export interface ReleaseResult { "released": boolean; "lock_key"?: string }

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

    /** List budgets */
    async listBudgets(query?: { "scope_type"?: string; "scope_id"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<BudgetList> {
      return this.request("GET", `/v1/budgets`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a budget */
    async createBudget(body: CreateBudget, init?: RequestInit): Promise<Budget> {
      return this.request("POST", `/v1/budgets`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a budget */
    async getBudget(id: string, init?: RequestInit): Promise<Budget> {
      return this.request("GET", `/v1/budgets/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a budget */
    async deleteBudget(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/budgets/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a project location */
    async deleteLocation(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/locations/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List locks */
    async listLocks(query?: { "workspace_id"?: string }, init?: RequestInit): Promise<LockList> {
      return this.request("GET", `/v1/locks`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Acquire a lock */
    async acquireLock(body: AcquireWorkspaceLock, init?: RequestInit): Promise<WorkspaceLock> {
      return this.request("POST", `/v1/locks`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Release a lock by lock_key */
    async releaseLock(id: string, init?: RequestInit): Promise<ReleaseResult> {
      return this.request("DELETE", `/v1/locks/${encodeURIComponent(String(id))}`, {
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

    /** List a project's assigned agents */
    async listProjectAgents(id: string, init?: RequestInit): Promise<WorkspaceAgentList> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/agents`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Assign an agent to a project */
    async assignProjectAgent(id: string, body: AssignWorkspaceAgent, init?: RequestInit): Promise<WorkspaceAgentAssignment> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/agents`, {
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

    /** List a project's on-machine locations */
    async listProjectLocations(id: string, init?: RequestInit): Promise<LocationList> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/locations`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Register a project location (machine-local path persisted centrally) */
    async addProjectLocation(id: string, body: AddWorkspaceLocation, init?: RequestInit): Promise<WorkspaceLocation> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/locations`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List a project's locks */
    async listProjectLocks(id: string, init?: RequestInit): Promise<LockList> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/locks`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List a project's recorded tmux sessions */
    async listProjectSessions(id: string, init?: RequestInit): Promise<SessionList> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}/sessions`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Record a project tmux session (machine-local execution state) */
    async recordProjectSession(id: string, body: RecordWorkspaceTmuxSession, init?: RequestInit): Promise<WorkspaceTmuxSession> {
      return this.request("POST", `/v1/projects/${encodeURIComponent(String(id))}/sessions`, {
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

    /** List agent runs */
    async listRuns(query?: { "workspace_id"?: string; "agent_id"?: string; "status"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<AgentRunList> {
      return this.request("GET", `/v1/runs`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create an agent run */
    async createRun(body: CreateAgentRun, init?: RequestInit): Promise<AgentRun> {
      return this.request("POST", `/v1/runs`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get an agent run */
    async getRun(id: string, init?: RequestInit): Promise<AgentRun> {
      return this.request("GET", `/v1/runs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update an agent run (status/result/tool calls) */
    async updateRun(id: string, body: UpdateAgentRun, init?: RequestInit): Promise<AgentRun> {
      return this.request("PATCH", `/v1/runs/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete a recorded tmux session */
    async deleteSession(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/sessions/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List budget spend records */
    async listSpend(query?: { "workspace_id"?: string; "run_id"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<SpendList> {
      return this.request("GET", `/v1/spend`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Record a budget spend entry */
    async recordSpend(body: RecordSpend, init?: RequestInit): Promise<Spend> {
      return this.request("POST", `/v1/spend`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List tmux profiles */
    async listTmuxProfiles(init?: RequestInit): Promise<TmuxProfileList> {
      return this.request("GET", `/v1/tmux-profiles`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a tmux profile */
    async createTmuxProfile(body: CreateTmuxProfile, init?: RequestInit): Promise<TmuxProfile> {
      return this.request("POST", `/v1/tmux-profiles`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a tmux profile by id or slug */
    async getTmuxProfile(id: string, init?: RequestInit): Promise<TmuxProfile> {
      return this.request("GET", `/v1/tmux-profiles/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List a tmux profile's windows */
    async listTmuxProfileWindows(id: string, init?: RequestInit): Promise<TmuxProfileWindowList> {
      return this.request("GET", `/v1/tmux-profiles/${encodeURIComponent(String(id))}/windows`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Add a window to a tmux profile */
    async addTmuxProfileWindow(id: string, body: CreateTmuxProfileWindow, init?: RequestInit): Promise<TmuxProfileWindow> {
      return this.request("POST", `/v1/tmux-profiles/${encodeURIComponent(String(id))}/windows`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Remove a project agent assignment */
    async removeProjectAgent(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/workspace-agents/${encodeURIComponent(String(id))}`, {
        body: undefined,
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
