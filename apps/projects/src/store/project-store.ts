// Unified projects registry Store seam.
//
// ONE interface (`ProjectStore`) with two transports behind it:
//   - LocalProjectStore  -> on-box sqlite (src/db/workspaces.ts)
//   - ApiProjectStore    -> HTTP `<API_URL>/v1` + bearer key (via the shared
//                          @hasna/contracts/client/storage seam, not a vendored copy)
//
// `resolveProjectStore()` routes on the CREDENTIAL AND THE AUTHORITY ONLY —
// there is no mode switch, no `*_STORAGE_MODE`, and no local-registry opt-in
// (owner rulings 2026-09-04, hasna/apps#1720/#1668/#1690). The whole decision
// is the @hasna/contracts client resolver's five-tier ladder, resolved fresh on
// every call:
//
//   1. an explicit argument            — a caller-supplied key
//   2. a deliberate env pointer        — HASNA_PROJECTS_API_KEY_OVERRIDE,
//                                        HASNA_PROFILE, HASNA_PROJECTS_API_KEY_REF
//   3. the macOS Keychain              — hasna.credentials.projects.api-key,
//                                        account HASNA_STATION -> hostname -s -> USER
//   4. disk, read at call time         — ~/.hasna/projects/config/credentials
//                                        (0400/0600; HASNA_HOME / HASNA_CONFIG_HOME
//                                        override the roots; XDG is never read)
//   5. HASNA_PROJECTS_API_KEY in the env — a legitimate tier, below disk, no notice
//
// The authority follows the same ladder (HASNA_PROJECTS_API_URL, the Keychain
// `api-url` item, the credentials file) and defaults to the path-prefixed fleet
// gateway `https://api.hasna.com/projects` once a credential resolves — URLs
// never need configuring. The unprefixed PROJECTS_API_URL / PROJECTS_API_KEY
// names remain accepted by the seam as a documented silent alias; the canonical
// HASNA_PROJECTS_* names always work and win.
//
// THE TWO OUTCOMES:
//   - Anything selects the hosted service (a credential from any tier, or an
//     authority declared anywhere) -> the HTTP store. A declared authority with
//     NO resolvable credential FAILS LOUD: the caller exits non-zero with the
//     seam's message naming every place it looked. There is no silent local
//     fallback and no local-fallback event.
//   - NOTHING configures the fleet at all — no URL in the env, the Keychain or
//     the credentials file, and no credential from any tier -> unhosted OSS
//     mode on the on-box SQLite registry, which projects supports by design.
//     It says so on stderr, once, in one line; it is never silent.
//
// Every registry command/tool/method calls the same Store methods. Machine-local
// runtime side effects (tmux, git, directory creation, rendering) are NOT
// shared state and stay local by design; callers gate those on transport.
//
// SAFETY: the HTTP transport carries a bearer key ONLY (never a DB DSN). The key
// value is never logged or embedded in output.

