// Postgres-backed store for projects-serve (Amendment A1 pure-remote).
//
// This is the cloud data-access layer the HTTP API wraps. It mirrors the domain
// semantics of src/db/workspaces.ts (the local SQLite core) — id/slug rules,
// tag merging, JSON-encoded columns, event journaling — but executes async SQL
// against cloud Postgres through the vendored storage kit's TypedQueryClient.
// There is NO sync engine and NO local cache here (pure remote): every call
// hits the database.
//
// TENANCY (R1, additive — see serve/tenancy.ts + migrations/0002_tenants.sql):
// every store instance carries a tenantId (derived server-side from the API-key
// principal, defaulting to the ROOT tenant during the R1 transition). Every read
// is scoped `WHERE tenant_id = $ctx` and every write stamps tenant_id. This is
// the application-layer "belt"; the RLS "braces" (GUC + policies) are pre-staged
// but NOT enabled until R2. Per-tenant unique constraints are also R2 — global
// uniques stay for R1, which is safe because all live data is one (ROOT) tenant.

import { nanoid } from "nanoid";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { ROOT_TENANT_ID } from "./tenancy.js";
import type {
  AcquireWorkspaceLockInput,
  AddWorkspaceLocationInput,
  Agent,
  AgentRow,
  AgentRun,
  AgentRunRow,
  AssignWorkspaceAgentInput,
  Budget,
  BudgetRow,
  BudgetSpend,
  BudgetSpendRow,
  CreateAgentInput,
  CreateAgentRunInput,
  CreateBudgetInput,
  CreateRecipeInput,
  CreateRootInput,
  CreateTmuxProfileInput,
  CreateWorkspaceInput,
  EventSource,
  JsonObject,
  RecordBudgetSpendInput,
  RecordWorkspaceTmuxSessionInput,
  Recipe,
  RecipeRow,
  RecordWorkspaceEventInput,
  Root,
  RootRow,
  TmuxProfile,
  TmuxProfileRow,
  TmuxProfileWindow,
  TmuxProfileWindowRow,
  UpdateAgentRunInput,
  UpdateRootInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceAgentAssignment,
  WorkspaceAgentAssignmentRow,
  WorkspaceEvent,
  WorkspaceEventRow,
  WorkspaceIntegrations,
  WorkspaceKind,
  WorkspaceLocation,
  WorkspaceLocationRow,
  WorkspaceLock,
  WorkspaceLockRow,
  WorkspaceRow,
  WorkspaceStatus,
  WorkspaceTmuxSession,
  WorkspaceTmuxSessionRow,
} from "../types/workspace.js";

// ---------------------------------------------------------------------------
// Pure helpers (mirrors of the SQLite core, kept dependency-light)
// ---------------------------------------------------------------------------

