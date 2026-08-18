// Postgres-backed store for projects-serve (Amendment A1 pure-remote).
//
// This is the cloud data-access layer the HTTP API wraps. It mirrors the domain
// semantics of src/db/workspaces.ts (the local SQLite core) — id/slug rules,
// tag merging, JSON-encoded columns, event journaling — but executes async SQL
// against cloud Postgres through the vendored storage kit's TypedQueryClient.
// There is NO sync engine and NO local cache here (pure remote): every call
// hits the database.

import { nanoid } from "nanoid";
import type { QueryResultRow } from "pg";
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
  assertProjectResourceLinkIntegrationMutation,
  assertProjectResourceLinkReadContractEquality,
  normalizeProjectResourceLinks,
  normalizeProjectResourceLinkIntegrations,
  PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
  projectResourceLinkCollection,
  projectResourceLinkId,
  projectResourceLinkIntegrationProjection,
  projectResourceLinksDigest,
  projectResourceLinkSnapshot,
  rowToProjectResourceLink,
} from "../lib/project-resource-links.js";
import {
  assertProjectQuarantinePostimage,
  assertProjectQuarantinePreconditions,
  normalizedExpectedResourceLinkIds,
  normalizedExpectedWorkspaceLocationIds,
  parseProjectQuarantineSnapshot,
  projectDigest,
  projectQuarantinePatch,
  projectQuarantinePreconditionDigest,
  projectQuarantineRequestDigest,
  projectQuarantineSnapshot,
  projectQuarantineSnapshotJson,
  PROJECT_QUARANTINE_EVENT,
  PROJECT_QUARANTINE_ROLLBACK_EVENT,
  restoreProjectPatch,
  workspaceLocationsDigest,
} from "../lib/project-quarantine.js";
import {
  applyProjectResourceLinkMigrationTransition,
  assertProjectResourceLinkProducerAttestation,
  buildProjectResourceLinkMigrationPlan,
  migrationEvent,
  migrationEvidenceWithProducerAttestation,
  projectResourceLinkProducerProjectSubject,
  reconcileProjectResourceLinkProducerProof,
  rowToProjectResourceLinkMigrationManifest,
  type AsyncProjectResourceLinkProducerEvidenceVerifier,
  type ProjectResourceLinkProducerAttestation,
} from "../lib/project-resource-link-migrations.js";
import { normalizeProjectMetadata } from "../lib/project-management.js";
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
  ProjectResourceLinkMigrationAdvanceRequest,
  ProjectResourceLinkMigrationEvent,
  ProjectResourceLinkMigrationManifestRow,
  ProjectResourceLinkMigrationManifestV1,
  ProjectResourceLinkMigrationPlanRequest,
  ProjectResourceLinkMigrationReadRequest,
  ProjectResourceLinkMigrationResult,
  ProjectResourceLinkMigrationRollbackRequest,
  ProjectResourceLinkReadRequest,
  ProjectResourceLinkReadResult,
  ProjectResourceLinkRollbackRequest,
  ProjectResourceLinkRow,
  ProjectResourceLinkSnapshot,
  ProjectQuarantineReadRequest,
  ProjectQuarantineReadResult,
  ProjectQuarantineRequest,
  ProjectQuarantineResult,
  ProjectQuarantineRollbackRequest,
  Recipe,
  RecipeRow,
  RecordWorkspaceEventInput,
  Root,
  RootRow,
  UpdateRootInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceAgentAssignment,
  WorkspaceAgentAssignmentRow,
  WorkspaceEvent,
  WorkspaceEventRow,
  WorkspaceIntegrations,
  WorkspaceLocation,
  WorkspaceLocationRow,
  WorkspaceLock,
  WorkspaceLockRow,
  WorkspaceKind,
  WorkspaceRow,
  WorkspaceStatus,
  Machine,
  MachineRow,
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

function rowToWorkspaceLocation(row: WorkspaceLocationRow): WorkspaceLocation {
  return {
    ...row,
    is_primary: Boolean(row.is_primary),
    exists_at_create: Boolean(row.exists_at_create),
    metadata: parseJson<JsonObject>(row.metadata, {}),
  };
}

