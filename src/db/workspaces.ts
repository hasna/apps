import type { Database, SQLQueryBindings } from "bun:sqlite";
import { customAlphabet } from "nanoid";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getDatabase, now, uuid } from "./database.js";
import { assertProjectWorkspaceId, projectWorkspaceStorePath } from "../lib/project-store-paths.js";
import { normalizeProjectMetadata } from "../lib/project-management.js";
import { redactProjectText, redactProjectValue } from "../lib/redaction.js";
import {
  assertCompleteStableProjectId,
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
  applyProjectResourceLinkMigrationTransition,
  assertProjectResourceLinkProducerAttestation,
  buildProjectResourceLinkMigrationPlan,
  migrationEvent,
  migrationEvidenceWithProducerAttestation,
  projectResourceLinkProducerProjectSubject,
  reconcileProjectResourceLinkProducerProof,
  rowToProjectResourceLinkMigrationManifest,
  type ProjectResourceLinkProducerAttestation,
  type ProjectResourceLinkProducerEvidenceVerifier,
} from "../lib/project-resource-link-migrations.js";
import {
  PROJECT_QUARANTINE_EVENT,
  PROJECT_QUARANTINE_ROLLBACK_EVENT,
  assertProjectQuarantinePostimage,
  assertProjectQuarantinePreconditions,
  normalizedExpectedResourceLinkIds,
  parseProjectQuarantineSnapshot,
  projectDigest,
  projectQuarantinePatch,
  projectQuarantinePreconditionDigest,
  projectQuarantineRequestDigest,
  projectQuarantineSnapshot,
  projectQuarantineSnapshotJson,
  restoreProjectPatch,
} from "../lib/project-quarantine.js";
import type {
  Agent,
  AgentRow,
  AgentRun,
  AgentRunRow,
  CreateAgentInput,
  CreateRecipeInput,
  CreateRootInput,
  CreateTmuxProfileInput,
  CreateTmuxProfileWindowInput,
  CreateWorkspaceInput,
  EventSource,
  GuardedProjectMutationReceipt,
  GuardedProjectMutationReceiptLookupInput,
  GuardedProjectMutationReceiptRow,
  GuardedProjectMutationRequest,
  GuardedProjectMutationResult,
  GuardedProjectMutationRollbackRequest,
  JsonObject,
  Machine,
  MachineRow,
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
  ProjectQuarantineRequest,
  ProjectQuarantineReadRequest,
  ProjectQuarantineReadResult,
  ProjectQuarantineResult,
  ProjectQuarantineRollbackRequest,
  Recipe,
  RecipeRow,
  RecordWorkspaceEventInput,
  Root,
  RootRow,
  TmuxProfile,
  TmuxProfileRow,
  TmuxProfileWindow,
  TmuxProfileWindowRow,
  UpdateWorkspaceInput,
  UpdateRootInput,
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
} from "../types/workspace.js";

const nanoid = customAlphabet(`0123456789${"abcdefghijklmnopqrstuvwxyz"}`, 12);

export function generateWorkspaceId(): string { return `wks_${nanoid()}`; }
export function generateRootId(): string { return `root_${nanoid()}`; }
export function generateRecipeId(): string { return `rcp_${nanoid()}`; }
export function generateAgentId(): string { return `agt_${nanoid()}`; }
export function generateWorkspaceEventId(): string { return `evt_${nanoid()}`; }
export function generateAgentRunId(): string { return `run_${nanoid()}`; }
export function generateLocationId(): string { return `loc_${nanoid()}`; }
export function generateTmuxProfileId(): string { return `tmp_${nanoid()}`; }
export function generateTmuxProfileWindowId(): string { return `tmw_${nanoid()}`; }
export function generateWorkspaceLockId(): string { return `lock_${nanoid()}`; }

export function workspaceSlugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function ensureUniqueSlug(table: string, base: string, db: Database, excludeId?: string): string {
  const safeBase = base || "workspace";
  let candidate = safeBase;
  let suffix = 1;
  while (true) {
    const row = db
      .query(`SELECT id FROM ${table} WHERE slug = ?`)
      .get(candidate) as { id: string } | null;
    if (!row || row.id === excludeId) return candidate;
    suffix++;
    candidate = `${safeBase}-${suffix}`;
  }
}

