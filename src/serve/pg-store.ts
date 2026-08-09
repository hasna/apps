// Postgres-backed store for projects-serve (Amendment A1 pure-remote).
//
// This is the cloud data-access layer the HTTP API wraps. It mirrors the domain
// semantics of src/db/workspaces.ts (the local SQLite core) — id/slug rules,
// tag merging, JSON-encoded columns, event journaling — but executes async SQL
// against cloud Postgres through the vendored storage kit's TypedQueryClient.
// There is NO sync engine and NO local cache here (pure remote): every call
// hits the database.

import { nanoid } from "nanoid";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import {
  assertCompleteStableProjectId,
  assertPositiveBounds,
  buildGuardedProjectReadResult,
  buildReceiptId,
  canonicalJson,
  deriveGuardedIdempotencyKey,
  preconditionDigest,
  requestDigest,
  rowToGuardedReceipt,
  sha256,
  timedOut,
  withResponseControl,
  workspaceRevision,
  workspaceSnapshot,
} from "../lib/guarded-project-mutation.js";
import {
  normalizeProjectResourceLinks,
  normalizeProjectResourceLinkIntegrations,
  PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
  projectResourceLinkId,
  projectResourceLinkIntegrationProjection,
  projectResourceLinksDigest,
  projectResourceLinkSnapshot,
  rowToProjectResourceLink,
} from "../lib/project-resource-links.js";
import { deriveWorkspaceRegistryFields } from "../lib/workspace-plan.js";
import type {
  Agent,
  AgentRow,
  CreateAgentInput,
  CreateRecipeInput,
  CreateRootInput,
  CreateWorkspaceInput,
  EventSource,
  GuardedProjectMutationReceipt,
  GuardedProjectMutationReceiptLookupInput,
  GuardedProjectMutationReceiptLookupResult,
  GuardedProjectMutationReceiptRow,
  GuardedProjectReadRequest,
  GuardedProjectReadResult,
  GuardedProjectMutationRequest,
  GuardedProjectMutationResult,
  GuardedProjectMutationRollbackRequest,
  JsonObject,
  ProjectResourceLink,
  ProjectResourceLinkInput,
  ProjectResourceLinkMutationRequest,
  ProjectResourceLinkMutationResult,
  ProjectResourceLinkReadRequest,
  ProjectResourceLinkReadResult,
  ProjectResourceLinkRollbackRequest,
  ProjectResourceLinkRow,
  ProjectResourceLinkSnapshot,
  Recipe,
  RecipeRow,
  RecordWorkspaceEventInput,
  Root,
  RootRow,
  UpdateRootInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceEvent,
  WorkspaceEventRow,
  WorkspaceIntegrations,
  WorkspaceKind,
  WorkspaceRow,
  WorkspaceStatus,
} from "../types/workspace.js";

type TransactionCapableClient = TypedQueryClient & {
  transaction?: <T>(fn: (client: TypedQueryClient) => Promise<T>) => Promise<T>;
};

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
  if (!raw) return fallback;
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

function hasOwn(metadata: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, key);
}

function canonicalMachineFromMetadata(metadata: JsonObject): string | null | undefined {
  if (!hasOwn(metadata, "canonical_machine")) return undefined;
  const value = metadata["canonical_machine"];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError("canonical_machine metadata must be a machine slug string");
  }
  return value.trim() || null;
}