function rowToWorkspaceLock(row: WorkspaceLockRow): WorkspaceLock {
  return {
    id: row.id,
    lock_key: row.lock_key,
    workspace_id: row.workspace_id,
    agent_id: row.agent_id,
    reason: row.reason,
    created_at: row.created_at,
    expires_at: row.expires_at,
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

function assertHostedProjectResourceLinkIntegrationMutation(
  beforeIntegrations: WorkspaceIntegrations,
  proposedIntegrations: WorkspaceIntegrations,
  links: readonly ProjectResourceLink[],
): void {
  try {
    assertProjectResourceLinkIntegrationMutation(beforeIntegrations, proposedIntegrations, links);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
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
  constructor(
    private readonly db: TypedQueryClient,
    private readonly producerEvidenceVerifier?: AsyncProjectResourceLinkProducerEvidenceVerifier,
  ) {}

  private async inTransaction<T>(operation: string, fn: (store: ProjectsPgStore) => Promise<T>): Promise<T> {
    const transaction = (this.db as TransactionCapableClient).transaction;
    if (typeof transaction !== "function") {
      throw new ValidationError(`${operation} requires a transaction-capable Postgres client`);
    }
    return transaction.call(
      this.db,
      async (client) => fn(new ProjectsPgStore(client, this.producerEvidenceVerifier)),
    ) as Promise<T>;
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

  async listWorkspaceLocations(projectId: string): Promise<WorkspaceLocation[]> {
    const rows = await this.db.many<WorkspaceLocationRow>(
      `SELECT * FROM workspace_locations
       WHERE workspace_id = $1
       ORDER BY is_primary DESC, created_at ASC, id ASC`,
      [projectId],
    );
    return rows.map(rowToWorkspaceLocation);
  }

  async listMachines(): Promise<Machine[]> {
    const rows = await this.db.many<MachineRow>(
      "SELECT * FROM machines ORDER BY slug ASC",
    );
    return rows.map((row) => ({
      slug: row.slug,
      status: row.status,
      role: row.role as Machine["role"],
    }));
  }

  // ---- hosted sub-resource writes (formerly on-box only) ----
  // The pg baseline has carried workspace_locations / workspace_agents /
  // workspace_locks since 0001; these methods make the hosted backend support
  // the same project sub-resource writes the local backend always did.

  async addWorkspaceLocation(input: {
    workspace_id: string;
    path: string;
    machine_id?: string;
    label?: string;
    kind?: string;
    is_primary?: boolean;
    metadata?: JsonObject;
    agent_id?: string;
    source?: EventSource;
    command?: string;
    created_at?: string;
  }): Promise<WorkspaceLocation> {
    const workspace = await this.requireWorkspace(input.workspace_id);
    const isPrimary = Boolean(input.is_primary);
    const machineId = input.machine_id?.trim();
    if (!machineId) throw new ValidationError("location machine must not be empty");
    const path = input.path.trim();
    if (!path) throw new ValidationError("location path is required");
    const id = nanoid(24);
    const ts = input.created_at ?? nowIso();
    if (isPrimary) {
      await this.db.execute("UPDATE workspace_locations SET is_primary = FALSE WHERE workspace_id = $1", [input.workspace_id]);
    }
    await this.db.execute(
      `INSERT INTO workspace_locations (
        id, workspace_id, path, machine_id, label, kind, is_primary, exists_at_create, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (workspace_id, path, machine_id) DO UPDATE SET
        label = EXCLUDED.label,
        kind = EXCLUDED.kind,
        is_primary = EXCLUDED.is_primary,
        metadata = EXCLUDED.metadata`,
      [
        id,
        input.workspace_id,
        path,
        machineId,
        input.label ?? "main",
        input.kind ?? "local",
        isPrimary,
        false,
        json(input.metadata ?? {}),
        ts,
      ],
    );
    if (isPrimary) {
      await this.db.execute("UPDATE workspaces SET primary_path = $1, updated_at = $2 WHERE id = $3", [
        path,
        nowIso(),
        input.workspace_id,
      ]);
    }
    if (input.source || input.agent_id || input.command) {
      await this.recordEvent({
        workspace_id: input.workspace_id,
        agent_id: input.agent_id,
        event_type: "location_added",
        source: input.source ?? "system",
        command: input.command,
        after: { path, label: input.label ?? "main", machine_id: machineId, primary: isPrimary } as unknown as JsonObject,
      });
    }
    const row = await this.db.get<WorkspaceLocationRow>(
      "SELECT * FROM workspace_locations WHERE workspace_id = $1 AND path = $2 AND machine_id = $3",
      [input.workspace_id, path, machineId],
    );
    if (!row) throw new Error(`Workspace location was not written: ${path}`);
    return rowToWorkspaceLocation(row);
  }

  async listWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgentAssignment[]> {
    await this.requireWorkspace(workspaceId);
    const rows = await this.db.many<WorkspaceAgentAssignmentRow & {
      agent_slug: string | null;
      agent_name: string | null;
      agent_kind: string | null;
      agent_provider: string | null;
      agent_model: string | null;
      agent_role: string | null;
      agent_permissions: string | null;
    }>(
      `SELECT wa.*, a.slug AS agent_slug, a.name AS agent_name, a.kind AS agent_kind,
              a.provider AS agent_provider, a.model AS agent_model, a.role AS agent_role,
              a.permissions AS agent_permissions
       FROM workspace_agents wa
       LEFT JOIN agents a ON a.id = wa.agent_id
       WHERE wa.workspace_id = $1
       ORDER BY wa.role ASC, wa.created_at ASC, wa.id ASC`,
      [workspaceId],
    );
    return rows.map((row) => this.toWorkspaceAgentAssignment(row));
  }

  private toWorkspaceAgentAssignment(row: WorkspaceAgentAssignmentRow & {
    agent_slug: string | null;
    agent_name: string | null;
    agent_kind: string | null;
    agent_provider: string | null;
    agent_model: string | null;
    agent_role: string | null;
    agent_permissions: string | null;
  }): WorkspaceAgentAssignment {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      agent_id: row.agent_id,
      role: row.role,
      assigned_by: row.assigned_by,
      metadata: parseJson(row.metadata, {}),
      created_at: row.created_at,
      agent: row.agent_id
        ? rowToAgent({
            id: row.agent_id,
            slug: row.agent_slug ?? "",
            name: row.agent_name ?? "",
            kind: row.agent_kind ?? "ai",
            provider: row.agent_provider,
            model: row.agent_model,
            role: row.agent_role,
            permissions: row.agent_permissions ?? "[]",
            metadata: "{}",
            created_at: row.created_at,
            updated_at: row.created_at,
          })
        : null,
    };
  }

  async assignAgentToWorkspace(input: {
    workspace_id: string;
    agent_id: string;
    role?: string;
    assigned_by?: string;
    metadata?: JsonObject;
    created_at?: string;
  }): Promise<WorkspaceAgentAssignment> {
    await this.requireWorkspace(input.workspace_id);
    const agent = await this.getAgent(input.agent_id);
    if (!agent) throw new NotFoundError(`Agent not found: ${input.agent_id}`);
    const role = input.role ?? "contributor";
    const id = nanoid(24);
    const ts = input.created_at ?? nowIso();
    await this.db.execute(
      `INSERT INTO workspace_agents (id, workspace_id, agent_id, role, assigned_by, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id, agent_id, role) DO NOTHING`,
      [id, input.workspace_id, agent.id, role, input.assigned_by ?? null, json(input.metadata ?? {}), ts],
    );
    const row = await this.db.get<WorkspaceAgentAssignmentRow & {
      agent_slug: string | null;
      agent_name: string | null;
      agent_kind: string | null;
      agent_provider: string | null;
      agent_model: string | null;
      agent_role: string | null;
      agent_permissions: string | null;
    }>(
      `SELECT wa.*, a.slug AS agent_slug, a.name AS agent_name, a.kind AS agent_kind,
              a.provider AS agent_provider, a.model AS agent_model, a.role AS agent_role,
              a.permissions AS agent_permissions
       FROM workspace_agents wa
       LEFT JOIN agents a ON a.id = wa.agent_id
       WHERE wa.workspace_id = $1 AND wa.agent_id = $2 AND wa.role = $3`,
      [input.workspace_id, agent.id, role],
    );
    if (!row) throw new Error(`Workspace agent assignment was not written: ${input.workspace_id}/${agent.id}/${role}`);
    return this.toWorkspaceAgentAssignment(row);
  }

  async listLocks(): Promise<WorkspaceLock[]> {
    await this.pruneExpiredLocks();
    const rows = await this.db.many<WorkspaceLockRow>(
      "SELECT * FROM workspace_locks ORDER BY created_at ASC, id ASC",
    );
    return rows.map(rowToWorkspaceLock);
  }

  async acquireLock(input: {
    lock_key: string;
    workspace_id?: string;
    agent_id?: string;
    reason?: string;
    ttl_seconds?: number;
    created_at?: string;
  }): Promise<WorkspaceLock> {
    if (!input.lock_key?.trim()) throw new ValidationError("lock_key is required");
    await this.pruneExpiredLocks();
    const existing = await this.db.get<WorkspaceLockRow>("SELECT * FROM workspace_locks WHERE lock_key = $1", [input.lock_key]);
    if (existing) throw new ValidationError(`Workspace lock already held: ${input.lock_key}`);
    const id = nanoid(24);
    const ts = input.created_at ?? nowIso();
    const expiresAt = input.ttl_seconds
      ? new Date(Date.now() + input.ttl_seconds * 1000).toISOString().replace("T", " ").replace("Z", "")
      : null;
    await this.db.execute(
      `INSERT INTO workspace_locks (id, lock_key, workspace_id, agent_id, reason, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, input.lock_key, input.workspace_id ?? null, input.agent_id ?? null, input.reason ?? null, ts, expiresAt],
    );
    const row = await this.db.get<WorkspaceLockRow>("SELECT * FROM workspace_locks WHERE id = $1", [id]);
    if (!row) throw new Error(`Workspace lock was not written: ${input.lock_key}`);
    return rowToWorkspaceLock(row);
  }

  async releaseLock(lockKey: string): Promise<boolean> {
    const existing = await this.db.get<WorkspaceLockRow>("SELECT * FROM workspace_locks WHERE lock_key = $1", [lockKey]);
    if (!existing) return false;
    await this.db.execute("DELETE FROM workspace_locks WHERE lock_key = $1", [lockKey]);
    return true;
  }

  private async pruneExpiredLocks(): Promise<void> {
    await this.db.execute("DELETE FROM workspace_locks WHERE expires_at IS NOT NULL AND expires_at < $1", [nowIso()]);
  }

  private async listWorkspaceLocationsBounded(
    projectId: string,
    maxItems: number,
  ): Promise<WorkspaceLocation[]> {
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new ValidationError("project quarantine workspace_location_max_items must be a positive integer");
    }
    const rows = await this.db.many<WorkspaceLocationRow>(
      `SELECT * FROM workspace_locations
       WHERE workspace_id = $1
       ORDER BY is_primary DESC, created_at ASC, id ASC
       LIMIT $2`,
      [projectId, maxItems + 1],
    );
    if (rows.length > maxItems) {
      throw new ValidationError(`project quarantine workspace-location collection exceeds max_items: more than ${maxItems}`);
    }
    return rows.map(rowToWorkspaceLocation);
  }

  private async replaceWorkspaceLocations(
    projectId: string,
    locations: readonly WorkspaceLocation[],
  ): Promise<void> {
    await this.db.execute("DELETE FROM workspace_locations WHERE workspace_id = $1", [projectId]);
    for (const location of locations) {
      await this.db.execute(
        `INSERT INTO workspace_locations (
          id, workspace_id, path, machine_id, label, kind, is_primary,
          exists_at_create, metadata, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          location.id,
          projectId,
          location.path,
          location.machine_id,
          location.label,
          location.kind,
          location.is_primary ? 1 : 0,
          location.exists_at_create ? 1 : 0,
          json(location.metadata),
          location.created_at,
        ],
      );
    }
  }

  private async replaceProjectResourceLinksExact(
    projectId: string,
    links: readonly ProjectResourceLink[],
  ): Promise<void> {
    await this.db.execute("DELETE FROM project_resource_links WHERE project_id = $1", [projectId]);
    for (const link of links) {
      await this.db.execute(
        `INSERT INTO project_resource_links (
          id, project_id, authority, service_instance, source_package, target_kind,
          locator_kind, locator_value, scope, labels_json, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          link.id,
          projectId,
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
  }

  async readProjectResourceLinks(
    input: ProjectResourceLinkReadRequest,
    startedAtMs = Date.now(),
  ): Promise<ProjectResourceLinkReadResult> {
    assertCompleteStableProjectId(input.project_id);
    const project = await this.requireWorkspace(input.project_id);
    const links = await this.listProjectResourceLinks(input.project_id, input.max_items);
    const read = {
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
      contract: projectResourceLinkCollection(
        project.id,
        workspaceRevision(project),
        links,
        input.max_items,
      ),
    };
    assertProjectResourceLinkReadContractEquality(read);
    return withResponseControl(read, input, startedAtMs, "project resource link read");
  }

  async readDuplicateProjectQuarantinePreimage(
    input: ProjectQuarantineReadRequest,
    startedAtMs = Date.now(),
  ): Promise<ProjectQuarantineReadResult> {
    try {
      assertCompleteStableProjectId(input.project_id);
      assertPositiveBounds(input);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    const project = await this.requireWorkspace(input.project_id);
    const links = await this.listProjectResourceLinks(input.project_id, input.resource_link_max_items);
    const locations = await this.listWorkspaceLocationsBounded(
      input.project_id,
      input.workspace_location_max_items,
    );
    const snapshot = projectQuarantineSnapshot(project, links, locations);
    return withResponseControl({
      ok: true as const,
      project_id: project.id,
      current_revision: project.updated_at,
      snapshot,
      resource_link_count: links.length,
      workspace_location_count: locations.length,
      complete: true as const,
      truncated: false as const,
    }, input, startedAtMs, "project quarantine preimage read");
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
    const metadata = normalizeProjectMetadata(input.metadata);
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
          json(metadata),
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
    if (input.integrations !== undefined) {
      assertHostedProjectResourceLinkIntegrationMutation(
        before.integrations,
        input.integrations,
        await this.listProjectResourceLinks(before.id, PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS),
      );
    }
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
    if (metadata !== undefined) {
      metadata = normalizeProjectMetadata(metadata, before.metadata);
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

  private async requireForwardProjectResourceLinkReceipt(
    receiptId: string,
    projectId: string,
  ): Promise<GuardedProjectMutationReceipt> {
    const row = await this.db.get<GuardedProjectMutationReceiptRow>(
      "SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1",
      [receiptId],
    );
    if (!row) throw new NotFoundError(`accepted receipt not found: ${receiptId}`);
    const accepted = rowToGuardedReceipt(row);
    if (
      accepted.outcome !== "accepted"
      || accepted.direction !== "forward"
      || accepted.target_id !== projectId
    ) {
      throw new ValidationError("resource link rollback requires a forward accepted receipt for the same project id");
    }
    if (!accepted.post_revision) {
      throw new ValidationError("resource link rollback accepted receipt has no post_revision");
    }
    return accepted;
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

  private async guardedConditionalUpdate(
    id: string,
    patch: UpdateWorkspaceInput,
    expectedRevision: string,
    options: { preserveExactSlug?: boolean } = {},
  ): Promise<Workspace | null> {
    const before = await this.requireWorkspace(id);
    const root = patch.root_id ? await this.getRoot(patch.root_id) : null;
    if (patch.root_id && !root) throw new ValidationError(`Root not found: ${patch.root_id}`);
    const recipe = patch.recipe_id ? await this.getRecipe(patch.recipe_id) : null;
    if (patch.recipe_id && !recipe) throw new ValidationError(`Recipe not found: ${patch.recipe_id}`);
    const metadata = patch.metadata === undefined
      ? undefined
      : normalizeProjectMetadata(patch.metadata, before.metadata);

    const updates: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.slug !== undefined) {
      set(
        "slug",
        options.preserveExactSlug
          ? patch.slug
          : await this.ensureUniqueSlug("workspaces", slugify(patch.slug), before.id),
      );
    }
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
    if (metadata !== undefined) set("metadata", json(metadata));
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
          existing
          && existing.scope === link.scope
          && canonicalJson(existing.labels) === canonicalJson(labels)
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
      const desiredIds = new Set(desired.map((link) => link.id));
      for (const existing of beforeLinks) {
        if (!desiredIds.has(existing.id)) {
          await this.db.execute("DELETE FROM project_resource_links WHERE id = $1", [existing.id]);
        }
      }
      for (const link of desired) {
        const existing = beforeLinks.find((candidate) => candidate.id === link.id);
        if (existing) {
          if (
            existing.scope !== link.scope
            || canonicalJson(existing.labels) !== canonicalJson(link.labels)
          ) {
            await this.db.execute(
              `UPDATE project_resource_links
               SET scope = $1, labels_json = $2, updated_at = $3
               WHERE id = $4`,
              [link.scope, canonicalJson(link.labels), link.updated_at, link.id],
            );
          }
        } else {
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
      const accepted = await store.requireForwardProjectResourceLinkReceipt(
        input.accepted_receipt_id,
        input.project_id,
      );
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
      const priorInverse = await store.guardedAcceptedByStep({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "inverse",
        target_id: input.project_id,
      });
      if (priorInverse) {
        const inverseBefore = parseResourceLinkSnapshot(priorInverse.before, "accepted inverse before");
        const inverseAfter = parseResourceLinkSnapshot(priorInverse.after, "accepted inverse after");
        if (
          priorInverse.expected_revision !== input.expected_current_revision
          || inverseBefore.collection_digest !== after.collection_digest
          || canonicalJson(inverseBefore.project.integrations) !== canonicalJson(after.project.integrations)
          || inverseAfter.collection_digest !== before.collection_digest
          || canonicalJson(inverseAfter.project.integrations) !== canonicalJson(before.project.integrations)
        ) {
          throw new ValidationError("accepted resource link inverse receipt does not match the forward receipt");
        }
        if (
          !priorInverse.post_revision
          || current.current_revision !== priorInverse.post_revision
          || current.collection_digest !== inverseAfter.collection_digest
          || canonicalJson(current.project.integrations) !== canonicalJson(inverseAfter.project.integrations)
        ) {
          throw new ValidationError("resource link rollback retry refuses drift after the accepted inverse");
        }
      } else if (
        current.current_revision !== input.expected_current_revision
        || current.collection_digest !== after.collection_digest
      ) {
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

  async quarantineDuplicateProject(input: ProjectQuarantineRequest): Promise<ProjectQuarantineResult> {
    return this.inTransaction("duplicate project quarantine", (store) =>
      store.quarantineDuplicateProjectInCurrentTransaction(input));
  }

  private async quarantineDuplicateProjectInCurrentTransaction(
    input: ProjectQuarantineRequest,
  ): Promise<ProjectQuarantineResult> {
    const started = Date.now();
    try {
      assertCompleteStableProjectId(input.project_id);
      assertPositiveBounds(input);
      normalizedExpectedResourceLinkIds(input);
      normalizedExpectedWorkspaceLocationIds(input);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    const reqDigest = projectQuarantineRequestDigest(input);
    const preDigest = projectQuarantinePreconditionDigest(input);
    const idempotencyKey = deriveGuardedIdempotencyKey({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
    });
    const beforeProject = await this.requireWorkspace(input.project_id);
    const beforeLinks = await this.listProjectResourceLinks(input.project_id, input.resource_link_max_items);
    const beforeLocations = await this.listWorkspaceLocationsBounded(
      input.project_id,
      input.workspace_location_max_items,
    );
    const before = projectQuarantineSnapshot(beforeProject, beforeLinks, beforeLocations);
    const duplicate = await this.guardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    });
    if (duplicate) {
      const acceptedAfter = parseProjectQuarantineSnapshot(duplicate.after, "accepted after");
      if (
        beforeProject.updated_at !== duplicate.post_revision
        || before.project_digest !== acceptedAfter.project_digest
        || before.resource_link_collection_digest !== acceptedAfter.resource_link_collection_digest
        || before.workspace_location_collection_digest !== acceptedAfter.workspace_location_collection_digest
      ) {
        throw new ValidationError("project quarantine retry refuses drift after the accepted receipt");
      }
      if (input.dry_run) {
        return withResponseControl({
          ok: true,
          dry_run: true,
          outcome: "duplicate_of_accepted" as const,
          idempotency_key: idempotencyKey,
          request_digest: reqDigest,
          precondition_digest: preDigest,
          project_id: input.project_id,
          expected_revision: input.expected_revision,
          current_revision: beforeProject.updated_at,
          before,
          after: acceptedAfter,
          receipt: null,
          rollback: {
            accepted_receipt_id: duplicate.receipt_id,
            expected_current_revision: duplicate.post_revision!,
          },
        }, input, started, "project quarantine");
      }
      const receipt = await this.duplicateGuardedReceipt(
        duplicate,
        beforeProject,
        projectQuarantineSnapshotJson(before),
      );
      return withResponseControl({
        ok: true,
        dry_run: false,
        outcome: "duplicate_of_accepted" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: beforeProject.updated_at,
        before,
        after: acceptedAfter,
        receipt,
        rollback: {
          accepted_receipt_id: duplicate.receipt_id,
          expected_current_revision: duplicate.post_revision!,
        },
      }, input, started, "project quarantine");
    }
    const priorAccepted = await this.guardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      target_id: input.project_id,
    });
    if (priorAccepted) {
      if (input.dry_run) {
        return withResponseControl({
          ok: false,
          dry_run: true,
          outcome: "terminal_nonacceptance" as const,
          idempotency_key: idempotencyKey,
          request_digest: reqDigest,
          precondition_digest: preDigest,
          project_id: input.project_id,
          expected_revision: input.expected_revision,
          current_revision: beforeProject.updated_at,
          before,
          after: null,
          receipt: null,
          rollback: null,
        }, input, started, "project quarantine");
      }
      const receipt = await this.guardedTerminalNonacceptance({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "forward",
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "changed_request_or_precondition_for_step",
        before_snapshot: projectQuarantineSnapshotJson(before),
      });
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: beforeProject.updated_at,
        before,
        after: null,
        receipt,
        rollback: null,
      }, input, started, "project quarantine");
    }
    let refusal: string | null;
    try {
      refusal = assertProjectQuarantinePreconditions(input, before);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    if (refusal) {
      if (input.dry_run) {
        return withResponseControl({
          ok: false,
          dry_run: true,
          outcome: "terminal_nonacceptance" as const,
          idempotency_key: idempotencyKey,
          request_digest: reqDigest,
          precondition_digest: preDigest,
          project_id: input.project_id,
          expected_revision: input.expected_revision,
          current_revision: beforeProject.updated_at,
          before,
          after: null,
          receipt: null,
          rollback: null,
        }, input, started, "project quarantine");
      }
      const receipt = await this.guardedTerminalNonacceptance({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "forward",
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: refusal,
        before_snapshot: projectQuarantineSnapshotJson(before),
      });
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: beforeProject.updated_at,
        before,
        after: null,
        receipt,
        rollback: null,
      }, input, started, "project quarantine");
    }
    const collision = await this.db.get<{ id: string }>(
      "SELECT id FROM workspaces WHERE slug = $1 AND id <> $2",
      [slugify(input.quarantine_slug), input.project_id],
    );
    if (collision) throw new ValidationError("project quarantine slug is already owned by another project");
    const patch = projectQuarantinePatch(input, before);
    const previewProject = {
      ...beforeProject,
      ...patch,
      slug: slugify(input.quarantine_slug),
      metadata: normalizeProjectMetadata(patch.metadata, beforeProject.metadata),
    } as Workspace;
    const preview = projectQuarantineSnapshot(previewProject, [], []);
    assertProjectQuarantinePostimage(input, before, preview);
    if (input.dry_run) {
      return withResponseControl({
        ok: true,
        dry_run: true,
        outcome: "planned" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: beforeProject.updated_at,
        before,
        after: preview,
        receipt: null,
        rollback: null,
      }, input, started, "project quarantine");
    }
    if (timedOut(started, input.time_budget_ms)) {
      throw new ValidationError("project quarantine time budget exceeded before write");
    }
    const afterProject = await this.guardedConditionalUpdate(
      input.project_id,
      {
        ...patch,
        agent_id: input.agent_id,
        source: input.source ?? "mcp",
        command: input.command,
      },
      input.expected_revision,
      { preserveExactSlug: true },
    );
    if (!afterProject) {
      const fresh = await this.requireWorkspace(input.project_id);
      const freshLinks = await this.listProjectResourceLinks(input.project_id, input.resource_link_max_items);
      const freshLocations = await this.listWorkspaceLocationsBounded(
        input.project_id,
        input.workspace_location_max_items,
      );
      const freshSnapshot = projectQuarantineSnapshot(fresh, freshLinks, freshLocations);
      const receipt = await this.guardedTerminalNonacceptance({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "forward",
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "stale_revision",
        before_snapshot: projectQuarantineSnapshotJson(freshSnapshot),
      });
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: fresh.updated_at,
        before: freshSnapshot,
        after: null,
        receipt,
        rollback: null,
      }, input, started, "project quarantine");
    }
    await this.replaceProjectResourceLinksExact(input.project_id, []);
    await this.replaceWorkspaceLocations(input.project_id, []);
    const after = projectQuarantineSnapshot(afterProject, [], []);
    assertProjectQuarantinePostimage(input, before, after);
    const receipt = await this.insertGuardedReceipt({
      receipt_id: buildReceiptId({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "forward",
        idempotency_key: idempotencyKey,
        outcome: "accepted",
        target_id: input.project_id,
      }),
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      expected_revision: input.expected_revision,
      outcome: "accepted",
      reason: null,
      result_project_id: afterProject.id,
      duplicate_of_receipt_id: null,
      before: projectQuarantineSnapshotJson(before),
      after: projectQuarantineSnapshotJson(after),
      post_revision: afterProject.updated_at,
    });
    await this.recordEvent({
      workspace_id: input.project_id,
      agent_id: input.agent_id,
      event_type: PROJECT_QUARANTINE_EVENT,
      source: input.source ?? "mcp",
      command: input.command,
      before: projectQuarantineSnapshotJson(before),
      after: projectQuarantineSnapshotJson(after),
      metadata: { receipt_id: receipt.receipt_id, operation_id: input.operation_id, step_id: input.step_id },
    });
    return withResponseControl({
      ok: true,
      dry_run: false,
      outcome: "accepted" as const,
      idempotency_key: idempotencyKey,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      project_id: input.project_id,
      expected_revision: input.expected_revision,
      current_revision: beforeProject.updated_at,
      before,
      after,
      receipt,
      rollback: { accepted_receipt_id: receipt.receipt_id, expected_current_revision: afterProject.updated_at },
    }, input, started, "project quarantine");
  }

  async rollbackDuplicateProjectQuarantine(
    input: ProjectQuarantineRollbackRequest,
  ): Promise<ProjectQuarantineResult> {
    return this.inTransaction("duplicate project quarantine rollback", (store) =>
      store.rollbackDuplicateProjectQuarantineInCurrentTransaction(input));
  }

  private async rollbackDuplicateProjectQuarantineInCurrentTransaction(
    input: ProjectQuarantineRollbackRequest,
  ): Promise<ProjectQuarantineResult> {
    const started = Date.now();
    try {
      assertCompleteStableProjectId(input.project_id);
      assertPositiveBounds(input);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    const row = await this.db.get<GuardedProjectMutationReceiptRow>(
      "SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1",
      [input.accepted_receipt_id],
    );
    if (!row) throw new NotFoundError(`accepted quarantine receipt not found: ${input.accepted_receipt_id}`);
    const accepted = rowToGuardedReceipt(row);
    if (accepted.outcome !== "accepted" || accepted.direction !== "forward" || accepted.target_id !== input.project_id) {
      throw new ValidationError("quarantine rollback requires a forward accepted receipt for the same project id");
    }
    if (accepted.post_revision !== input.expected_current_revision) {
      throw new ValidationError("quarantine rollback expected_current_revision must equal the accepted receipt post_revision");
    }
    const acceptedBefore = parseProjectQuarantineSnapshot(accepted.before, "accepted before");
    const acceptedAfter = parseProjectQuarantineSnapshot(accepted.after, "accepted after");
    const reqDigest = sha256(canonicalJson({
      route: "projects.duplicate-quarantine.rollback.v1",
      accepted_receipt_id: accepted.receipt_id,
      restore_project_digest: acceptedBefore.project_digest,
      restore_resource_link_collection_digest: acceptedBefore.resource_link_collection_digest,
      restore_workspace_location_collection_digest: acceptedBefore.workspace_location_collection_digest,
    }));
    const preDigest = preconditionDigest({
      project_id: input.project_id,
      expected_revision: input.expected_current_revision,
    });
    const idempotencyKey = deriveGuardedIdempotencyKey({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
    });
    const currentProject = await this.requireWorkspace(input.project_id);
    const currentLinks = await this.listProjectResourceLinks(input.project_id, input.resource_link_max_items);
    const currentLocations = await this.listWorkspaceLocationsBounded(
      input.project_id,
      input.workspace_location_max_items,
    );
    const current = projectQuarantineSnapshot(currentProject, currentLinks, currentLocations);
    const duplicate = await this.guardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    });
    if (duplicate) {
      const acceptedInverseAfter = parseProjectQuarantineSnapshot(duplicate.after, "accepted inverse after");
      if (
        currentProject.updated_at !== duplicate.post_revision
        || current.project_digest !== acceptedInverseAfter.project_digest
        || current.resource_link_collection_digest !== acceptedInverseAfter.resource_link_collection_digest
        || current.workspace_location_collection_digest !== acceptedInverseAfter.workspace_location_collection_digest
      ) {
        throw new ValidationError("quarantine rollback retry refuses drift after the accepted inverse");
      }
      const receipt = await this.duplicateGuardedReceipt(
        duplicate,
        currentProject,
        projectQuarantineSnapshotJson(current),
      );
      return withResponseControl({
        ok: true,
        dry_run: false,
        outcome: "duplicate_of_accepted" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_current_revision,
        current_revision: currentProject.updated_at,
        before: current,
        after: acceptedInverseAfter,
        receipt,
        rollback: null,
      }, input, started, "project quarantine rollback");
    }
    const priorInverse = await this.guardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      target_id: input.project_id,
    });
    if (priorInverse) {
      const receipt = await this.guardedTerminalNonacceptance({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "inverse",
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_current_revision,
        reason: "changed_request_or_precondition_for_step",
        before_snapshot: projectQuarantineSnapshotJson(current),
      });
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_current_revision,
        current_revision: currentProject.updated_at,
        before: current,
        after: null,
        receipt,
        rollback: null,
      }, input, started, "project quarantine rollback");
    }
    if (
      currentProject.updated_at !== input.expected_current_revision
      || current.project_digest !== acceptedAfter.project_digest
      || current.resource_link_collection_digest !== acceptedAfter.resource_link_collection_digest
      || current.workspace_location_collection_digest !== acceptedAfter.workspace_location_collection_digest
    ) {
      throw new ValidationError("quarantine rollback refuses current project, resource-link, or path-selector drift");
    }
    if (timedOut(started, input.time_budget_ms)) {
      throw new ValidationError("project quarantine rollback time budget exceeded before write");
    }
    const afterProject = await this.guardedConditionalUpdate(
      input.project_id,
      {
        ...restoreProjectPatch(acceptedBefore),
        agent_id: input.agent_id,
        source: input.source ?? "mcp",
        command: input.command,
      },
      input.expected_current_revision,
      { preserveExactSlug: true },
    );
    if (!afterProject) throw new ValidationError("quarantine rollback conditional update lost");
    await this.replaceProjectResourceLinksExact(input.project_id, acceptedBefore.resource_links);
    await this.replaceWorkspaceLocations(input.project_id, acceptedBefore.workspace_locations);
    const after = projectQuarantineSnapshot(afterProject, acceptedBefore.resource_links, acceptedBefore.workspace_locations);
    const normalizedAfter = {
      ...after.project,
      updated_at: acceptedBefore.project.updated_at,
    };
    if (
      projectDigest(normalizedAfter, after.workspace_locations) !== acceptedBefore.project_digest
      || after.resource_link_collection_digest !== acceptedBefore.resource_link_collection_digest
      || after.workspace_location_collection_digest !== acceptedBefore.workspace_location_collection_digest
    ) {
      throw new ValidationError("quarantine rollback exact inverse readback mismatch");
    }
    const receipt = await this.insertGuardedReceipt({
      receipt_id: buildReceiptId({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "inverse",
        idempotency_key: idempotencyKey,
        outcome: "accepted",
        target_id: input.project_id,
      }),
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      expected_revision: input.expected_current_revision,
      outcome: "accepted",
      reason: null,
      result_project_id: afterProject.id,
      duplicate_of_receipt_id: null,
      before: projectQuarantineSnapshotJson(current),
      after: projectQuarantineSnapshotJson(after),
      post_revision: afterProject.updated_at,
    });
    await this.recordEvent({
      workspace_id: input.project_id,
      agent_id: input.agent_id,
      event_type: PROJECT_QUARANTINE_ROLLBACK_EVENT,
      source: input.source ?? "mcp",
      command: input.command,
      before: projectQuarantineSnapshotJson(current),
      after: projectQuarantineSnapshotJson(after),
      metadata: {
        receipt_id: receipt.receipt_id,
        accepted_receipt_id: accepted.receipt_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
      },
    });
    return withResponseControl({
      ok: true,
      dry_run: false,
      outcome: "accepted" as const,
      idempotency_key: idempotencyKey,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      project_id: input.project_id,
      expected_revision: input.expected_current_revision,
      current_revision: currentProject.updated_at,
      before: current,
      after,
      receipt,
      rollback: null,
    }, input, started, "project quarantine rollback");
  }

  private async resourceLinkMigrationManifest(
    projectId: string,
    manifestId: string,
  ): Promise<ProjectResourceLinkMigrationManifestV1> {
    const row = await this.db.get<ProjectResourceLinkMigrationManifestRow>(
      `SELECT * FROM project_resource_link_migration_manifests
       WHERE manifest_id = $1 AND project_id = $2`,
      [manifestId, projectId],
    );
    if (!row) throw new NotFoundError(`project resource link migration manifest not found: ${manifestId}`);
    return rowToProjectResourceLinkMigrationManifest(row);
  }

  private async resourceLinkMigrationEvents(
    manifestId: string,
  ): Promise<ProjectResourceLinkMigrationEvent[]> {
    return (await this.boundedResourceLinkMigrationEvents(
      manifestId,
      PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
    )).events;
  }

  private async boundedResourceLinkMigrationEvents(
    manifestId: string,
    maxItems: number,
  ): Promise<{
    events: ProjectResourceLinkMigrationEvent[];
    complete: boolean;
    truncated: boolean;
  }> {
    if (!Number.isInteger(maxItems) || maxItems <= 0) {
      throw new ValidationError("project resource link migration event max_items must be a positive integer");
    }
    const rows = await this.db.many<Record<string, unknown> & QueryResultRow>(
      `SELECT event_id, manifest_id, transition_version, from_state, to_state,
              request_digest, precondition_digest, evidence_json, created_at
       FROM project_resource_link_migration_events
       WHERE manifest_id = $1
       ORDER BY transition_version ASC
       LIMIT $2`,
      [manifestId, maxItems + 1],
    );
    const truncated = rows.length > maxItems;
    return {
      events: rows.slice(0, maxItems).map((row) => ({
        event_id: String(row["event_id"]),
        manifest_id: String(row["manifest_id"]),
        transition_version: Number(row["transition_version"]),
        from_state: row["from_state"] === null ? null : row["from_state"] as ProjectResourceLinkMigrationEvent["from_state"],
        to_state: row["to_state"] as ProjectResourceLinkMigrationEvent["to_state"],
        request_digest: String(row["request_digest"]),
        precondition_digest: String(row["precondition_digest"]),
        evidence: parseJson(String(row["evidence_json"]), {}),
        created_at: String(row["created_at"]),
      })),
      complete: !truncated,
      truncated,
    };
  }

  private async insertResourceLinkMigrationEvent(event: ProjectResourceLinkMigrationEvent): Promise<void> {
    await this.db.execute(
      `INSERT INTO project_resource_link_migration_events (
        event_id, manifest_id, transition_version, from_state, to_state,
        request_digest, precondition_digest, evidence_json, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        event.event_id,
        event.manifest_id,
        event.transition_version,
        event.from_state,
        event.to_state,
        event.request_digest,
        event.precondition_digest,
        json(event.evidence),
        event.created_at,
      ],
    );
  }

  private async persistResourceLinkMigrationTransition(
    before: ProjectResourceLinkMigrationManifestV1,
    after: ProjectResourceLinkMigrationManifestV1,
    evidence: JsonObject,
  ): Promise<void> {
    const row = await this.db.get<{ manifest_id: string }>(
      `UPDATE project_resource_link_migration_manifests
       SET state = $1, links_json = $2, projects_forward_receipt_id = $3,
           projects_inverse_receipt_id = $4, projects_reference_proof_json = $5,
           last_verified_projects_revision = $6, last_verified_projects_digest = $7,
           transition_version = $8, updated_at = $9
       WHERE manifest_id = $10 AND project_id = $11 AND transition_version = $12
       RETURNING manifest_id`,
      [
        after.state,
        json(after.links),
        after.projects_forward_receipt_id,
        after.projects_inverse_receipt_id,
        after.projects_reference_proof === null ? null : json(after.projects_reference_proof),
        after.last_verified_projects_revision,
        after.last_verified_projects_digest,
        after.transition_version,
        after.updated_at,
        after.manifest_id,
        after.project_id,
        before.transition_version,
      ],
    );
    if (!row) throw new ValidationError("project resource link migration transition CAS lost");
    await this.insertResourceLinkMigrationEvent(migrationEvent(
      after.manifest_id,
      after.transition_version,
      before.state,
      after.state,
      sha256(canonicalJson(evidence)),
      sha256(canonicalJson({
        manifest_id: before.manifest_id,
        transition_version: before.transition_version,
        state: before.state,
      })),
      evidence,
      after.updated_at,
    ));
  }

  async planProjectResourceLinkMigration(
    input: ProjectResourceLinkMigrationPlanRequest,
  ): Promise<ProjectResourceLinkMigrationResult> {
    const started = Date.now();
    assertCompleteStableProjectId(input.project_id);
    const project = await this.requireWorkspace(input.project_id);
    if (workspaceRevision(project) !== input.expected_project_revision) {
      throw new ValidationError("project resource link migration plan refuses a stale project revision");
    }
    const maxItems = input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS;
    if (input.links.length > maxItems) {
      throw new ValidationError("project resource link migration plan exceeds max_items");
    }
    const ts = nowIso();
    const candidate = buildProjectResourceLinkMigrationPlan(input, ts);
    const existing = await this.db.get<ProjectResourceLinkMigrationManifestRow>(
      `SELECT * FROM project_resource_link_migration_manifests
       WHERE project_id = $1 AND operation_id = $2 AND step_id = $3`,
      [input.project_id, input.operation_id, input.step_id],
    );
    if (existing) {
      const manifest = rowToProjectResourceLinkMigrationManifest(existing);
      if (manifest.manifest_id !== candidate.manifest_id) {
        throw new ValidationError("project resource link migration step already has a different accepted manifest");
      }
      return withResponseControl({
        ok: true,
        outcome: "duplicate_of_accepted" as const,
        manifest,
        events: await this.resourceLinkMigrationEvents(manifest.manifest_id),
      }, input, started, "project resource link migration plan");
    }
    await this.inTransaction("project resource link migration plan", async (store) => {
      await store.db.execute(
        `INSERT INTO project_resource_link_migration_manifests (
          manifest_id, project_id, operation_id, step_id, state,
          expected_project_revision, desired_collection_digest, links_json,
          transition_version, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          candidate.manifest_id,
          candidate.project_id,
          candidate.operation_id,
          candidate.step_id,
          candidate.state,
          candidate.expected_project_revision,
          candidate.desired_collection_digest,
          json(candidate.links),
          candidate.transition_version,
          candidate.created_at,
          candidate.updated_at,
        ],
      );
      await store.insertResourceLinkMigrationEvent(migrationEvent(
        candidate.manifest_id,
        candidate.transition_version,
        null,
        "planned",
        sha256(canonicalJson(input.links)),
        sha256(canonicalJson({
          project_id: input.project_id,
          expected_project_revision: input.expected_project_revision,
        })),
        { link_ids: candidate.links.map((item) => item.link_id) },
        ts,
      ));
    });
    return withResponseControl({
      ok: true,
      outcome: "accepted" as const,
      manifest: candidate,
      events: await this.resourceLinkMigrationEvents(candidate.manifest_id),
    }, input, started, "project resource link migration plan");
  }

  async readProjectResourceLinkMigration(
    input: ProjectResourceLinkMigrationReadRequest,
  ): Promise<ProjectResourceLinkMigrationResult> {
    const started = Date.now();
    const manifest = await this.resourceLinkMigrationManifest(input.project_id, input.manifest_id);
    const boundedEvents = await this.boundedResourceLinkMigrationEvents(
      manifest.manifest_id,
      input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
    );
    return withResponseControl({
      ok: true,
      outcome: "accepted" as const,
      manifest,
      events: boundedEvents.events,
    }, input, started, "project resource link migration read", boundedEvents);
  }

  async advanceProjectResourceLinkMigration(
    input: ProjectResourceLinkMigrationAdvanceRequest,
  ): Promise<ProjectResourceLinkMigrationResult> {
    const started = Date.now();
    const before = await this.resourceLinkMigrationManifest(input.project_id, input.manifest_id);
    if (before.transition_version !== input.expected_transition_version) {
      throw new ValidationError("project resource link migration advance transition_version is stale");
    }
    if (before.state === input.next_state) {
      return withResponseControl({
        ok: true,
        outcome: "duplicate_of_accepted" as const,
        manifest: before,
        events: await this.resourceLinkMigrationEvents(before.manifest_id),
      }, input, started, "project resource link migration advance");
    }
    let producerEvidence = input.producer_evidence;
    let producerAttestation: ProjectResourceLinkProducerAttestation | undefined;
    if (input.next_state === "producer_applied") {
      try {
        producerEvidence = reconcileProjectResourceLinkProducerProof(before, input.producer_evidence, "forward");
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
    }
    if (input.next_state === "projects_applied") {
      if (!input.projects_forward_receipt_id) {
        throw new ValidationError("projects_applied requires a Projects forward receipt");
      }
      const row = await this.db.get<GuardedProjectMutationReceiptRow>(
        "SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = $1",
        [input.projects_forward_receipt_id],
      );
      if (!row) throw new NotFoundError("Projects forward receipt not found");
      const receipt = rowToGuardedReceipt(row);
      const snapshot = parseResourceLinkSnapshot(receipt.after, "Projects forward");
      const ids = new Set(snapshot.links.map((link) => link.id));
      if (
        receipt.outcome !== "accepted"
        || receipt.direction !== "forward"
        || receipt.target_id !== input.project_id
        || snapshot.collection_digest !== before.desired_collection_digest
        || before.links.some((item) => !ids.has(item.link_id))
      ) {
        throw new ValidationError("Projects forward receipt does not prove the manifest collection");
      }
    }
    if (input.next_state === "verified") {
      try {
        producerEvidence = reconcileProjectResourceLinkProducerProof(before, input.producer_evidence, "readback");
        const trustedProject = await this.getWorkspace(input.project_id);
        if (!trustedProject) throw new Error(`Project not found: ${input.project_id}`);
        producerAttestation = assertProjectResourceLinkProducerAttestation(
          before,
          "readback",
          producerEvidence,
          await this.producerEvidenceVerifier?.({
            manifest: before,
            trusted_project: projectResourceLinkProducerProjectSubject(trustedProject),
            phase: "readback",
            producer_evidence: producerEvidence,
            transition_evidence: input.evidence,
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
          }),
        );
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
      const read = await this.readProjectResourceLinks({
        project_id: input.project_id,
        max_items: Math.max(PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS, before.links.length),
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
      });
      if (
        read.collection_digest !== before.desired_collection_digest
        || input.last_verified_projects_revision !== read.current_revision
        || input.last_verified_projects_digest !== read.collection_digest
      ) {
        throw new ValidationError("verified transition requires a current complete Projects readback");
      }
    }
    const after = applyProjectResourceLinkMigrationTransition(before, input.next_state, nowIso(), {
      producer_evidence: producerEvidence,
      projects_forward_receipt_id: input.projects_forward_receipt_id,
      last_verified_projects_revision: input.last_verified_projects_revision,
      last_verified_projects_digest: input.last_verified_projects_digest,
    });
    const transitionEvidence = producerAttestation
      ? migrationEvidenceWithProducerAttestation(input.evidence, producerAttestation)
      : input.evidence;
    await this.inTransaction("project resource link migration advance", (store) =>
      store.persistResourceLinkMigrationTransition(before, after, transitionEvidence));
    return withResponseControl({
      ok: true,
      outcome: "accepted" as const,
      manifest: after,
      events: await this.resourceLinkMigrationEvents(after.manifest_id),
    }, input, started, "project resource link migration advance");
  }

  async rollbackProjectResourceLinkMigration(
    input: ProjectResourceLinkMigrationRollbackRequest,
  ): Promise<ProjectResourceLinkMigrationResult> {
    const started = Date.now();
    let before = await this.resourceLinkMigrationManifest(input.project_id, input.manifest_id);
    if (["rolled_back", "retained_target"].includes(before.state)) {
      return withResponseControl({
        ok: true,
        outcome: "duplicate_of_accepted" as const,
        manifest: before,
        events: await this.resourceLinkMigrationEvents(before.manifest_id),
      }, input, started, "project resource link migration rollback");
    }
    if (before.transition_version !== input.expected_transition_version) {
      throw new ValidationError("project resource link migration rollback transition_version is stale");
    }
    let proof = before.projects_reference_proof;
    let inverseReceiptId = before.projects_inverse_receipt_id;
    const establishingProjectsReferenceProof = proof === null;
    if (establishingProjectsReferenceProof && input.producer_outcome !== "pending") {
      throw new ValidationError(
        "first migration rollback call must use producer_outcome=pending so Projects reference proof is persisted before producer compensation",
      );
    }
    const linkIds = before.links.map((item) => item.link_id);
    if (!proof) {
      if (before.projects_forward_receipt_id) {
        const forwardReceipt = await this.requireForwardProjectResourceLinkReceipt(
          before.projects_forward_receipt_id,
          input.project_id,
        );
        const inverse = await this.rollbackProjectResourceLinks({
          project_id: input.project_id,
          operation_id: `${before.operation_id}:migration-rollback`,
          step_id: `${before.step_id}:projects-reference`,
          accepted_receipt_id: before.projects_forward_receipt_id,
          expected_current_revision: forwardReceipt.post_revision!,
          max_items: input.max_items,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
          agent_id: input.agent_id,
          source: input.source,
          command: input.command,
        });
        const verified = await this.readProjectResourceLinks({
          project_id: input.project_id,
          max_items: input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
        });
        if (verified.links.some((link) => linkIds.includes(link.id))) {
          throw new ValidationError("Projects inverse did not remove every manifest reference");
        }
        if (!["accepted", "duplicate_of_accepted"].includes(inverse.outcome)) {
          throw new ValidationError("Projects inverse was not accepted");
        }
        inverseReceiptId = inverse.receipt?.duplicate_of_receipt_id
          ?? inverse.receipt?.receipt_id
          ?? null;
        if (!inverseReceiptId) throw new ValidationError("Projects inverse did not return an accepted receipt");
        proof = {
          kind: "accepted_inverse",
          forward_receipt_id: before.projects_forward_receipt_id,
          inverse_receipt_id: inverseReceiptId,
          verified_revision: verified.current_revision,
          collection_digest: verified.collection_digest,
          link_ids_checked: linkIds,
          complete: true,
          truncated: false,
          request_digest: inverse.request_digest,
          precondition_digest: inverse.precondition_digest,
        };
      } else {
        const current = await this.readProjectResourceLinks({
          project_id: input.project_id,
          max_items: input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
        });
        if (current.links.some((link) => linkIds.includes(link.id))) {
          throw new ValidationError("ambiguous Projects state: manifest links exist without a matching accepted forward receipt");
        }
        proof = {
          kind: "no_projects_write",
          verified_revision: current.current_revision,
          collection_digest: current.collection_digest,
          link_ids_checked: linkIds,
          complete: true,
          truncated: false,
          request_digest: sha256(canonicalJson({ manifest_id: before.manifest_id, link_ids: linkIds })),
          precondition_digest: sha256(canonicalJson({
            revision: current.current_revision,
            collection_digest: current.collection_digest,
          })),
        };
      }
    }
    if (before.state !== "rollback_in_progress") {
      const inProgress = applyProjectResourceLinkMigrationTransition(before, "rollback_in_progress", nowIso(), {
        projects_inverse_receipt_id: inverseReceiptId,
        projects_reference_proof: proof,
        last_verified_projects_revision: proof.verified_revision,
        last_verified_projects_digest: proof.collection_digest,
      });
      await this.inTransaction("project resource link migration rollback proof", (store) =>
        store.persistResourceLinkMigrationTransition(before, inProgress, input.evidence));
      before = inProgress;
    }
    if (input.producer_outcome === "pending") {
      return withResponseControl({
        ok: true,
        outcome: "accepted" as const,
        manifest: before,
        events: await this.resourceLinkMigrationEvents(before.manifest_id),
      }, input, started, "project resource link migration rollback");
    }
    const nextState = input.producer_outcome === "complete"
      ? "rolled_back"
      : input.producer_outcome === "retained_target"
        ? "retained_target"
        : "failed_reconcilable";
    let terminalProducerEvidence = input.producer_evidence;
    let producerAttestation: ProjectResourceLinkProducerAttestation | undefined;
    if (nextState === "rolled_back" || nextState === "retained_target") {
      try {
        terminalProducerEvidence = reconcileProjectResourceLinkProducerProof(
          before,
          input.producer_evidence,
          "inverse",
          nextState === "rolled_back" ? "complete" : "retained_target",
        );
        const phase = nextState === "rolled_back" ? "inverse_complete" : "inverse_retained_target";
        const trustedProject = await this.getWorkspace(input.project_id);
        if (!trustedProject) throw new Error(`Project not found: ${input.project_id}`);
        producerAttestation = assertProjectResourceLinkProducerAttestation(
          before,
          phase,
          terminalProducerEvidence,
          await this.producerEvidenceVerifier?.({
            manifest: before,
            trusted_project: projectResourceLinkProducerProjectSubject(trustedProject),
            phase,
            producer_evidence: terminalProducerEvidence,
            transition_evidence: input.evidence,
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
          }),
        );
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
    }
    const after = applyProjectResourceLinkMigrationTransition(before, nextState, nowIso(), {
      producer_evidence: terminalProducerEvidence,
      projects_inverse_receipt_id: inverseReceiptId,
      projects_reference_proof: proof,
      last_verified_projects_revision: proof.verified_revision,
      last_verified_projects_digest: proof.collection_digest,
    });
    const transitionEvidence = producerAttestation
      ? migrationEvidenceWithProducerAttestation(input.evidence, producerAttestation)
      : input.evidence;
    await this.inTransaction("project resource link migration rollback", (store) =>
      store.persistResourceLinkMigrationTransition(before, after, transitionEvidence));
    return withResponseControl({
      ok: true,
      outcome: "accepted" as const,
      manifest: after,
      events: await this.resourceLinkMigrationEvents(after.manifest_id),
    }, input, started, "project resource link migration rollback");
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
    const normalizedPatch: UpdateWorkspaceInput = input.patch.metadata === undefined
      ? input.patch
      : {
          ...input.patch,
          metadata: normalizeProjectMetadata(input.patch.metadata, before.metadata),
        };
    if (input.patch.integrations !== undefined) {
      assertHostedProjectResourceLinkIntegrationMutation(
        before.integrations,
        input.patch.integrations,
        await this.listProjectResourceLinks(input.project_id, PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS),
      );
    }
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
      const after = { ...before, ...normalizedPatch } as Workspace;
      const result = { ok: true, dry_run: true, outcome: "planned" as const, idempotency_key: idempotencyKey, request_digest: reqDigest, precondition_digest: preDigest, project_id: input.project_id, expected_revision: input.expected_revision, current_revision: currentRevision, before, after, receipt: null };
      return withResponseControl(result, input, started);
    }
    if (timedOut(started, input.time_budget_ms)) throw new ValidationError("guarded mutation time budget exceeded before write");
    const after = await this.guardedConditionalUpdate(input.project_id, {
      ...normalizedPatch,
      agent_id: input.agent_id ?? input.patch.agent_id,
      source: input.source ?? input.patch.source ?? "mcp",
      command: input.command ?? input.patch.command,
    }, input.expected_revision);
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