export function generateWorkspaceId(): string {
  return `wks_${nanoid()}`;
}
export function generateRootId(): string {
  return `root_${nanoid()}`;
}
export function generateRecipeId(): string {
  return `rcp_${nanoid()}`;
}
export function generateAgentId(): string {
  return `agt_${nanoid()}`;
}
export function generateEventId(): string {
  return `evt_${nanoid()}`;
}
export function generateAgentRunId(): string {
  return `run_${nanoid()}`;
}
export function generateBudgetId(): string {
  return `bdg_${nanoid()}`;
}
export function generateSpendId(): string {
  return `spd_${nanoid()}`;
}
export function generateLocationId(): string {
  return `loc_${nanoid()}`;
}
export function generateAssignmentId(): string {
  return `asg_${nanoid()}`;
}
export function generateTmuxProfileId(): string {
  return `tmx_${nanoid()}`;
}
export function generateTmuxWindowId(): string {
  return `twn_${nanoid()}`;
}
export function generateTmuxSessionId(): string {
  return `tsn_${nanoid()}`;
}
export function generateLockId(): string {
  return `lck_${nanoid()}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function nowIso(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== "string") return raw as unknown as T; // pg jsonb already parsed
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Row mappers (Postgres rows share the SQLite TEXT/JSON column shape)
// ---------------------------------------------------------------------------

function rowToRoot(row: RootRow): Root {
  return {
    ...row,
    tags: parseJson<string[]>(row.tags, []),
    default_kind: row.default_kind as Root["default_kind"],
    repo_visibility: row.repo_visibility as Root["repo_visibility"],
    allowed_recipes: parseJson<string[]>(row.allowed_recipes, []),
    allowed_agents: parseJson<string[]>(row.allowed_agents, []),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToAgent(row: AgentRow): Agent {
  return {
    ...row,
    kind: row.kind as Agent["kind"],
    permissions: parseJson<string[]>(row.permissions, []),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    ...row,
    kind: row.kind as Recipe["kind"],
    steps: parseJson<JsonObject[]>(row.steps, []),
    variables: parseJson<JsonObject>(row.variables, {}),
    default_tags: parseJson<string[]>(row.default_tags, []),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...row,
    kind: row.kind as WorkspaceKind,
    status: row.status as WorkspaceStatus,
    tags: parseJson<string[]>(row.tags, []),
    integrations: parseJson<WorkspaceIntegrations>(row.integrations, {}),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToEvent(row: WorkspaceEventRow): WorkspaceEvent {
  return {
    ...row,
    source: row.source as EventSource,
    before_json: parseJson<JsonObject | null>(row.before_json, null),
    after_json: parseJson<JsonObject | null>(row.after_json, null),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    ...row,
    status: row.status as AgentRun["status"],
    plan_json: parseJson<JsonObject | null>(row.plan_json, null),
    tool_calls_json: parseJson<JsonObject[]>(row.tool_calls_json, []),
    result_json: parseJson<JsonObject | null>(row.result_json, null),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToBudget(row: BudgetRow): Budget {
  return {
    ...row,
    scope_type: row.scope_type as Budget["scope_type"],
    window: row.window as Budget["window"],
    mode: row.mode as Budget["mode"],
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToSpend(row: BudgetSpendRow): BudgetSpend {
  return {
    ...row,
    usd: num(row.usd),
    input_tokens: num(row.input_tokens),
    output_tokens: num(row.output_tokens),
    total_tokens: num(row.total_tokens),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToLocation(row: WorkspaceLocationRow): WorkspaceLocation {
  return {
    ...row,
    is_primary: Boolean(row.is_primary),
    exists_at_create: Boolean(row.exists_at_create),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToAssignment(row: WorkspaceAgentAssignmentRow): WorkspaceAgentAssignment {
  return {
    ...row,
    metadata: parseJson<JsonObject>(row.metadata, {}),
    agent: null,
  };
}

function rowToTmuxProfile(row: TmuxProfileRow): TmuxProfile {
  return {
    ...row,
    attach: Boolean(row.attach),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToTmuxWindow(row: TmuxProfileWindowRow): TmuxProfileWindow {
  return {
    ...row,
    detached: Boolean(row.detached),
    revive: Boolean(row.revive),
    env: parseJson<Record<string, string>>(row.env, {}),
  };
}

function rowToTmuxSession(row: WorkspaceTmuxSessionRow): WorkspaceTmuxSession {
  return { ...row, metadata: parseJson<JsonObject>(row.metadata, {}) };
}

function rowToLock(row: WorkspaceLockRow): WorkspaceLock {
  return { ...row };
}

/** Not-found error carrying an HTTP status hint for the router. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Client/validation error (bad input) carrying a 400 hint. */
export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface WorkspaceFilter {
  status?: WorkspaceStatus;
  kind?: WorkspaceKind;
  root_id?: string;
  query?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface AgentRunFilter {
  workspace_id?: string;
  agent_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface BudgetFilter {
  scope_type?: string;
  scope_id?: string;
  limit?: number;
  offset?: number;
}

export interface SpendFilter {
  workspace_id?: string;
  run_id?: string;
  limit?: number;
  offset?: number;
}

export class ProjectsPgStore {
  /** Server-derived tenant boundary for every query on this instance. */
  readonly tenantId: string;

  constructor(
    private readonly db: TypedQueryClient,
    opts: { tenantId?: string } = {},
  ) {
    this.tenantId = opts.tenantId ?? ROOT_TENANT_ID;
  }

  /** Return a store bound to a specific tenant (per-request scoping). */
  forTenant(tenantId: string): ProjectsPgStore {
    return new ProjectsPgStore(this.db, { tenantId });
  }

  // --- slug uniqueness (per-tenant; DB constraint is still global in R1) ----
  private async ensureUniqueSlug(table: string, base: string, excludeId?: string): Promise<string> {
    const safeBase = base || "workspace";
    let candidate = safeBase;
    let suffix = 1;
    // Table name is a fixed internal literal, never user input.
    for (;;) {
      const row = await this.db.get<{ id: string }>(
        `SELECT id FROM ${table} WHERE slug = $1 AND tenant_id = $2`,
        [candidate, this.tenantId],
      );
      if (!row || row.id === excludeId) return candidate;
      suffix++;
      candidate = `${safeBase}-${suffix}`;
    }
  }

  // --- roots ------------------------------------------------------------
  async listRoots(): Promise<Root[]> {
    const rows = await this.db.many<RootRow>(
      "SELECT * FROM roots WHERE tenant_id = $1 ORDER BY slug ASC",
      [this.tenantId],
    );
    return rows.map(rowToRoot);
  }

  async getRoot(idOrSlug: string): Promise<Root | null> {
    const row = await this.db.get<RootRow>(
      "SELECT * FROM roots WHERE (id = $1 OR slug = $1) AND tenant_id = $2",
      [idOrSlug, this.tenantId],
    );
    return row ? rowToRoot(row) : null;
  }

  async createRoot(input: CreateRootInput): Promise<Root> {
    if (!input.name?.trim()) throw new ValidationError("root name is required");
    if (!input.base_path?.trim()) throw new ValidationError("root base_path is required");
    const id = generateRootId();
    const ts = nowIso();
    const slug = await this.ensureUniqueSlug("roots", input.slug ?? slugify(input.name));
    await this.db.execute(
      `INSERT INTO roots (
        id, slug, name, base_path, tags, default_kind, default_recipe_id,
        default_tmux_profile_id, github_org, repo_visibility, path_template,
        name_template, allowed_recipes, allowed_agents, metadata, tenant_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        id,
        slug,
        input.name,
        input.base_path,
        json(normalizeList(input.tags)),
        input.default_kind ?? null,
        input.default_recipe_id ?? null,
        input.default_tmux_profile_id ?? null,
        input.github_org ?? null,
        input.repo_visibility ?? null,
        input.path_template ?? null,
        input.name_template ?? null,
        json(normalizeList(input.allowed_recipes)),
        json(normalizeList(input.allowed_agents)),
        json(input.metadata ?? {}),
        this.tenantId,
        ts,
        ts,
      ],
    );
    return (await this.getRoot(id))!;
  }

  async updateRoot(idOrSlug: string, input: UpdateRootInput): Promise<Root> {
    const before = await this.getRoot(idOrSlug);
    if (!before) throw new NotFoundError(`Root not found: ${idOrSlug}`);
    const updates: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };
    if (input.slug !== undefined) set("slug", await this.ensureUniqueSlug("roots", slugify(input.slug), before.id));
    if (input.name !== undefined) set("name", input.name);
    if (input.base_path !== undefined) set("base_path", input.base_path);
    if (input.tags !== undefined) set("tags", json(normalizeList(input.tags)));
    if (input.default_kind !== undefined) set("default_kind", input.default_kind);
    if (input.github_org !== undefined) set("github_org", input.github_org);
    if (input.repo_visibility !== undefined) set("repo_visibility", input.repo_visibility);
    if (input.path_template !== undefined) set("path_template", input.path_template);
    if (input.name_template !== undefined) set("name_template", input.name_template);
    if (input.allowed_recipes !== undefined) set("allowed_recipes", json(normalizeList(input.allowed_recipes)));
    if (input.allowed_agents !== undefined) set("allowed_agents", json(normalizeList(input.allowed_agents)));
    if (input.metadata !== undefined) set("metadata", json(input.metadata));
    if (!updates.length) return before;
    set("updated_at", nowIso());
    params.push(before.id);
    params.push(this.tenantId);
    await this.db.execute(
      `UPDATE roots SET ${updates.join(", ")} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
      params,
    );
    return (await this.getRoot(before.id))!;
  }

  async deleteRoot(idOrSlug: string, detachWorkspaces = false): Promise<{ root: Root; detached_workspaces: number }> {
    const root = await this.getRoot(idOrSlug);
    if (!root) throw new NotFoundError(`Root not found: ${idOrSlug}`);
    const countRow = await this.db.get<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM workspaces WHERE root_id = $1 AND tenant_id = $2",
      [root.id, this.tenantId],
    );
    const count = Number(countRow?.n ?? 0);
    if (count > 0 && !detachWorkspaces) {
      throw new ValidationError(
        `Root ${root.slug} is used by ${count} workspace(s); pass detach=true to clear those references before deletion.`,
      );
    }
    if (count > 0) {
      await this.db.execute(
        "UPDATE workspaces SET root_id = NULL, updated_at = $1 WHERE root_id = $2 AND tenant_id = $3",
        [nowIso(), root.id, this.tenantId],
      );
    }
    await this.db.execute("DELETE FROM roots WHERE id = $1 AND tenant_id = $2", [root.id, this.tenantId]);
    return { root, detached_workspaces: count };
  }

  // --- agents -----------------------------------------------------------
  async listAgents(): Promise<Agent[]> {
    const rows = await this.db.many<AgentRow>(
      "SELECT * FROM agents WHERE tenant_id = $1 ORDER BY slug ASC",
      [this.tenantId],
    );
    return rows.map(rowToAgent);
  }

  async getAgent(idOrSlug: string): Promise<Agent | null> {
    const row = await this.db.get<AgentRow>(
      "SELECT * FROM agents WHERE (id = $1 OR slug = $1) AND tenant_id = $2",
      [idOrSlug, this.tenantId],
    );
    return row ? rowToAgent(row) : null;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    if (!input.name?.trim()) throw new ValidationError("agent name is required");
    const kind = input.kind ?? "ai";
    if (!["human", "ai", "service", "cli"].includes(kind)) {
      throw new ValidationError(`invalid agent kind: ${kind}`);
    }
    const id = generateAgentId();
    const ts = nowIso();
    const slug = await this.ensureUniqueSlug("agents", input.slug ?? slugify(input.name));
    await this.db.execute(
      `INSERT INTO agents (id, slug, name, kind, provider, model, role, permissions, metadata, tenant_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        slug,
        input.name,
        kind,
        input.provider ?? null,
        input.model ?? null,
        input.role ?? null,
        json(normalizeList(input.permissions)),
        json(input.metadata ?? {}),
        this.tenantId,
        ts,
        ts,
      ],
    );
    return (await this.getAgent(id))!;
  }

  // --- recipes ----------------------------------------------------------
  async listRecipes(): Promise<Recipe[]> {
    const rows = await this.db.many<RecipeRow>(
      "SELECT * FROM recipes WHERE tenant_id = $1 ORDER BY slug ASC",
      [this.tenantId],
    );
    return rows.map(rowToRecipe);
  }

  async getRecipe(idOrSlug: string): Promise<Recipe | null> {
    const row = await this.db.get<RecipeRow>(
      "SELECT * FROM recipes WHERE (id = $1 OR slug = $1) AND tenant_id = $2",
      [idOrSlug, this.tenantId],
    );
    return row ? rowToRecipe(row) : null;
  }

  async createRecipe(input: CreateRecipeInput): Promise<Recipe> {
    if (!input.name?.trim()) throw new ValidationError("recipe name is required");
    const id = generateRecipeId();
    const ts = nowIso();
    const slug = await this.ensureUniqueSlug("recipes", input.slug ?? slugify(input.name));
    await this.db.execute(
      `INSERT INTO recipes (id, slug, name, description, kind, version, steps, variables, default_tags, default_tmux_profile_id, metadata, tenant_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        slug,
        input.name,
        input.description ?? null,
        input.kind ?? null,
        input.version ?? 1,
        json(input.steps ?? []),
        json(input.variables ?? {}),
        json(normalizeList(input.default_tags)),
        input.default_tmux_profile_id ?? null,
        json(input.metadata ?? {}),
        this.tenantId,
        ts,
        ts,
      ],
    );
    return (await this.getRecipe(id))!;
  }

  // --- workspaces (projects) -------------------------------------------
  async listWorkspaces(filter: WorkspaceFilter = {}): Promise<Workspace[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [this.tenantId];
    const push = (clause: (idx: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(clause(params.length));
    };
    if (filter.status) push((i) => `status = $${i}`, filter.status);
    if (filter.kind) push((i) => `kind = $${i}`, filter.kind);
    if (filter.root_id) push((i) => `root_id = $${i}`, filter.root_id);
    if (filter.query) {
      params.push(`%${filter.query.toLowerCase()}%`);
      const i = params.length;
      conditions.push(
        `(lower(name) LIKE $${i} OR lower(slug) LIKE $${i} OR lower(COALESCE(description,'')) LIKE $${i} OR lower(COALESCE(primary_path,'')) LIKE $${i} OR lower(COALESCE(tags,'')) LIKE $${i} OR lower(COALESCE(metadata,'')) LIKE $${i})`,
      );
    }
    if (filter.tags && filter.tags.length > 0) {
      for (const tag of filter.tags) {
        params.push(tag);
        conditions.push(`(tags::jsonb ? $${params.length})`);
      }
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    params.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
    const limitIdx = params.length;
    params.push(Math.max(filter.offset ?? 0, 0));
    const offsetIdx = params.length;
    const rows = await this.db.many<WorkspaceRow>(
      `SELECT * FROM workspaces ${where} ORDER BY name ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return rows.map(rowToWorkspace);
  }

  async getWorkspace(idOrSlug: string): Promise<Workspace | null> {
    const row = await this.db.get<WorkspaceRow>(
      "SELECT * FROM workspaces WHERE (id = $1 OR slug = $1) AND tenant_id = $2",
      [idOrSlug, this.tenantId],
    );
    return row ? rowToWorkspace(row) : null;
  }

  async requireWorkspace(idOrSlug: string): Promise<Workspace> {
    const ws = await this.getWorkspace(idOrSlug);
    if (!ws) throw new NotFoundError(`Workspace not found: ${idOrSlug}`);
    return ws;
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    if (!input.name?.trim()) throw new ValidationError("workspace name is required");
    const id = input.id ?? generateWorkspaceId();
    const ts = nowIso();
    const slug = await this.ensureUniqueSlug("workspaces", input.slug ?? slugify(input.name));

    const root = input.root_id ? await this.getRoot(input.root_id) : null;
    if (input.root_id && !root) throw new ValidationError(`Root not found: ${input.root_id}`);
    const recipe = input.recipe_id ? await this.getRecipe(input.recipe_id) : null;
    if (input.recipe_id && !recipe) throw new ValidationError(`Recipe not found: ${input.recipe_id}`);

    const kind = input.kind ?? recipe?.kind ?? root?.default_kind ?? "generic";
    const tags = normalizeList([...(root?.tags ?? []), ...(recipe?.default_tags ?? []), ...(input.tags ?? [])]);
    const primaryPath = input.primary_path ?? null;

    try {
      await this.db.execute(
        `INSERT INTO workspaces (
          id, slug, name, description, kind, status, root_id, recipe_id, primary_path,
          git_remote, s3_bucket, s3_prefix, tags, integrations, metadata, tenant_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id,
          slug,
          input.name,
          input.description ?? null,
          kind,
          root?.id ?? null,
          recipe?.id ?? null,
          primaryPath,
          input.git_remote ?? null,
          input.s3_bucket ?? null,
          input.s3_prefix ?? null,
          json(tags),
          json(input.integrations ?? {}),
          json(input.metadata ?? {}),
          this.tenantId,
          ts,
          ts,
        ],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique/i.test(msg)) throw new ValidationError(`workspace conflict: ${msg}`);
      throw err;
    }

    const workspace = (await this.getWorkspace(id))!;
    await this.recordEvent({
      workspace_id: id,
      agent_id: input.agent_id,
      event_type: "created",
      source: input.source ?? "mcp",
      prompt: input.prompt,
      command: input.command,
      after: workspace as unknown as JsonObject,
      metadata: { root_slug: root?.slug, recipe_slug: recipe?.slug },
    });
    return workspace;
  }

  async updateWorkspace(idOrSlug: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    const before = await this.requireWorkspace(idOrSlug);
    const root = input.root_id ? await this.getRoot(input.root_id) : null;
    if (input.root_id && !root) throw new ValidationError(`Root not found: ${input.root_id}`);
    const recipe = input.recipe_id ? await this.getRecipe(input.recipe_id) : null;
    if (input.recipe_id && !recipe) throw new ValidationError(`Recipe not found: ${input.recipe_id}`);

    const updates: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };
    if (input.name !== undefined) set("name", input.name);
    if (input.slug !== undefined) set("slug", await this.ensureUniqueSlug("workspaces", slugify(input.slug), before.id));
    if (input.description !== undefined) set("description", input.description);
    if (input.kind !== undefined) set("kind", input.kind);
    if (input.status !== undefined) set("status", input.status);
    if (input.root_id !== undefined) set("root_id", input.root_id ? root!.id : null);
    if (input.recipe_id !== undefined) set("recipe_id", input.recipe_id ? recipe!.id : null);
    if (input.primary_path !== undefined) set("primary_path", input.primary_path ?? null);
    if (input.git_remote !== undefined) set("git_remote", input.git_remote);
    if (input.s3_bucket !== undefined) set("s3_bucket", input.s3_bucket);
    if (input.s3_prefix !== undefined) set("s3_prefix", input.s3_prefix);
    if (input.tags !== undefined) set("tags", json(normalizeList(input.tags)));
    if (input.integrations !== undefined) set("integrations", json(input.integrations));
    if (input.metadata !== undefined) set("metadata", json(input.metadata));

    if (updates.length > 0) {
      set("updated_at", nowIso());
      params.push(before.id);
      params.push(this.tenantId);
      await this.db.execute(
        `UPDATE workspaces SET ${updates.join(", ")} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
        params,
      );
    }
    const after = (await this.getWorkspace(before.id))!;
    await this.recordEvent({
      workspace_id: before.id,
      agent_id: input.agent_id,
      event_type: input.status === "deleted" ? "deleted" : "updated",
      source: input.source ?? "mcp",
      prompt: input.prompt,
      command: input.command,
      before: before as unknown as JsonObject,
      after: after as unknown as JsonObject,
    });
    return after;
  }

  async archiveWorkspace(idOrSlug: string, input: Omit<UpdateWorkspaceInput, "status"> = {}): Promise<Workspace> {
    return this.updateWorkspace(idOrSlug, { ...input, status: "archived" });
  }

  async unarchiveWorkspace(idOrSlug: string, input: Omit<UpdateWorkspaceInput, "status"> = {}): Promise<Workspace> {
    return this.updateWorkspace(idOrSlug, { ...input, status: "active" });
  }

  async deleteWorkspace(
    idOrSlug: string,
    input: Omit<UpdateWorkspaceInput, "status"> & { hard?: boolean } = {},
  ): Promise<{ workspace: Workspace; hard: boolean }> {
    const before = await this.requireWorkspace(idOrSlug);
    if (!input.hard) {
      const workspace = await this.updateWorkspace(before.id, { ...input, status: "deleted" });
      return { workspace, hard: false };
    }
    await this.recordEvent({
      workspace_id: before.id,
      agent_id: input.agent_id,
      event_type: "deleted",
      source: input.source ?? "mcp",
      prompt: input.prompt,
      command: input.command,
      before: before as unknown as JsonObject,
      metadata: { hard: true },
    });
    await this.db.execute("DELETE FROM workspaces WHERE id = $1 AND tenant_id = $2", [before.id, this.tenantId]);
    return { workspace: before, hard: true };
  }

  // --- events -----------------------------------------------------------
  async listWorkspaceEvents(workspaceId: string, limit = 200): Promise<WorkspaceEvent[]> {
    const rows = await this.db.many<WorkspaceEventRow>(
      "SELECT * FROM workspace_events WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT $3",
      [workspaceId, this.tenantId, Math.min(Math.max(limit, 1), 1000)],
    );
    return rows.map(rowToEvent);
  }

  async recordEvent(input: RecordWorkspaceEventInput): Promise<WorkspaceEvent> {
    const id = generateEventId();
    await this.db.execute(
      `INSERT INTO workspace_events (
        id, workspace_id, agent_id, event_type, source, prompt, command,
        before_json, after_json, metadata, tenant_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        input.workspace_id ?? null,
        input.agent_id ?? null,
        input.event_type,
        input.source,
        input.prompt ?? null,
        input.command ?? null,
        input.before === undefined ? null : json(input.before),
        input.after === undefined ? null : json(input.after),
        json(input.metadata ?? {}),
        this.tenantId,
        nowIso(),
      ],
    );
    const row = await this.db.get<WorkspaceEventRow>(
      "SELECT * FROM workspace_events WHERE id = $1 AND tenant_id = $2",
      [id, this.tenantId],
    );
    return rowToEvent(row!);
  }

  // --- agent runs -------------------------------------------------------
  async listAgentRuns(filter: AgentRunFilter = {}): Promise<AgentRun[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [this.tenantId];
    const push = (clause: (i: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(clause(params.length));
    };
    if (filter.workspace_id) push((i) => `workspace_id = $${i}`, filter.workspace_id);
    if (filter.agent_id) push((i) => `agent_id = $${i}`, filter.agent_id);
    if (filter.status) push((i) => `status = $${i}`, filter.status);
    params.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
    const limitIdx = params.length;
    params.push(Math.max(filter.offset ?? 0, 0));
    const offsetIdx = params.length;
    const rows = await this.db.many<AgentRunRow>(
      `SELECT * FROM agent_runs WHERE ${conditions.join(" AND ")} ORDER BY started_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return rows.map(rowToAgentRun);
  }

  async getAgentRun(id: string): Promise<AgentRun | null> {
    const row = await this.db.get<AgentRunRow>(
      "SELECT * FROM agent_runs WHERE id = $1 AND tenant_id = $2",
      [id, this.tenantId],
    );
    return row ? rowToAgentRun(row) : null;
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    if (!input.prompt?.trim()) throw new ValidationError("agent run prompt is required");
    const id = generateAgentRunId();
    await this.db.execute(
      `INSERT INTO agent_runs (
        id, agent_id, workspace_id, provider, model, prompt, status,
        plan_json, tool_calls_json, result_json, error, metadata, tenant_id, started_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        input.agent_id ?? null,
        input.workspace_id ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.prompt,
        input.status ?? "planned",
        input.plan === undefined ? null : json(input.plan),
        json(input.tool_calls ?? []),
        input.result === undefined ? null : json(input.result),
        input.error ?? null,
        json(input.metadata ?? {}),
        this.tenantId,
        nowIso(),
      ],
    );
    return (await this.getAgentRun(id))!;
  }

  async updateAgentRun(id: string, input: UpdateAgentRunInput): Promise<AgentRun> {
    const before = await this.getAgentRun(id);
    if (!before) throw new NotFoundError(`Agent run not found: ${id}`);
    const updates: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };
    if (input.status !== undefined) set("status", input.status);
    if (input.provider !== undefined) set("provider", input.provider);
    if (input.model !== undefined) set("model", input.model);
    if (input.plan !== undefined) set("plan_json", input.plan === null ? null : json(input.plan));
    if (input.tool_calls !== undefined) set("tool_calls_json", json(input.tool_calls));
    if (input.result !== undefined) set("result_json", input.result === null ? null : json(input.result));
    if (input.error !== undefined) set("error", input.error);
    if (input.metadata !== undefined) set("metadata", json(input.metadata));
    if (input.completed_at !== undefined) set("completed_at", input.completed_at);
    else if (input.status === "completed" || input.status === "failed") set("completed_at", nowIso());
    if (!updates.length) return before;
    params.push(id);
    params.push(this.tenantId);
    await this.db.execute(
      `UPDATE agent_runs SET ${updates.join(", ")} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
      params,
    );
    return (await this.getAgentRun(id))!;
  }

  // --- budgets ----------------------------------------------------------
  async listBudgets(filter: BudgetFilter = {}): Promise<Budget[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [this.tenantId];
    const push = (clause: (i: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(clause(params.length));
    };
    if (filter.scope_type) push((i) => `scope_type = $${i}`, filter.scope_type);
    if (filter.scope_id) push((i) => `scope_id = $${i}`, filter.scope_id);
    params.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
    const limitIdx = params.length;
    params.push(Math.max(filter.offset ?? 0, 0));
    const offsetIdx = params.length;
    const rows = await this.db.many<BudgetRow>(
      `SELECT * FROM project_budgets WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return rows.map(rowToBudget);
  }

  async getBudget(id: string): Promise<Budget | null> {
    const row = await this.db.get<BudgetRow>(
      "SELECT * FROM project_budgets WHERE id = $1 AND tenant_id = $2",
      [id, this.tenantId],
    );
    return row ? rowToBudget(row) : null;
  }

  async createBudget(input: CreateBudgetInput): Promise<Budget> {
    if (!input.scope_type || !["project", "run"].includes(input.scope_type)) {
      throw new ValidationError("budget scope_type must be 'project' or 'run'");
    }
    if (!input.scope_id?.trim()) throw new ValidationError("budget scope_id is required");
    if (!input.window || !["daily", "monthly", "lifetime"].includes(input.window)) {
      throw new ValidationError("budget window must be 'daily', 'monthly', or 'lifetime'");
    }
    const id = generateBudgetId();
    const ts = nowIso();
    await this.db.execute(
      `INSERT INTO project_budgets (
        id, scope_type, scope_id, "window", mode, max_usd, max_input_tokens,
        max_output_tokens, max_total_tokens, warning_threshold, reset_at, metadata, tenant_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        input.scope_type,
        input.scope_id,
        input.window,
        input.mode ?? "hard",
        input.max_usd ?? null,
        input.max_input_tokens ?? null,
        input.max_output_tokens ?? null,
        input.max_total_tokens ?? null,
        input.warning_threshold ?? null,
        input.reset_at ?? null,
        json(input.metadata ?? {}),
        this.tenantId,
        ts,
        ts,
      ],
    );
    return (await this.getBudget(id))!;
  }

  async deleteBudget(id: string): Promise<Budget> {
    const before = await this.getBudget(id);
    if (!before) throw new NotFoundError(`Budget not found: ${id}`);
    await this.db.execute("DELETE FROM project_budgets WHERE id = $1 AND tenant_id = $2", [id, this.tenantId]);
    return before;
  }

  // --- budget spend -----------------------------------------------------
  async listSpend(filter: SpendFilter = {}): Promise<BudgetSpend[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [this.tenantId];
    const push = (clause: (i: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(clause(params.length));
    };
    if (filter.workspace_id) push((i) => `workspace_id = $${i}`, filter.workspace_id);
    if (filter.run_id) push((i) => `run_id = $${i}`, filter.run_id);
    params.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
    const limitIdx = params.length;
    params.push(Math.max(filter.offset ?? 0, 0));
    const offsetIdx = params.length;
    const rows = await this.db.many<BudgetSpendRow>(
      `SELECT * FROM project_budget_spend WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return rows.map(rowToSpend);
  }

  async recordSpend(input: RecordBudgetSpendInput): Promise<BudgetSpend> {
    const id = generateSpendId();
    await this.db.execute(
      `INSERT INTO project_budget_spend (
        id, workspace_id, run_id, provider, model, usd, input_tokens,
        output_tokens, total_tokens, metadata, tenant_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        input.workspace_id ?? null,
        input.run_id ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.usd ?? 0,
        input.input_tokens ?? 0,
        input.output_tokens ?? 0,
        input.total_tokens ?? 0,
        json(input.metadata ?? {}),
        this.tenantId,
        nowIso(),
      ],
    );
    const row = await this.db.get<BudgetSpendRow>(
      "SELECT * FROM project_budget_spend WHERE id = $1 AND tenant_id = $2",
      [id, this.tenantId],
    );
    return rowToSpend(row!);
  }

  // --- workspace locations ---------------------------------------------
  async listWorkspaceLocations(workspaceId: string): Promise<WorkspaceLocation[]> {
    const rows = await this.db.many<WorkspaceLocationRow>(
      "SELECT * FROM workspace_locations WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at ASC",
      [workspaceId, this.tenantId],
    );
    return rows.map(rowToLocation);
  }

  async addWorkspaceLocation(input: AddWorkspaceLocationInput): Promise<WorkspaceLocation> {
    await this.requireWorkspace(input.workspace_id);
    if (!input.path?.trim()) throw new ValidationError("location path is required");
    if (!input.machine_id?.trim()) throw new ValidationError("location machine_id is required");
    const id = generateLocationId();
    await this.db.execute(
      `INSERT INTO workspace_locations (
        id, workspace_id, path, machine_id, label, kind, is_primary, exists_at_create, metadata, tenant_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (workspace_id, path, machine_id) DO UPDATE SET
        label = EXCLUDED.label, kind = EXCLUDED.kind, is_primary = EXCLUDED.is_primary, metadata = EXCLUDED.metadata`,
      [
        id,
        input.workspace_id,
        input.path,
        input.machine_id,
        input.label ?? "main",
        input.kind ?? "local",
        input.is_primary ?? false,
        input.exists_at_create ?? false,
        json(input.metadata ?? {}),
        this.tenantId,
        nowIso(),
      ],
    );
    const row = await this.db.get<WorkspaceLocationRow>(
      "SELECT * FROM workspace_locations WHERE workspace_id = $1 AND path = $2 AND machine_id = $3 AND tenant_id = $4",
      [input.workspace_id, input.path, input.machine_id, this.tenantId],
    );
    return rowToLocation(row!);
  }

  async deleteWorkspaceLocation(id: string): Promise<void> {
    await this.db.execute("DELETE FROM workspace_locations WHERE id = $1 AND tenant_id = $2", [id, this.tenantId]);
  }

  // --- workspace agents (membership) -----------------------------------
  async listWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgentAssignment[]> {
    const rows = await this.db.many<WorkspaceAgentAssignmentRow>(
      "SELECT * FROM workspace_agents WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at ASC",
      [workspaceId, this.tenantId],
    );
    return rows.map(rowToAssignment);
  }

  async assignWorkspaceAgent(input: AssignWorkspaceAgentInput): Promise<WorkspaceAgentAssignment> {
    await this.requireWorkspace(input.workspace_id);
    const agent = await this.getAgent(input.agent_id);
    if (!agent) throw new ValidationError(`Agent not found: ${input.agent_id}`);
    const id = generateAssignmentId();
    const role = input.role ?? "contributor";
    await this.db.execute(
      `INSERT INTO workspace_agents (id, workspace_id, agent_id, role, assigned_by, metadata, tenant_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (workspace_id, agent_id, role) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [
        id,
        input.workspace_id,
        agent.id,
        role,
        input.assigned_by ?? null,
        json(input.metadata ?? {}),
        this.tenantId,
        nowIso(),
      ],
    );
    const row = await this.db.get<WorkspaceAgentAssignmentRow>(
      "SELECT * FROM workspace_agents WHERE workspace_id = $1 AND agent_id = $2 AND role = $3 AND tenant_id = $4",
      [input.workspace_id, agent.id, role, this.tenantId],
    );
    const assignment = rowToAssignment(row!);
    assignment.agent = agent;
    return assignment;
  }

  async removeWorkspaceAgent(id: string): Promise<void> {
    await this.db.execute("DELETE FROM workspace_agents WHERE id = $1 AND tenant_id = $2", [id, this.tenantId]);
  }

  // --- tmux profiles ----------------------------------------------------
  async listTmuxProfiles(): Promise<TmuxProfile[]> {
    const rows = await this.db.many<TmuxProfileRow>(
      "SELECT * FROM tmux_profiles WHERE tenant_id = $1 ORDER BY slug ASC",
      [this.tenantId],
    );
    return rows.map(rowToTmuxProfile);
  }

  async getTmuxProfile(idOrSlug: string): Promise<TmuxProfile | null> {
    const row = await this.db.get<TmuxProfileRow>(
      "SELECT * FROM tmux_profiles WHERE (id = $1 OR slug = $1) AND tenant_id = $2",
      [idOrSlug, this.tenantId],
    );
    return row ? rowToTmuxProfile(row) : null;
  }

  async createTmuxProfile(input: CreateTmuxProfileInput): Promise<TmuxProfile> {
    if (!input.name?.trim()) throw new ValidationError("tmux profile name is required");
    const id = generateTmuxProfileId();
    const ts = nowIso();
    const slug = await this.ensureUniqueSlug("tmux_profiles", input.slug ?? slugify(input.name));
    await this.db.execute(
      `INSERT INTO tmux_profiles (id, slug, name, description, session_template, attach, metadata, tenant_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        slug,
        input.name,
        input.description ?? null,
        input.session_template ?? "{slug}",
        input.attach ?? false,
        json(input.metadata ?? {}),
        this.tenantId,
        ts,
        ts,
      ],
    );
    for (const window of input.windows ?? []) {
      await this.addTmuxProfileWindow(id, window);
    }
    return (await this.getTmuxProfile(id))!;
  }

  async listTmuxProfileWindows(profileId: string): Promise<TmuxProfileWindow[]> {
    const rows = await this.db.many<TmuxProfileWindowRow>(
      "SELECT * FROM tmux_profile_windows WHERE profile_id = $1 AND tenant_id = $2 ORDER BY COALESCE(window_index, 0) ASC, created_at ASC",
      [profileId, this.tenantId],
    );
    return rows.map(rowToTmuxWindow);
  }

  async addTmuxProfileWindow(
    profileId: string,
    input: Omit<import("../types/workspace.js").CreateTmuxProfileWindowInput, "profile_id">,
  ): Promise<TmuxProfileWindow> {
    if (!input.window_name_template?.trim()) throw new ValidationError("window_name_template is required");
    const id = generateTmuxWindowId();
    await this.db.execute(
      `INSERT INTO tmux_profile_windows (
        id, profile_id, window_name_template, path_template, command, window_index, detached, env, revive, tenant_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (profile_id, window_name_template) DO UPDATE SET
        path_template = EXCLUDED.path_template, command = EXCLUDED.command,
        window_index = EXCLUDED.window_index, detached = EXCLUDED.detached,
        env = EXCLUDED.env, revive = EXCLUDED.revive`,
      [
        id,
        profileId,
        input.window_name_template,
        input.path_template ?? null,
        input.command ?? null,
        input.window_index ?? null,
        input.detached ?? true,
        json(input.env ?? {}),
        input.revive ?? true,
        this.tenantId,
        nowIso(),
      ],
    );
    const row = await this.db.get<TmuxProfileWindowRow>(
      "SELECT * FROM tmux_profile_windows WHERE profile_id = $1 AND window_name_template = $2 AND tenant_id = $3",
      [profileId, input.window_name_template, this.tenantId],
    );
    return rowToTmuxWindow(row!);
  }

  // --- workspace tmux sessions -----------------------------------------
  async listWorkspaceTmuxSessions(workspaceId: string): Promise<WorkspaceTmuxSession[]> {
    const rows = await this.db.many<WorkspaceTmuxSessionRow>(
      "SELECT * FROM workspace_tmux_sessions WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at ASC",
      [workspaceId, this.tenantId],
    );
    return rows.map(rowToTmuxSession);
  }

  async recordWorkspaceTmuxSession(input: RecordWorkspaceTmuxSessionInput): Promise<WorkspaceTmuxSession> {
    await this.requireWorkspace(input.workspace_id);
    if (!input.session_name?.trim()) throw new ValidationError("session_name is required");
    const id = generateTmuxSessionId();
    await this.db.execute(
      `INSERT INTO workspace_tmux_sessions (id, workspace_id, profile_id, session_name, metadata, tenant_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id, session_name) DO UPDATE SET profile_id = EXCLUDED.profile_id, metadata = EXCLUDED.metadata`,
      [
        id,
        input.workspace_id,
        input.profile_id ?? null,
        input.session_name,
        json(input.metadata ?? {}),
        this.tenantId,
        nowIso(),
      ],
    );
    const row = await this.db.get<WorkspaceTmuxSessionRow>(
      "SELECT * FROM workspace_tmux_sessions WHERE workspace_id = $1 AND session_name = $2 AND tenant_id = $3",
      [input.workspace_id, input.session_name, this.tenantId],
    );
    return rowToTmuxSession(row!);
  }

  async deleteWorkspaceTmuxSession(id: string): Promise<void> {
    await this.db.execute("DELETE FROM workspace_tmux_sessions WHERE id = $1 AND tenant_id = $2", [id, this.tenantId]);
  }

  // --- workspace locks --------------------------------------------------
  async listWorkspaceLocks(workspaceId?: string): Promise<WorkspaceLock[]> {
    if (workspaceId) {
      const rows = await this.db.many<WorkspaceLockRow>(
        "SELECT * FROM workspace_locks WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at DESC",
        [workspaceId, this.tenantId],
      );
      return rows.map(rowToLock);
    }
    const rows = await this.db.many<WorkspaceLockRow>(
      "SELECT * FROM workspace_locks WHERE tenant_id = $1 ORDER BY created_at DESC",
      [this.tenantId],
    );
    return rows.map(rowToLock);
  }

  async acquireWorkspaceLock(input: AcquireWorkspaceLockInput): Promise<WorkspaceLock> {
    if (!input.lock_key?.trim()) throw new ValidationError("lock_key is required");
    const existing = await this.db.get<WorkspaceLockRow>(
      "SELECT * FROM workspace_locks WHERE lock_key = $1 AND tenant_id = $2",
      [input.lock_key, this.tenantId],
    );
    if (existing) {
      const stillValid = !existing.expires_at || existing.expires_at > nowIso();
      if (stillValid) throw new ValidationError(`lock already held: ${input.lock_key}`);
      await this.db.execute("DELETE FROM workspace_locks WHERE id = $1 AND tenant_id = $2", [existing.id, this.tenantId]);
    }
    const id = generateLockId();
    await this.db.execute(
      `INSERT INTO workspace_locks (id, lock_key, workspace_id, agent_id, reason, tenant_id, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.lock_key,
        input.workspace_id ?? null,
        input.agent_id ?? null,
        input.reason ?? null,
        this.tenantId,
        nowIso(),
        input.expires_at ?? null,
      ],
    );
    const row = await this.db.get<WorkspaceLockRow>(
      "SELECT * FROM workspace_locks WHERE id = $1 AND tenant_id = $2",
      [id, this.tenantId],
    );
    return rowToLock(row!);
  }

  async releaseWorkspaceLock(lockKey: string): Promise<boolean> {
    const existing = await this.db.get<{ id: string }>(
      "SELECT id FROM workspace_locks WHERE lock_key = $1 AND tenant_id = $2",
      [lockKey, this.tenantId],
    );
    if (!existing) return false;
    await this.db.execute("DELETE FROM workspace_locks WHERE id = $1 AND tenant_id = $2", [existing.id, this.tenantId]);
    return true;
  }

  // --- health -----------------------------------------------------------
  async ping(): Promise<boolean> {
    const row = await this.db.get<{ ok: number }>("SELECT 1 AS ok");
    return row?.ok === 1;
  }
}