function rowToRoot(row: RootRow): Root {
  return {
    ...row,
    tags: parseJson<string[]>(row.tags, []),
    default_kind: row.default_kind as Root["default_kind"],
    repo_visibility: row.repo_visibility as Root["repo_visibility"],
    allowed_recipes: parseJson<string[]>(row.allowed_recipes, []),
    allowed_agents: parseJson<string[]>(row.allowed_agents, []),
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToAgent(row: AgentRow): Agent {
  return {
    ...row,
    kind: row.kind as Agent["kind"],
    permissions: parseJson<string[]>(row.permissions, []),
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToMachine(row: MachineRow): Machine {
  return {
    ...row,
    role: row.role as Machine["role"],
  };
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    ...row,
    kind: row.kind as Recipe["kind"],
    steps: redactProjectValue(parseJson<JsonObject[]>(row.steps, [])),
    variables: redactProjectValue(parseJson<JsonObject>(row.variables, {})),
    default_tags: parseJson<string[]>(row.default_tags, []),
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...row,
    kind: row.kind as WorkspaceKind,
    status: row.status as WorkspaceStatus,
    tags: parseJson<string[]>(row.tags, []),
    integrations: redactProjectValue(parseJson<WorkspaceIntegrations>(row.integrations, {})),
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToLocation(row: WorkspaceLocationRow): WorkspaceLocation {
  return {
    ...row,
    is_primary: row.is_primary === 1,
    exists_at_create: row.exists_at_create === 1,
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToWorkspaceAgentAssignment(row: WorkspaceAgentAssignmentRow, db: Database): WorkspaceAgentAssignment {
  return {
    ...row,
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
    agent: getAgent(row.agent_id, db),
  };
}

function rowToEvent(row: WorkspaceEventRow): WorkspaceEvent {
  return {
    ...row,
    source: row.source as WorkspaceEvent["source"],
    prompt: row.prompt ? redactProjectText(row.prompt) : null,
    command: row.command ? redactProjectText(row.command) : null,
    before_json: redactProjectValue(parseJson<JsonObject | null>(row.before_json, null)),
    after_json: redactProjectValue(parseJson<JsonObject | null>(row.after_json, null)),
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    ...row,
    status: row.status as AgentRun["status"],
    prompt: redactProjectText(row.prompt),
    plan_json: redactProjectValue(parseJson<JsonObject | null>(row.plan_json, null)),
    tool_calls_json: redactProjectValue(parseJson<JsonObject[]>(row.tool_calls_json, [])),
    result_json: redactProjectValue(parseJson<JsonObject | null>(row.result_json, null)),
    error: row.error ? redactProjectText(row.error) : null,
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToTmuxProfile(row: TmuxProfileRow): TmuxProfile {
  return {
    ...row,
    attach: row.attach === 1,
    metadata: redactProjectValue(parseJson<JsonObject>(row.metadata, {})),
  };
}

function rowToTmuxProfileWindow(row: TmuxProfileWindowRow): TmuxProfileWindow {
  return {
    ...row,
    detached: row.detached === 1,
    env: redactProjectValue(parseJson<Record<string, string>>(row.env, {})),
    revive: row.revive === 1,
  };
}

function rowToWorkspaceLock(row: WorkspaceLockRow): WorkspaceLock {
  return row;
}

function parseWorkspaceRevision(revision: string): number {
  return Date.parse(revision.replace(" ", "T") + "Z");
}

function workspaceRevisionFromMs(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

function nextWorkspaceRevision(current: string): string {
  const nowRevision = now();
  const currentMs = parseWorkspaceRevision(current);
  const nowMs = parseWorkspaceRevision(nowRevision);
  if (Number.isFinite(currentMs) && Number.isFinite(nowMs) && nowMs <= currentMs) {
    return workspaceRevisionFromMs(currentMs + 1);
  }
  if (nowRevision !== current) return nowRevision;
  if (Number.isFinite(currentMs)) return workspaceRevisionFromMs(currentMs + 1);
  return `${current}.1`;
}

export function renderTemplate(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
}

export function createRoot(input: CreateRootInput, db?: Database): Root {
  const d = db || getDatabase();
  const id = generateRootId();
  const ts = now();
  const slug = ensureUniqueSlug("roots", input.slug ?? workspaceSlugify(input.name), d);
  const basePath = resolve(input.base_path);

  d.run(
    `INSERT INTO roots (
      id, slug, name, base_path, tags, default_kind, default_recipe_id,
      default_tmux_profile_id, github_org, repo_visibility, path_template,
      name_template, allowed_recipes, allowed_agents, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      input.name,
      basePath,
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

  return getRoot(id, d)!;
}

export function getRoot(id: string, db?: Database): Root | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM roots WHERE id = ?").get(id) as RootRow | null;
  return row ? rowToRoot(row) : null;
}

export function getRootBySlug(slug: string, db?: Database): Root | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM roots WHERE slug = ?").get(slug) as RootRow | null;
  return row ? rowToRoot(row) : null;
}

export function listRoots(db?: Database): Root[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM roots ORDER BY slug ASC").all() as RootRow[]).map(rowToRoot);
}

export function updateRoot(id: string, input: UpdateRootInput, db?: Database): Root {
  const d = db || getDatabase();
  const before = getRoot(id, d);
  if (!before) throw new Error(`Root not found: ${id}`);
  const updates: string[] = [];
  const params: SQLQueryBindings[] = [];
  const set = (column: string, value: SQLQueryBindings) => {
    updates.push(`${column} = ?`);
    params.push(value);
  };

  if (input.slug !== undefined) set("slug", ensureUniqueSlug("roots", workspaceSlugify(input.slug), d, id));
  if (input.name !== undefined) set("name", input.name);
  if (input.base_path !== undefined) set("base_path", resolve(input.base_path));
  if (input.tags !== undefined) set("tags", json(normalizeList(input.tags)));
  if (input.default_kind !== undefined) set("default_kind", input.default_kind);
  if (input.default_recipe_id !== undefined) set("default_recipe_id", input.default_recipe_id);
  if (input.default_tmux_profile_id !== undefined) set("default_tmux_profile_id", input.default_tmux_profile_id);
  if (input.github_org !== undefined) set("github_org", input.github_org);
  if (input.repo_visibility !== undefined) set("repo_visibility", input.repo_visibility);
  if (input.path_template !== undefined) set("path_template", input.path_template);
  if (input.name_template !== undefined) set("name_template", input.name_template);
  if (input.allowed_recipes !== undefined) set("allowed_recipes", json(normalizeList(input.allowed_recipes)));
  if (input.allowed_agents !== undefined) set("allowed_agents", json(normalizeList(input.allowed_agents)));
  if (input.metadata !== undefined) set("metadata", json(input.metadata));

  if (!updates.length) return before;
  set("updated_at", now());
  params.push(id);
  d.run(`UPDATE roots SET ${updates.join(", ")} WHERE id = ?`, params);
  return getRoot(id, d)!;
}

export function deleteRoot(id: string, options: { detachWorkspaces?: boolean } = {}, db?: Database): { root: Root; detached_workspaces: number } {
  const d = db || getDatabase();
  const root = getRoot(id, d);
  if (!root) throw new Error(`Root not found: ${id}`);
  const count = (d.query("SELECT COUNT(*) as n FROM workspaces WHERE root_id = ?").get(id) as { n: number }).n;
  if (count > 0 && !options.detachWorkspaces) {
    throw new Error(`Root ${root.slug} is used by ${count} workspace(s); pass detachWorkspaces to clear those references before deletion.`);
  }
  if (count > 0) {
    d.run("UPDATE workspaces SET root_id = NULL, updated_at = ? WHERE root_id = ?", [now(), id]);
  }
  d.run("DELETE FROM roots WHERE id = ?", [id]);
  return { root, detached_workspaces: count };
}

export interface RootMatchInput {
  path?: string;
  tags?: string[];
  kind?: WorkspaceKind;
  github_org?: string;
}

export interface RootMatchResult {
  root: Root;
  score: number;
  reasons: string[];
}

/**
 * Pure root scoring over an in-memory list — no db access. Shared by the local
 * `scoreRoots` (which reads sqlite) and the api transport (which scores roots
 * fetched over HTTP), so matching behaves identically in both modes.
 */
export function rankRoots(roots: Root[], input: RootMatchInput = {}): RootMatchResult[] {
  const absPath = input.path ? resolve(input.path) : undefined;
  const tags = new Set(input.tags ?? []);
  return roots
    .map((root) => {
      let score = 0;
      const reasons: string[] = [];
      if (absPath && (absPath === root.base_path || absPath.startsWith(`${root.base_path}/`))) {
        score += 1000 + root.base_path.length;
        reasons.push("path-prefix");
      }
      if (input.kind && root.default_kind === input.kind) {
        score += 50;
        reasons.push("kind");
      }
      if (input.github_org && root.github_org === input.github_org) {
        score += 40;
        reasons.push("github-org");
      }
      const tagMatches = root.tags.filter((tag) => tags.has(tag));
      if (tagMatches.length > 0) {
        score += tagMatches.length * 10;
        reasons.push(`tags:${tagMatches.join(",")}`);
      }
      return { root, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.root.slug.localeCompare(b.root.slug));
}

export function scoreRoots(input: RootMatchInput = {}, db?: Database): RootMatchResult[] {
  const absPath = input.path ? resolve(input.path) : undefined;
  const tags = new Set(input.tags ?? []);
  return listRoots(db)
    .map((root) => {
      let score = 0;
      const reasons: string[] = [];
      if (absPath && (absPath === root.base_path || absPath.startsWith(`${root.base_path}/`))) {
        score += 1000 + root.base_path.length;
        reasons.push("path-prefix");
      }
      if (input.kind && root.default_kind === input.kind) {
        score += 50;
        reasons.push("kind");
      }
      if (input.github_org && root.github_org === input.github_org) {
        score += 40;
        reasons.push("github-org");
      }
      const tagMatches = root.tags.filter((tag) => tags.has(tag));
      if (tagMatches.length > 0) {
        score += tagMatches.length * 10;
        reasons.push(`tags:${tagMatches.join(",")}`);
      }
      return { root, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.root.slug.localeCompare(b.root.slug));
}

export function matchRoot(input: RootMatchInput, db?: Database): Root | null {
  return scoreRoots(input, db)[0]?.root ?? null;
}

export function matchRootForPath(path: string, db?: Database): Root | null {
  return matchRoot({ path }, db);
}

export function createAgent(input: CreateAgentInput, db?: Database): Agent {
  const d = db || getDatabase();
  const id = generateAgentId();
  const ts = now();
  const slug = ensureUniqueSlug("agents", input.slug ?? workspaceSlugify(input.name), d);

  d.run(
    `INSERT INTO agents (
      id, slug, name, kind, provider, model, role, permissions, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      input.name,
      input.kind,
      input.provider ?? null,
      input.model ?? null,
      input.role ?? null,
      json(normalizeList(input.permissions)),
      json(input.metadata ?? {}),
      ts,
      ts,
    ],
  );

  return getAgent(id, d)!;
}

export function getAgent(id: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function getAgentBySlug(slug: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM agents WHERE slug = ?").get(slug) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function listAgents(db?: Database): Agent[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM agents ORDER BY slug ASC").all() as AgentRow[]).map(rowToAgent);
}

export function getMachine(slug: string, db?: Database): Machine | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE slug = ?").get(slug) as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

export function listMachines(db?: Database): Machine[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM machines ORDER BY slug ASC").all() as MachineRow[]).map(rowToMachine);
}

export function mergeAgentPermissions(agentId: string, permissions: string[], db?: Database): Agent {
  const d = db || getDatabase();
  const agent = getAgent(agentId, d);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const merged = normalizeList([...agent.permissions, ...permissions]);
  if (merged.length !== agent.permissions.length) {
    d.run("UPDATE agents SET permissions = ?, updated_at = ? WHERE id = ?", [json(merged), now(), agent.id]);
  }
  return getAgent(agent.id, d)!;
}

export function ensureCliAgent(db?: Database): Agent {
  const d = db || getDatabase();
  const permissions = ["workspace:create", "workspace:update", "workspace:delete", "workspace:import", "github:publish", "tmux:apply", "doctor:fix"];
  const existing = getAgentBySlug("cli", d);
  if (existing) {
    return mergeAgentPermissions(existing.id, permissions, d);
  }
  return createAgent({
    slug: "cli",
    name: "CLI",
    kind: "cli",
    role: "automation",
    permissions,
  }, d);
}

export function assertAgentPermission(agentId: string | undefined, permission: string, db?: Database): void {
  if (!agentId) return;
  const agent = getAgent(agentId, db);
  if (!agent || agent.permissions.length === 0) return;
  if (agent.permissions.includes("*") || agent.permissions.includes(permission)) return;
  throw new Error(`Agent ${agent.slug} does not have permission ${permission}`);
}

function isAllowedReference(allowed: string[], id: string | null | undefined, slug: string | null | undefined): boolean {
  if (allowed.length === 0) return true;
  return Boolean((id && allowed.includes(id)) || (slug && allowed.includes(slug)));
}

function assertRootWorkspacePolicy(root: Root | null, recipe: Recipe | null, agentId: string | undefined, db: Database): void {
  if (!root) return;
  if (!isAllowedReference(root.allowed_recipes, recipe?.id, recipe?.slug)) {
    throw new Error(`Root ${root.slug} does not allow recipe ${recipe?.slug ?? "none"}`);
  }
  if (root.allowed_agents.length > 0) {
    const agent = agentId ? getAgent(agentId, db) : null;
    if (!isAllowedReference(root.allowed_agents, agent?.id, agent?.slug)) {
      throw new Error(`Root ${root.slug} does not allow agent ${agent?.slug ?? agentId ?? "unknown"}`);
    }
  }
}

export function createRecipe(input: CreateRecipeInput, db?: Database): Recipe {
  const d = db || getDatabase();
  const id = generateRecipeId();
  const ts = now();
  const slug = ensureUniqueSlug("recipes", input.slug ?? workspaceSlugify(input.name), d);

  d.run(
    `INSERT INTO recipes (
      id, slug, name, description, kind, version, steps, variables, default_tags,
      default_tmux_profile_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  return getRecipe(id, d)!;
}

export function getRecipe(id: string, db?: Database): Recipe | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM recipes WHERE id = ?").get(id) as RecipeRow | null;
  return row ? rowToRecipe(row) : null;
}

export function getRecipeBySlug(slug: string, db?: Database): Recipe | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM recipes WHERE slug = ?").get(slug) as RecipeRow | null;
  return row ? rowToRecipe(row) : null;
}

export function listRecipes(db?: Database): Recipe[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM recipes ORDER BY slug ASC").all() as RecipeRow[]).map(rowToRecipe);
}

export function createTmuxProfile(input: CreateTmuxProfileInput, db?: Database): TmuxProfile {
  const d = db || getDatabase();
  const id = generateTmuxProfileId();
  const ts = now();
  const slug = ensureUniqueSlug("tmux_profiles", input.slug ?? workspaceSlugify(input.name), d);

  d.run(
    `INSERT INTO tmux_profiles (
      id, slug, name, description, session_template, attach, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      input.name,
      input.description ?? null,
      input.session_template ?? "{slug}",
      input.attach ? 1 : 0,
      json(input.metadata ?? {}),
      ts,
      ts,
    ],
  );

  for (const window of input.windows ?? []) {
    addTmuxProfileWindow({ ...window, profile_id: id }, d);
  }

  return getTmuxProfile(id, d)!;
}

export function getTmuxProfile(id: string, db?: Database): TmuxProfile | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM tmux_profiles WHERE id = ?").get(id) as TmuxProfileRow | null;
  return row ? rowToTmuxProfile(row) : null;
}

export function getTmuxProfileBySlug(slug: string, db?: Database): TmuxProfile | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM tmux_profiles WHERE slug = ?").get(slug) as TmuxProfileRow | null;
  return row ? rowToTmuxProfile(row) : null;
}

export function resolveTmuxProfile(idOrSlug: string, db?: Database): TmuxProfile | null {
  const d = db || getDatabase();
  return getTmuxProfile(idOrSlug, d) ?? getTmuxProfileBySlug(idOrSlug, d);
}

export function listTmuxProfiles(db?: Database): TmuxProfile[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM tmux_profiles ORDER BY slug ASC").all() as TmuxProfileRow[]).map(rowToTmuxProfile);
}

export function addTmuxProfileWindow(input: CreateTmuxProfileWindowInput & { profile_id: string }, db?: Database): TmuxProfileWindow {
  const d = db || getDatabase();
  const profile = getTmuxProfile(input.profile_id, d);
  if (!profile) throw new Error(`Tmux profile not found: ${input.profile_id}`);
  const id = generateTmuxProfileWindowId();
  d.run(
    `INSERT INTO tmux_profile_windows (
      id, profile_id, window_name_template, path_template, command, window_index,
      detached, env, revive, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, window_name_template) DO UPDATE SET
      path_template = excluded.path_template,
      command = excluded.command,
      window_index = excluded.window_index,
      detached = excluded.detached,
      env = excluded.env,
      revive = excluded.revive`,
    [
      id,
      input.profile_id,
      input.window_name_template,
      input.path_template ?? null,
      input.command ?? null,
      input.window_index ?? null,
      input.detached === false ? 0 : 1,
      json(input.env ?? {}),
      input.revive === false ? 0 : 1,
      now(),
    ],
  );
  const row = d
    .query("SELECT * FROM tmux_profile_windows WHERE profile_id = ? AND window_name_template = ?")
    .get(input.profile_id, input.window_name_template) as TmuxProfileWindowRow | null;
  if (!row) throw new Error(`Tmux profile window was not written: ${input.window_name_template}`);
  return rowToTmuxProfileWindow(row);
}

export function listTmuxProfileWindows(profileId: string, db?: Database): TmuxProfileWindow[] {
  const d = db || getDatabase();
  return (d
    .query("SELECT * FROM tmux_profile_windows WHERE profile_id = ? ORDER BY COALESCE(window_index, 9999), window_name_template ASC")
    .all(profileId) as TmuxProfileWindowRow[]).map(rowToTmuxProfileWindow);
}

function machineId(): string {
  return hostname();
}

function hasOwn(metadata: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, key);
}

function canonicalMachineFromMetadata(metadata: JsonObject): string | null | undefined {
  if (!hasOwn(metadata, "canonical_machine")) return undefined;
  const value = metadata["canonical_machine"];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("canonical_machine metadata must be a machine slug string");
  }
  return value.trim() || null;
}

function withoutCanonicalMachineMetadata(metadata: JsonObject): JsonObject {
  const copy = { ...metadata };
  delete copy["canonical_machine"];
  return copy;
}

function deriveWorkspacePath(input: CreateWorkspaceInput, root: Root | null, slug: string, id: string, kind: WorkspaceKind): string | null {
  if (input.primary_path) return resolve(input.primary_path);
  if (!root && kind !== "remote-only") return projectWorkspaceStorePath(id);
  if (!root) return null;
  const rendered = renderTemplate(root.path_template || root.name_template || "{slug}", {
    slug,
    name: input.name,
    kind,
    root: root.slug,
    org: root.github_org,
  });
  return isAbsolute(rendered) ? resolve(rendered) : resolve(join(root.base_path, rendered));
}

export function createWorkspace(input: CreateWorkspaceInput, db?: Database): Workspace {
  const d = db || getDatabase();
  const id = input.id ? assertProjectWorkspaceId(input.id) : generateWorkspaceId();
  const ts = now();
  const requestedSlug = input.slug ?? workspaceSlugify(input.name);
  const slugBase = input.require_exact_identity
    ? workspaceSlugify(requestedSlug)
    : requestedSlug;
  const slug = input.require_exact_identity
    ? slugBase
    : ensureUniqueSlug("workspaces", slugBase, d);
  const root = input.root_id ? getRoot(input.root_id, d) : null;
  if (input.root_id && !root) throw new Error(`Root not found: ${input.root_id}`);
  const recipe = input.recipe_id ? getRecipe(input.recipe_id, d) : null;
  if (input.recipe_id && !recipe) throw new Error(`Recipe not found: ${input.recipe_id}`);
  assertAgentPermission(input.agent_id, "workspace:create", d);
  assertRootWorkspacePolicy(root, recipe, input.agent_id, d);

  const kind = input.kind ?? recipe?.kind ?? root?.default_kind ?? "generic";
  const primaryPath = deriveWorkspacePath(input, root, slug, id, kind);
  const tags = normalizeList([
    ...(root?.tags ?? []),
    ...(recipe?.default_tags ?? []),
    ...(input.tags ?? []),
  ]);
  const metadata = normalizeProjectMetadata(input.metadata);

  d.run(
    `INSERT INTO workspaces (
      id, slug, name, description, kind, status, root_id, recipe_id, primary_path,
      git_remote, s3_bucket, s3_prefix, tags, integrations, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      json(metadata),
      ts,
      ts,
    ],
  );

  if (primaryPath) {
    addWorkspaceLocation({
      workspace_id: id,
      path: primaryPath,
      label: "main",
      kind: input.git_remote && !existsSync(primaryPath) ? "remote-intended" : "local",
      is_primary: true,
      metadata: {},
    }, d);
  }

  if (input.agent_id) {
    assignAgentToWorkspace(id, input.agent_id, "creator", input.agent_id, { source: input.source ?? "cli" }, d);
  }

  const workspace = getWorkspace(id, d)!;
  recordWorkspaceEvent({
    workspace_id: id,
    agent_id: input.agent_id,
    event_type: "created",
    source: input.source ?? "cli",
    prompt: input.prompt,
    command: input.command,
    after: workspace as unknown as JsonObject,
    metadata: { root_slug: root?.slug, recipe_slug: recipe?.slug },
  }, d);

  return workspace;
}

export function getWorkspace(id: string, db?: Database): Workspace | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | null;
  return row ? rowToWorkspace(row) : null;
}

export function getWorkspaceBySlug(slug: string, db?: Database): Workspace | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM workspaces WHERE slug = ?").get(slug) as WorkspaceRow | null;
  return row ? rowToWorkspace(row) : null;
}

export function getWorkspaceByPath(path: string, db?: Database): Workspace | null {
  return listWorkspacesByPath(path, db)[0] ?? null;
}

export function listWorkspacesByPath(path: string, db?: Database): Workspace[] {
  const d = db || getDatabase();
  const absPath = resolve(path);
  const rows = d
    .query(`
      SELECT DISTINCT w.*
      FROM workspaces w
      LEFT JOIN workspace_locations loc ON loc.workspace_id = w.id
      WHERE w.primary_path = ? OR loc.path = ?
      ORDER BY
        CASE WHEN w.primary_path = ? THEN 0 ELSE 1 END,
        w.name ASC
    `)
    .all(absPath, absPath, absPath) as WorkspaceRow[];
  return rows.map(rowToWorkspace);
}

export interface WorkspaceFilter {
  status?: WorkspaceStatus;
  kind?: WorkspaceKind;
  root_id?: string;
  query?: string;
  tags?: string[];
  exclude_eval_artifacts?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Build the shared WHERE clause + bindings for a workspace filter, so listing
 * and counting can never drift apart (a total computed from a different
 * predicate than the rows is worse than no total at all).
 */
function workspaceFilterSql(filter: WorkspaceFilter): { where: string; params: SQLQueryBindings[] } {
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
  if (filter.kind) { conditions.push("kind = ?"); params.push(filter.kind); }
  if (filter.root_id) { conditions.push("root_id = ?"); params.push(filter.root_id); }
  if (filter.query) {
    const q = `%${filter.query.toLowerCase()}%`;
    conditions.push("(lower(name) LIKE ? OR lower(slug) LIKE ? OR lower(COALESCE(description, '')) LIKE ? OR lower(COALESCE(primary_path, '')) LIKE ? OR lower(COALESCE(tags, '')) LIKE ? OR lower(COALESCE(integrations, '')) LIKE ? OR lower(COALESCE(metadata, '')) LIKE ?)");
    params.push(q, q, q, q, q, q, q);
  }
  if (filter.tags && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      conditions.push("EXISTS (SELECT 1 FROM json_each(workspaces.tags) WHERE json_each.value = ?)");
      params.push(tag);
    }
  }
  if (filter.exclude_eval_artifacts) {
    conditions.push(`NOT (
      slug LIKE 'eval-%'
      OR name LIKE 'Eval %'
      OR EXISTS (
        SELECT 1 FROM json_each(workspaces.tags)
        WHERE json_each.value = 'eval' OR json_each.value LIKE 'eval-%'
      )
      OR COALESCE(json_extract(metadata, '$.eval_fixture'), 0) = 1
      OR COALESCE(json_extract(metadata, '$.agent_eval_fixture'), 0) = 1
    )`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/**
 * List workspaces.
 *
 * `filter.limit` is optional and, when omitted, means EVERY matching row.
 * It used to silently default to 100, so a caller asking for "all projects"
 * quietly received the first hundred with nothing in the result to say so —
 * the local twin of the server's 1000-row cap. SQLite's `LIMIT -1` is the
 * documented "no limit" sentinel and keeps OFFSET usable.
 */
export function listWorkspaces(filter: WorkspaceFilter = {}, db?: Database): Workspace[] {
  const d = db || getDatabase();
  const { where, params } = workspaceFilterSql(filter);
  const rows = d
    .query(`SELECT * FROM workspaces ${where} ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`)
    .all(...params, filter.limit ?? -1, filter.offset ?? 0) as WorkspaceRow[];

  return rows.map(rowToWorkspace);
}

/** Rows matching `filter`, ignoring its limit/offset. */
export function countWorkspaces(filter: WorkspaceFilter = {}, db?: Database): number {
  const d = db || getDatabase();
  const { where, params } = workspaceFilterSql(filter);
  const row = d.query(`SELECT COUNT(*) AS n FROM workspaces ${where}`).get(...params) as { n: number } | null;
  return row?.n ?? 0;
}

export function resolveWorkspace(idOrSlug: string, db?: Database): Workspace | null {
  const d = db || getDatabase();
  return getWorkspace(idOrSlug, d) ?? getWorkspaceBySlug(idOrSlug, d);
}

export function updateWorkspace(id: string, input: UpdateWorkspaceInput, db?: Database): Workspace {
  const d = db || getDatabase();
  const before = getWorkspace(id, d);
  if (!before) throw new Error(`Workspace not found: ${id}`);
  assertAgentPermission(input.agent_id, input.status === "deleted" ? "workspace:delete" : "workspace:update", d);

  const root = input.root_id === undefined || input.root_id === null ? null : getRoot(input.root_id, d);
  if (input.root_id && !root) throw new Error(`Root not found: ${input.root_id}`);
  const recipe = input.recipe_id === undefined || input.recipe_id === null ? null : getRecipe(input.recipe_id, d);
  if (input.recipe_id && !recipe) throw new Error(`Recipe not found: ${input.recipe_id}`);

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
    if (!canonicalMachine) throw new Error("Canonical machine must not be empty");
    if (!getMachine(canonicalMachine, d)) throw new Error(`Machine not found: ${canonicalMachine}`);
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
  if (input.integrations !== undefined) {
    assertProjectResourceLinkIntegrationMutation(
      before.integrations,
      input.integrations,
      listProjectResourceLinks(id, PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS, d),
    );
  }

  const updates: string[] = [];
  const params: SQLQueryBindings[] = [];
  const set = (column: string, value: SQLQueryBindings) => {
    updates.push(`${column} = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", input.name);
  if (input.slug !== undefined) set("slug", ensureUniqueSlug("workspaces", workspaceSlugify(input.slug), d, id));
  if (input.description !== undefined) set("description", input.description);
  if (input.kind !== undefined) set("kind", input.kind);
  if (input.status !== undefined) set("status", input.status);
  if (input.root_id !== undefined) set("root_id", input.root_id);
  if (input.recipe_id !== undefined) set("recipe_id", input.recipe_id);
  if (canonicalMachine !== undefined) set("canonical_machine", canonicalMachine);
  if (input.primary_path !== undefined) set("primary_path", input.primary_path ? resolve(input.primary_path) : null);
  if (input.git_remote !== undefined) set("git_remote", input.git_remote);
  if (input.s3_bucket !== undefined) set("s3_bucket", input.s3_bucket);
  if (input.s3_prefix !== undefined) set("s3_prefix", input.s3_prefix);
  if (input.tags !== undefined) set("tags", json(normalizeList(input.tags)));
  if (input.integrations !== undefined) set("integrations", json(input.integrations));
  if (metadata !== undefined) set("metadata", json(metadata));
  if (input.last_opened_at !== undefined) set("last_opened_at", input.last_opened_at);

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    params.push(nextWorkspaceRevision(before.updated_at));
    params.push(id);
    d.run(`UPDATE workspaces SET ${updates.join(", ")} WHERE id = ?`, params);
  }

  let after = getWorkspace(id, d)!;
  if (input.primary_path !== undefined) {
    if (input.primary_path) {
      addWorkspaceLocation({
        workspace_id: id,
        path: input.primary_path,
        label: "main",
        kind: after.git_remote && !existsSync(resolve(input.primary_path)) ? "remote-intended" : "local",
        is_primary: true,
        metadata: {},
      }, d);
    } else {
      d.run("UPDATE workspace_locations SET is_primary = 0 WHERE workspace_id = ?", [id]);
    }
    after = getWorkspace(id, d)!;
  }

  recordWorkspaceEvent({
    workspace_id: id,
    agent_id: input.agent_id,
    event_type: "updated",
    source: input.source ?? "cli",
    prompt: input.prompt,
    command: input.command,
    before: before as unknown as JsonObject,
    after: after as unknown as JsonObject,
  }, d);
  return after;
}

function insertGuardedProjectMutationReceipt(
  input: Omit<GuardedProjectMutationReceipt, "created_at">,
  db: Database,
): GuardedProjectMutationReceipt {
  db.run(
    `INSERT INTO guarded_project_mutation_receipts (
      receipt_id, operation_id, step_id, direction, idempotency_key, target_id,
      request_digest, precondition_digest, expected_revision, outcome, reason,
      result_project_id, duplicate_of_receipt_id, before_json, after_json,
      post_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.before === null ? null : json(redactProjectValue(input.before)),
      input.after === null ? null : json(redactProjectValue(input.after)),
      input.post_revision,
    ],
  );
  const row = db.query("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = ?").get(input.receipt_id) as GuardedProjectMutationReceiptRow;
  return rowToGuardedReceipt(row);
}

function findGuardedAcceptedReceipt(input: {
  operation_id: string;
  step_id: string;
  direction: "forward" | "inverse";
  idempotency_key: string;
  target_id: string;
}, db: Database): GuardedProjectMutationReceipt | null {
  const row = db.query(
    `SELECT * FROM guarded_project_mutation_receipts
     WHERE operation_id = ? AND step_id = ? AND direction = ? AND idempotency_key = ?
       AND target_id = ? AND outcome = 'accepted'
     ORDER BY created_at ASC, receipt_id ASC`,
  ).get(input.operation_id, input.step_id, input.direction, input.idempotency_key, input.target_id) as GuardedProjectMutationReceiptRow | null;
  return row ? rowToGuardedReceipt(row) : null;
}

function findGuardedAcceptedByStep(input: {
  operation_id: string;
  step_id: string;
  direction: "forward" | "inverse";
  target_id: string;
}, db: Database): GuardedProjectMutationReceipt | null {
  const row = db.query(
    `SELECT * FROM guarded_project_mutation_receipts
     WHERE operation_id = ? AND step_id = ? AND direction = ? AND target_id = ?
       AND outcome = 'accepted'
     ORDER BY created_at ASC, receipt_id ASC`,
  ).get(input.operation_id, input.step_id, input.direction, input.target_id) as GuardedProjectMutationReceiptRow | null;
  return row ? rowToGuardedReceipt(row) : null;
}

function requireForwardProjectResourceLinkReceipt(
  receiptId: string,
  projectId: string,
  db: Database,
): GuardedProjectMutationReceipt {
  const row = db.query(
    "SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = ?",
  ).get(receiptId) as GuardedProjectMutationReceiptRow | null;
  if (!row) throw new Error(`accepted receipt not found: ${receiptId}`);
  const accepted = rowToGuardedReceipt(row);
  if (
    accepted.outcome !== "accepted"
    || accepted.direction !== "forward"
    || accepted.target_id !== projectId
  ) {
    throw new Error("resource link rollback requires a forward accepted receipt for the same project id");
  }
  if (!accepted.post_revision) {
    throw new Error("resource link rollback accepted receipt has no post_revision");
  }
  return accepted;
}

function terminalNonacceptanceReceipt(input: {
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
}, db: Database): GuardedProjectMutationReceipt {
  return insertGuardedProjectMutationReceipt({
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
  }, db);
}

function duplicateOfAcceptedReceipt(
  accepted: GuardedProjectMutationReceipt,
  before: Workspace,
  db: Database,
  beforeSnapshot?: JsonObject,
): GuardedProjectMutationReceipt {
  const receiptId = buildReceiptId({
    operation_id: accepted.operation_id,
    step_id: accepted.step_id,
    direction: accepted.direction,
    idempotency_key: accepted.idempotency_key,
    outcome: "duplicate_of_accepted",
    target_id: accepted.target_id,
    suffix: accepted.receipt_id,
  });
  const existing = db.query("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = ?").get(receiptId) as GuardedProjectMutationReceiptRow | null;
  if (existing) return rowToGuardedReceipt(existing);
  return insertGuardedProjectMutationReceipt({
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
  }, db);
}

function assertProjectResourceLinkMaxItems(maxItems: number): void {
  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    throw new Error("project resource link max_items must be a positive integer");
  }
}

function listProjectResourceLinkRows(projectId: string, maxItems: number, db: Database): ProjectResourceLinkRow[] {
  assertProjectResourceLinkMaxItems(maxItems);
  const rows = db.query(
    `SELECT * FROM project_resource_links
     WHERE project_id = ?
     ORDER BY authority, service_instance, source_package, target_kind, locator_kind, locator_value, id
     LIMIT ?`,
  ).all(projectId, maxItems + 1) as ProjectResourceLinkRow[];
  if (rows.length > maxItems) {
    throw new Error(`project resource link collection exceeds max_items: more than ${maxItems}`);
  }
  return rows;
}

export function listProjectResourceLinks(
  projectId: string,
  maxItems = PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
  db?: Database,
): ProjectResourceLink[] {
  const d = db || getDatabase();
  assertCompleteStableProjectId(projectId);
  return listProjectResourceLinkRows(projectId, maxItems, d).map(rowToProjectResourceLink);
}

export function readProjectResourceLinks(
  input: ProjectResourceLinkReadRequest,
  db?: Database,
  startedAt = Date.now(),
): ProjectResourceLinkReadResult {
  const d = db || getDatabase();
  assertCompleteStableProjectId(input.project_id);
  assertProjectResourceLinkMaxItems(input.max_items);
  const project = getWorkspace(input.project_id, d);
  if (!project) throw new Error(`Workspace not found: ${input.project_id}`);
  const links = listProjectResourceLinks(input.project_id, input.max_items, d);
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
  return withResponseControl(read, input, startedAt, "project resource link read");
}

function projectResourceLinkInputFromStored(link: ProjectResourceLink): ProjectResourceLinkInput {
  const { id: _id, project_id: _projectId, created_at: _createdAt, updated_at: _updatedAt, ...input } = link;
  return input;
}

function desiredProjectResourceLinks(
  projectId: string,
  mode: ProjectResourceLinkMutationRequest["mode"],
  requested: readonly ProjectResourceLinkInput[],
  before: readonly ProjectResourceLink[],
  preserve?: readonly ProjectResourceLink[],
): ProjectResourceLink[] {
  const normalized = normalizeProjectResourceLinks(requested);
  const beforeById = new Map(before.map((link) => [link.id, link]));
  const preserveById = new Map((preserve ?? []).map((link) => [link.id, link]));
  const requestedLinks = normalized.map((input) => {
    const id = projectResourceLinkId(projectId, input);
    const existing = beforeById.get(id);
    const restored = preserveById.get(id);
    const timestamp = restored?.created_at ?? existing?.created_at ?? now();
    return {
      id,
      project_id: projectId,
      ...input,
      labels: input.labels ?? {},
      created_at: timestamp,
      updated_at: restored?.updated_at ?? (existing
        && existing.scope === input.scope
        && canonicalJson(existing.labels) === canonicalJson(input.labels ?? {})
        ? existing.updated_at
        : now()),
    };
  });
  const combined = mode === "add"
    ? [...before, ...requestedLinks.filter((link) => !beforeById.has(link.id))]
    : requestedLinks;
  return combined.sort((a, b) =>
    canonicalJson({
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
    })),
  );
}

function replaceProjectResourceLinks(
  projectId: string,
  links: readonly ProjectResourceLink[],
  db: Database,
): void {
  const desiredIds = new Set(links.map((link) => link.id));
  for (const existing of listProjectResourceLinks(projectId, PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS, db)) {
    if (!desiredIds.has(existing.id)) db.run("DELETE FROM project_resource_links WHERE id = ?", [existing.id]);
  }
  for (const link of links) {
    const existing = db.query("SELECT * FROM project_resource_links WHERE id = ?").get(link.id) as ProjectResourceLinkRow | null;
    if (existing) {
      const current = rowToProjectResourceLink(existing);
      if (
        current.scope !== link.scope
        || canonicalJson(current.labels) !== canonicalJson(link.labels)
      ) {
        db.run(
          "UPDATE project_resource_links SET scope = ?, labels_json = ?, updated_at = ? WHERE id = ?",
          [link.scope, canonicalJson(link.labels), link.updated_at, link.id],
        );
      }
      continue;
    }
    db.run(
      `INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

function listWorkspaceLocationsBounded(
  workspaceId: string,
  maxItems: number,
  db: Database,
): WorkspaceLocation[] {
  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    throw new Error("project quarantine workspace_location_max_items must be a positive integer");
  }
  const rows = db.query(
    `SELECT * FROM workspace_locations
     WHERE workspace_id = ?
     ORDER BY is_primary DESC, created_at ASC, id ASC
     LIMIT ?`,
  ).all(workspaceId, maxItems + 1) as WorkspaceLocationRow[];
  if (rows.length > maxItems) {
    throw new Error(`project quarantine workspace-location collection exceeds max_items: more than ${maxItems}`);
  }
  return rows.map(rowToLocation);
}

function replaceWorkspaceLocations(
  workspaceId: string,
  locations: readonly WorkspaceLocation[],
  db: Database,
): void {
  db.run("DELETE FROM workspace_locations WHERE workspace_id = ?", [workspaceId]);
  for (const location of locations) {
    db.run(
      `INSERT INTO workspace_locations (
        id, workspace_id, path, machine_id, label, kind, is_primary,
        exists_at_create, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        location.id,
        workspaceId,
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

function applyProjectQuarantineWorkspacePatch(
  projectId: string,
  patch: UpdateWorkspaceInput,
  expectedRevision: string,
  db: Database,
): Workspace {
  const before = getWorkspace(projectId, db);
  if (!before) throw new Error(`Workspace not found: ${projectId}`);
  if (before.updated_at !== expectedRevision) {
    throw new Error("project quarantine conditional update lost");
  }
  const after = previewWorkspacePatch(before, patch);
  const nextRevision = nextWorkspaceRevision(expectedRevision);
  const result = db.run(
    `UPDATE workspaces SET
      name = ?, slug = ?, description = ?, kind = ?, status = ?, root_id = ?, recipe_id = ?,
      canonical_machine = ?, primary_path = ?, git_remote = ?, s3_bucket = ?, s3_prefix = ?,
      tags = ?, integrations = ?, metadata = ?, last_opened_at = ?, updated_at = ?
     WHERE id = ? AND updated_at = ?`,
    [
      after.name,
      after.slug,
      after.description,
      after.kind,
      after.status,
      after.root_id,
      after.recipe_id,
      after.canonical_machine,
      after.primary_path,
      after.git_remote,
      after.s3_bucket,
      after.s3_prefix,
      json(after.tags),
      json(after.integrations),
      json(after.metadata),
      after.last_opened_at,
      nextRevision,
      projectId,
      expectedRevision,
    ],
  );
  if (result.changes !== 1) throw new Error("project quarantine conditional update lost");
  return getWorkspace(projectId, db)!;
}

function snapshotJson(snapshot: ProjectResourceLinkSnapshot): JsonObject {
  return snapshot as unknown as JsonObject;
}

function parseResourceLinkSnapshot(value: JsonObject | null, label: string): ProjectResourceLinkSnapshot {
  const snapshot = value as unknown as ProjectResourceLinkSnapshot | null;
  if (!snapshot?.project?.id || !Array.isArray(snapshot.links) || typeof snapshot.collection_digest !== "string") {
    throw new Error(`${label} receipt snapshot is incomplete`);
  }
  return snapshot;
}

function mutateProjectResourceLinksInternal(
  input: ProjectResourceLinkMutationRequest,
  db: Database,
  options: {
    direction?: "forward" | "inverse";
    forced_integrations?: WorkspaceIntegrations;
    preserve_links?: readonly ProjectResourceLink[];
  } = {},
): ProjectResourceLinkMutationResult {
  const started = Date.now();
  assertCompleteStableProjectId(input.project_id);
  const maxItems = input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS;
  assertProjectResourceLinkMaxItems(maxItems);
  const normalized = normalizeProjectResourceLinks(input.links);
  const forcedIntegrations = normalizeProjectResourceLinkIntegrations(
    options.forced_integrations ?? input.integrations,
  );
  if (normalized.length > maxItems) {
    throw new Error(`project resource link request exceeds max_items: ${normalized.length} > ${maxItems}`);
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

  return db.transaction(() => {
    const beforeProject = getWorkspace(input.project_id, db);
    if (!beforeProject) throw new Error(`Workspace not found: ${input.project_id}`);
    const beforeLinks = listProjectResourceLinks(input.project_id, maxItems, db);
    const before = projectResourceLinkSnapshot(beforeProject, beforeLinks);
    const currentRevision = workspaceRevision(beforeProject);
    const duplicate = findGuardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    }, db);
    if (duplicate) {
      const duplicateReceipt = duplicateOfAcceptedReceipt(duplicate, beforeProject, db, snapshotJson(before));
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
        receipt: duplicateReceipt,
      }, input, started, "project resource link mutation");
    }
    const priorAccepted = findGuardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      target_id: input.project_id,
    }, db);
    if (priorAccepted) {
      const receipt = terminalNonacceptanceReceipt({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "changed_request_or_precondition_for_step",
        before_snapshot: snapshotJson(before),
      }, db);
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
      const receipt = terminalNonacceptanceReceipt({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "stale_revision",
        before_snapshot: snapshotJson(before),
      }, db);
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

    const desired = desiredProjectResourceLinks(
      input.project_id,
      input.mode,
      normalized,
      beforeLinks,
      options.preserve_links,
    );
    if (desired.length > maxItems) {
      throw new Error(`project resource link collection exceeds max_items: ${desired.length} > ${maxItems}`);
    }
    const integrations = forcedIntegrations
      ?? projectResourceLinkIntegrationProjection(beforeProject.integrations, beforeLinks, desired);
    const previewProject = { ...beforeProject, integrations };
    const preview = projectResourceLinkSnapshot(previewProject, desired);
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
    if (timedOut(started, input.time_budget_ms)) throw new Error("project resource link mutation time budget exceeded before write");

    const changed = canonicalJson(before.links) !== canonicalJson(desired)
      || canonicalJson(beforeProject.integrations) !== canonicalJson(integrations);
    let afterProject = beforeProject;
    if (changed) {
      replaceProjectResourceLinks(input.project_id, desired, db);
      const nextRevision = nextWorkspaceRevision(currentRevision);
      const update = db.run(
        "UPDATE workspaces SET integrations = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
        [canonicalJson(integrations), nextRevision, input.project_id, currentRevision],
      );
      if (update.changes !== 1) throw new Error("project resource link conditional update lost");
      afterProject = getWorkspace(input.project_id, db)!;
    }
    const afterLinks = listProjectResourceLinks(input.project_id, maxItems, db);
    const after = projectResourceLinkSnapshot(afterProject, afterLinks);
    if (after.collection_digest !== projectResourceLinksDigest(desired)) {
      throw new Error("project resource link exact readback mismatch");
    }
    const receipt = insertGuardedProjectMutationReceipt({
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
      before: snapshotJson(before),
      after: snapshotJson(after),
      post_revision: workspaceRevision(afterProject),
    }, db);
    recordWorkspaceEvent({
      workspace_id: afterProject.id,
      agent_id: input.agent_id,
      event_type: direction === "inverse" ? "project_resource_links_rollback" : `project_resource_links_${input.mode}`,
      source: input.source ?? "cli",
      command: input.command,
      before: snapshotJson(before),
      after: snapshotJson(after),
      metadata: {
        receipt_id: receipt.receipt_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
        idempotency_key: idempotencyKey,
        collection_digest: after.collection_digest,
      },
    }, db);
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
  })();
}

export function mutateProjectResourceLinks(
  input: ProjectResourceLinkMutationRequest,
  db?: Database,
): ProjectResourceLinkMutationResult {
  return mutateProjectResourceLinksInternal(input, db || getDatabase());
}

export function mutateProjectResourceLinksForRegistration(
  input: ProjectResourceLinkMutationRequest,
  integrations: WorkspaceIntegrations,
  db?: Database,
): ProjectResourceLinkMutationResult {
  return mutateProjectResourceLinksInternal(input, db || getDatabase(), {
    forced_integrations: integrations,
  });
}

export function rollbackProjectResourceLinks(
  input: ProjectResourceLinkRollbackRequest,
  db?: Database,
): ProjectResourceLinkMutationResult {
  const d = db || getDatabase();
  assertCompleteStableProjectId(input.project_id);
  const accepted = requireForwardProjectResourceLinkReceipt(
    input.accepted_receipt_id,
    input.project_id,
    d,
  );
  if (accepted.post_revision !== input.expected_current_revision) {
    throw new Error("resource link rollback expected_current_revision must equal the accepted receipt post_revision");
  }
  const before = parseResourceLinkSnapshot(accepted.before, "accepted before");
  const after = parseResourceLinkSnapshot(accepted.after, "accepted after");
  const current = readProjectResourceLinks({
    project_id: input.project_id,
    max_items: input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  }, d);
  const priorInverse = findGuardedAcceptedByStep({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "inverse",
    target_id: input.project_id,
  }, d);
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
      throw new Error("accepted resource link inverse receipt does not match the forward receipt");
    }
    if (
      !priorInverse.post_revision
      || current.current_revision !== priorInverse.post_revision
      || current.collection_digest !== inverseAfter.collection_digest
      || canonicalJson(current.project.integrations) !== canonicalJson(inverseAfter.project.integrations)
    ) {
      throw new Error("resource link rollback retry refuses drift after the accepted inverse");
    }
  } else if (
    current.current_revision !== input.expected_current_revision
    || current.collection_digest !== after.collection_digest
  ) {
    throw new Error("resource link rollback refuses current revision or collection digest drift");
  }
  return mutateProjectResourceLinksInternal({
    project_id: input.project_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    mode: "reconcile",
    expected_revision: input.expected_current_revision,
    links: before.links.map(projectResourceLinkInputFromStored),
    max_items: input.max_items,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
    agent_id: input.agent_id,
    source: input.source,
    command: input.command,
  }, d, {
    direction: "inverse",
    forced_integrations: before.project.integrations,
    preserve_links: before.links,
  });
}

export function readDuplicateProjectQuarantinePreimage(
  input: ProjectQuarantineReadRequest,
  db?: Database,
): ProjectQuarantineReadResult {
  const d = db || getDatabase();
  const started = Date.now();
  assertCompleteStableProjectId(input.project_id);
  assertProjectResourceLinkMaxItems(input.resource_link_max_items);
  const project = getWorkspace(input.project_id, d);
  if (!project) throw new Error(`Workspace not found: ${input.project_id}`);
  const links = listProjectResourceLinks(input.project_id, input.resource_link_max_items, d);
  const locations = listWorkspaceLocationsBounded(
    input.project_id,
    input.workspace_location_max_items,
    d,
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
  }, input, started, "project quarantine preimage read");
}

export function quarantineDuplicateProject(
  input: ProjectQuarantineRequest,
  db?: Database,
): ProjectQuarantineResult {
  const d = db || getDatabase();
  const started = Date.now();
  assertCompleteStableProjectId(input.project_id);
  assertProjectResourceLinkMaxItems(input.resource_link_max_items);
  if (!Number.isInteger(input.workspace_location_max_items) || input.workspace_location_max_items <= 0) {
    throw new Error("project quarantine workspace_location_max_items must be a positive integer");
  }
  const expectedIds = normalizedExpectedResourceLinkIds(input);
  const reqDigest = projectQuarantineRequestDigest(input);
  const preDigest = projectQuarantinePreconditionDigest(input, expectedIds);
  const idempotencyKey = deriveGuardedIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "forward",
    target_id: input.project_id,
    request_digest: reqDigest,
    precondition_digest: preDigest,
  });

  return d.transaction(() => {
    const beforeProject = getWorkspace(input.project_id, d);
    if (!beforeProject) throw new Error(`Workspace not found: ${input.project_id}`);
    const beforeLinks = listProjectResourceLinks(input.project_id, input.resource_link_max_items, d);
    const beforeLocations = listWorkspaceLocationsBounded(
      input.project_id,
      input.workspace_location_max_items,
      d,
    );
    const before = projectQuarantineSnapshot(beforeProject, beforeLinks, beforeLocations);
    const duplicate = findGuardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    }, d);
    if (duplicate) {
      const acceptedAfter = parseProjectQuarantineSnapshot(duplicate.after, "accepted after");
      if (
        before.project.updated_at !== duplicate.post_revision
        || before.project_digest !== acceptedAfter.project_digest
        || before.resource_link_collection_digest !== acceptedAfter.resource_link_collection_digest
        || before.workspace_location_collection_digest !== acceptedAfter.workspace_location_collection_digest
      ) {
        throw new Error("project quarantine retry refuses drift after the accepted receipt");
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
      const receipt = duplicateOfAcceptedReceipt(
        duplicate,
        beforeProject,
        d,
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
    const priorAccepted = findGuardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      target_id: input.project_id,
    }, d);
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
      const receipt = terminalNonacceptanceReceipt({
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
      }, d);
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
    const refusal = assertProjectQuarantinePreconditions(input, before);
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
      const receipt = terminalNonacceptanceReceipt({
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
      }, d);
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
    const conflictingSlug = d.query("SELECT id FROM workspaces WHERE slug = ? AND id <> ?")
      .get(workspaceSlugify(input.quarantine_slug), input.project_id) as { id: string } | null;
    if (conflictingSlug) throw new Error("project quarantine slug is already owned by another project");
    const patch = projectQuarantinePatch(input, before);
    const previewProject = previewWorkspacePatch(beforeProject, patch);
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
    if (timedOut(started, input.time_budget_ms)) throw new Error("project quarantine time budget exceeded before write");

    replaceProjectResourceLinks(input.project_id, [], d);
    replaceWorkspaceLocations(input.project_id, [], d);
    const afterProject = applyProjectQuarantineWorkspacePatch(
      input.project_id,
      patch,
      input.expected_revision,
      d,
    );
    const after = projectQuarantineSnapshot(
      afterProject,
      listProjectResourceLinks(input.project_id, input.resource_link_max_items, d),
      listWorkspaceLocationsBounded(input.project_id, input.workspace_location_max_items, d),
    );
    assertProjectQuarantinePostimage(input, before, after);
    const receipt = insertGuardedProjectMutationReceipt({
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
    }, d);
    recordWorkspaceEvent({
      workspace_id: input.project_id,
      agent_id: input.agent_id,
      event_type: PROJECT_QUARANTINE_EVENT,
      source: input.source ?? "cli",
      command: input.command,
      before: projectQuarantineSnapshotJson(before),
      after: projectQuarantineSnapshotJson(after),
      metadata: {
        receipt_id: receipt.receipt_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
      },
    }, d);
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
      rollback: {
        accepted_receipt_id: receipt.receipt_id,
        expected_current_revision: afterProject.updated_at,
      },
    }, input, started, "project quarantine");
  })();
}

export function rollbackDuplicateProjectQuarantine(
  input: ProjectQuarantineRollbackRequest,
  db?: Database,
): ProjectQuarantineResult {
  const d = db || getDatabase();
  const started = Date.now();
  assertCompleteStableProjectId(input.project_id);
  assertProjectResourceLinkMaxItems(input.resource_link_max_items);
  if (!Number.isInteger(input.workspace_location_max_items) || input.workspace_location_max_items <= 0) {
    throw new Error("project quarantine workspace_location_max_items must be a positive integer");
  }
  return d.transaction(() => {
    const row = d.query("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = ?")
      .get(input.accepted_receipt_id) as GuardedProjectMutationReceiptRow | null;
    if (!row) throw new Error(`accepted quarantine receipt not found: ${input.accepted_receipt_id}`);
    const accepted = rowToGuardedReceipt(row);
    if (accepted.outcome !== "accepted" || accepted.direction !== "forward" || accepted.target_id !== input.project_id) {
      throw new Error("quarantine rollback requires a forward accepted receipt for the same project id");
    }
    if (accepted.post_revision !== input.expected_current_revision) {
      throw new Error("quarantine rollback expected_current_revision must equal the accepted receipt post_revision");
    }
    const acceptedBefore = parseProjectQuarantineSnapshot(accepted.before, "accepted before");
    const acceptedAfter = parseProjectQuarantineSnapshot(accepted.after, "accepted after");
    const currentProject = getWorkspace(input.project_id, d);
    if (!currentProject) throw new Error(`Workspace not found: ${input.project_id}`);
    const current = projectQuarantineSnapshot(
      currentProject,
      listProjectResourceLinks(input.project_id, input.resource_link_max_items, d),
      listWorkspaceLocationsBounded(input.project_id, input.workspace_location_max_items, d),
    );
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
    const duplicate = findGuardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    }, d);
    if (duplicate) {
      const acceptedInverseAfter = parseProjectQuarantineSnapshot(duplicate.after, "accepted inverse after");
      if (
        currentProject.updated_at !== duplicate.post_revision
        || current.project_digest !== acceptedInverseAfter.project_digest
        || current.resource_link_collection_digest !== acceptedInverseAfter.resource_link_collection_digest
        || current.workspace_location_collection_digest !== acceptedInverseAfter.workspace_location_collection_digest
      ) {
        throw new Error("quarantine rollback retry refuses drift after the accepted inverse");
      }
      const receipt = duplicateOfAcceptedReceipt(
        duplicate,
        currentProject,
        d,
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
    const priorInverse = findGuardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "inverse",
      target_id: input.project_id,
    }, d);
    if (priorInverse) {
      const receipt = terminalNonacceptanceReceipt({
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
      }, d);
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
      throw new Error("quarantine rollback refuses current project, resource-link, or path-selector drift");
    }

    replaceProjectResourceLinks(input.project_id, acceptedBefore.resource_links, d);
    replaceWorkspaceLocations(input.project_id, acceptedBefore.workspace_locations, d);
    const afterProject = applyProjectQuarantineWorkspacePatch(
      input.project_id,
      restoreProjectPatch(acceptedBefore),
      input.expected_current_revision,
      d,
    );
    const after = projectQuarantineSnapshot(
      afterProject,
      listProjectResourceLinks(input.project_id, input.resource_link_max_items, d),
      listWorkspaceLocationsBounded(input.project_id, input.workspace_location_max_items, d),
    );
    const restoredProject = { ...after.project, updated_at: acceptedBefore.project.updated_at };
    if (
      projectDigest(restoredProject, after.workspace_locations) !== acceptedBefore.project_digest
      || after.resource_link_collection_digest !== acceptedBefore.resource_link_collection_digest
      || after.workspace_location_collection_digest !== acceptedBefore.workspace_location_collection_digest
    ) {
      throw new Error("quarantine rollback exact inverse readback mismatch");
    }
    const receipt = insertGuardedProjectMutationReceipt({
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
    }, d);
    recordWorkspaceEvent({
      workspace_id: input.project_id,
      agent_id: input.agent_id,
      event_type: PROJECT_QUARANTINE_ROLLBACK_EVENT,
      source: input.source ?? "cli",
      command: input.command,
      before: projectQuarantineSnapshotJson(current),
      after: projectQuarantineSnapshotJson(after),
      metadata: {
        receipt_id: receipt.receipt_id,
        accepted_receipt_id: accepted.receipt_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
      },
    }, d);
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
  })();
}

function getProjectResourceLinkMigrationManifest(
  projectId: string,
  manifestId: string,
  db: Database,
): ProjectResourceLinkMigrationManifestV1 {
  const row = db.query(
    `SELECT * FROM project_resource_link_migration_manifests
     WHERE manifest_id = ? AND project_id = ?`,
  ).get(manifestId, projectId) as ProjectResourceLinkMigrationManifestRow | null;
  if (!row) throw new Error(`project resource link migration manifest not found: ${manifestId}`);
  return rowToProjectResourceLinkMigrationManifest(row);
}

function listProjectResourceLinkMigrationEvents(
  manifestId: string,
  db: Database,
): ProjectResourceLinkMigrationEvent[] {
  return readBoundedProjectResourceLinkMigrationEvents(
    manifestId,
    PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
    db,
  ).events;
}

function readBoundedProjectResourceLinkMigrationEvents(
  manifestId: string,
  maxItems: number,
  db: Database,
): {
  events: ProjectResourceLinkMigrationEvent[];
  complete: boolean;
  truncated: boolean;
} {
  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    throw new Error("project resource link migration event max_items must be a positive integer");
  }
  const rows = db.query(
    `SELECT event_id, manifest_id, transition_version, from_state, to_state,
            request_digest, precondition_digest, evidence_json, created_at
     FROM project_resource_link_migration_events
     WHERE manifest_id = ?
     ORDER BY transition_version ASC
     LIMIT ?`,
  ).all(manifestId, maxItems + 1) as Array<Record<string, unknown>>;
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
      evidence: JSON.parse(String(row["evidence_json"])) as JsonObject,
      created_at: String(row["created_at"]),
    })),
    complete: !truncated,
    truncated,
  };
}

function insertProjectResourceLinkMigrationEvent(
  event: ProjectResourceLinkMigrationEvent,
  db: Database,
): void {
  db.run(
    `INSERT INTO project_resource_link_migration_events (
      event_id, manifest_id, transition_version, from_state, to_state,
      request_digest, precondition_digest, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.event_id,
      event.manifest_id,
      event.transition_version,
      event.from_state,
      event.to_state,
      event.request_digest,
      event.precondition_digest,
      canonicalJson(event.evidence),
      event.created_at,
    ],
  );
}

function persistProjectResourceLinkMigrationTransition(
  before: ProjectResourceLinkMigrationManifestV1,
  after: ProjectResourceLinkMigrationManifestV1,
  evidence: JsonObject,
  db: Database,
): void {
  const update = db.run(
    `UPDATE project_resource_link_migration_manifests
     SET state = ?, links_json = ?, projects_forward_receipt_id = ?,
         projects_inverse_receipt_id = ?, projects_reference_proof_json = ?,
         last_verified_projects_revision = ?, last_verified_projects_digest = ?,
         transition_version = ?, updated_at = ?
     WHERE manifest_id = ? AND project_id = ? AND transition_version = ?`,
    [
      after.state,
      canonicalJson(after.links),
      after.projects_forward_receipt_id,
      after.projects_inverse_receipt_id,
      after.projects_reference_proof === null ? null : canonicalJson(after.projects_reference_proof),
      after.last_verified_projects_revision,
      after.last_verified_projects_digest,
      after.transition_version,
      after.updated_at,
      after.manifest_id,
      after.project_id,
      before.transition_version,
    ],
  );
  if (update.changes !== 1) throw new Error("project resource link migration transition CAS lost");
  insertProjectResourceLinkMigrationEvent(migrationEvent(
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
  ), db);
}

export function planProjectResourceLinkMigration(
  input: ProjectResourceLinkMigrationPlanRequest,
  db?: Database,
): ProjectResourceLinkMigrationResult {
  const d = db || getDatabase();
  const started = Date.now();
  assertCompleteStableProjectId(input.project_id);
  const project = getWorkspace(input.project_id, d);
  if (!project) throw new Error(`Workspace not found: ${input.project_id}`);
  if (workspaceRevision(project) !== input.expected_project_revision) {
    throw new Error("project resource link migration plan refuses a stale project revision");
  }
  const maxItems = input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS;
  if (input.links.length > maxItems) throw new Error("project resource link migration plan exceeds max_items");
  const ts = now();
  const candidate = buildProjectResourceLinkMigrationPlan(input, ts);
  const existingRow = d.query(
    `SELECT * FROM project_resource_link_migration_manifests
     WHERE project_id = ? AND operation_id = ? AND step_id = ?`,
  ).get(input.project_id, input.operation_id, input.step_id) as ProjectResourceLinkMigrationManifestRow | null;
  if (existingRow) {
    const existing = rowToProjectResourceLinkMigrationManifest(existingRow);
    if (existing.manifest_id !== candidate.manifest_id) {
      throw new Error("project resource link migration step already has a different accepted manifest");
    }
    return withResponseControl({
      ok: true,
      outcome: "duplicate_of_accepted" as const,
      manifest: existing,
      events: listProjectResourceLinkMigrationEvents(existing.manifest_id, d),
    }, input, started, "project resource link migration plan");
  }
  d.transaction(() => {
    d.run(
      `INSERT INTO project_resource_link_migration_manifests (
        manifest_id, project_id, operation_id, step_id, state,
        expected_project_revision, desired_collection_digest, links_json,
        projects_forward_receipt_id, projects_inverse_receipt_id,
        projects_reference_proof_json, last_verified_projects_revision,
        last_verified_projects_digest, transition_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      [
        candidate.manifest_id,
        candidate.project_id,
        candidate.operation_id,
        candidate.step_id,
        candidate.state,
        candidate.expected_project_revision,
        candidate.desired_collection_digest,
        canonicalJson(candidate.links),
        candidate.transition_version,
        candidate.created_at,
        candidate.updated_at,
      ],
    );
    insertProjectResourceLinkMigrationEvent(migrationEvent(
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
    ), d);
  })();
  return withResponseControl({
    ok: true,
    outcome: "accepted" as const,
    manifest: candidate,
    events: listProjectResourceLinkMigrationEvents(candidate.manifest_id, d),
  }, input, started, "project resource link migration plan");
}

export function readProjectResourceLinkMigration(
  input: ProjectResourceLinkMigrationReadRequest,
  db?: Database,
): ProjectResourceLinkMigrationResult {
  const d = db || getDatabase();
  const started = Date.now();
  const manifest = getProjectResourceLinkMigrationManifest(input.project_id, input.manifest_id, d);
  const boundedEvents = readBoundedProjectResourceLinkMigrationEvents(
    manifest.manifest_id,
    input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
    d,
  );
  return withResponseControl({
    ok: true,
    outcome: "accepted" as const,
    manifest,
    events: boundedEvents.events,
  }, input, started, "project resource link migration read", boundedEvents);
}

export function advanceProjectResourceLinkMigration(
  input: ProjectResourceLinkMigrationAdvanceRequest,
  db?: Database,
  producerEvidenceVerifier?: ProjectResourceLinkProducerEvidenceVerifier,
): ProjectResourceLinkMigrationResult {
  const d = db || getDatabase();
  const started = Date.now();
  const before = getProjectResourceLinkMigrationManifest(input.project_id, input.manifest_id, d);
  if (before.transition_version !== input.expected_transition_version) {
    throw new Error("project resource link migration advance transition_version is stale");
  }
  if (before.state === input.next_state) {
    return withResponseControl({
      ok: true,
      outcome: "duplicate_of_accepted" as const,
      manifest: before,
      events: listProjectResourceLinkMigrationEvents(before.manifest_id, d),
    }, input, started, "project resource link migration advance");
  }
  let producerEvidence = input.producer_evidence;
  let producerAttestation: ProjectResourceLinkProducerAttestation | undefined;
  if (input.next_state === "producer_applied") {
    producerEvidence = reconcileProjectResourceLinkProducerProof(before, input.producer_evidence, "forward");
  }
  if (input.next_state === "projects_applied") {
    if (!input.projects_forward_receipt_id) throw new Error("projects_applied requires a Projects forward receipt");
    const row = d.query("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = ?")
      .get(input.projects_forward_receipt_id) as GuardedProjectMutationReceiptRow | null;
    if (!row) throw new Error("Projects forward receipt not found");
    const receipt = rowToGuardedReceipt(row);
    const snapshot = parseResourceLinkSnapshot(receipt.after, "Projects forward");
    const snapshotIds = new Set(snapshot.links.map((link) => link.id));
    if (
      receipt.outcome !== "accepted"
      || receipt.direction !== "forward"
      || receipt.target_id !== input.project_id
      || snapshot.collection_digest !== before.desired_collection_digest
      || before.links.some((item) => !snapshotIds.has(item.link_id))
    ) {
      throw new Error("Projects forward receipt does not prove the manifest collection");
    }
  }
  if (input.next_state === "verified") {
    producerEvidence = reconcileProjectResourceLinkProducerProof(before, input.producer_evidence, "readback");
    const trustedProject = getWorkspace(input.project_id, d);
    if (!trustedProject) throw new Error(`Project not found: ${input.project_id}`);
    producerAttestation = assertProjectResourceLinkProducerAttestation(
      before,
      "readback",
      producerEvidence,
      producerEvidenceVerifier?.({
        manifest: before,
        trusted_project: projectResourceLinkProducerProjectSubject(trustedProject),
        phase: "readback",
        producer_evidence: producerEvidence,
        transition_evidence: input.evidence,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
      }),
    );
    const read = readProjectResourceLinks({
      project_id: input.project_id,
      max_items: Math.max(PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS, before.links.length),
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
    }, d);
    if (
      read.collection_digest !== before.desired_collection_digest
      || input.last_verified_projects_revision !== read.current_revision
      || input.last_verified_projects_digest !== read.collection_digest
    ) {
      throw new Error("verified transition requires a current complete Projects readback");
    }
  }
  const after = applyProjectResourceLinkMigrationTransition(before, input.next_state, now(), {
    producer_evidence: producerEvidence,
    projects_forward_receipt_id: input.projects_forward_receipt_id,
    last_verified_projects_revision: input.last_verified_projects_revision,
    last_verified_projects_digest: input.last_verified_projects_digest,
  });
  const transitionEvidence = producerAttestation
    ? migrationEvidenceWithProducerAttestation(input.evidence, producerAttestation)
    : input.evidence;
  d.transaction(() => persistProjectResourceLinkMigrationTransition(before, after, transitionEvidence, d))();
  return withResponseControl({
    ok: true,
    outcome: "accepted" as const,
    manifest: after,
    events: listProjectResourceLinkMigrationEvents(after.manifest_id, d),
  }, input, started, "project resource link migration advance");
}

export function rollbackProjectResourceLinkMigration(
  input: ProjectResourceLinkMigrationRollbackRequest,
  db?: Database,
  producerEvidenceVerifier?: ProjectResourceLinkProducerEvidenceVerifier,
): ProjectResourceLinkMigrationResult {
  const d = db || getDatabase();
  const started = Date.now();
  let before = getProjectResourceLinkMigrationManifest(input.project_id, input.manifest_id, d);
  if (["rolled_back", "retained_target"].includes(before.state)) {
    return withResponseControl({
      ok: true,
      outcome: "duplicate_of_accepted" as const,
      manifest: before,
      events: listProjectResourceLinkMigrationEvents(before.manifest_id, d),
    }, input, started, "project resource link migration rollback");
  }
  if (before.transition_version !== input.expected_transition_version) {
    throw new Error("project resource link migration rollback transition_version is stale");
  }
  let proof = before.projects_reference_proof;
  let inverseReceiptId = before.projects_inverse_receipt_id;
  const establishingProjectsReferenceProof = proof === null;
  if (establishingProjectsReferenceProof && input.producer_outcome !== "pending") {
    throw new Error(
      "first migration rollback call must use producer_outcome=pending so Projects reference proof is persisted before producer compensation",
    );
  }
  if (!proof) {
    const linkIds = before.links.map((item) => item.link_id);
    if (before.projects_forward_receipt_id) {
      const forwardReceipt = requireForwardProjectResourceLinkReceipt(
        before.projects_forward_receipt_id,
        input.project_id,
        d,
      );
      const inverse = rollbackProjectResourceLinks({
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
      }, d);
      const verified = readProjectResourceLinks({
        project_id: input.project_id,
        max_items: input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
      }, d);
      if (verified.links.some((link) => linkIds.includes(link.id))) {
        throw new Error("Projects inverse did not remove every manifest reference");
      }
      if (!["accepted", "duplicate_of_accepted"].includes(inverse.outcome)) {
        throw new Error("Projects inverse was not accepted");
      }
      inverseReceiptId = inverse.receipt?.duplicate_of_receipt_id
        ?? inverse.receipt?.receipt_id
        ?? null;
      if (!inverseReceiptId) throw new Error("Projects inverse did not return an accepted receipt");
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
      const current = readProjectResourceLinks({
        project_id: input.project_id,
        max_items: input.max_items ?? PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
      }, d);
      if (current.links.some((link) => linkIds.includes(link.id))) {
        throw new Error("ambiguous Projects state: manifest links exist without a matching accepted forward receipt");
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
    const inProgress = applyProjectResourceLinkMigrationTransition(before, "rollback_in_progress", now(), {
      projects_inverse_receipt_id: inverseReceiptId,
      projects_reference_proof: proof,
      last_verified_projects_revision: proof.verified_revision,
      last_verified_projects_digest: proof.collection_digest,
    });
    d.transaction(() => persistProjectResourceLinkMigrationTransition(before, inProgress, input.evidence, d))();
    before = inProgress;
  }
  if (input.producer_outcome === "pending") {
    return withResponseControl({
      ok: true,
      outcome: "accepted" as const,
      manifest: before,
      events: listProjectResourceLinkMigrationEvents(before.manifest_id, d),
    }, input, started, "project resource link migration rollback");
  }
  const nextState = input.producer_outcome === "complete"
    ? "rolled_back"
    : input.producer_outcome === "retained_target"
      ? "retained_target"
      : "failed_reconcilable";
  const terminalProducerEvidence = nextState === "rolled_back" || nextState === "retained_target"
    ? reconcileProjectResourceLinkProducerProof(
      before,
      input.producer_evidence,
      "inverse",
      nextState === "rolled_back" ? "complete" : "retained_target",
    )
    : undefined;
  const producerAttestation = terminalProducerEvidence
    ? (() => {
        const trustedProject = getWorkspace(input.project_id, d);
        if (!trustedProject) throw new Error(`Project not found: ${input.project_id}`);
        const phase = nextState === "rolled_back" ? "inverse_complete" : "inverse_retained_target";
        return assertProjectResourceLinkProducerAttestation(
          before,
          phase,
          terminalProducerEvidence,
          producerEvidenceVerifier?.({
            manifest: before,
            trusted_project: projectResourceLinkProducerProjectSubject(trustedProject),
            phase,
            producer_evidence: terminalProducerEvidence,
            transition_evidence: input.evidence,
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
          }),
        );
      })()
    : undefined;
  const after = applyProjectResourceLinkMigrationTransition(before, nextState, now(), {
    producer_evidence: terminalProducerEvidence,
    projects_inverse_receipt_id: inverseReceiptId,
    projects_reference_proof: proof,
    last_verified_projects_revision: proof.verified_revision,
    last_verified_projects_digest: proof.collection_digest,
  });
  const transitionEvidence = producerAttestation
    ? migrationEvidenceWithProducerAttestation(input.evidence, producerAttestation)
    : input.evidence;
  d.transaction(() => persistProjectResourceLinkMigrationTransition(before, after, transitionEvidence, d))();
  before = after;
  return withResponseControl({
    ok: true,
    outcome: "accepted" as const,
    manifest: before,
    events: listProjectResourceLinkMigrationEvents(before.manifest_id, d),
  }, input, started, "project resource link migration rollback");
}

function previewWorkspacePatch(before: Workspace, patch: UpdateWorkspaceInput): Workspace {
  return {
    ...before,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.slug !== undefined ? { slug: workspaceSlugify(patch.slug) } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.root_id !== undefined ? { root_id: patch.root_id } : {}),
    ...(patch.recipe_id !== undefined ? { recipe_id: patch.recipe_id } : {}),
    ...(patch.canonical_machine !== undefined ? { canonical_machine: patch.canonical_machine } : {}),
    ...(patch.primary_path !== undefined ? { primary_path: patch.primary_path } : {}),
    ...(patch.git_remote !== undefined ? { git_remote: patch.git_remote } : {}),
    ...(patch.s3_bucket !== undefined ? { s3_bucket: patch.s3_bucket } : {}),
    ...(patch.s3_prefix !== undefined ? { s3_prefix: patch.s3_prefix } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.integrations !== undefined ? { integrations: patch.integrations } : {}),
    ...(patch.metadata !== undefined
      ? { metadata: normalizeProjectMetadata(patch.metadata, before.metadata) }
      : {}),
    ...(patch.last_opened_at !== undefined ? { last_opened_at: patch.last_opened_at } : {}),
  } as Workspace;
}

export function guardedUpdateWorkspace(input: GuardedProjectMutationRequest, db?: Database): GuardedProjectMutationResult {
  const d = db || getDatabase();
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

  return d.transaction(() => {
    const before = getWorkspace(input.project_id, d);
    if (!before) throw new Error(`Workspace not found: ${input.project_id}`);
    if (input.patch.integrations !== undefined) {
      assertProjectResourceLinkIntegrationMutation(
        before.integrations,
        input.patch.integrations,
        listProjectResourceLinks(input.project_id, PROJECT_RESOURCE_LINK_DEFAULT_MAX_ITEMS, d),
      );
    }
    const currentRevision = workspaceRevision(before);
    const duplicate = findGuardedAcceptedReceipt({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      idempotency_key: idempotencyKey,
      target_id: input.project_id,
    }, d);
    if (duplicate) {
      const duplicateReceipt = duplicateOfAcceptedReceipt(duplicate, before, d);
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
    const priorAccepted = findGuardedAcceptedByStep({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction,
      target_id: input.project_id,
    }, d);
    if (priorAccepted) {
      const receipt = terminalNonacceptanceReceipt({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "changed_request_or_precondition_for_step",
        before,
      }, d);
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: null,
        receipt,
      }, input, started);
    }
    if (currentRevision !== input.expected_revision) {
      const receipt = terminalNonacceptanceReceipt({
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction,
        idempotency_key: idempotencyKey,
        target_id: input.project_id,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        expected_revision: input.expected_revision,
        reason: "stale_revision",
        before,
      }, d);
      return withResponseControl({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance" as const,
        idempotency_key: idempotencyKey,
        request_digest: reqDigest,
        precondition_digest: preDigest,
        project_id: input.project_id,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        before,
        after: null,
        receipt,
      }, input, started);
    }
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
        current_revision: currentRevision,
        before,
        after: previewWorkspacePatch(before, input.patch),
        receipt: null,
      }, input, started);
    }
    if (timedOut(started, input.time_budget_ms)) throw new Error("guarded mutation time budget exceeded before write");
    const after = updateWorkspace(input.project_id, {
      ...input.patch,
      agent_id: input.agent_id ?? input.patch.agent_id,
      source: input.source ?? input.patch.source ?? "cli",
      command: input.command ?? input.patch.command,
    }, d);
    const receipt = insertGuardedProjectMutationReceipt({
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
      result_project_id: after.id,
      duplicate_of_receipt_id: null,
      before: workspaceSnapshot(before),
      after: workspaceSnapshot(after),
      post_revision: workspaceRevision(after),
    }, d);
    recordWorkspaceEvent({
      workspace_id: after.id,
      agent_id: input.agent_id,
      event_type: "guarded_metadata_mutation",
      source: input.source ?? "cli",
      command: input.command,
      before: before as unknown as JsonObject,
      after: after as unknown as JsonObject,
      metadata: { receipt_id: receipt.receipt_id, operation_id: input.operation_id, step_id: input.step_id, idempotency_key: idempotencyKey },
    }, d);
    return withResponseControl({
      ok: true,
      dry_run: false,
      outcome: "accepted" as const,
      idempotency_key: idempotencyKey,
      request_digest: reqDigest,
      precondition_digest: preDigest,
      project_id: input.project_id,
      expected_revision: input.expected_revision,
      current_revision: currentRevision,
      before,
      after,
      receipt,
    }, input, started);
  })();
}

export function lookupGuardedWorkspaceMutationReceipt(
  input: GuardedProjectMutationReceiptLookupInput,
  db?: Database,
): GuardedProjectMutationReceipt {
  const d = db || getDatabase();
  assertCompleteStableProjectId(input.project_id);
  if (input.max_items !== 1) throw new Error("guarded receipt lookup max_items must be exactly 1");
  const rows = d.query(
    `SELECT * FROM guarded_project_mutation_receipts
     WHERE operation_id = ? AND step_id = ? AND direction = ? AND idempotency_key = ? AND target_id = ?
     ORDER BY created_at ASC, receipt_id ASC
     LIMIT 2`,
  ).all(input.operation_id, input.step_id, input.direction, input.idempotency_key, input.project_id) as GuardedProjectMutationReceiptRow[];
  if (rows.length === 0) throw new Error("guarded receipt lookup expected exactly one terminal receipt, found 0");
  const receipts = rows.map(rowToGuardedReceipt);
  const accepted = receipts.find((receipt) => receipt.outcome === "accepted");
  const duplicates = receipts.filter((receipt) => receipt.outcome === "duplicate_of_accepted");
  if (receipts.length > 1) {
    if (!accepted || duplicates.length !== receipts.length - 1 || duplicates.some((receipt) => receipt.duplicate_of_receipt_id !== accepted.receipt_id)) {
      throw new Error(`guarded receipt lookup expected exactly one terminal result, found ${receipts.length}`);
    }
  }
  const receipt = duplicates.at(-1) ?? accepted ?? receipts[0]!;
  if (!["accepted", "duplicate_of_accepted", "terminal_nonacceptance"].includes(receipt.outcome)) {
    throw new Error(`guarded receipt lookup found nonterminal outcome: ${receipt.outcome}`);
  }
  return receipt;
}

function restorePatchFromReceipt(receipt: GuardedProjectMutationReceipt): UpdateWorkspaceInput {
  const before = receipt.before as unknown as Workspace | null;
  if (!before) throw new Error("accepted receipt has no before snapshot");
  return {
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
  };
}

export function rollbackGuardedWorkspaceMutation(input: GuardedProjectMutationRollbackRequest, db?: Database): GuardedProjectMutationResult {
  const d = db || getDatabase();
  assertCompleteStableProjectId(input.project_id);
  const acceptedRow = d.query("SELECT * FROM guarded_project_mutation_receipts WHERE receipt_id = ?").get(input.accepted_receipt_id) as GuardedProjectMutationReceiptRow | null;
  if (!acceptedRow) throw new Error(`accepted receipt not found: ${input.accepted_receipt_id}`);
  const accepted = rowToGuardedReceipt(acceptedRow);
  if (accepted.outcome !== "accepted" || accepted.direction !== "forward" || accepted.target_id !== input.project_id) {
    throw new Error("rollback requires a forward accepted receipt for the same project id");
  }
  if (accepted.post_revision !== input.expected_current_revision) {
    throw new Error("rollback expected_current_revision must equal the accepted receipt post_revision");
  }
  const patch = restorePatchFromReceipt(accepted);
  const reqDigest = requestDigest(patch);
  const preDigest = preconditionDigest({ project_id: input.project_id, expected_revision: input.expected_current_revision });
  const idempotencyKey = deriveGuardedIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "inverse",
    target_id: input.project_id,
    request_digest: reqDigest,
    precondition_digest: preDigest,
  });
  const result = guardedUpdateWorkspace({
    project_id: input.project_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: "inverse",
    expected_revision: input.expected_current_revision,
    patch,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
    agent_id: input.agent_id,
    source: input.source ?? "cli",
    command: input.command,
  }, d);
  if (result.receipt?.outcome === "accepted") {
    recordWorkspaceEvent({
      workspace_id: input.project_id,
      agent_id: input.agent_id,
      event_type: "guarded_metadata_mutation_rollback",
      source: input.source ?? "cli",
      command: input.command,
      metadata: {
        receipt_id: result.receipt.receipt_id,
        accepted_receipt_id: accepted.receipt_id,
        operation_id: input.operation_id,
        step_id: input.step_id,
      },
    }, d);
  }
  return result;
}

export function linkWorkspaceIntegrations(
  id: string,
  integrations: WorkspaceIntegrations,
  input: Pick<UpdateWorkspaceInput, "agent_id" | "source" | "prompt" | "command"> = {},
  db?: Database,
): Workspace {
  const d = db || getDatabase();
  const workspace = getWorkspace(id, d);
  if (!workspace) throw new Error(`Workspace not found: ${id}`);
  const merged: WorkspaceIntegrations = { ...workspace.integrations };
  for (const [key, value] of Object.entries(integrations)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) merged[key] = trimmed;
  }
  return updateWorkspace(id, {
    integrations: merged,
    agent_id: input.agent_id,
    source: input.source,
    prompt: input.prompt,
    command: input.command,
  }, d);
}

export function archiveWorkspace(id: string, input: Omit<UpdateWorkspaceInput, "status"> = {}, db?: Database): Workspace {
  return updateWorkspace(id, { ...input, status: "archived" }, db);
}

export function unarchiveWorkspace(id: string, input: Omit<UpdateWorkspaceInput, "status"> = {}, db?: Database): Workspace {
  return updateWorkspace(id, { ...input, status: "active" }, db);
}

export function deleteWorkspace(
  id: string,
  input: Omit<UpdateWorkspaceInput, "status"> & { hard?: boolean; recordEvent?: boolean } = {},
  db?: Database,
): { workspace: Workspace; hard: boolean } {
  const d = db || getDatabase();
  const before = getWorkspace(id, d);
  if (!before) throw new Error(`Workspace not found: ${id}`);
  const { hard, recordEvent, ...updateInput } = input;

  if (!hard) {
    const workspace = updateWorkspace(id, { ...updateInput, status: "deleted" }, d);
    return { workspace, hard: false };
  }

  if (recordEvent !== false) {
    recordWorkspaceEvent({
      workspace_id: id,
      agent_id: updateInput.agent_id,
      event_type: "deleted",
      source: updateInput.source ?? "cli",
      prompt: updateInput.prompt,
      command: updateInput.command,
      before: before as unknown as JsonObject,
      metadata: { hard: true },
    }, d);
  }
  d.run("DELETE FROM workspaces WHERE id = ?", [id]);
  return { workspace: before, hard: true };
}

export interface AddWorkspaceLocationInput {
  workspace_id: string;
  path: string;
  machine_id?: string;
  label?: string;
  kind?: string;
  is_primary?: boolean;
  metadata?: JsonObject;
  agent_id?: string;
  source?: EventSource;
  prompt?: string;
  command?: string;
}

export function addWorkspaceLocation(input: AddWorkspaceLocationInput, db?: Database): WorkspaceLocation {
  const d = db || getDatabase();
  const workspace = getWorkspace(input.workspace_id, d);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspace_id}`);

  if (input.is_primary) {
    d.run("UPDATE workspace_locations SET is_primary = 0 WHERE workspace_id = ?", [input.workspace_id]);
  }

  const id = generateLocationId();
  const path = resolve(input.path);
  const localMachine = machineId();
  const machine = input.machine_id === undefined ? localMachine : input.machine_id.trim();
  if (!machine) throw new Error("Location machine must not be empty");
  const ts = now();
  d.run(
    `INSERT INTO workspace_locations (
      id, workspace_id, path, machine_id, label, kind, is_primary, exists_at_create, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, path, machine_id) DO UPDATE SET
      label = excluded.label,
      kind = excluded.kind,
      is_primary = excluded.is_primary,
      metadata = excluded.metadata`,
    [
      id,
      input.workspace_id,
      path,
      machine,
      input.label ?? "main",
      input.kind ?? "local",
      input.is_primary ? 1 : 0,
      machine === localMachine && existsSync(path) ? 1 : 0,
      json(input.metadata ?? {}),
      ts,
    ],
  );

  if (input.is_primary) {
    d.run("UPDATE workspaces SET primary_path = ?, updated_at = ? WHERE id = ?", [
      path,
      nextWorkspaceRevision(workspace.updated_at),
      input.workspace_id,
    ]);
  }

  const row = d
    .query("SELECT * FROM workspace_locations WHERE workspace_id = ? AND path = ? AND machine_id = ?")
    .get(input.workspace_id, path, machine) as WorkspaceLocationRow | null;
  if (!row) throw new Error(`Workspace location was not written: ${path}`);
  const location = rowToLocation(row);
  if (input.source || input.agent_id || input.prompt || input.command) {
    recordWorkspaceEvent({
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      event_type: "location_added",
      source: input.source ?? "system",
      prompt: input.prompt,
      command: input.command,
      after: location as unknown as JsonObject,
      metadata: { primary: location.is_primary },
    }, d);
  }
  return location;
}

export function listWorkspaceLocations(workspaceId: string, db?: Database): WorkspaceLocation[] {
  const d = db || getDatabase();
  const rows = d
    .query("SELECT * FROM workspace_locations WHERE workspace_id = ? ORDER BY is_primary DESC, created_at ASC")
    .all(workspaceId) as WorkspaceLocationRow[];
  return rows.map(rowToLocation);
}

export function getWorkspaceLocationByPath(path: string, db?: Database): WorkspaceLocation | null {
  const d = db || getDatabase();
  const absPath = resolve(path);
  const row = d
    .query("SELECT * FROM workspace_locations WHERE path = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1")
    .get(absPath) as WorkspaceLocationRow | null;
  return row ? rowToLocation(row) : null;
}

export function assignAgentToWorkspace(
  workspaceId: string,
  agentId: string,
  role = "contributor",
  assignedBy?: string,
  metadata?: JsonObject,
  db?: Database,
): WorkspaceAgentAssignment {
  const d = db || getDatabase();
  if (!getWorkspace(workspaceId, d)) throw new Error(`Workspace not found: ${workspaceId}`);
  if (!getAgent(agentId, d)) throw new Error(`Agent not found: ${agentId}`);
  d.run(
    `INSERT INTO workspace_agents (id, workspace_id, agent_id, role, assigned_by, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, agent_id, role) DO NOTHING`,
    [uuid(), workspaceId, agentId, role, assignedBy ?? null, json(metadata ?? {}), now()],
  );
  const row = d
    .query("SELECT * FROM workspace_agents WHERE workspace_id = ? AND agent_id = ? AND role = ?")
    .get(workspaceId, agentId, role) as WorkspaceAgentAssignmentRow | null;
  if (!row) throw new Error(`Workspace agent assignment was not written: ${workspaceId}/${agentId}/${role}`);
  return rowToWorkspaceAgentAssignment(row, d);
}

export function listWorkspaceAgents(workspaceId: string, db?: Database): WorkspaceAgentAssignment[] {
  const d = db || getDatabase();
  const rows = d
    .query("SELECT * FROM workspace_agents WHERE workspace_id = ? ORDER BY role ASC, created_at ASC")
    .all(workspaceId) as WorkspaceAgentAssignmentRow[];
  return rows.map((row) => rowToWorkspaceAgentAssignment(row, d));
}

export function recordWorkspaceEvent(input: RecordWorkspaceEventInput, db?: Database): WorkspaceEvent {
  const d = db || getDatabase();
  const id = generateWorkspaceEventId();
  d.run(
    `INSERT INTO workspace_events (
      id, workspace_id, agent_id, event_type, source, prompt, command,
      before_json, after_json, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.workspace_id ?? null,
      input.agent_id ?? null,
      input.event_type,
      input.source,
      input.prompt ? redactProjectText(input.prompt) : null,
      input.command ? redactProjectText(input.command) : null,
      input.before === undefined ? null : json(redactProjectValue(input.before)),
      input.after === undefined ? null : json(redactProjectValue(input.after)),
      json(redactProjectValue(input.metadata ?? {})),
      now(),
    ],
  );
  const row = d.query("SELECT * FROM workspace_events WHERE id = ?").get(id) as WorkspaceEventRow;
  return rowToEvent(row);
}

export function listWorkspaceEvents(workspaceId: string, db?: Database): WorkspaceEvent[] {
  const d = db || getDatabase();
  return (d
    .query("SELECT * FROM workspace_events WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId) as WorkspaceEventRow[]).map(rowToEvent);
}

export function listStartedWorkspaceEvents(
  options: { limit?: number } = {},
  db?: Database,
): Array<{ event: WorkspaceEvent; project_slug: string }> {
  const d = db || getDatabase();
  const params: SQLQueryBindings[] = [];
  let sql =
    `SELECT e.*, w.slug AS workspace_slug
     FROM workspace_events e
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE e.event_type = 'started'
     ORDER BY e.created_at DESC`;
  if (options.limit && options.limit > 0) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  const rows = d.query(sql).all(...params) as Array<WorkspaceEventRow & { workspace_slug: string }>;
  return rows.map((row) => ({ event: rowToEvent(row), project_slug: row.workspace_slug }));
}

/**
 * The on-box agent-run ledger (agent_runs) FK-references the LOCAL workspaces
 * table. In api/cloud mode the referenced project lives only in the cloud
 * registry, so a cloud id would violate the FK. The ledger is a machine-local
 * record of a run that happened here; keep the workspace_id only when the row
 * exists on this box, otherwise store null (the run is still fully recorded).
 */
function localWorkspaceIdOrNull(d: Database, workspaceId: string | undefined | null): string | null {
  if (!workspaceId) return null;
  const row = d.query("SELECT id FROM workspaces WHERE id = ?").get(workspaceId);
  return row ? workspaceId : null;
}

export function startAgentRun(
  input: { agent_id?: string; workspace_id?: string; provider?: string; model?: string; prompt: string; plan?: JsonObject; metadata?: JsonObject },
  db?: Database,
): AgentRun {
  const d = db || getDatabase();
  const id = generateAgentRunId();
  d.run(
    `INSERT INTO agent_runs (
      id, agent_id, workspace_id, provider, model, prompt, status,
      plan_json, tool_calls_json, metadata, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '[]', ?, ?)`,
    [
      id,
      input.agent_id ?? null,
      localWorkspaceIdOrNull(d, input.workspace_id),
      input.provider ?? null,
      input.model ?? null,
      redactProjectText(input.prompt),
      input.plan ? json(redactProjectValue(input.plan)) : null,
      json(redactProjectValue(input.metadata ?? {})),
      now(),
    ],
  );
  const row = d.query("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow;
  return rowToAgentRun(row);
}

export function completeAgentRun(
  runId: string,
  input: { status?: "completed" | "failed"; workspace_id?: string; result?: JsonObject; error?: string; tool_calls?: JsonObject[] },
  db?: Database,
): AgentRun {
  const d = db || getDatabase();
  const status = input.status ?? (input.error ? "failed" : "completed");
  d.run(
    `UPDATE agent_runs SET
      status = ?,
      workspace_id = COALESCE(?, workspace_id),
      result_json = ?,
      error = ?,
      tool_calls_json = ?,
      completed_at = ?
    WHERE id = ?`,
    [
      status,
      localWorkspaceIdOrNull(d, input.workspace_id),
      input.result ? json(redactProjectValue(input.result)) : null,
      input.error ? redactProjectText(input.error) : null,
      json(redactProjectValue(input.tool_calls ?? [])),
      now(),
      runId,
    ],
  );
  const row = d.query("SELECT * FROM agent_runs WHERE id = ?").get(runId) as AgentRunRow | null;
  if (!row) throw new Error(`Agent run not found: ${runId}`);
  return rowToAgentRun(row);
}

export function listAgentRuns(filter: { workspace_id?: string; agent_id?: string; status?: AgentRun["status"]; limit?: number } = {}, db?: Database): AgentRun[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (filter.workspace_id) { conditions.push("workspace_id = ?"); params.push(filter.workspace_id); }
  if (filter.agent_id) { conditions.push("agent_id = ?"); params.push(filter.agent_id); }
  if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return (d
    .query(`SELECT * FROM agent_runs ${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...params, filter.limit ?? 100) as AgentRunRow[]).map(rowToAgentRun);
}

function clearExpiredLocks(db: Database): void {
  db.run("DELETE FROM workspace_locks WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')");
}

export function acquireWorkspaceLock(
  input: { lock_key: string; workspace_id?: string; agent_id?: string; reason?: string; ttl_seconds?: number },
  db?: Database,
): WorkspaceLock {
  const d = db || getDatabase();
  clearExpiredLocks(d);
  const existing = d.query("SELECT * FROM workspace_locks WHERE lock_key = ?").get(input.lock_key) as WorkspaceLockRow | null;
  if (existing) {
    throw new Error(`Workspace lock already held: ${input.lock_key}`);
  }
  const id = generateWorkspaceLockId();
  const expiresAt = input.ttl_seconds
    ? new Date(Date.now() + input.ttl_seconds * 1000).toISOString().replace("T", " ").replace("Z", "")
    : null;
  d.run(
    `INSERT INTO workspace_locks (id, lock_key, workspace_id, agent_id, reason, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.lock_key, input.workspace_id ?? null, input.agent_id ?? null, input.reason ?? null, now(), expiresAt],
  );
  const row = d.query("SELECT * FROM workspace_locks WHERE id = ?").get(id) as WorkspaceLockRow;
  return rowToWorkspaceLock(row);
}

export function releaseWorkspaceLock(lockKey: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM workspace_locks WHERE lock_key = ?", [lockKey]);
  return result.changes > 0;
}

export function listWorkspaceLocks(db?: Database): WorkspaceLock[] {
  const d = db || getDatabase();
  clearExpiredLocks(d);
  return (d.query("SELECT * FROM workspace_locks ORDER BY created_at ASC").all() as WorkspaceLockRow[]).map(rowToWorkspaceLock);
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | null;
  return Boolean(row);
}

export function inferWorkspaceKind(slug: string, path: string, tags: string[] = []): WorkspaceKind {
  const text = `${slug} ${path} ${tags.join(" ")}`.toLowerCase();
  if (tags.includes("remote-only")) return "remote-only";
  if (text.includes("/companywebsite/") || slug.startsWith("cweb-")) return "company-website";
  if (text.includes("/internalapp/") || slug.startsWith("iapp-")) return "internal-app";
  if (text.includes("/platform/") || slug.startsWith("platform-")) return "platform";
  if (text.includes("/scaffold/") || slug.startsWith("scaffold-")) return "scaffold";
  if (text.includes("/community/") || slug.startsWith("community-")) return "community";
  if (slug.startsWith("open-") || text.includes("/opensource/")) return "open-source";
  if (slug.startsWith("project-") || text.includes("/project/")) return "project";
  return "generic";
}

function inferRootForLegacyPath(path: string, kind: WorkspaceKind, db: Database): Root {
  const absPath = resolve(path);
  const candidates = [
    { slug: "hasna-open-dev", base: "/home/hasna/workspace/hasna/opensource/opensourcedev", name: "Hasna Open Source Dev", template: "open-{slug}", tag: "open-source" },
    { slug: "hasna-open", base: "/home/hasna/workspace/hasna/opensource", name: "Hasna Open Source", template: "{slug}", tag: "open-source" },
    { slug: "hasnaxyz-projects", base: "/home/hasna/workspace/hasnaxyz/project", name: "Hasna XYZ Projects", template: "project-{slug}", tag: "project" },
    { slug: "hasnaxyz-internal", base: "/home/hasna/workspace/hasnaxyz/internalapp", name: "Hasna XYZ Internal Apps", template: "iapp-{slug}", tag: "internal" },
    { slug: "hasnaxyz-companywebsites", base: "/home/hasna/workspace/hasnaxyz/companywebsite", name: "Hasna XYZ Company Websites", template: "cweb-{slug}", tag: "companywebsite" },
    { slug: "hasnatools-platform", base: "/home/hasna/workspace/hasnatools/platform", name: "Hasna Tools Platform", template: "platform-{slug}", tag: "platform" },
    { slug: "hasnastudio-platform", base: "/home/hasna/workspace/hasnastudio/platform", name: "Hasna Studio Platform", template: "platform-{slug}", tag: "platform" },
    { slug: "hasna-scaffold", base: "/home/hasna/workspace/hasna/scaffold", name: "Hasna Scaffolds", template: "scaffold-{slug}", tag: "scaffold" },
    { slug: "hasna-community", base: "/home/hasna/workspace/hasna/community", name: "Hasna Community", template: "community-{slug}", tag: "community" },
  ];
  const matched = candidates.find((candidate) => absPath.startsWith(`${candidate.base}/`) || absPath === candidate.base);
  if (matched) {
    const existing = getRootBySlug(matched.slug, db);
    if (existing) return existing;
    return createRoot({
      slug: matched.slug,
      name: matched.name,
      base_path: matched.base,
      tags: [matched.tag],
      default_kind: kind,
      path_template: matched.template,
    }, db);
  }

  const base = dirname(absPath);
  const slug = `root-${workspaceSlugify(base.replace(/^\/+/, ""))}`;
  const existing = getRootBySlug(slug, db);
  if (existing) return existing;
  return createRoot({
    slug,
    name: base.split("/").filter(Boolean).slice(-2).join(" / ") || base,
    base_path: base,
    default_kind: kind,
    path_template: "{slug}",
  }, db);
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  roots_created_or_reused: number;
  workdirs_migrated: number;
  workdirs_skipped: number;
  before: MigrationCounts;
  after: MigrationCounts;
  validation: MigrationValidation;
  samples: MigrationSample[];
}

export interface MigrationCounts {
  legacy_projects: number;
  legacy_workdirs: number;
  migration_map: number;
  workspaces: number;
  workspace_locations: number;
}

export interface MigrationValidation {
  valid: boolean;
  expected_legacy_projects: number;
  accounted_projects: number;
  missing_projects: number;
  workdir_source_count: number;
  workdir_migrated: number;
  workdir_skipped: number;
  expected_migration_map_rows: number;
  actual_migration_map_rows: number;
  missing_migration_map_rows: number;
  expected_workspace_locations_at_least: number;
  actual_workspace_locations: number;
}

export interface MigrationSample {
  old_project_id: string;
  workspace_id: string;
  old_slug: string;
  workspace_slug: string;
  old_path: string;
  workspace_path: string | null;
}

interface LegacyProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  path: string;
  s3_bucket: string | null;
  s3_prefix: string | null;
  git_remote: string | null;
  tags: string | null;
  integrations: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  last_opened_at?: string | null;
}

interface LegacyWorkdirRow {
  id?: string | null;
  project_id: string;
  path: string;
  machine_id?: string | null;
  label: string | null;
  is_primary: number | null;
  claude_md_generated?: number | null;
  agents_md_generated?: number | null;
  created_at: string | null;
}

function tableCount(db: Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  return (db.query(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
}

function migrationCounts(db: Database): MigrationCounts {
  return {
    legacy_projects: tableCount(db, "projects"),
    legacy_workdirs: tableCount(db, "project_workdirs"),
    migration_map: tableCount(db, "workspace_migration_map"),
    workspaces: tableCount(db, "workspaces"),
    workspace_locations: tableCount(db, "workspace_locations"),
  };
}

function listLegacyProjects(db: Database): LegacyProjectRow[] {
  if (!tableExists(db, "projects")) return [];
  return db.query("SELECT * FROM projects ORDER BY created_at ASC").all() as LegacyProjectRow[];
}

function listLegacyWorkdirs(db: Database): LegacyWorkdirRow[] {
  if (!tableExists(db, "project_workdirs")) return [];
  return db.query("SELECT * FROM project_workdirs ORDER BY created_at ASC").all() as LegacyWorkdirRow[];
}

function migrateLegacyWorkdirs(db: Database): { migrated: number; skipped: number } {
  let migrated = 0;
  let skipped = 0;
  for (const workdir of listLegacyWorkdirs(db)) {
    const mapped = db.query("SELECT workspace_id FROM workspace_migration_map WHERE old_project_id = ?").get(workdir.project_id) as { workspace_id: string } | null;
    if (!mapped) {
      skipped++;
      continue;
    }
    const workspace = getWorkspace(mapped.workspace_id, db);
    if (!workspace) {
      skipped++;
      continue;
    }
    const path = resolve(workdir.path);
    const machine = workdir.machine_id || machineId();
    const existsAtCreate = machine === machineId() && existsSync(path);
    const existing = db.query(
      "SELECT id FROM workspace_locations WHERE workspace_id = ? AND path = ? AND machine_id = ?",
    ).get(mapped.workspace_id, path, machine) as { id: string } | null;
    const isPrimary = Boolean(workdir.is_primary);
    if (isPrimary) {
      db.run("UPDATE workspace_locations SET is_primary = 0 WHERE workspace_id = ?", [mapped.workspace_id]);
    }
    const metadata = json({
      migrated_from_project_workdir: true,
      migrated_from_workdir_id: workdir.id ?? null,
      old_project_id: workdir.project_id,
      claude_md_generated: Boolean(workdir.claude_md_generated),
      agents_md_generated: Boolean(workdir.agents_md_generated),
    });
    if (existing) {
      db.run(
        `UPDATE workspace_locations
         SET label = ?, kind = ?, is_primary = ?, exists_at_create = ?, metadata = ?
         WHERE id = ?`,
        [workdir.label || "main", "local", isPrimary ? 1 : 0, existsAtCreate ? 1 : 0, metadata, existing.id],
      );
      skipped++;
    } else {
      db.run(
        `INSERT INTO workspace_locations (
          id, workspace_id, path, machine_id, label, kind, is_primary, exists_at_create, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateLocationId(),
          mapped.workspace_id,
          path,
          machine,
          workdir.label || "main",
          "local",
          isPrimary ? 1 : 0,
          existsAtCreate ? 1 : 0,
          metadata,
          workdir.created_at ?? now(),
        ],
      );
      migrated++;
    }
    if (isPrimary || !workspace.primary_path) {
      db.run("UPDATE workspaces SET primary_path = ?, updated_at = ? WHERE id = ?", [path, now(), mapped.workspace_id]);
    }
  }
  return { migrated, skipped };
}

function migrationSamples(db: Database, limit = 5): MigrationSample[] {
  if (!tableExists(db, "projects")) return [];
  return db.query(`
    SELECT
      p.id as old_project_id,
      m.workspace_id as workspace_id,
      p.slug as old_slug,
      w.slug as workspace_slug,
      p.path as old_path,
      w.primary_path as workspace_path
    FROM workspace_migration_map m
    JOIN projects p ON p.id = m.old_project_id
    JOIN workspaces w ON w.id = m.workspace_id
    ORDER BY p.created_at ASC
    LIMIT ?
  `).all(limit) as MigrationSample[];
}

function migrationValidation(before: MigrationCounts, after: MigrationCounts, workdirs = { migrated: 0, skipped: 0 }): MigrationValidation {
  const expectedMapRows = before.legacy_projects;
  const actualMapRows = after.migration_map;
  const expectedLocations = before.legacy_projects + before.legacy_workdirs;
  const accountedProjects = actualMapRows;
  const missingProjects = Math.max(0, before.legacy_projects - accountedProjects);
  const accountedWorkdirs = workdirs.migrated + workdirs.skipped;
  return {
    valid: missingProjects === 0 && accountedWorkdirs >= before.legacy_workdirs && after.workspace_locations >= before.workspace_locations,
    expected_legacy_projects: before.legacy_projects,
    accounted_projects: accountedProjects,
    missing_projects: missingProjects,
    workdir_source_count: before.legacy_workdirs,
    workdir_migrated: workdirs.migrated,
    workdir_skipped: workdirs.skipped,
    expected_migration_map_rows: expectedMapRows,
    actual_migration_map_rows: actualMapRows,
    missing_migration_map_rows: Math.max(0, expectedMapRows - actualMapRows),
    expected_workspace_locations_at_least: expectedLocations,
    actual_workspace_locations: after.workspace_locations,
  };
}

export function migrateLegacyProjectsToWorkspaces(db?: Database): MigrationResult {
  const d = db || getDatabase();
  const before = migrationCounts(d);
  if (!tableExists(d, "projects")) {
    const after = migrationCounts(d);
    return {
      migrated: 0,
      skipped: 0,
      roots_created_or_reused: 0,
      workdirs_migrated: 0,
      workdirs_skipped: 0,
      before,
      after,
      validation: migrationValidation(before, after),
      samples: [],
    };
  }

  const rows = listLegacyProjects(d);

  let migrated = 0;
  let skipped = 0;
  const roots = new Set<string>();
  const migrationAgent = getAgentBySlug("migration", d) ?? createAgent({ slug: "migration", name: "Migration", kind: "service", role: "migration" }, d);

  for (const row of rows) {
    const existing = d.query("SELECT workspace_id FROM workspace_migration_map WHERE old_project_id = ?").get(row.id) as { workspace_id: string } | null;
    if (existing) {
      skipped++;
      continue;
    }

    const tags = parseJson<string[]>(row.tags, []);
    const kind = inferWorkspaceKind(row.slug, row.path, tags);
    const root = inferRootForLegacyPath(row.path, kind, d);
    roots.add(root.id);

    const workspace = createWorkspace({
      name: row.name,
      slug: row.slug,
      description: row.description ?? undefined,
      kind,
      root_id: root.id,
      primary_path: row.path,
      git_remote: row.git_remote ?? undefined,
      s3_bucket: row.s3_bucket ?? undefined,
      s3_prefix: row.s3_prefix ?? undefined,
      tags,
      integrations: parseJson<WorkspaceIntegrations>(row.integrations, {}),
      metadata: {
        migrated_from_project_id: row.id,
        migration_inference: {
          kind,
          root_id: root.id,
          root_slug: root.slug,
          confidence: root.base_path && resolve(row.path).startsWith(root.base_path) ? 1 : 0.7,
        },
      },
      agent_id: migrationAgent.id,
      source: "migration",
      command: "migrateLegacyProjectsToWorkspaces",
    }, d);

    d.run("UPDATE workspaces SET status = ?, created_at = ?, updated_at = ?, synced_at = ?, last_opened_at = ? WHERE id = ?", [
      row.status === "archived" ? "archived" : "active",
      row.created_at,
      row.updated_at,
      row.synced_at ?? null,
      row.last_opened_at ?? null,
      workspace.id,
    ]);
    d.run("INSERT INTO workspace_migration_map (old_project_id, workspace_id, metadata) VALUES (?, ?, ?)", [
      row.id,
      workspace.id,
      json({ old_slug: row.slug, old_path: row.path }),
    ]);
    migrated++;
  }
  const workdirs = migrateLegacyWorkdirs(d);
  const after = migrationCounts(d);

  return {
    migrated,
    skipped,
    roots_created_or_reused: roots.size,
    workdirs_migrated: workdirs.migrated,
    workdirs_skipped: workdirs.skipped,
    before,
    after,
    validation: migrationValidation(before, after, workdirs),
    samples: migrationSamples(d),
  };
}