function withoutCanonicalMachineMetadata(metadata: JsonObject): JsonObject {
  const copy = { ...metadata };
  delete copy["canonical_machine"];
  return copy;
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

function resourceLinkSnapshotJson(snapshot: ProjectResourceLinkSnapshot): JsonObject {
  return snapshot as unknown as JsonObject;
}

function parseResourceLinkSnapshot(value: JsonObject | null, label: string): ProjectResourceLinkSnapshot {
  const snapshot = value as unknown as ProjectResourceLinkSnapshot | null;
  if (!snapshot?.project?.id || !Array.isArray(snapshot.links) || typeof snapshot.collection_digest !== "string") {
    throw new ValidationError(`${label} receipt snapshot is incomplete`);
  }
  return snapshot;
}

function resourceLinkInputFromStored(link: ProjectResourceLink): ProjectResourceLinkInput {
  const { id: _id, project_id: _projectId, created_at: _createdAt, updated_at: _updatedAt, ...input } = link;
  return input;
}

function nextResourceLinkRevision(current: string): string {
  const currentMs = Date.parse(current.replace(" ", "T") + "Z");
  const nowValue = nowIso();
  if (nowValue !== current) return nowValue;
  return Number.isFinite(currentMs)
    ? new Date(currentMs + 1).toISOString().replace("T", " ").replace("Z", "")
    : `${current}.1`;
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

/**
 * Server-side bounds on a single `/v1/projects` page. These protect the
 * database from an unbounded scan; they are NOT a statement that the caller may
 * only ever see this many projects. The response reports `total` and `has_more`
 * so a client can page the rest — the `@hasna/projects` store does so
 * automatically.
 */
export const WORKSPACE_LIST_DEFAULT_LIMIT = 100;
export const WORKSPACE_LIST_MAX_LIMIT = 1000;

export interface WorkspaceFilter {
  status?: WorkspaceStatus;
  kind?: WorkspaceKind;
  root_id?: string;
  query?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export class ProjectsPgStore {
  constructor(private readonly db: TypedQueryClient) {}

  private async inTransaction<T>(operation: string, fn: (store: ProjectsPgStore) => Promise<T>): Promise<T> {
    const transaction = (this.db as TransactionCapableClient).transaction;
    if (typeof transaction !== "function") {
      throw new ValidationError(`${operation} requires a transaction-capable Postgres client`);
    }
    return transaction.call(this.db, async (client) => fn(new ProjectsPgStore(client))) as Promise<T>;
  }

  // --- slug uniqueness --------------------------------------------------
  private async ensureUniqueSlug(table: string, base: string, excludeId?: string): Promise<string> {
    const safeBase = base || "workspace";
    let candidate = safeBase;
    let suffix = 1;
    // Table name is a fixed internal literal, never user input.
    for (;;) {
      const row = await this.db.get<{ id: string }>(`SELECT id FROM ${table} WHERE slug = $1`, [candidate]);
      if (!row || row.id === excludeId) return candidate;
      suffix++;
      candidate = `${safeBase}-${suffix}`;
    }
  }

  // --- roots ------------------------------------------------------------
  async listRoots(): Promise<Root[]> {
    const rows = await this.db.many<RootRow>("SELECT * FROM roots ORDER BY slug ASC");
    return rows.map(rowToRoot);
  }

  async getRoot(idOrSlug: string): Promise<Root | null> {
    const row = await this.db.get<RootRow>("SELECT * FROM roots WHERE id = $1 OR slug = $1", [idOrSlug]);
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
        name_template, allowed_recipes, allowed_agents, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
    await this.db.execute(`UPDATE roots SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
    return (await this.getRoot(before.id))!;
  }

  async deleteRoot(idOrSlug: string, detachWorkspaces = false): Promise<{ root: Root; detached_workspaces: number }> {
    const root = await this.getRoot(idOrSlug);
    if (!root) throw new NotFoundError(`Root not found: ${idOrSlug}`);
    const countRow = await this.db.get<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM workspaces WHERE root_id = $1",
      [root.id],
    );
    const count = Number(countRow?.n ?? 0);
    if (count > 0 && !detachWorkspaces) {
      throw new ValidationError(
        `Root ${root.slug} is used by ${count} workspace(s); pass detach=true to clear those references before deletion.`,
      );
    }
    if (count > 0) {
      await this.db.execute("UPDATE workspaces SET root_id = NULL, updated_at = $1 WHERE root_id = $2", [
        nowIso(),
        root.id,
      ]);
    }
    await this.db.execute("DELETE FROM roots WHERE id = $1", [root.id]);
    return { root, detached_workspaces: count };
  }

  // --- agents -----------------------------------------------------------
  async listAgents(): Promise<Agent[]> {
    const rows = await this.db.many<AgentRow>("SELECT * FROM agents ORDER BY slug ASC");
    return rows.map(rowToAgent);
  }

  async getAgent(idOrSlug: string): Promise<Agent | null> {
    const row = await this.db.get<AgentRow>("SELECT * FROM agents WHERE id = $1 OR slug = $1", [idOrSlug]);
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
      `INSERT INTO agents (id, slug, name, kind, provider, model, role, permissions, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
        ts,
        ts,
      ],
    );
    return (await this.getAgent(id))!;
  }

  // --- recipes ----------------------------------------------------------
  async listRecipes(): Promise<Recipe[]> {
    const rows = await this.db.many<RecipeRow>("SELECT * FROM recipes ORDER BY slug ASC");
    return rows.map(rowToRecipe);
  }

  async getRecipe(idOrSlug: string): Promise<Recipe | null> {
    const row = await this.db.get<RecipeRow>("SELECT * FROM recipes WHERE id = $1 OR slug = $1", [idOrSlug]);
    return row ? rowToRecipe(row) : null;
  }

  async createRecipe(input: CreateRecipeInput): Promise<Recipe> {
    if (!input.name?.trim()) throw new ValidationError("recipe name is required");
    const id = generateRecipeId();
    const ts = nowIso();
    const slug = await this.ensureUniqueSlug("recipes", input.slug ?? slugify(input.name));
    await this.db.execute(
      `INSERT INTO recipes (id, slug, name, description, kind, version, steps, variables, default_tags, default_tmux_profile_id, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
        ts,
        ts,
      ],
    );
    return (await this.getRecipe(id))!;
  }

  // --- workspaces (projects) -------------------------------------------
  /**
   * Shared predicate for listing and counting workspaces. Kept in one place so
   * a reported total can never describe a different set than the rows beside
   * it.
   */
  private workspaceFilterSql(filter: WorkspaceFilter): { where: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
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
    return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
  }

  async listWorkspaces(filter: WorkspaceFilter = {}): Promise<Workspace[]> {
    const { where, params } = this.workspaceFilterSql(filter);
    params.push(Math.min(Math.max(filter.limit ?? WORKSPACE_LIST_DEFAULT_LIMIT, 1), WORKSPACE_LIST_MAX_LIMIT));
    const limitIdx = params.length;
    params.push(Math.max(filter.offset ?? 0, 0));
    const offsetIdx = params.length;
    const rows = await this.db.many<WorkspaceRow>(
      `SELECT * FROM workspaces ${where} ORDER BY name ASC, id ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return rows.map(rowToWorkspace);
  }

  /** Rows matching `filter`, ignoring its limit/offset. */
  async countWorkspaces(filter: WorkspaceFilter = {}): Promise<number> {
    const { where, params } = this.workspaceFilterSql(filter);
    const row = await this.db.get<{ n: string | number }>(`SELECT COUNT(*) AS n FROM workspaces ${where}`, params);
    return Number(row?.n ?? 0);
  }

  async getWorkspace(idOrSlug: string): Promise<Workspace | null> {
    const row = await this.db.get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1 OR slug = $1", [idOrSlug]);
    return row ? rowToWorkspace(row) : null;
  }

  async guardedReadWorkspace(
    input: GuardedProjectReadRequest,
    startedAtMs = Date.now(),
  ): Promise<GuardedProjectReadResult> {
    try {
      assertCompleteStableProjectId(input.project_id);
      assertPositiveBounds(input);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    const row = await this.db.get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [input.project_id]);
    if (!row) throw new NotFoundError(`Workspace not found: ${input.project_id}`);
    try {
      const maxItems = input.resource_link_max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS;
      const links = await this.listProjectResourceLinks(input.project_id, maxItems);
      return buildGuardedProjectReadResult(rowToWorkspace(row), input, startedAtMs, {
        links,
        max_items: maxItems,
        collection_digest: projectResourceLinksDigest(links),
      });
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
  }

  async listProjectResourceLinks(
    projectId: string,
    maxItems = PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
  ): Promise<ProjectResourceLink[]> {
    assertCompleteStableProjectId(projectId);
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new ValidationError("project resource link max_items must be a positive integer");
    }
    const rows = await this.db.many<ProjectResourceLinkRow>(
      `SELECT * FROM project_resource_links
       WHERE project_id = $1
       ORDER BY authority, service_instance, source_package, target_kind, locator_kind, locator_value, id
       LIMIT $2`,
      [projectId, maxItems + 1],
    );
    if (rows.length > maxItems) {
      throw new ValidationError(`project resource link collection exceeds max_items: more than ${maxItems}`);
    }
    return rows.map(rowToProjectResourceLink);
  }

  async readProjectResourceLinks(
    input: ProjectResourceLinkReadRequest,
    startedAtMs = Date.now(),
  ): Promise<ProjectResourceLinkReadResult> {
    assertCompleteStableProjectId(input.project_id);
    const project = await this.requireWorkspace(input.project_id);
    const links = await this.listProjectResourceLinks(input.project_id, input.max_items);
    return withResponseControl({
      ok: true as const,
      project_id: project.id,
      project,
      current_revision: workspaceRevision(project),
      links,
      link_count: links.length,
      max_items: input.max_items,
      collection_digest: projectResourceLinksDigest(links),
      complete: true as const,
      truncated: false as const,
    }, input, startedAtMs, "project resource link read");
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
    const requestedSlug = input.slug ?? slugify(input.name);
    const slugBase = input.require_exact_identity
      ? slugify(requestedSlug)
      : requestedSlug;
    const slug = input.require_exact_identity
      ? slugBase
      : await this.ensureUniqueSlug("workspaces", slugBase);

    const root = input.root_id ? await this.getRoot(input.root_id) : null;
    if (input.root_id && !root) throw new ValidationError(`Root not found: ${input.root_id}`);
    const recipe = input.recipe_id ? await this.getRecipe(input.recipe_id) : null;
    if (input.recipe_id && !recipe) throw new ValidationError(`Recipe not found: ${input.recipe_id}`);

    const kind = input.kind ?? recipe?.kind ?? root?.default_kind ?? "generic";
    const tags = normalizeList([...(root?.tags ?? []), ...(recipe?.default_tags ?? []), ...(input.tags ?? [])]);
    // Slug allocation is server-authoritative. Derive slug-dependent defaults
    // only after ensureUniqueSlug has selected the value this row will persist;
    // otherwise a duplicate request can point at the first project's path and
    // conversations channel. Explicit client values still win in the helper.
    const derived = deriveWorkspaceRegistryFields(input, { root, slug, id, kind });

    try {
      await this.db.execute(
        `INSERT INTO workspaces (
          id, slug, name, description, kind, status, root_id, recipe_id, primary_path,
          git_remote, s3_bucket, s3_prefix, tags, integrations, metadata, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          slug,
          input.name,
          input.description ?? null,
          kind,
          root?.id ?? null,
          recipe?.id ?? null,
          derived.primary_path,
          input.git_remote ?? null,
          input.s3_bucket ?? null,
          input.s3_prefix ?? null,
          json(tags),
          json(derived.integrations),
          json(input.metadata ?? {}),
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

    const inputMetadataMachine = input.metadata === undefined
      ? undefined
      : canonicalMachineFromMetadata(input.metadata);
    const existingMetadataMachine = canonicalMachineFromMetadata(before.metadata);
    let canonicalMachine = input.canonical_machine;
    if (canonicalMachine === undefined && inputMetadataMachine !== undefined) {
      canonicalMachine = inputMetadataMachine;
    } else if (canonicalMachine === undefined && before.canonical_machine === null && existingMetadataMachine !== undefined) {
      canonicalMachine = existingMetadataMachine;
    }
    if (typeof canonicalMachine === "string") {
      canonicalMachine = canonicalMachine.trim();
      if (!canonicalMachine) throw new ValidationError("Canonical machine must not be empty");
      const machine = await this.db.get<{ slug: string }>("SELECT slug FROM machines WHERE slug = $1", [canonicalMachine]);
      if (!machine) throw new ValidationError(`Machine not found: ${canonicalMachine}`);
    }

    let metadata = input.metadata;
    if (metadata !== undefined && inputMetadataMachine !== undefined) {
      metadata = withoutCanonicalMachineMetadata(metadata);
    } else if (metadata === undefined && existingMetadataMachine !== undefined) {
      metadata = withoutCanonicalMachineMetadata(before.metadata);
    }

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
    if (canonicalMachine !== undefined) set("canonical_machine", canonicalMachine);
    if (input.primary_path !== undefined) set("primary_path", input.primary_path ?? null);
    if (input.git_remote !== undefined) set("git_remote", input.git_remote);
    if (input.s3_bucket !== undefined) set("s3_bucket", input.s3_bucket);
    if (input.s3_prefix !== undefined) set("s3_prefix", input.s3_prefix);
    if (input.tags !== undefined) set("tags", json(normalizeList(input.tags)));
    if (input.integrations !== undefined) set("integrations", json(input.integrations));
    if (metadata !== undefined) set("metadata", json(metadata));
    if (input.last_opened_at !== undefined) set("last_opened_at", input.last_opened_at);

    if (updates.length > 0) {
      set("updated_at", nowIso());
      params.push(before.id);
      await this.db.execute(`UPDATE workspaces SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
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

  private async insertGuardedReceipt(input: Omit<GuardedProjectMutationReceipt, "created_at">): Promise<GuardedProjectMutationReceipt> {
    await this.db.execute(
      `INSERT INTO guarded_project_mutation_receipts (
        receipt_id, operation_id, step_id, direction, idempotency_key, target_id,
        request_digest, precondition_digest, expected_revision, outcome, reason,
        result_project_id, duplicate_of_receipt_id, before_json, after_json, post_revision
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.receipt_id,
        input.operation_id,
        input.step_id,
        input.direction,
        input.idempotency_key,
        input.target_id,
        input.request_digest,
        input.precondition_digest,
        input.expected_revision,
        input.outcome,
        input.reason,
        input.result_project_id,
        input.duplicate_of_receipt_id,
        input.before === null ? null : json(input.before),
        input.after === null ? null : json(input.after),
        input.post_revision,
      ],
    );
    const row = await this.db.get<GuardedProjectMutationReceiptRow>("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1", [input.receipt_id]);
    return rowToGuardedReceipt(row!);
  }

  private async guardedAcceptedReceipt(input: { operation_id: string; step_id: string; direction: "forward" | "inverse"; idempotency_key: string; target_id: string }): Promise<GuardedProjectMutationReceipt | null> {
    const row = await this.db.get<GuardedProjectMutationReceiptRow>(
      `SELECT * FROM guarded_project_mutation_receipts
       WHERE operation_id = $1 AND step_id = $2 AND direction = $3 AND idempotency_key = $4
         AND target_id = $5 AND outcome = 'accepted'
       ORDER BY created_at ASC, receipt_id ASC`,
      [input.operation_id, input.step_id, input.direction, input.idempotency_key, input.target_id],
    );
    return row ? rowToGuardedReceipt(row) : null;
  }

  private async guardedAcceptedByStep(input: { operation_id: string; step_id: string; direction: "forward" | "inverse"; target_id: string }): Promise<GuardedProjectMutationReceipt | null> {
    const row = await this.db.get<GuardedProjectMutationReceiptRow>(
      `SELECT * FROM guarded_project_mutation_receipts
       WHERE operation_id = $1 AND step_id = $2 AND direction = $3 AND target_id = $4
         AND outcome = 'accepted'
       ORDER BY created_at ASC, receipt_id ASC`,
      [input.operation_id, input.step_id, input.direction, input.target_id],
    );
    return row ? rowToGuardedReceipt(row) : null;
  }

  private async guardedTerminalNonacceptance(input: {
    operation_id: string;
    step_id: string;
    direction: "forward" | "inverse";
    idempotency_key: string;
    target_id: string;
    request_digest: string;
    precondition_digest: string;
    expected_revision: string;
    reason: string;
    before?: Workspace | null;
    before_snapshot?: JsonObject | null;
  }): Promise<GuardedProjectMutationReceipt> {
    return this.insertGuardedReceipt({
      receipt_id: buildReceiptId({ ...input, outcome: "terminal_nonacceptance", suffix: input.reason }),
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: input.direction,
      idempotency_key: input.idempotency_key,
      target_id: input.target_id,
      request_digest: input.request_digest,
      precondition_digest: input.precondition_digest,
      expected_revision: input.expected_revision,
      outcome: "terminal_nonacceptance",
      reason: input.reason,
      result_project_id: null,
      duplicate_of_receipt_id: null,
      before: input.before_snapshot ?? (input.before ? workspaceSnapshot(input.before) : null),
      after: null,
      post_revision: null,
    });
  }

  private async duplicateGuardedReceipt(
    accepted: GuardedProjectMutationReceipt,
    before: Workspace,
    beforeSnapshot?: JsonObject,
  ): Promise<GuardedProjectMutationReceipt> {
    const receiptId = buildReceiptId({
      operation_id: accepted.operation_id,
      step_id: accepted.step_id,
      direction: accepted.direction,
      idempotency_key: accepted.idempotency_key,
      outcome: "duplicate_of_accepted",
      target_id: accepted.target_id,
      suffix: accepted.receipt_id,
    });
    const existing = await this.db.get<GuardedProjectMutationReceiptRow>("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1", [receiptId]);
    if (existing) return rowToGuardedReceipt(existing);
    return this.insertGuardedReceipt({
      receipt_id: receiptId,
      operation_id: accepted.operation_id,
      step_id: accepted.step_id,
      direction: accepted.direction,
      idempotency_key: accepted.idempotency_key,
      target_id: accepted.target_id,
      request_digest: accepted.request_digest,
      precondition_digest: accepted.precondition_digest,
      expected_revision: accepted.expected_revision,
      outcome: "duplicate_of_accepted",
      reason: null,
      result_project_id: accepted.result_project_id,
      duplicate_of_receipt_id: accepted.receipt_id,
      before: beforeSnapshot ?? workspaceSnapshot(before),
      after: accepted.after,
      post_revision: accepted.post_revision,
    });
  }

  private async guardedConditionalUpdate(id: string, patch: UpdateWorkspaceInput, expectedRevision: string): Promise<Workspace | null> {
    const before = await this.requireWorkspace(id);
    const root = patch.root_id ? await this.getRoot(patch.root_id) : null;
    if (patch.root_id && !root) throw new ValidationError(`Root not found: ${patch.root_id}`);
    const recipe = patch.recipe_id ? await this.getRecipe(patch.recipe_id) : null;
    if (patch.recipe_id && !recipe) throw new ValidationError(`Recipe not found: ${patch.recipe_id}`);

    const updates: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.slug !== undefined) set("slug", await this.ensureUniqueSlug("workspaces", slugify(patch.slug), before.id));
    if (patch.description !== undefined) set("description", patch.description);
    if (patch.kind !== undefined) set("kind", patch.kind);
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.root_id !== undefined) set("root_id", patch.root_id ? root!.id : null);
    if (patch.recipe_id !== undefined) set("recipe_id", patch.recipe_id ? recipe!.id : null);
    if (patch.canonical_machine !== undefined) set("canonical_machine", patch.canonical_machine);
    if (patch.primary_path !== undefined) set("primary_path", patch.primary_path ?? null);
    if (patch.git_remote !== undefined) set("git_remote", patch.git_remote);
    if (patch.s3_bucket !== undefined) set("s3_bucket", patch.s3_bucket);
    if (patch.s3_prefix !== undefined) set("s3_prefix", patch.s3_prefix);
    if (patch.tags !== undefined) set("tags", json(normalizeList(patch.tags)));
    if (patch.integrations !== undefined) set("integrations", json(patch.integrations));
    if (patch.metadata !== undefined) set("metadata", json(patch.metadata));
    if (patch.last_opened_at !== undefined) set("last_opened_at", patch.last_opened_at);
    if (!updates.length) return before;
    set("updated_at", nowIso());
    params.push(id);
    const idIdx = params.length;
    params.push(expectedRevision);
    const revIdx = params.length;
    const row = await this.db.get<WorkspaceRow>(
      `UPDATE workspaces SET ${updates.join(", ")}
       WHERE id = $${idIdx} AND updated_at = $${revIdx}
       RETURNING *`,
      params,
    );
    return row ? rowToWorkspace(row) : null;
  }

  async mutateProjectResourceLinks(input: ProjectResourceLinkMutationRequest): Promise<ProjectResourceLinkMutationResult> {
    return this.inTransaction("project resource link mutation", (store) =>
      store.mutateProjectResourceLinksInCurrentTransaction(input, {
        forced_integrations: input.integrations,
      }));
  }

  private async mutateProjectResourceLinksInCurrentTransaction(
    input: ProjectResourceLinkMutationRequest,
    options: {
      direction?: "forward" | "inverse";
      forced_integrations?: WorkspaceIntegrations;
      preserve_links?: readonly ProjectResourceLink[];
    } = {},
  ): Promise<ProjectResourceLinkMutationResult> {
    const started = Date.now();
    try {
      assertCompleteStableProjectId(input.project_id);
      assertPositiveBounds(input);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    const maxItems = input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS;
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new ValidationError("project resource link max_items must be a positive integer");
    }
    let normalized: ProjectResourceLinkInput[];
    let forcedIntegrations: WorkspaceIntegrations | undefined;
    try {
      normalized = normalizeProjectResourceLinks(input.links);
      forcedIntegrations = normalizeProjectResourceLinkIntegrations(
        options.forced_integrations ?? input.integrations,
      );
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    if (normalized.length > maxItems) {
      throw new ValidationError(`project resource link request exceeds max_items: ${normalized.length} > ${maxItems}`);
    }
    const direction = options.direction ?? "forward";
    const reqDigest = sha256(canonicalJson({
      mode: input.mode,
      links: normalized,
      integrations: forcedIntegrations ?? null,
    }));
    const preDigest = preconditionDigest({ project_id: input.project_id, expected_revision: input.expected_revision });
    const idempotencyKey = deriveGuardedIdempotencyKey({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
    });
    const beforeProject = await this.requireWorkspace(input.project_id);
    const beforeLinks = await this.listProjectResourceLinks(input.project_id, maxItems);
    const before = projectResourceLinkSnapshot(beforeProject, beforeLinks);
    const currentRevision = workspaceRevision(beforeProject);

    const duplicate = await this.guardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    });
    if (duplicate) {
      const receipt = await this.duplicateGuardedReceipt(
        duplicate,
        beforeProject,
        resourceLinkSnapshotJson(before),
      );
      return withResponseControl({
        ok: true,
        dry_run: false,
        outcome: "duplicate_of_accepted" as const,
        mode: input.mode,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: parseResourceLinkSnapshot(duplicate.after, "accepted"),
        receipt,
      }, input, started, "project resource link mutation");
    }
    const priorAccepted = await this.guardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      target_id: input.project_id,
    });
    if (priorAccepted) {
      const receipt = await this.guardedTerminalNonacceptance({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "changed_request_or_precondition_for_step",
        before_snapshot: resourceLinkSnapshotJson(before),
      });
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        mode: input.mode,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: null,
        receipt,
      }, input, started, "project resource link mutation");
    }
    if (currentRevision !== input.expected_revision) {
      const receipt = await this.guardedTerminalNonacceptance({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "stale_revision",
        before_snapshot: resourceLinkSnapshotJson(before),
      });
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        mode: input.mode,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: null,
        receipt,
      }, input, started, "project resource link mutation");
    }

    const beforeById = new Map(beforeLinks.map((link) => [link.id, link]));
    const preserveById = new Map((options.preserve_links ?? []).map((link) => [link.id, link]));
    const requested = normalized.map((link) => {
      const id = projectResourceLinkId(input.project_id, link);
      const existing = beforeById.get(id);
      const restored = preserveById.get(id);
      const labels = link.labels ?? {};
      return {
        id,
        project_id: input.project_id,
        ...link,
        labels,
        created_at: restored?.created_at ?? existing?.created_at ?? nowIso(),
        updated_at: restored?.updated_at ?? (
          existing && canonicalJson(existing.labels) === canonicalJson(labels)
            ? existing.updated_at
            : nowIso()
        ),
      } satisfies ProjectResourceLink;
    });
    const desired = (input.mode === "add"
      ? [...beforeLinks, ...requested.filter((link) => !beforeById.has(link.id))]
      : requested
    ).sort((a, b) => canonicalJson({
      authority: a.authority,
      service_instance: a.service_instance,
      source_package: a.source_package,
      target_kind: a.target_kind,
      locator_kind: a.locator.kind,
      locator_value: a.locator.value,
    }).localeCompare(canonicalJson({
      authority: b.authority,
      service_instance: b.service_instance,
      source_package: b.source_package,
      target_kind: b.target_kind,
      locator_kind: b.locator.kind,
      locator_value: b.locator.value,
    })));
    if (desired.length > maxItems) {
      throw new ValidationError(`project resource link collection exceeds max_items: ${desired.length} > ${maxItems}`);
    }
    const integrations = forcedIntegrations
      ?? projectResourceLinkIntegrationProjection(beforeProject.integrations, beforeLinks, desired);
    const preview = projectResourceLinkSnapshot({ ...beforeProject, integrations }, desired);
    if (input.dry_run) {
      return withResponseControl({
        ok: true,
        dry_run: true,
        outcome: "planned" as const,
        mode: input.mode,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: preview,
        receipt: null,
      }, input, started, "project resource link mutation");
    }
    if (timedOut(started, input.time_budget_ms)) {
      throw new ValidationError("project resource link mutation time budget exceeded before write");
    }

    const changed = canonicalJson(beforeLinks) !== canonicalJson(desired)
      || canonicalJson(beforeProject.integrations) !== canonicalJson(integrations);
    let afterProject = beforeProject;
    if (changed) {
      await this.db.execute("DELETE FROM project_resource_links WHERE project_id = $1", [input.project_id]);
      for (const link of desired) {
        await this.db.execute(
          `INSERT INTO project_resource_links (
            id, project_id, authority, service_instance, source_package, target_kind,
            locator_kind, locator_value, scope, labels_json, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            link.id,
            link.project_id,
            link.authority,
            link.service_instance,
            link.source_package,
            link.target_kind,
            link.locator.kind,
            link.locator.value,
            link.scope,
            canonicalJson(link.labels),
            link.created_at,
            link.updated_at,
          ],
        );
      }
      const nextRevision = nextResourceLinkRevision(currentRevision);
      const row = await this.db.get<WorkspaceRow>(
        `UPDATE workspaces SET integrations = $1, updated_at = $2
         WHERE id = $3 AND updated_at = $4
         RETURNING *`,
        [canonicalJson(integrations), nextRevision, input.project_id, currentRevision],
      );
      if (!row) throw new ValidationError("project resource link conditional update lost");
      afterProject = rowToWorkspace(row);
    }
    const afterLinks = await this.listProjectResourceLinks(input.project_id, maxItems);
    const after = projectResourceLinkSnapshot(afterProject, afterLinks);
    if (after.collection_digest !== projectResourceLinksDigest(desired)) {
      throw new ValidationError("project resource link exact readback mismatch");
    }
    const receipt = await this.insertGuardedReceipt({
      receipt_id: buildReceiptId({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        outcome: "accepted",
        target_id: input.project_id,
      }),
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      expected_revision: input.expected_revision,
      outcome: "accepted",
      reason: null,
      result_project_id: afterProject.id,
      duplicate_of_receipt_id: null,
      before: resourceLinkSnapshotJson(before),
      after: resourceLinkSnapshotJson(after),
      post_revision: workspaceRevision(afterProject),
    });
    await this.recordEvent({
      workspace_id: afterProject.id,
      agent_id: input.agent_id,
      event_type: direction === "inverse" ? "project_resource_links_rollback" : `project_resource_links_${input.mode}`,
      source: input.source ?? "mcp",
      command: input.command,
      before: resourceLinkSnapshotJson(before),
      after: resourceLinkSnapshotJson(after),
      metadata: {
        receipt_id: receipt.receipt_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
        idempotency_key: idempotencyKey,
        collection_digest: after.collection_digest,
      },
    });
    return withResponseControl({
      ok: true,
      dry_run: false,
      outcome: "accepted" as const,
      mode: input.mode,
      idempotency_key: idempotencyKey,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      project_id: input.project_id,
      expected_revision: input.expected_revision,
      current_revision: currentRevision,
      before,
      after,
      receipt,
    }, input, started, "project resource link mutation");
  }

  async rollbackProjectResourceLinks(input: ProjectResourceLinkRollbackRequest): Promise<ProjectResourceLinkMutationResult> {
    return this.inTransaction("project resource link rollback", async (store) => {
      assertCompleteStableProjectId(input.project_id);
      const row = await store.db.get<GuardedProjectMutationReceiptRow>(
        "SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1",
        [input.accepted_receipt_id],
      );
      if (!row) throw new NotFoundError(`accepted receipt not found: ${input.accepted_receipt_id}`);
      const accepted = rowToGuardedReceipt(row);
      if (accepted.outcome !== "accepted" || accepted.direction !== "forward" || accepted.target_id !== input.project_id) {
        throw new ValidationError("resource link rollback requires a forward accepted receipt for the same project id");
      }
      if (accepted.post_revision !== input.expected_current_revision) {
        throw new ValidationError("resource link rollback expected_current_revision must equal the accepted receipt post_revision");
      }
      const before = parseResourceLinkSnapshot(accepted.before, "accepted before");
      const after = parseResourceLinkSnapshot(accepted.after, "accepted after");
      const current = await store.readProjectResourceLinks({
        project_id: input.project_id,
        max_items: input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
      });
      if (current.current_revision !== input.expected_current_revision || current.collection_digest !== after.collection_digest) {
        throw new ValidationError("resource link rollback refuses current revision or collection digest drift");
      }
      return store.mutateProjectResourceLinksInCurrentTransaction({
        project_id: input.project_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
        mode: "reconcile",
        expected_revision: input.expected_current_revision,
        links: before.links.map(resourceLinkInputFromStored),
        max_items: input.max_items,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
        agent_id: input.agent_id,
        source: input.source,
        command: input.command,
      }, {
        direction: "inverse",
        forced_integrations: before.project.integrations,
        preserve_links: before.links,
      });
    });
  }

  async guardedUpdateWorkspace(input: GuardedProjectMutationRequest): Promise<GuardedProjectMutationResult> {
    return this.inTransaction("guarded project metadata mutation", (store) => store.guardedUpdateWorkspaceInCurrentTransaction(input));
  }

  private async guardedUpdateWorkspaceInCurrentTransaction(input: GuardedProjectMutationRequest): Promise<GuardedProjectMutationResult> {
    const started = Date.now();
    assertCompleteStableProjectId(input.project_id);
    const direction = input.direction ?? "forward";
    const reqDigest = requestDigest(input.patch);
    const preDigest = preconditionDigest({ project_id: input.project_id, expected_revision: input.expected_revision });
    const idempotencyKey = deriveGuardedIdempotencyKey({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
    });
    const before = await this.requireWorkspace(input.project_id);
    const currentRevision = workspaceRevision(before);
    const duplicate = await this.guardedAcceptedReceipt({ operation_id: input.operation_id, step_id: input.step_id, direction, idempotency_key: idempotencyKey, target_id: input.project_id });
    if (duplicate) {
      const duplicateReceipt = await this.duplicateGuardedReceipt(duplicate, before);
      const result = {
        ok: true,
        dry_run: false,
        outcome: "duplicate_of_accepted" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: duplicate.after as unknown as Workspace,
        receipt: duplicateReceipt,
      };
      return withResponseControl(result, input, started);
    }
    const priorAccepted = await this.guardedAcceptedByStep({ operation_id: input.operation_id, step_id: input.step_id, direction, target_id: input.project_id });
    if (priorAccepted) {
      const receipt = await this.guardedTerminalNonacceptance({ operation_id: input.operation_id, step_id: input.step_id, direction, idempotency_key: idempotencyKey, target_id: input.project_id, request_digest: reqDigest, precondition_digest: preDigest, expected_revision: input.expected_revision, reason: "changed_request_or_precondition_for_step", before });
      const result = { ok: false, dry_run: false, outcome: "terminal_nonacceptance" as const, idempotency_key: idempotencyKey, request_digest: reqDigest, precondition_digest: preDigest, project_id: input.project_id, expected_revision: input.expected_revision, current_revision: currentRevision, before, after: null, receipt };
      return withResponseControl(result, input, started);
    }
    if (currentRevision !== input.expected_revision) {
      const receipt = await this.guardedTerminalNonacceptance({ operation_id: input.operation_id, step_id: input.step_id, direction, idempotency_key: idempotencyKey, target_id: input.project_id, request_digest: reqDigest, precondition_digest: preDigest, expected_revision: input.expected_revision, reason: "stale_revision", before });
      const result = { ok: false, dry_run: false, outcome: "terminal_nonacceptance" as const, idempotency_key: idempotencyKey, request_digest: reqDigest, precondition_digest: preDigest, project_id: input.project_id, expected_revision: input.expected_revision, current_revision: currentRevision, before, after: null, receipt };
      return withResponseControl(result, input, started);
    }
    if (input.dry_run) {
      const after = { ...before, ...input.patch } as Workspace;
      const result = { ok: true, dry_run: true, outcome: "planned" as const, idempotency_key: idempotencyKey, request_digest: reqDigest, precondition_digest: preDigest, project_id: input.project_id, expected_revision: input.expected_revision, current_revision: currentRevision, before, after, receipt: null };
      return withResponseControl(result, input, started);
    }
    if (timedOut(started, input.time_budget_ms)) throw new ValidationError("guarded mutation time budget exceeded before write");
    const after = await this.guardedConditionalUpdate(input.project_id, { ...input.patch, agent_id: input.agent_id ?? input.patch.agent_id, source: input.source ?? input.patch.source ?? "mcp", command: input.command ?? input.patch.command }, input.expected_revision);
    if (!after) {
      const fresh = await this.requireWorkspace(input.project_id);
      const receipt = await this.guardedTerminalNonacceptance({ operation_id: input.operation_id, step_id: input.step_id, direction, idempotency_key: idempotencyKey, target_id: input.project_id, request_digest: reqDigest, precondition_digest: preDigest, expected_revision: input.expected_revision, reason: "stale_revision", before: fresh });
      const result = { ok: false, dry_run: false, outcome: "terminal_nonacceptance" as const, idempotency_key: idempotencyKey, request_digest: reqDigest, precondition_digest: preDigest, project_id: input.project_id, expected_revision: input.expected_revision, current_revision: workspaceRevision(fresh), before: fresh, after: null, receipt };
      return withResponseControl(result, input, started);
    }
    const receipt = await this.insertGuardedReceipt({
      receipt_id: buildReceiptId({ operation_id: input.operation_id, step_id: input.step_id, direction, idempotency_key: idempotencyKey, outcome: "accepted", target_id: input.project_id }),
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      expected_revision: input.expected_revision,
      outcome: "accepted",
      reason: null,
      result_project_id: after.id,
      duplicate_of_receipt_id: null,
      before: workspaceSnapshot(before),
      after: workspaceSnapshot(after),
      post_revision: workspaceRevision(after),
    });
    await this.recordEvent({ workspace_id: after.id, agent_id: input.agent_id, event_type: direction === "inverse" ? "guarded_metadata_mutation_rollback" : "guarded_metadata_mutation", source: input.source ?? "mcp", command: input.command, before: before as unknown as JsonObject, after: after as unknown as JsonObject, metadata: { receipt_id: receipt.receipt_id, operation_id: input.operation_id, step_id: input.step_id, idempotency_key: idempotencyKey } });
    const result = { ok: true, dry_run: false, outcome: "accepted" as const, idempotency_key: idempotencyKey, request_digest: reqDigest, precondition_digest: preDigest, project_id: input.project_id, expected_revision: input.expected_revision, current_revision: currentRevision, before, after, receipt };
    return withResponseControl(result, input, started);
  }

  async lookupGuardedWorkspaceMutationReceipt(input: GuardedProjectMutationReceiptLookupInput): Promise<GuardedProjectMutationReceiptLookupResult> {
    const started = Date.now();
    assertCompleteStableProjectId(input.project_id);
    if (input.max_items !== 1) throw new ValidationError("guarded receipt lookup max_items must be exactly 1");
    const rows = await this.db.many<GuardedProjectMutationReceiptRow>(
      `SELECT * FROM guarded_project_mutation_receipts
       WHERE operation_id = $1 AND step_id = $2 AND direction = $3 AND idempotency_key = $4 AND target_id = $5
       ORDER BY created_at ASC, receipt_id ASC
       LIMIT 2`,
      [input.operation_id, input.step_id, input.direction, input.idempotency_key, input.project_id],
    );
    if (rows.length === 0) throw new ValidationError("guarded receipt lookup expected exactly one terminal receipt, found 0");
    const receipts = rows.map(rowToGuardedReceipt);
    const accepted = receipts.find((receipt) => receipt.outcome === "accepted");
    const duplicates = receipts.filter((receipt) => receipt.outcome === "duplicate_of_accepted");
    if (receipts.length > 1) {
      if (!accepted || duplicates.length !== receipts.length - 1 || duplicates.some((receipt) => receipt.duplicate_of_receipt_id !== accepted.receipt_id)) {
        throw new ValidationError(`guarded receipt lookup expected exactly one terminal result, found ${receipts.length}`);
      }
    }
    const receipt = duplicates.at(-1) ?? accepted ?? receipts[0]!;
    return withResponseControl({ receipt }, input, started);
  }

  async rollbackGuardedWorkspaceMutation(input: GuardedProjectMutationRollbackRequest): Promise<GuardedProjectMutationResult> {
    return this.inTransaction("guarded project metadata rollback", (store) => store.rollbackGuardedWorkspaceMutationInCurrentTransaction(input));
  }

  private async rollbackGuardedWorkspaceMutationInCurrentTransaction(input: GuardedProjectMutationRollbackRequest): Promise<GuardedProjectMutationResult> {
    assertCompleteStableProjectId(input.project_id);
    const row = await this.db.get<GuardedProjectMutationReceiptRow>("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1", [input.accepted_receipt_id]);
    if (!row) throw new NotFoundError(`accepted receipt not found: ${input.accepted_receipt_id}`);
    const accepted = rowToGuardedReceipt(row);
    if (accepted.outcome !== "accepted" || accepted.direction !== "forward" || accepted.target_id !== input.project_id) {
      throw new ValidationError("rollback requires a forward accepted receipt for the same project id");
    }
    if (accepted.post_revision !== input.expected_current_revision) {
      throw new ValidationError("rollback expected_current_revision must equal the accepted receipt post_revision");
    }
    const before = accepted.before as unknown as Workspace | null;
    if (!before) throw new ValidationError("accepted receipt has no before snapshot");
    return this.guardedUpdateWorkspaceInCurrentTransaction({
      project_id: input.project_id,
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      expected_revision: input.expected_current_revision,
      patch: {
        name: before.name,
        slug: before.slug,
        description: before.description,
        kind: before.kind,
        status: before.status,
        root_id: before.root_id,
        recipe_id: before.recipe_id,
        canonical_machine: before.canonical_machine,
        primary_path: before.primary_path,
        git_remote: before.git_remote,
        s3_bucket: before.s3_bucket,
        s3_prefix: before.s3_prefix,
        tags: before.tags,
        integrations: before.integrations,
        metadata: before.metadata,
        last_opened_at: before.last_opened_at,
      },
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
      agent_id: input.agent_id,
      source: input.source ?? "mcp",
      command: input.command,
    });
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
    await this.db.execute("DELETE FROM workspaces WHERE id = $1", [before.id]);
    return { workspace: before, hard: true };
  }

  // --- events -----------------------------------------------------------
  async listWorkspaceEvents(workspaceId: string, limit = 200): Promise<WorkspaceEvent[]> {
    const rows = await this.db.many<WorkspaceEventRow>(
      "SELECT * FROM workspace_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2",
      [workspaceId, Math.min(Math.max(limit, 1), 1000)],
    );
    return rows.map(rowToEvent);
  }

  async recordEvent(input: RecordWorkspaceEventInput): Promise<WorkspaceEvent> {
    const id = generateEventId();
    const agent = input.agent_id ? await this.getAgent(input.agent_id) : null;
    await this.db.execute(
      `INSERT INTO workspace_events (
        id, workspace_id, agent_id, event_type, source, prompt, command,
        before_json, after_json, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        input.workspace_id ?? null,
        agent?.id ?? null,
        input.event_type,
        input.source,
        input.prompt ?? null,
        input.command ?? null,
        input.before === undefined ? null : json(input.before),
        input.after === undefined ? null : json(input.after),
        json(input.metadata ?? {}),
        nowIso(),
      ],
    );
    const row = await this.db.get<WorkspaceEventRow>("SELECT * FROM workspace_events WHERE id = $1", [id]);
    return rowToEvent(row!);
  }

  // --- health -----------------------------------------------------------
  async ping(): Promise<boolean> {
    const row = await this.db.get<{ ok: number }>("SELECT 1 AS ok");
    return row?.ok === 1;
  }
}