import {
  acquireWorkspaceLock,
  addWorkspaceLocation as dbAddWorkspaceLocation,
  archiveWorkspace as dbArchiveWorkspace,
  assignAgentToWorkspace as dbAssignAgentToWorkspace,
  createAgent as dbCreateAgent,
  createRecipe as dbCreateRecipe,
  createRoot as dbCreateRoot,
  createWorkspace as dbCreateWorkspace,
  deleteRoot as dbDeleteRoot,
  deleteWorkspace as dbDeleteWorkspace,
  guardedUpdateWorkspace as dbGuardedUpdateWorkspace,
  getAgent as dbGetAgent,
  getAgentBySlug as dbGetAgentBySlug,
  getWorkspace as dbGetWorkspace,
  getRecipe as dbGetRecipe,
  getRecipeBySlug as dbGetRecipeBySlug,
  getRoot as dbGetRoot,
  getRootBySlug as dbGetRootBySlug,
  addTmuxProfileWindow as dbAddTmuxProfileWindow,
  createTmuxProfile as dbCreateTmuxProfile,
  listAgentRuns as dbListAgentRuns,
  listAgents as dbListAgents,
  listRecipes as dbListRecipes,
  listRoots as dbListRoots,
  listTmuxProfileWindows as dbListTmuxProfileWindows,
  listTmuxProfiles as dbListTmuxProfiles,
  resolveTmuxProfile as dbResolveTmuxProfile,
  listWorkspaceAgents as dbListWorkspaceAgents,
  listWorkspaceEvents as dbListWorkspaceEvents,
  listWorkspaceLocations as dbListWorkspaceLocations,
  listMachines as dbListMachines,
  listWorkspaceLocks as dbListWorkspaceLocks,
  listProjectResourceLinks as dbListProjectResourceLinks,
  lookupGuardedWorkspaceMutationReceipt as dbLookupGuardedWorkspaceMutationReceipt,
  mutateProjectResourceLinks as dbMutateProjectResourceLinks,
  mutateProjectResourceLinksForRegistration as dbMutateProjectResourceLinksForRegistration,
  advanceProjectResourceLinkMigration as dbAdvanceProjectResourceLinkMigration,
  planProjectResourceLinkMigration as dbPlanProjectResourceLinkMigration,
  readProjectResourceLinkMigration as dbReadProjectResourceLinkMigration,
  readProjectResourceLinks as dbReadProjectResourceLinks,
  countWorkspaces as dbCountWorkspaces,
  listWorkspaces as dbListWorkspaces,
  rankRoots,
  recordWorkspaceEvent as dbRecordWorkspaceEvent,
  releaseWorkspaceLock,
  forceReleaseWorkspaceLock,
  rollbackGuardedWorkspaceMutation as dbRollbackGuardedWorkspaceMutation,
  quarantineDuplicateProject as dbQuarantineDuplicateProject,
  readDuplicateProjectQuarantinePreimage as dbReadDuplicateProjectQuarantinePreimage,
  rollbackDuplicateProjectQuarantine as dbRollbackDuplicateProjectQuarantine,
  rollbackProjectResourceLinks as dbRollbackProjectResourceLinks,
  rollbackProjectResourceLinkMigration as dbRollbackProjectResourceLinkMigration,
  resolveWorkspace as dbResolveWorkspace,
  scoreRoots as dbScoreRoots,
  unarchiveWorkspace as dbUnarchiveWorkspace,
  updateRoot as dbUpdateRoot,
  updateWorkspace as dbUpdateWorkspace,
  type RootMatchInput,
  type RootMatchResult,
  type WorkspaceFilter,
} from "../db/workspaces.js";
import {
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";
import {
  clientTransportEnvKeys,
  credentialDiskSources,
  type CredentialChainOptions,
} from "@hasna/contracts/client";
import { unconfiguredForHostedUse } from "../lib/client-configuration.js";
import type { HasnaHttpTransport, HasnaRequestOptions, QueryParams } from "@hasna/contracts/client";
import { getDbPath } from "../db/database.js";
import { basename } from "node:path";
import {
  isProjectDirectory,
  normalizeProjectPath,
  resolveRegisteredProjectTargetOrThrow,
  type ProjectResolverOptions,
} from "../lib/project-resolver.js";
import {
  isProjectWorkspaceStorePath,
  PROJECT_WORKSPACE_ID_PATTERN,
} from "../lib/project-store-paths.js";
import { collectCompletePages, collectPages, type CompletePage } from "./paginate.js";
import {
  createProjectDataModel as dbCreateProjectDataModel,
  createProjectDataRecord as dbCreateProjectDataRecord,
  inspectProjectStore as dbInspectProjectStore,
  inspectProjectStoreWithLoops as dbInspectProjectStoreWithLoops,
  linkProjectLoop as dbLinkProjectLoop,
  listProjectDataModels as dbListProjectDataModels,
  listProjectDataRecords as dbListProjectDataRecords,
  listProjectLoopLinks as dbListProjectLoopLinks,
  listProjectLoopSummaries as dbListProjectLoopSummaries,
  type CreateProjectDataModelInput,
  type CreateProjectDataRecordInput,
  type LinkProjectLoopInput,
  type ProjectDataModel,
  type ProjectDataRecord,
  type ProjectLoopLink,
  type ProjectLoopSummary,
  type ProjectStoreSummary,
} from "../db/project-store.js";
import {
  createProjectBudget as dbCreateProjectBudget,
  getProjectBudgetStatuses as dbGetProjectBudgetStatuses,
  listProjectBudgets as dbListProjectBudgets,
  recordProjectSpend as dbRecordProjectSpend,
  resetProjectBudget as dbResetProjectBudget,
  type CreateProjectBudgetInput,
  type ProjectBudget,
  type ProjectBudgetContext,
  type ProjectBudgetSpend,
  type ProjectBudgetStatus,
  type ProjectSpendInput,
} from "../lib/budget.js";
import {
  ensureProjectChannelViaStore,
  type ProjectChannelEnsureResult,
  type StoreEnsureChannelOptions,
} from "../lib/project-channel.js";
import {
  assertCompleteStableProjectId,
  assertPositiveBounds,
  buildGuardedProjectReadResult,
  canonicalJson,
  deriveGuardedIdempotencyKey,
  preconditionDigest,
  sha256,
  withResponseControl,
} from "../lib/guarded-project-mutation.js";
import {
  normalizeProjectResourceLinkIntegrations,
  assertProjectResourceLinkReadContractEquality,
  normalizeProjectResourceLinks,
} from "../lib/project-resource-links.js";
import {
  projectResourceLinkProducerProjectSubject,
  reconcileProjectResourceLinkProducerProof,
  type AsyncProjectResourceLinkProducerEvidenceVerifier,
  type ProjectResourceLinkProducerAttestationPhase,
  type ProjectResourceLinkProducerEvidenceVerifier,
  type ProjectResourceLinkProducerVerificationInput,
} from "../lib/project-resource-link-migrations.js";
import {
  createProductionProjectResourceLinkProducerEvidenceVerifier,
} from "../lib/project-resource-link-producer-verifier.js";
import {
  productionProjectRegistrationAuthorities,
  type ProductionProjectRegistrationAuthorityOptions,
} from "../lib/production-project-registration-authorities.js";
import { normalizeProjectMetadata } from "../lib/project-management.js";
import type {
  Agent,
  AgentRun,
  CreateAgentInput,
  CreateRecipeInput,
  CreateRootInput,
  CreateWorkspaceInput,
  EventSource,
  GuardedProjectMutationReceiptLookupInput,
  GuardedProjectMutationReceiptLookupResult,
  GuardedProjectReadRequest,
  GuardedProjectReadResult,
  GuardedProjectMutationRequest,
  GuardedProjectMutationResult,
  GuardedProjectMutationRollbackRequest,
  JsonObject,
  ProjectQuarantineRequest,
  ProjectQuarantineReadRequest,
  ProjectQuarantineReadResult,
  ProjectQuarantineResult,
  ProjectQuarantineRollbackRequest,
  ProjectResourceLinkMutationRequest,
  ProjectResourceLinkMutationResult,
  ProjectResourceLinkMigrationAdvanceRequest,
  ProjectResourceLinkMigrationPlanRequest,
  ProjectResourceLinkMigrationReadRequest,
  ProjectResourceLinkMigrationResult,
  ProjectResourceLinkMigrationRollbackRequest,
  ProjectResourceLinkReadRequest,
  ProjectResourceLinkReadResult,
  ProjectResourceLinkRollbackRequest,
  CreateTmuxProfileInput,
  CreateTmuxProfileWindowInput,
  Recipe,
  Root,
  TmuxProfile,
  TmuxProfileWindow,
  UpdateRootInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceAgentAssignment,
  WorkspaceEvent,
  WorkspaceLocation,
  WorkspaceLock,
  Machine,
} from "../types/workspace.js";

const APP = "projects";
const RESOURCE = "projects";

/** Process-environment shape accepted by the shared @hasna/contracts seam. */
type Env = Record<string, string | undefined>;

export type ProjectStoreTransport = "local" | "http";

/** Mutation provenance carried on every write (agent + audit trail). */
export interface MutationContext {
  agentId?: string;
  source?: EventSource;
  command?: string;
  prompt?: string;
  reason?: string;
}

export interface DeleteProjectResult {
  /** The deleted project row when the transport can return it (always local). */
  workspace: Workspace | null;
  hard: boolean;
  /** Stable identifier for the deleted project (id or slug). */
  id: string;
}

export interface DeleteRootResult {
  root: Root;
  detached_workspaces: number;
}

/** Explicit audit-event write (routes through the Store, never raw sqlite). */
export interface RecordEventInput {
  event_type: string;
  source: EventSource;
  agentId?: string;
  prompt?: string;
  command?: string;
  before?: JsonObject | null;
  after?: JsonObject | null;
  metadata?: JsonObject;
}

/** Filter for the prompt-agent run ledger read (on-box sub-resource). */
export interface AgentRunFilter {
  workspace_id?: string;
  agent_id?: string;
  status?: AgentRun["status"];
  limit?: number;
}

/** Assign a registered agent to a project role (on-box sub-resource). */
export interface AssignAgentInput {
  /** Already-resolved agent id. */
  agentId: string;
  role?: string;
  assignedBy?: string;
  metadata?: JsonObject;
  source?: EventSource;
  command?: string;
}

/** Register another on-disk location for a project (on-box sub-resource). */
export interface AddLocationInput {
  path: string;
  machineId?: string;
  label?: string;
  kind?: string;
  isPrimary?: boolean;
  metadata?: JsonObject;
  agentId?: string;
  source?: EventSource;
  command?: string;
}

export interface AddLocationResult {
  project: Workspace;
  location: WorkspaceLocation;
}

/** Acquire a project mutation lock (machine-local coordination primitive). */
export interface AcquireLockInput {
  key: string;
  workspaceId?: string;
  agentId?: string;
  reason?: string;
  ttlSeconds?: number;
}

/**
 * Operations that only exist on-box. Agent assignments, extra disk locations
 * and mutation locks are now modeled by the hosted /v1 API; project budgets
 * and spend remain machine-local sub-resources with no hosted routes, so any
 * budget/spend access (reads included) in the hosted transport throws this rather than
 * silently writing local sqlite or returning an empty ledger (split-brain).
 */
class LocalOnlyOperationError extends Error {
  constructor(operation: string) {
    super(`${operation} is a local-only operation and is not available in the hosted backend.`);
    this.name = "LocalOnlyOperationError";
  }
}

/**
 * A project list plus the metadata a caller needs to know whether it is the
 * whole set. `projects list --json` used to emit a bare array that was capped
 * server-side, so a truncated read and a complete one looked identical; every
 * bounded read now carries `total`/`has_more`/`complete`.
 */
export interface ProjectListPage {
  readonly projects: Workspace[];
  /** Rows returned in this page. */
  readonly count: number;
  /** Rows matching the filter, ignoring limit/offset. */
  readonly total: number;
  /** Offset this page started at. */
  readonly offset: number;
  /** Caller-requested bound, or null when the caller asked for everything. */
  readonly limit: number | null;
  /** More rows exist past this page. */
  readonly has_more: boolean;
  /** Every matching row is present (i.e. `offset === 0 && !has_more`). */
  readonly complete: boolean;
}

export interface CompleteProjectPopulation {
  readonly projects: Workspace[];
  readonly total: number;
  readonly pages: number;
  readonly complete: true;
}

export interface ProjectStore {
  readonly transport: ProjectStoreTransport;
  /** Base `<url>/v1` for the hosted transport; null for local. Never contains the key. */
  readonly baseUrl: string | null;
  /**
   * List projects. With no `limit` this returns EVERY matching row — the store
   * walks the server's pages itself rather than handing back one capped page.
   */
  listProjects(filter?: WorkspaceFilter): Promise<Workspace[]>;
  /** Full population read with a stable producer total and terminal invariant. */
  listProjectsComplete(filter?: Omit<WorkspaceFilter, "limit" | "offset">): Promise<CompleteProjectPopulation>;
  /** As `listProjects`, plus the totals that make a bounded read detectable. */
  listProjectsPage(filter?: WorkspaceFilter): Promise<ProjectListPage>;
  getProject(idOrSlug: string): Promise<Workspace | null>;
  /**
   * Resolve a caller-supplied target to a single project, throwing if none
   * matches. Local resolves by id/slug/name and — as a machine-local
   * convenience — by on-disk path/marker. Api resolves by id/slug server-side.
   */
  resolveTarget(target: string | undefined, options?: ProjectResolverOptions): Promise<Workspace>;
  createProject(input: CreateWorkspaceInput): Promise<Workspace>;
  updateProject(id: string, patch: UpdateWorkspaceInput): Promise<Workspace>;
  guardedReadProject(input: GuardedProjectReadRequest): Promise<GuardedProjectReadResult>;
  readProjectResourceLinks(input: ProjectResourceLinkReadRequest): Promise<ProjectResourceLinkReadResult>;
  mutateProjectResourceLinks(input: ProjectResourceLinkMutationRequest): Promise<ProjectResourceLinkMutationResult>;
  rollbackProjectResourceLinks(input: ProjectResourceLinkRollbackRequest): Promise<ProjectResourceLinkMutationResult>;
  readDuplicateProjectQuarantinePreimage(input: ProjectQuarantineReadRequest): Promise<ProjectQuarantineReadResult>;
  quarantineDuplicateProject(input: ProjectQuarantineRequest): Promise<ProjectQuarantineResult>;
  rollbackDuplicateProjectQuarantine(input: ProjectQuarantineRollbackRequest): Promise<ProjectQuarantineResult>;
  planProjectResourceLinkMigration(input: ProjectResourceLinkMigrationPlanRequest): Promise<ProjectResourceLinkMigrationResult>;
  readProjectResourceLinkMigration(input: ProjectResourceLinkMigrationReadRequest): Promise<ProjectResourceLinkMigrationResult>;
  advanceProjectResourceLinkMigration(input: ProjectResourceLinkMigrationAdvanceRequest): Promise<ProjectResourceLinkMigrationResult>;
  rollbackProjectResourceLinkMigration(input: ProjectResourceLinkMigrationRollbackRequest): Promise<ProjectResourceLinkMigrationResult>;
  guardedUpdateProject(input: GuardedProjectMutationRequest): Promise<GuardedProjectMutationResult>;
  lookupGuardedProjectMutationReceipt(input: GuardedProjectMutationReceiptLookupInput): Promise<GuardedProjectMutationReceiptLookupResult>;
  rollbackGuardedProjectMutation(input: GuardedProjectMutationRollbackRequest): Promise<GuardedProjectMutationResult>;
  archiveProject(id: string, ctx?: MutationContext): Promise<Workspace>;
  unarchiveProject(id: string, ctx?: MutationContext): Promise<Workspace>;
  deleteProject(id: string, opts: { hard?: boolean }, ctx?: MutationContext): Promise<DeleteProjectResult>;
  listEvents(idOrSlug: string, limit?: number): Promise<WorkspaceEvent[]>;
  /** Record an explicit audit event. Local writes sqlite; api POSTs to /projects/:id/events. */
  recordEvent(idOrSlug: string, input: RecordEventInput): Promise<WorkspaceEvent>;
  /**
   * Per-project agent assignments. This is an on-box sub-resource; the api
   * transport does not model it server-side and returns an empty list.
   */
  getProjectAgents(id: string): Promise<WorkspaceAgentAssignment[]>;
  /** Assign a registered agent to a project role. Local-only (throws in the hosted transport). */
  assignAgent(idOrSlug: string, input: AssignAgentInput): Promise<WorkspaceAgentAssignment>;
  /** Per-project registered locations. Readable from both registry transports. */
  getProjectLocations(id: string): Promise<WorkspaceLocation[]>;
  /** Registry of canonical machines (roles: mirror-hub | assignable | avoid). */
  listMachines(): Promise<Machine[]>;
  /** Register another on-disk location for a project. Local-only (throws in the hosted transport). */
  addLocation(idOrSlug: string, input: AddLocationInput): Promise<AddLocationResult>;

  // ---- Mutation locks (machine-local coordination) ----
  listLocks(): Promise<WorkspaceLock[]>;
  acquireLock(input: AcquireLockInput): Promise<WorkspaceLock>;
  // Holder-scoped release (regression 6692dc56): the caller passes the acquired
  // lock's unique id, so a stale holder cannot delete a successor's live lock.
  releaseLock(key: string, lockId: string): Promise<boolean>;
  // Deliberate administrative release by key alone (CLI `unlock`, MCP
  // projects_unlock). By-key release is the unsafe shape when used
  // automatically, so only these named admin verbs route here.
  forceReleaseLock(key: string): Promise<boolean>;

  // ---- Roots (shared registry: /v1/roots) ----
  listRoots(): Promise<Root[]>;
  getRoot(idOrSlug: string): Promise<Root | null>;
  createRoot(input: CreateRootInput): Promise<Root>;
  updateRoot(idOrSlug: string, patch: UpdateRootInput): Promise<Root>;
  deleteRoot(idOrSlug: string, opts?: { detachProjects?: boolean }): Promise<DeleteRootResult>;
  /** Score registered roots by path/kind/tags/github_org (behaves identically in both transports). */
  matchRoots(input: RootMatchInput): Promise<RootMatchResult[]>;

  // ---- Agents (shared registry: /v1/agents) ----
  listAgents(): Promise<Agent[]>;
  getAgent(idOrSlug: string): Promise<Agent | null>;
  createAgent(input: CreateAgentInput): Promise<Agent>;

  // ---- Recipes (shared registry: /v1/recipes) ----
  listRecipes(): Promise<Recipe[]>;
  getRecipe(idOrSlug: string): Promise<Recipe | null>;
  createRecipe(input: CreateRecipeInput): Promise<Recipe>;

  // ---- Prompt-agent run ledger (on-box sub-resource) ----
  // Agent runs are recorded on-box during local prompt-agent execution; the
  // projects API server does not model them, so the HTTP transport returns an
  // empty list rather than reading a local sqlite file the hosted project does
  // not own. This keeps the runs/handoff surfaces from split-brain reads.
  listAgentRuns(filter?: AgentRunFilter): Promise<AgentRun[]>;

  // ---- Per-project data models & records (on-box project.db sub-resource) ----
  listDataModels(project: Workspace): Promise<ProjectDataModel[]>;
  createDataModel(project: Workspace, input: CreateProjectDataModelInput, ctx?: MutationContext): Promise<ProjectDataModel>;
  listDataRecords(project: Workspace, modelId: string): Promise<ProjectDataRecord[]>;
  createDataRecord(project: Workspace, input: CreateProjectDataRecordInput, ctx?: MutationContext): Promise<ProjectDataRecord>;

  // ---- Project <-> OpenLoops links (on-box project.db sub-resource) ----
  listLoopLinks(project: Workspace): Promise<ProjectLoopLink[]>;
  linkLoop(project: Workspace, input: LinkProjectLoopInput, ctx?: MutationContext): Promise<ProjectLoopLink>;
  listLoopSummaries(project: Workspace, options?: { includeRuns?: boolean; runLimit?: number }): Promise<ProjectLoopSummary[]>;
  inspectAppStore(project: Workspace): Promise<ProjectStoreSummary>;
  inspectAppStoreWithLoops(project: Workspace, options?: { includeRuns?: boolean }): Promise<ProjectStoreSummary>;

  // ---- Project/run budgets & audited spend (on-box governance sub-resource) ----
  createBudget(input: CreateProjectBudgetInput): Promise<ProjectBudget>;
  listBudgets(context?: ProjectBudgetContext): Promise<ProjectBudget[]>;
  getBudgetStatuses(context?: ProjectBudgetContext): Promise<ProjectBudgetStatus[]>;
  resetBudget(id: string): Promise<ProjectBudget>;
  recordSpend(input: ProjectSpendInput): Promise<ProjectBudgetSpend>;

  // ---- tmux profiles (machine-local runtime resource) ----
  // tmux is a machine-local construct: a tmux server runs on THIS box, so saved
  // window-layout profiles live on the box that runs tmux and resolve against
  // local sqlite in BOTH transports. They are deliberately NOT part of the
  // shared hosted registry (there is no `/v1/tmux-profiles` endpoint), but every
  // command still routes through the Store so nothing touches sqlite directly.
  listTmuxProfiles(): Promise<TmuxProfile[]>;
  getTmuxProfile(idOrSlug: string): Promise<TmuxProfile | null>;
  createTmuxProfile(input: CreateTmuxProfileInput): Promise<TmuxProfile>;
  addTmuxProfileWindow(input: CreateTmuxProfileWindowInput & { profile_id: string }): Promise<TmuxProfileWindow>;
  listTmuxProfileWindows(profileId: string): Promise<TmuxProfileWindow[]>;

  // ---- Conversations channel (works in BOTH transports) ----
  // Channel derivation is pure and channel creation is a machine-local side
  // effect. Ensure does not write the project record; the audit event routes
  // through the Store so it lands wherever the project lives (local or hosted).
  ensureChannel(project: Workspace, options?: StoreEnsureChannelOptions): Promise<ProjectChannelEnsureResult>;
}

// --------------------------------------------------------------------------
// Local transport (on-box sqlite)
// --------------------------------------------------------------------------

function withLock<T>(workspaceId: string, ctx: MutationContext | undefined, reason: string, fn: () => T): T {
  const key = `workspace:${workspaceId}`;
  // `workspace_locks.workspace_id` is FK-constrained to the machine-local
  // `workspaces` table (db/schema.ts). Since the app-store methods are now also
  // reachable in the hosted transport, the project may be hosted-only and have no local
  // registry row, in which case supplying the id fails the FK and the write
  // never reaches the local project.db.
  //
  // The column is nullable and mutual exclusion keys on the UNIQUE `lock_key`,
  // not on `workspace_id`, so omitting the id when no local row exists keeps the
  // locking semantics identical and only drops the row-to-row association.
  const hasLocalWorkspaceRow = dbGetWorkspace(workspaceId) !== null;
  let lock: WorkspaceLock;
  try {
    lock = acquireWorkspaceLock({
      lock_key: key,
      workspace_id: hasLocalWorkspaceRow ? workspaceId : undefined,
      agent_id: ctx?.agentId,
      reason,
      ttl_seconds: 600,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Workspace lock already held:")) {
      throw new Error(message.replace("Workspace lock", "Project lock"));
    }
    throw err;
  }
  try {
    return fn();
  } finally {
    // Holder-scoped release (regression 6692dc56): release by the acquired
    // row's unique id, never by key alone — a guarded mutation that outlives
    // the TTL must not delete a successor's live lock.
    releaseWorkspaceLock(key, lock.id);
  }
}

/**
 * tmux profiles are a machine-local runtime resource. tmux always runs on THIS
 * box, so its saved window-layout profiles resolve against local sqlite in
 * BOTH transports (local and HTTP) — they are not shared hosted state.
 * Both Store transports delegate here so the "route through the Store"
 * invariant holds (no command touches sqlite directly) without pretending
 * profiles live on the hosted backend.
 */
/**
 * The per-project app store is a machine-local sqlite FILE at
 * $HASNA_PROJECTS_HOME/data/<project_id>/project.db. It is keyed by the SAME
 * project id in both transports, and the projects API server models none of it
 * — there is no /v1 loop, data-model or app-store route to call.
 *
 * So both transports resolve it against local sqlite, exactly as tmux profiles
 * do above. The HTTP transport previously answered these reads from a hardcoded
 * empty summary on the premise that the file "does not hold the hosted project's
 * data"; that premise was wrong (same id, same file), and it made every read
 * vacuous — `loops list` returned `loops: []` and `store inspect` reported
 * `exists: false` / `loop_links: 0` against stores holding real rows, at rc=0,
 * with no input that could ever produce a non-empty answer. See todos 4c17afb1.
 */
const machineLocalAppStore = {
  listDataModels: async (project: Workspace): Promise<ProjectDataModel[]> => dbListProjectDataModels(project),
  createDataModel: async (
    project: Workspace,
    input: CreateProjectDataModelInput,
    ctx?: MutationContext,
  ): Promise<ProjectDataModel> =>
    withLock(project.id, ctx, "project data model create", () => dbCreateProjectDataModel(project, input)),
  listDataRecords: async (project: Workspace, modelId: string): Promise<ProjectDataRecord[]> =>
    dbListProjectDataRecords(project, modelId),
  createDataRecord: async (
    project: Workspace,
    input: CreateProjectDataRecordInput,
    ctx?: MutationContext,
  ): Promise<ProjectDataRecord> =>
    withLock(project.id, ctx, "project data record create", () => dbCreateProjectDataRecord(project, input)),
  listLoopLinks: async (project: Workspace): Promise<ProjectLoopLink[]> => dbListProjectLoopLinks(project),
  linkLoop: async (project: Workspace, input: LinkProjectLoopInput, ctx?: MutationContext): Promise<ProjectLoopLink> =>
    withLock(project.id, ctx, "project OpenLoops link", () => dbLinkProjectLoop(project, input)),
  listLoopSummaries: async (
    project: Workspace,
    options?: { includeRuns?: boolean; runLimit?: number },
  ): Promise<ProjectLoopSummary[]> => dbListProjectLoopSummaries(project, options),
  inspectAppStore: async (project: Workspace): Promise<ProjectStoreSummary> => dbInspectProjectStore(project),
  inspectAppStoreWithLoops: async (
    project: Workspace,
    options?: { includeRuns?: boolean },
  ): Promise<ProjectStoreSummary> => dbInspectProjectStoreWithLoops(project, options),
} as const;

const machineLocalTmuxProfiles = {
  listTmuxProfiles: async (): Promise<TmuxProfile[]> => dbListTmuxProfiles(),
  getTmuxProfile: async (idOrSlug: string): Promise<TmuxProfile | null> => dbResolveTmuxProfile(idOrSlug),
  createTmuxProfile: async (input: CreateTmuxProfileInput): Promise<TmuxProfile> => dbCreateTmuxProfile(input),
  addTmuxProfileWindow: async (input: CreateTmuxProfileWindowInput & { profile_id: string }): Promise<TmuxProfileWindow> =>
    dbAddTmuxProfileWindow(input),
  listTmuxProfileWindows: async (profileId: string): Promise<TmuxProfileWindow[]> => dbListTmuxProfileWindows(profileId),
} as const;

function mutationFields(ctx?: MutationContext): Pick<UpdateWorkspaceInput, "agent_id" | "source" | "command" | "prompt"> {
  return {
    agent_id: ctx?.agentId,
    source: ctx?.source ?? "cli",
    command: ctx?.command,
    prompt: ctx?.prompt,
  };
}

async function prepareLocalProducerEvidenceVerifier(
  verifier: AsyncProjectResourceLinkProducerEvidenceVerifier,
  input: ProjectResourceLinkMigrationAdvanceRequest | ProjectResourceLinkMigrationRollbackRequest,
  phase: ProjectResourceLinkProducerAttestationPhase,
): Promise<ProjectResourceLinkProducerEvidenceVerifier> {
  const manifest = dbReadProjectResourceLinkMigration({
    project_id: input.project_id,
    manifest_id: input.manifest_id,
    max_items: 1,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  }).manifest;
  const trustedProject = dbGetWorkspace(input.project_id);
  if (!trustedProject) {
    throw new Error(`Project not found: ${input.project_id}`);
  }
  const producerEvidence = phase === "readback"
    ? reconcileProjectResourceLinkProducerProof(
      manifest,
      input.producer_evidence,
      "readback",
    )
    : reconcileProjectResourceLinkProducerProof(
      manifest,
      input.producer_evidence,
      "inverse",
      phase === "inverse_complete" ? "complete" : "retained_target",
    );
  const verificationInput: ProjectResourceLinkProducerVerificationInput = {
    manifest,
    trusted_project: projectResourceLinkProducerProjectSubject(trustedProject),
    phase,
    producer_evidence: producerEvidence,
    transition_evidence: input.evidence,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  };
  const attestation = await verifier(verificationInput);
  const expectedInput = canonicalJson(verificationInput);
  return (actualInput) => {
    if (canonicalJson(actualInput) !== expectedInput) {
      throw new Error("local producer attestation does not match the transition under lock");
    }
    return attestation;
  };
}

class LocalProjectStore implements ProjectStore {
  readonly transport = "local" as const;
  readonly baseUrl = null;

  constructor(
    private readonly producerEvidenceVerifier: AsyncProjectResourceLinkProducerEvidenceVerifier,
  ) {}

  async listProjects(filter?: WorkspaceFilter): Promise<Workspace[]> {
    if (filter?.limit === undefined && filter?.offset === undefined) {
      return (await this.listProjectsComplete(filter)).projects;
    }
    return dbListWorkspaces(filter ?? {});
  }

  async listProjectsComplete(filter?: Omit<WorkspaceFilter, "limit" | "offset">): Promise<CompleteProjectPopulation> {
    const f = filter ?? {};
    const projects = dbListWorkspaces(f);
    const total = dbCountWorkspaces(f);
    const ids = new Set(projects.map((project) => project.id));
    if (ids.size !== projects.length || projects.length !== total) {
      throw new Error(`Projects list terminal invariant failed: local producer returned ${projects.length} unique rows for total ${total}.`);
    }
    return { projects, total, pages: 1, complete: true };
  }

  async listProjectsPage(filter?: WorkspaceFilter): Promise<ProjectListPage> {
    const f = filter ?? {};
    return buildProjectListPage(dbListWorkspaces(f), f, dbCountWorkspaces(f));
  }

  async getProject(idOrSlug: string): Promise<Workspace | null> {
    return dbResolveWorkspace(idOrSlug);
  }

  async resolveTarget(target: string | undefined, options?: ProjectResolverOptions): Promise<Workspace> {
    return resolveRegisteredProjectTargetOrThrow(target, options).project;
  }

  async createProject(input: CreateWorkspaceInput): Promise<Workspace> {
    return dbCreateWorkspace(input);
  }

  async updateProject(id: string, patch: UpdateWorkspaceInput): Promise<Workspace> {
    return withLock(id, { agentId: patch.agent_id, source: patch.source, command: patch.command }, "project update", () =>
      dbUpdateWorkspace(id, patch),
    );
  }

  async guardedReadProject(input: GuardedProjectReadRequest): Promise<GuardedProjectReadResult> {
    const started = Date.now();
    assertCompleteStableProjectId(input.project_id);
    assertPositiveBounds(input);
    const project = dbGetWorkspace(input.project_id);
    if (!project) throw new Error(`Project not found: ${input.project_id}`);
    const maxItems = input.resource_link_max_items ?? 1_000;
    const links = dbListProjectResourceLinks(input.project_id, maxItems);
    return buildGuardedProjectReadResult(project, input, started, {
      links,
      max_items: maxItems,
      collection_digest: dbReadProjectResourceLinks({
        project_id: input.project_id,
        max_items: maxItems,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
      }).collection_digest,
    });
  }

  async readProjectResourceLinks(input: ProjectResourceLinkReadRequest): Promise<ProjectResourceLinkReadResult> {
    return dbReadProjectResourceLinks(input);
  }

  async mutateProjectResourceLinks(input: ProjectResourceLinkMutationRequest): Promise<ProjectResourceLinkMutationResult> {
    return withLock(input.project_id, { agentId: input.agent_id, source: input.source, command: input.command }, "project resource links mutation", () =>
      input.integrations
        ? dbMutateProjectResourceLinksForRegistration(input, input.integrations)
        : dbMutateProjectResourceLinks(input),
    );
  }

  async rollbackProjectResourceLinks(input: ProjectResourceLinkRollbackRequest): Promise<ProjectResourceLinkMutationResult> {
    return withLock(input.project_id, { agentId: input.agent_id, source: input.source, command: input.command }, "project resource links rollback", () =>
      dbRollbackProjectResourceLinks(input),
    );
  }

  async readDuplicateProjectQuarantinePreimage(input: ProjectQuarantineReadRequest): Promise<ProjectQuarantineReadResult> {
    return dbReadDuplicateProjectQuarantinePreimage(input);
  }

  async quarantineDuplicateProject(input: ProjectQuarantineRequest): Promise<ProjectQuarantineResult> {
    return withLock(input.project_id, { agentId: input.agent_id, source: input.source, command: input.command }, "duplicate project quarantine", () =>
      dbQuarantineDuplicateProject(input),
    );
  }

  async rollbackDuplicateProjectQuarantine(input: ProjectQuarantineRollbackRequest): Promise<ProjectQuarantineResult> {
    return withLock(input.project_id, { agentId: input.agent_id, source: input.source, command: input.command }, "duplicate project quarantine rollback", () =>
      dbRollbackDuplicateProjectQuarantine(input),
    );
  }

  async planProjectResourceLinkMigration(input: ProjectResourceLinkMigrationPlanRequest): Promise<ProjectResourceLinkMigrationResult> {
    return withLock(input.project_id, undefined, "project resource link migration plan", () =>
      dbPlanProjectResourceLinkMigration(input),
    );
  }

  async readProjectResourceLinkMigration(input: ProjectResourceLinkMigrationReadRequest): Promise<ProjectResourceLinkMigrationResult> {
    return dbReadProjectResourceLinkMigration(input);
  }

  async advanceProjectResourceLinkMigration(input: ProjectResourceLinkMigrationAdvanceRequest): Promise<ProjectResourceLinkMigrationResult> {
    const verifier = input.next_state === "verified"
      ? await prepareLocalProducerEvidenceVerifier(
        this.producerEvidenceVerifier,
        input,
        "readback",
      )
      : undefined;
    return withLock(input.project_id, undefined, "project resource link migration advance", () =>
      dbAdvanceProjectResourceLinkMigration(input, undefined, verifier),
    );
  }

  async rollbackProjectResourceLinkMigration(input: ProjectResourceLinkMigrationRollbackRequest): Promise<ProjectResourceLinkMigrationResult> {
    const phase = input.producer_outcome === "complete"
      ? "inverse_complete"
      : input.producer_outcome === "retained_target"
        ? "inverse_retained_target"
        : undefined;
    const verifier = phase
      ? await prepareLocalProducerEvidenceVerifier(
        this.producerEvidenceVerifier,
        input,
        phase,
      )
      : undefined;
    return withLock(input.project_id, undefined, "project resource link migration rollback", () =>
      dbRollbackProjectResourceLinkMigration(input, undefined, verifier),
    );
  }

  async guardedUpdateProject(input: GuardedProjectMutationRequest): Promise<GuardedProjectMutationResult> {
    return withLock(input.project_id, { agentId: input.agent_id, source: input.source, command: input.command }, "guarded project update", () =>
      dbGuardedUpdateWorkspace(input),
    );
  }

  async lookupGuardedProjectMutationReceipt(input: GuardedProjectMutationReceiptLookupInput): Promise<GuardedProjectMutationReceiptLookupResult> {
    const started = Date.now();
    const receipt = dbLookupGuardedWorkspaceMutationReceipt(input);
    return withResponseControl({ receipt }, input, started);
  }

  async rollbackGuardedProjectMutation(input: GuardedProjectMutationRollbackRequest): Promise<GuardedProjectMutationResult> {
    return withLock(input.project_id, { agentId: input.agent_id, source: input.source, command: input.command }, "guarded project rollback", () =>
      dbRollbackGuardedWorkspaceMutation(input),
    );
  }

  async archiveProject(id: string, ctx?: MutationContext): Promise<Workspace> {
    return withLock(id, ctx, "project archive", () => dbArchiveWorkspace(id, mutationFields(ctx)));
  }

  async unarchiveProject(id: string, ctx?: MutationContext): Promise<Workspace> {
    return withLock(id, ctx, "project unarchive", () => dbUnarchiveWorkspace(id, mutationFields(ctx)));
  }

  async deleteProject(id: string, opts: { hard?: boolean }, ctx?: MutationContext): Promise<DeleteProjectResult> {
    const res = withLock(id, ctx, "project delete", () => dbDeleteWorkspace(id, { ...mutationFields(ctx), hard: opts.hard }));
    return { workspace: res.workspace, hard: res.hard, id: res.workspace.id };
  }

  async listEvents(idOrSlug: string, limit?: number): Promise<WorkspaceEvent[]> {
    const project = dbResolveWorkspace(idOrSlug);
    if (!project) throw new Error(`Project not found: ${idOrSlug}`);
    const events = dbListWorkspaceEvents(project.id);
    // Bounded reads come back newest-first, matching the HTTP transport
    // (ORDER BY created_at DESC LIMIT); the unbounded read stays ASC for the
    // callers that depend on ascending order.
    return limit && limit > 0 ? events.slice(-limit).reverse() : events;
  }

  async recordEvent(idOrSlug: string, input: RecordEventInput): Promise<WorkspaceEvent> {
    const project = dbResolveWorkspace(idOrSlug);
    if (!project) throw new Error(`Project not found: ${idOrSlug}`);
    return dbRecordWorkspaceEvent({
      workspace_id: project.id,
      agent_id: input.agentId,
      event_type: input.event_type,
      source: input.source,
      prompt: input.prompt,
      command: input.command,
      before: input.before,
      after: input.after,
      metadata: input.metadata,
    });
  }

  async getProjectAgents(id: string): Promise<WorkspaceAgentAssignment[]> {
    return dbListWorkspaceAgents(id);
  }

  async assignAgent(idOrSlug: string, input: AssignAgentInput): Promise<WorkspaceAgentAssignment> {
    const project = dbResolveWorkspace(idOrSlug);
    if (!project) throw new Error(`Project not found: ${idOrSlug}`);
    const role = input.role ?? "contributor";
    return withLock(project.id, { agentId: input.assignedBy, source: input.source, command: input.command }, "project agent assign", () => {
      const assignment = dbAssignAgentToWorkspace(project.id, input.agentId, role, input.assignedBy, input.metadata);
      dbRecordWorkspaceEvent({
        workspace_id: project.id,
        agent_id: input.assignedBy,
        event_type: "agent_assigned",
        source: input.source ?? "cli",
        command: input.command,
        after: {
          agent_id: input.agentId,
          role: assignment.role,
          assignment_id: assignment.id,
        },
      });
      return assignment;
    });
  }

  async getProjectLocations(id: string): Promise<WorkspaceLocation[]> {
    return dbListWorkspaceLocations(id);
  }

  async listMachines(): Promise<Machine[]> {
    return dbListMachines();
  }

  async addLocation(idOrSlug: string, input: AddLocationInput): Promise<AddLocationResult> {
    const project = dbResolveWorkspace(idOrSlug);
    if (!project) throw new Error(`Project not found: ${idOrSlug}`);
    return withLock(project.id, { agentId: input.agentId, source: input.source, command: input.command }, "project location add", () => {
      const location = dbAddWorkspaceLocation({
        workspace_id: project.id,
        path: input.path,
        machine_id: input.machineId,
        label: input.label,
        kind: input.kind,
        is_primary: input.isPrimary,
        metadata: input.metadata,
        agent_id: input.agentId,
        source: input.source ?? "cli",
        command: input.command,
      });
      const updated = dbResolveWorkspace(project.id) ?? project;
      return { project: updated, location };
    });
  }

  async listLocks(): Promise<WorkspaceLock[]> {
    return dbListWorkspaceLocks();
  }

  async acquireLock(input: AcquireLockInput): Promise<WorkspaceLock> {
    return acquireWorkspaceLock({
      lock_key: input.key,
      workspace_id: input.workspaceId,
      agent_id: input.agentId,
      reason: input.reason,
      ttl_seconds: input.ttlSeconds,
    });
  }

  async releaseLock(key: string, lockId: string): Promise<boolean> {
    return releaseWorkspaceLock(key, lockId);
  }

  async forceReleaseLock(key: string): Promise<boolean> {
    return forceReleaseWorkspaceLock(key);
  }

  async listRoots(): Promise<Root[]> {
    return dbListRoots();
  }

  async getRoot(idOrSlug: string): Promise<Root | null> {
    return dbGetRoot(idOrSlug) ?? dbGetRootBySlug(idOrSlug);
  }

  async createRoot(input: CreateRootInput): Promise<Root> {
    return dbCreateRoot(input);
  }

  async updateRoot(idOrSlug: string, patch: UpdateRootInput): Promise<Root> {
    const root = await this.getRoot(idOrSlug);
    if (!root) throw new Error(`Root not found: ${idOrSlug}`);
    return dbUpdateRoot(root.id, patch);
  }

  async deleteRoot(idOrSlug: string, opts?: { detachProjects?: boolean }): Promise<DeleteRootResult> {
    const root = await this.getRoot(idOrSlug);
    if (!root) throw new Error(`Root not found: ${idOrSlug}`);
    return dbDeleteRoot(root.id, { detachWorkspaces: opts?.detachProjects });
  }

  async matchRoots(input: RootMatchInput): Promise<RootMatchResult[]> {
    return dbScoreRoots(input);
  }

  async listAgents(): Promise<Agent[]> {
    return dbListAgents();
  }

  async getAgent(idOrSlug: string): Promise<Agent | null> {
    return dbGetAgent(idOrSlug) ?? dbGetAgentBySlug(idOrSlug);
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    return dbCreateAgent(input);
  }

  async listRecipes(): Promise<Recipe[]> {
    return dbListRecipes();
  }

  async getRecipe(idOrSlug: string): Promise<Recipe | null> {
    return dbGetRecipe(idOrSlug) ?? dbGetRecipeBySlug(idOrSlug);
  }

  async createRecipe(input: CreateRecipeInput): Promise<Recipe> {
    return dbCreateRecipe(input);
  }

  async listAgentRuns(filter?: AgentRunFilter): Promise<AgentRun[]> {
    return dbListAgentRuns(filter ?? {});
  }

  // ---- App store: data models/records + loop links ----
  // Shared with the HTTP transport: the app store is one machine-local sqlite
  // file in both transports, so both classes delegate to the same implementation
  // rather than keeping two copies that can drift.
  listDataModels = machineLocalAppStore.listDataModels;
  createDataModel = machineLocalAppStore.createDataModel;
  listDataRecords = machineLocalAppStore.listDataRecords;
  createDataRecord = machineLocalAppStore.createDataRecord;
  listLoopLinks = machineLocalAppStore.listLoopLinks;
  linkLoop = machineLocalAppStore.linkLoop;
  listLoopSummaries = machineLocalAppStore.listLoopSummaries;
  inspectAppStore = machineLocalAppStore.inspectAppStore;
  inspectAppStoreWithLoops = machineLocalAppStore.inspectAppStoreWithLoops;

  // ---- Budgets & spend ----
  async createBudget(input: CreateProjectBudgetInput): Promise<ProjectBudget> {
    return dbCreateProjectBudget(input);
  }

  async listBudgets(context?: ProjectBudgetContext): Promise<ProjectBudget[]> {
    return dbListProjectBudgets(context);
  }

  async getBudgetStatuses(context?: ProjectBudgetContext): Promise<ProjectBudgetStatus[]> {
    return dbGetProjectBudgetStatuses(context);
  }

  async resetBudget(id: string): Promise<ProjectBudget> {
    return dbResetProjectBudget(id);
  }

  async recordSpend(input: ProjectSpendInput): Promise<ProjectBudgetSpend> {
    return dbRecordProjectSpend(input);
  }

  // ---- tmux profiles (machine-local runtime resource; see shared impl) ----
  listTmuxProfiles = machineLocalTmuxProfiles.listTmuxProfiles;
  getTmuxProfile = machineLocalTmuxProfiles.getTmuxProfile;
  createTmuxProfile = machineLocalTmuxProfiles.createTmuxProfile;
  addTmuxProfileWindow = machineLocalTmuxProfiles.addTmuxProfileWindow;
  listTmuxProfileWindows = machineLocalTmuxProfiles.listTmuxProfileWindows;

  // ---- Channel ----
  async ensureChannel(project: Workspace, options?: StoreEnsureChannelOptions): Promise<ProjectChannelEnsureResult> {
    return ensureProjectChannelViaStore(this, project, options);
  }
}

// --------------------------------------------------------------------------
// Api transport (HTTP /v1 + bearer key)
// --------------------------------------------------------------------------

/** Assemble the completeness envelope both stores return. */
function buildProjectListPage(projects: Workspace[], filter: WorkspaceFilter, total: number): ProjectListPage {
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? null;
  const has_more = offset + projects.length < total;
  return {
    projects,
    count: projects.length,
    total,
    offset,
    limit,
    has_more,
    complete: offset === 0 && !has_more,
  };
}

function listQuery(filter?: WorkspaceFilter): QueryParams {
  if (!filter) return {};
  return {
    kind: filter.kind,
    status: filter.status,
    query: filter.query,
    root_id: filter.root_id,
    tag: filter.tags && filter.tags.length > 0 ? filter.tags[0] : undefined,
    // The hosted API excludes registry-fixture rows by default; only send the
    // opt-in when the caller explicitly asked for them.
    ...(filter.exclude_registry_fixtures === false ? { include_fixtures: "true" } : {}),
    limit: filter.limit,
    offset: filter.offset,
  };
}

/**
 * The shared hosted registry resolves a project only by id or slug. Path,
 * marker and relative targets (".", "..", "/abs", "~/x", "a/b") are a
 * machine-local concept the hosted backend does not model — and, worse, sending "." or
 * ".." lets the URL parser collapse the dot-segment so `/projects/.` becomes
 * the collection route `/projects/`, returning a LIST payload that then
 * masquerades as a single project (and crashes renderers that read
 * `project.metadata`). We never send those to the API; callers fall back to
 * their local path/marker handling when this returns false.
 */
function isHostedRegistryResolvableId(idOrSlug: string): boolean {
  const target = idOrSlug.trim();
  if (!target) return false;
  if (target === "." || target === "..") return false;
  if (target.startsWith("~")) return false;
  if (target.startsWith("/") || target.startsWith("./") || target.startsWith("../")) return false;
  if (target.includes("/") || target.includes("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(target)) return false; // windows absolute path
  return true;
}

/**
 * A canonical work-project path carries a stable Projects id in its final
 * segment. Resolve that id only when the directory exists on this machine and
 * the complete path is the package-owned `workspaces/<wks_id>` location.
 *
 * This is deliberately narrower than general path or marker resolution: the
 * server row must still be fetched by the derived stable id and independently
 * attest the same canonical primary path before the target is accepted.
 */
function canonicalProjectIdFromExistingPath(target: string): string | null {
  const path = normalizeProjectPath(target);
  if (!isProjectDirectory(path)) return null;
  const projectId = basename(path);
  if (!PROJECT_WORKSPACE_ID_PATTERN.test(projectId)) return null;
  return isProjectWorkspaceStorePath(projectId, path) ? projectId : null;
}

/**
 * Guarantee the shape the LocalStore always produces: `metadata`/`integrations`
 * are objects and `tags` is an array. The projects API returns these
 * populated, but normalizing at the transport boundary keeps every downstream
 * renderer (`projectManagementSummary` et al.) safe even if a row ever comes
 * back with a null column. Rejects non-object payloads (e.g. a list wrapper)
 * so a malformed response can never masquerade as a single project.
 */
function normalizeApiWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== "object") return null;
  const ws = raw as Partial<Workspace>;
  if (typeof ws.id !== "string" || typeof ws.slug !== "string") return null;
  return {
    ...(ws as Workspace),
    tags: Array.isArray(ws.tags) ? ws.tags : [],
    integrations: (ws.integrations ?? {}) as Workspace["integrations"],
    metadata: (ws.metadata ?? {}) as JsonObject,
  };
}

class ApiProjectStore implements ProjectStore {
  readonly transport = "http" as const;
  readonly baseUrl: string;
  private readonly client: HasnaStorageClient;

  constructor(client: HasnaStorageClient) {
    this.client = client;
    this.baseUrl = client.baseUrl;
  }

  /**
   * Fetch one page. The server clamps `limit` to its own maximum, so the row
   * count that comes back — not the one we asked for — is the truth.
   */
  private async fetchProjectPage(
    filter: WorkspaceFilter | undefined,
    params: { limit: number; offset: number },
  ): Promise<{
    rows: Workspace[];
    total: number | null;
    offset: number | null;
    limit: number | null;
    has_more: boolean | null;
  }> {
    const raw = await this.client.transport.get<{
      workspaces?: Workspace[];
      projects?: Workspace[];
      total?: number;
      offset?: number;
      limit?: number;
      has_more?: boolean;
    }>("/projects", {
      query: { ...listQuery(filter), limit: params.limit, offset: params.offset },
    });
    const rows = (raw.workspaces ?? raw.projects ?? []).map((row) => normalizeApiWorkspace(row) ?? (row as Workspace));
    return {
      rows,
      total: typeof raw.total === "number" ? raw.total : null,
      offset: typeof raw.offset === "number" ? raw.offset : null,
      limit: typeof raw.limit === "number" ? raw.limit : null,
      has_more: typeof raw.has_more === "boolean" ? raw.has_more : null,
    };
  }

  /**
   * List projects, walking the server's pages.
   *
   * The API caps every list response (1000 rows at the time of writing) and
   * reports only the page length, so the previous single-request implementation
   * returned a truncated set that no caller could distinguish from a complete
   * one. We now page through `offset` until the server runs out; the stride is
   * whatever the first response actually contained, so the cap is never
   * hardcoded here and a server-side change needs no client release.
   */
  async listProjects(filter?: WorkspaceFilter): Promise<Workspace[]> {
    if (filter?.limit === undefined && filter?.offset === undefined) {
      return (await this.listProjectsComplete(filter)).projects;
    }
    return collectPages<Workspace>(
      async (params) => (await this.fetchProjectPage(filter, params)).rows,
      (row) => row?.id,
      {
        ...(filter?.limit !== undefined ? { want: filter.limit } : {}),
        ...(filter?.offset !== undefined ? { offset: filter.offset } : {}),
      },
    );
  }

  async listProjectsComplete(filter?: Omit<WorkspaceFilter, "limit" | "offset">): Promise<CompleteProjectPopulation> {
    const f = filter ?? {};
    const population = await collectCompletePages<Workspace>(
      async (params): Promise<CompletePage<Workspace>> => {
        const page = await this.fetchProjectPage(f, params);
        if (page.total === null || page.offset === null || page.limit === null || page.has_more === null) {
          throw new Error("Projects producer did not return the complete population contract (total/offset/limit/has_more).");
        }
        return {
          rows: page.rows,
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          has_more: page.has_more,
        };
      },
      (row) => row?.id,
    );
    return { projects: population.rows, total: population.total, pages: population.pages, complete: true };
  }

  async listProjectsPage(filter?: WorkspaceFilter): Promise<ProjectListPage> {
    const f = filter ?? {};
    if (f.limit === undefined && f.offset === undefined) {
      const population = await this.listProjectsComplete(f);
      return buildProjectListPage(population.projects, f, population.total);
    }
    let serverTotal: number | null = null;
    const projects = await collectPages<Workspace>(
      async (params) => {
        const page = await this.fetchProjectPage(f, params);
        if (page.total !== null) serverTotal = page.total;
        return page.rows;
      },
      (row) => row?.id,
      {
        ...(f.limit !== undefined ? { want: f.limit } : {}),
        ...(f.offset !== undefined ? { offset: f.offset } : {}),
      },
    );
    // No server-reported total (pre-0.1.96 deployment): ask for one row past the
    // bound to learn whether more exist, rather than reporting a guess.
    const total = serverTotal ?? (await this.probeTotal(f, projects.length));
    return buildProjectListPage(projects, f, total);
  }

  /**
   * Establish the true match count when the server does not report one: an
   * unbounded read is already the whole set, and a bounded read only needs to
   * know whether anything lies past its window.
   */
  private async probeTotal(filter: WorkspaceFilter, returned: number): Promise<number> {
    const offset = filter.offset ?? 0;
    if (filter.limit === undefined) return offset + returned;
    const rest = await collectPages<Workspace>(
      async (params) => (await this.fetchProjectPage(filter, params)).rows,
      (row) => row?.id,
      { offset: offset + returned },
    );
    return offset + returned + rest.length;
  }

  async getProject(idOrSlug: string): Promise<Workspace | null> {
    // Path/marker/relative targets are machine-local and not resolvable by the
    // hosted registry; never send them to the API (see isHostedRegistryResolvableId).
    if (!isHostedRegistryResolvableId(idOrSlug)) return null;
    return normalizeApiWorkspace(await this.client.get<Workspace>(RESOURCE, idOrSlug));
  }

  async resolveTarget(target: string | undefined, options?: ProjectResolverOptions): Promise<Workspace> {
    const idOrSlug = target?.trim();
    if (!idOrSlug) throw new Error("Project not found: (no target provided)");
    const canonicalProjectId = options?.allowPath === false
      ? null
      : canonicalProjectIdFromExistingPath(idOrSlug);
    if (canonicalProjectId) {
      const project = await this.getProject(canonicalProjectId);
      if (
        project?.id === canonicalProjectId
        && isProjectWorkspaceStorePath(canonicalProjectId, project.primary_path)
      ) {
        return project;
      }
      throw new Error(`Project not found: ${idOrSlug}`);
    }
    const project = await this.getProject(idOrSlug);
    if (!project) throw new Error(`Project not found: ${idOrSlug}`);
    return project;
  }

  async createProject(input: CreateWorkspaceInput): Promise<Workspace> {
    const metadata = normalizeProjectMetadata(input.metadata);
    const created = await this.client.create<Workspace>(RESOURCE, {
      ...input,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    return normalizeApiWorkspace(created) ?? created;
  }

  async updateProject(id: string, patch: UpdateWorkspaceInput): Promise<Workspace> {
    const updated = await this.client.update<Workspace>(RESOURCE, id, {
      ...patch,
      ...(patch.metadata !== undefined
        ? { metadata: normalizeProjectMetadata(patch.metadata) }
        : {}),
    });
    return normalizeApiWorkspace(updated) ?? updated;
  }

  async guardedReadProject(input: GuardedProjectReadRequest): Promise<GuardedProjectReadResult> {
    assertCompleteStableProjectId(input.project_id);
    assertPositiveBounds(input);
    return this.client.transport.get<GuardedProjectReadResult>(
      `/projects/${encodeURIComponent(input.project_id)}/guarded-metadata`,
      {
        query: {
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
          resource_link_max_items: input.resource_link_max_items,
        },
        timeoutMs: input.time_budget_ms,
      },
    );
  }

  async readProjectResourceLinks(input: ProjectResourceLinkReadRequest): Promise<ProjectResourceLinkReadResult> {
    const result = await this.client.transport.get<ProjectResourceLinkReadResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-links`,
      {
        query: {
          max_items: input.max_items,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
        },
        timeoutMs: input.time_budget_ms,
      },
    );
    assertProjectResourceLinkReadContractEquality(result);
    return result;
  }

  async mutateProjectResourceLinks(input: ProjectResourceLinkMutationRequest): Promise<ProjectResourceLinkMutationResult> {
    const normalized = normalizeProjectResourceLinks(input.links);
    const integrations = normalizeProjectResourceLinkIntegrations(input.integrations);
    const requestHash = sha256(canonicalJson({
      mode: input.mode,
      links: normalized,
      integrations: integrations ?? null,
    }));
    const preconditionHash = preconditionDigest({
      project_id: input.project_id,
      expected_revision: input.expected_revision,
    });
    const idempotencyKey = deriveGuardedIdempotencyKey({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      target_id: input.project_id,
      request_digest: requestHash,
      precondition_digest: preconditionHash,
    });
    return this.client.transport.post<ProjectResourceLinkMutationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-links/${input.mode}`,
      input,
      {
        idempotencyKey,
        timeoutMs: input.time_budget_ms,
      },
    );
  }

  async rollbackProjectResourceLinks(input: ProjectResourceLinkRollbackRequest): Promise<ProjectResourceLinkMutationResult> {
    return this.client.transport.post<ProjectResourceLinkMutationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-links/rollback`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async readDuplicateProjectQuarantinePreimage(input: ProjectQuarantineReadRequest): Promise<ProjectQuarantineReadResult> {
    return this.client.transport.get<ProjectQuarantineReadResult>(
      `/projects/${encodeURIComponent(input.project_id)}/duplicate-quarantine`,
      {
        query: {
          resource_link_max_items: input.resource_link_max_items,
          workspace_location_max_items: input.workspace_location_max_items,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
        },
        timeoutMs: input.time_budget_ms,
      },
    );
  }

  async quarantineDuplicateProject(input: ProjectQuarantineRequest): Promise<ProjectQuarantineResult> {
    return this.client.transport.post<ProjectQuarantineResult>(
      `/projects/${encodeURIComponent(input.project_id)}/duplicate-quarantine`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async rollbackDuplicateProjectQuarantine(input: ProjectQuarantineRollbackRequest): Promise<ProjectQuarantineResult> {
    return this.client.transport.post<ProjectQuarantineResult>(
      `/projects/${encodeURIComponent(input.project_id)}/duplicate-quarantine/rollback`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async planProjectResourceLinkMigration(input: ProjectResourceLinkMigrationPlanRequest): Promise<ProjectResourceLinkMigrationResult> {
    return this.client.transport.post<ProjectResourceLinkMigrationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-link-migrations/plan`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async readProjectResourceLinkMigration(input: ProjectResourceLinkMigrationReadRequest): Promise<ProjectResourceLinkMigrationResult> {
    return this.client.transport.get<ProjectResourceLinkMigrationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-link-migrations/${encodeURIComponent(input.manifest_id)}`,
      {
        query: {
          max_items: input.max_items,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
        },
        timeoutMs: input.time_budget_ms,
      },
    );
  }

  async advanceProjectResourceLinkMigration(input: ProjectResourceLinkMigrationAdvanceRequest): Promise<ProjectResourceLinkMigrationResult> {
    return this.client.transport.post<ProjectResourceLinkMigrationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-link-migrations/${encodeURIComponent(input.manifest_id)}/advance`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async rollbackProjectResourceLinkMigration(input: ProjectResourceLinkMigrationRollbackRequest): Promise<ProjectResourceLinkMigrationResult> {
    return this.client.transport.post<ProjectResourceLinkMigrationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/resource-link-migrations/${encodeURIComponent(input.manifest_id)}/rollback`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async guardedUpdateProject(input: GuardedProjectMutationRequest): Promise<GuardedProjectMutationResult> {
    const res = await this.client.transport.post<GuardedProjectMutationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/guarded-metadata`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
    return res;
  }

  async lookupGuardedProjectMutationReceipt(input: GuardedProjectMutationReceiptLookupInput): Promise<GuardedProjectMutationReceiptLookupResult> {
    return this.client.transport.get<GuardedProjectMutationReceiptLookupResult>(
      `/projects/${encodeURIComponent(input.project_id)}/guarded-metadata/receipts`,
      {
        query: {
          operation_id: input.operation_id,
          step_id: input.step_id,
          direction: input.direction,
          idempotency_key: input.idempotency_key,
          max_items: input.max_items,
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
        },
        timeoutMs: input.time_budget_ms,
      },
    );
  }

  async rollbackGuardedProjectMutation(input: GuardedProjectMutationRollbackRequest): Promise<GuardedProjectMutationResult> {
    return this.client.transport.post<GuardedProjectMutationResult>(
      `/projects/${encodeURIComponent(input.project_id)}/guarded-metadata/rollback`,
      input,
      { timeoutMs: input.time_budget_ms },
    );
  }

  async archiveProject(id: string): Promise<Workspace> {
    const ws = await this.client.transport.post<Workspace>(`/projects/${encodeURIComponent(id)}/archive`);
    return normalizeApiWorkspace(ws) ?? ws;
  }

  async unarchiveProject(id: string): Promise<Workspace> {
    const ws = await this.client.transport.post<Workspace>(`/projects/${encodeURIComponent(id)}/unarchive`);
    return normalizeApiWorkspace(ws) ?? ws;
  }

  async deleteProject(id: string, opts: { hard?: boolean }): Promise<DeleteProjectResult> {
    const q = opts.hard ? "?hard=true" : "";
    const res = await this.client.transport.del<{
      workspace?: Workspace;
      project?: Workspace;
      hard?: boolean;
      id?: string;
    }>(`/projects/${encodeURIComponent(id)}${q}`);
    const workspace = normalizeApiWorkspace(res?.workspace ?? res?.project);
    return { workspace, hard: Boolean(res?.hard), id: res?.id ?? workspace?.id ?? id };
  }

  async listEvents(idOrSlug: string, limit?: number): Promise<WorkspaceEvent[]> {
    const raw = await this.client.transport.get<{ events?: WorkspaceEvent[] }>(
      `/projects/${encodeURIComponent(idOrSlug)}/events`,
      { query: limit ? { limit } : {} },
    );
    return raw.events ?? [];
  }

  async recordEvent(idOrSlug: string, input: RecordEventInput): Promise<WorkspaceEvent> {
    const raw = await this.client.transport.post<{ event?: WorkspaceEvent } | WorkspaceEvent>(
      `/projects/${encodeURIComponent(idOrSlug)}/events`,
      {
        event_type: input.event_type,
        source: input.source,
        agent_id: input.agentId,
        prompt: input.prompt,
        command: input.command,
        before: input.before,
        after: input.after,
        metadata: input.metadata,
      },
    );
    return (raw as { event?: WorkspaceEvent }).event ?? (raw as WorkspaceEvent);
  }

  // Per-project agent assignments and extra disk locations are registry data:
  // the hosted /v1 API models both (assignments read/write and the location
  // collection), so both transports serve the same sub-resources.
  async getProjectAgents(id: string): Promise<WorkspaceAgentAssignment[]> {
    const raw = await this.client.transport.get<{ assignments?: WorkspaceAgentAssignment[] }>(
      `/projects/${encodeURIComponent(id)}/agents`,
    );
    return raw.assignments ?? [];
  }

  async assignAgent(idOrSlug: string, input: AssignAgentInput): Promise<WorkspaceAgentAssignment> {
    const raw = await this.client.transport.post<{ assignment?: WorkspaceAgentAssignment } | WorkspaceAgentAssignment>(
      `/projects/${encodeURIComponent(idOrSlug)}/agents`,
      {
        agent_id: input.agentId,
        role: input.role,
        assigned_by: input.assignedBy,
        metadata: input.metadata,
      },
    );
    const assignment = (raw as { assignment?: WorkspaceAgentAssignment }).assignment ?? (raw as WorkspaceAgentAssignment);
    if (!assignment) throw new Error(`Agent assignment was not recorded for ${idOrSlug}`);
    return assignment;
  }

  async getProjectLocations(id: string): Promise<WorkspaceLocation[]> {
    const raw = await this.client.transport.get<{ locations?: WorkspaceLocation[] }>(
      `/projects/${encodeURIComponent(id)}/locations`,
    );
    return raw.locations ?? [];
  }

  async listMachines(): Promise<Machine[]> {
    const raw = await this.client.transport.get<{ machines?: Machine[] }>("/machines");
    return raw.machines ?? [];
  }

  async addLocation(idOrSlug: string, input: AddLocationInput): Promise<AddLocationResult> {
    const raw = await this.client.transport.post<{ project?: Workspace; location?: WorkspaceLocation } | AddLocationResult>(
      `/projects/${encodeURIComponent(idOrSlug)}/locations`,
      {
        path: input.path,
        machine_id: input.machineId,
        label: input.label,
        kind: input.kind,
        is_primary: input.isPrimary,
        metadata: input.metadata,
      },
    );
    const location = (raw as { location?: WorkspaceLocation }).location ?? (raw as AddLocationResult).location;
    const project = (raw as { project?: Workspace }).project ?? (raw as AddLocationResult).project;
    if (!location || !project) throw new Error(`Project location was not recorded for ${idOrSlug}`);
    return { project, location };
  }

  // Mutation locks are hosted through the /v1 locks resource so the explicit
  // lock commands work identically on a hosted project (fleet-visible locks).
  async listLocks(): Promise<WorkspaceLock[]> {
    const raw = await this.client.transport.get<{ locks?: WorkspaceLock[] }>("/locks");
    return raw.locks ?? [];
  }

  async acquireLock(input: AcquireLockInput): Promise<WorkspaceLock> {
    const raw = await this.client.transport.post<{ lock?: WorkspaceLock } | WorkspaceLock>(
      "/locks",
      {
        lock_key: input.key,
        workspace_id: input.workspaceId,
        agent_id: input.agentId,
        reason: input.reason,
        ttl_seconds: input.ttlSeconds,
      },
    );
    const lock = (raw as { lock?: WorkspaceLock }).lock ?? (raw as WorkspaceLock);
    if (!lock) throw new Error(`Project lock was not acquired: ${input.key}`);
    return lock;
  }

  async releaseLock(key: string, lockId: string): Promise<boolean> {
    const raw = await this.client.transport.del<{ released?: boolean }>(
      `/locks/${encodeURIComponent(key)}`,
      undefined,
      { query: { lock_id: lockId } },
    );
    return Boolean(raw?.released);
  }

  async forceReleaseLock(key: string): Promise<boolean> {
    const raw = await this.client.transport.del<{ released?: boolean }>(
      `/locks/${encodeURIComponent(key)}`,
    );
    return Boolean(raw?.released);
  }

  async listRoots(): Promise<Root[]> {
    const raw = await this.client.transport.get<{ roots?: Root[] }>("/roots");
    return raw.roots ?? [];
  }

  async getRoot(idOrSlug: string): Promise<Root | null> {
    return this.client.get<Root>("roots", idOrSlug);
  }

  async createRoot(input: CreateRootInput): Promise<Root> {
    return this.client.create<Root>("roots", input);
  }

  async updateRoot(idOrSlug: string, patch: UpdateRootInput): Promise<Root> {
    return this.client.update<Root>("roots", idOrSlug, patch);
  }

  async deleteRoot(idOrSlug: string, opts?: { detachProjects?: boolean }): Promise<DeleteRootResult> {
    const root = await this.getRoot(idOrSlug);
    if (!root) throw new Error(`Root not found: ${idOrSlug}`);
    const q = opts?.detachProjects ? "?detach=true" : "";
    const res = await this.client.transport.del<{ detached_workspaces?: number }>(
      `/roots/${encodeURIComponent(root.id)}${q}`,
    );
    return { root, detached_workspaces: res?.detached_workspaces ?? 0 };
  }

  async matchRoots(input: RootMatchInput): Promise<RootMatchResult[]> {
    return rankRoots(await this.listRoots(), input);
  }

  async listAgents(): Promise<Agent[]> {
    const raw = await this.client.transport.get<{ agents?: Agent[] }>("/agents");
    return raw.agents ?? [];
  }

  async getAgent(idOrSlug: string): Promise<Agent | null> {
    return this.client.get<Agent>("agents", idOrSlug);
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    return this.client.create<Agent>("agents", input);
  }

  async listRecipes(): Promise<Recipe[]> {
    const raw = await this.client.transport.get<{ recipes?: Recipe[] }>("/recipes");
    return raw.recipes ?? [];
  }

  async getRecipe(idOrSlug: string): Promise<Recipe | null> {
    return this.client.get<Recipe>("recipes", idOrSlug);
  }

  async createRecipe(input: CreateRecipeInput): Promise<Recipe> {
    return this.client.create<Recipe>("recipes", input);
  }

  // Agent runs are an on-box ledger the projects API server does not model;
  // returning empty avoids reading a local sqlite file the hosted project does
  // not own (the split-brain the runs/handoff surfaces would otherwise hit).
  async listAgentRuns(): Promise<AgentRun[]> {
    return [];
  }

  // ---- App store (machine-local sqlite in BOTH transports; see shared impl) ----
  // Budgets/spend are NOT part of this machine-local set: they are an on-box
  // ledger (project_registry sqlite) that the hosted server does NOT model —
  // route() dispatches projects/roots/agents/locks/recipes/machines and falls
  // through to 404 for budgets — so every budget read/write in the hosted transport throws
  // LocalOnlyOperationError rather than silently returning an empty ledger.
  listDataModels = machineLocalAppStore.listDataModels;
  createDataModel = machineLocalAppStore.createDataModel;
  listDataRecords = machineLocalAppStore.listDataRecords;
  createDataRecord = machineLocalAppStore.createDataRecord;
  listLoopLinks = machineLocalAppStore.listLoopLinks;
  linkLoop = machineLocalAppStore.linkLoop;
  listLoopSummaries = machineLocalAppStore.listLoopSummaries;
  inspectAppStore = machineLocalAppStore.inspectAppStore;
  inspectAppStoreWithLoops = machineLocalAppStore.inspectAppStoreWithLoops;

  async createBudget(): Promise<ProjectBudget> {
    throw new LocalOnlyOperationError("create project budget");
  }

  async listBudgets(): Promise<ProjectBudget[]> {
    throw new LocalOnlyOperationError("list project budgets");
  }

  async getBudgetStatuses(): Promise<ProjectBudgetStatus[]> {
    throw new LocalOnlyOperationError("read project budget statuses");
  }

  async resetBudget(): Promise<ProjectBudget> {
    throw new LocalOnlyOperationError("reset project budget");
  }

  async recordSpend(): Promise<ProjectBudgetSpend> {
    throw new LocalOnlyOperationError("record project spend");
  }

  // tmux profiles are a machine-local runtime resource (tmux runs on THIS box),
  // so even in the hosted backend they resolve against local sqlite rather than a
  // nonexistent hosted endpoint. See machineLocalTmuxProfiles.
  listTmuxProfiles = machineLocalTmuxProfiles.listTmuxProfiles;
  getTmuxProfile = machineLocalTmuxProfiles.getTmuxProfile;
  createTmuxProfile = machineLocalTmuxProfiles.createTmuxProfile;
  addTmuxProfileWindow = machineLocalTmuxProfiles.addTmuxProfileWindow;
  listTmuxProfileWindows = machineLocalTmuxProfiles.listTmuxProfileWindows;

  // Channel derivation is pure and ensure writes no project record; the audit
  // event routes through this same HTTP transport (recordEvent) so it lands on
  // the hosted project.
  async ensureChannel(project: Workspace, options?: StoreEnsureChannelOptions): Promise<ProjectChannelEnsureResult> {
    return ensureProjectChannelViaStore(this, project, options);
  }
}

// --------------------------------------------------------------------------
// Resolver
// --------------------------------------------------------------------------

let cached: ProjectStore | null = null;

/**
 * The shared @hasna/contracts seam keeps the server's reason on the error
 * BODY and leaves it out of the message; the projects CLI/MCP surfaces
 * `error.message`, so re-attach the bounded body detail to the message (the
 * vendored transport used to do this). The error keeps its shape — name
 * "HasnaHttpError", status, body — so the seam's own shape-based checks
 * (404 -> null mapping, retry decisions) keep working. Matched by shape, never
 * by instanceof: the seam builds `./client` and `./client/storage` as separate
 * bundles, each carrying its own copy of the class.
 */
function enrichSeamTransport(transport: HasnaHttpTransport): HasnaHttpTransport {
  const withDetail = (error: unknown): unknown => {
    if (!(error instanceof Error) || error.name !== "HasnaHttpError") return error;
    const body = (error as { body?: unknown }).body;
    const detail = body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as { error?: unknown }).error
      : undefined;
    if (typeof detail !== "string" || detail.length === 0 || error.message.includes(detail)) {
      return error;
    }
    const bounded = detail.length <= 500 ? detail : `${detail.slice(0, 497)}...`;
    return Object.assign(new Error(`${error.message}: ${bounded}`), {
      name: error.name,
      status: (error as { status?: number }).status,
      method: (error as { method?: string }).method,
      path: (error as { path?: string }).path,
      body,
    });
  };
  const guard = <T>(promise: Promise<T>): Promise<T> =>
    promise.catch((error: unknown) => {
      throw withDetail(error);
    });
  return {
    ...transport,
    request: <T = unknown>(method: string, path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T> =>
      guard(transport.request<T>(method, path, body, opts)),
    get: <T = unknown>(path: string, opts?: HasnaRequestOptions): Promise<T> =>
      guard(transport.get<T>(path, opts)),
    post: <T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T> =>
      guard(transport.post<T>(path, body, opts)),
    put: <T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T> =>
      guard(transport.put<T>(path, body, opts)),
    patch: <T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T> =>
      guard(transport.patch<T>(path, body, opts)),
    del: <T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T> =>
      guard(transport.del<T>(path, body, opts)),
  };
}

export interface ResolveProjectStoreOptions {
  producerAuthorityOptions?: ProductionProjectRegistrationAuthorityOptions;
  producerVerifierNow?: () => string;
  /** Tier-1/Tier-3 controls handed to the shared resolver (a key, a profile, a fake Keychain runner). */
  credentials?: CredentialChainOptions;
  /** Where the one-line unhosted-mode notice goes. Defaults to stderr. */
  notify?: (line: string) => void;
}

/** One line, once per process, naming every place the resolver looked. */
let announcedUnhostedMode = false;

function announceUnhostedMode(env: Env, notify: (line: string) => void): void {
  if (announcedUnhostedMode) return;
  announcedUnhostedMode = true;
  const keys = clientTransportEnvKeys(APP);
  const diskPaths = credentialDiskSources(APP, env);
  const disk = diskPaths.length > 0 ? diskPaths.join(" or ") : "no credentials file (no HOME)";
  notify(
    `projects: local mode — nothing configures the hosted registry ` +
    `(no ${keys.apiUrlKeys[0]}, no Keychain item hasna.credentials.${APP}.api-key, no ${disk}, ` +
    `no ${keys.apiKeyKeys[0]}); reading and writing the on-box SQLite registry at ${getDbPath()}.`,
  );
}

/** Test seam: forget that the unhosted-mode line was already printed. */
export function __resetUnhostedModeNotice(): void {
  announcedUnhostedMode = false;
}

/**
 * Resolve the active projects Store.
 *
 * ROUTES ON URL + KEY ONLY (owner rulings 2026-09-04, hasna/apps#1720): the
 * shared @hasna/contracts resolver decides, there is no mode switch, and there
 * is no local-registry opt-in. A credential from any tier — argument, env
 * pointer, Keychain, `~/.hasna/projects/config/credentials`, or a plain
 * `HASNA_PROJECTS_API_KEY` — selects the hosted store against the configured
 * authority or, by default, `https://api.hasna.com/projects`.
 *
 * A station that declares an authority but resolves no credential FAILS LOUD:
 * the seam's error propagates, the caller exits non-zero, no local store is
 * opened and no local-fallback event is written. Only a completely silent
 * environment reaches the on-box registry — the unhosted OSS mode projects
 * supports by design — and it says so in one line on stderr.
 */
export function resolveProjectStore(
  env: Env = process.env,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
  options: ResolveProjectStoreOptions = {},
): ProjectStore {
  const cacheable = env === process.env
    && options.producerAuthorityOptions === undefined
    && options.producerVerifierNow === undefined
    && options.credentials === undefined
    && options.notify === undefined;
  if (cacheable && cached) return cached;
  // Only the RESOLUTION is guarded. A failure building the store around a
  // successfully resolved client is a defect, not a configuration question, and
  // must not be caught here.
  let resolved: ReturnType<typeof resolveStorageClient> | null = null;
  try {
    resolved = resolveStorageClient(APP, env, {
      fetchImpl,
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });
  } catch (error) {
    // The seam refused to build a client. That is the LOUD outcome unless the
    // environment configures nothing at all, in which case this app's unhosted
    // OSS mode is the deliberate answer — never a rescue for a broken or
    // half-configured hosted setup, and never silent.
    if (!unconfiguredForHostedUse(APP, env, options.credentials)) throw error;
    announceUnhostedMode(env, options.notify ?? ((line: string) => console.error(line)));
  }
  if (resolved) {
    const httpStore: ProjectStore = new ApiProjectStore({
      ...resolved.client,
      transport: enrichSeamTransport(resolved.client.transport),
    });
    if (cacheable) cached = httpStore;
    return httpStore;
  }
  const localStore: ProjectStore = new LocalProjectStore(
    createProductionProjectResourceLinkProducerEvidenceVerifier({
      authorities: productionProjectRegistrationAuthorities({
        ...options.producerAuthorityOptions,
        env: options.producerAuthorityOptions?.env ?? env,
        fetch: options.producerAuthorityOptions?.fetch
          ?? fetchImpl as typeof globalThis.fetch | undefined,
      }),
      now: options.producerVerifierNow,
    }),
  );
  if (cacheable) cached = localStore;
  return localStore;
}

/** Test/di seam: clear the process-env cached store. */
export function __resetProjectStore(): void {
  cached = null;
}
