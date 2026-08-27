// Task statuses
export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Task priorities
export const TASK_PRIORITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// Plan statuses
export const PLAN_STATUSES = ["active", "completed", "archived"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

// Project Source — a data source or file location associated with a project
export interface ProjectSource {
  id: string;
  project_id: string;
  type: string; // 's3', 'gdrive', 'local', 'github', 'notion', 'http', etc.
  name: string;
  uri: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectSourceRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  uri: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectSourceInput {
  project_id: string;
  type: string;
  name: string;
  uri: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// Project
export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  task_list_id: string | null;
  task_prefix: string | null;
  task_counter: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  machine_id?: string | null;
  synced_at?: string | null;
  sources?: ProjectSource[];
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
  task_list_id?: string;
  task_prefix?: string;
  parent_id?: string;
}

/** Ordinary project metadata update. Canonical slug changes require renameProject. */
export interface UpdateProjectInput {
  name?: string;
  path?: string;
  description?: string | null;
  parent_id?: string | null;
}

export interface RenameProjectInput {
  new_slug: string;
  name?: string;
}

export interface RenameProjectResult {
  project: Project;
  task_lists_updated: number;
}

export interface ProjectTaskListEnsureReceipt {
  schema_version: "todos.project-task-list-ensure.v1";
  receipt_id: string;
  idempotency_key: string;
  project_id: string;
  task_list_id: string;
  slug: string;
  created_by_operation: boolean;
  result_revision: string;
  result_digest: string;
  rollback_supported: boolean;
  created_at: string;
}

export interface ProjectTaskListEnsureResult {
  mode: "plan" | "apply";
  action: "would_create" | "created" | "already_present";
  project: Project;
  task_list: TaskList | null;
  receipt: ProjectTaskListEnsureReceipt | null;
}

export interface ProjectTaskListRollbackResult {
  schema_version: "todos.project-task-list-ensure.v1";
  action: "removed";
  project_id: string;
  task_list_id: string;
  accepted_receipt_id: string;
  rollback_receipt_id: string;
  removed_at: string;
}

export interface PlanProjectLinkReceipt {
  schema_version: "todos.plan-project-link.v1";
  receipt_id: string;
  idempotency_key: string;
  plan_id: string;
  project_id: string;
  prior_plan_project_id: string | null;
  prior_task_project_ids: Record<string, string | null>;
  task_ids: string[];
  task_count: number;
  result_plan_revision: string;
  result_digest: string;
  rollback_supported: true;
  created_at: string;
}

export interface PlanProjectLinkResult {
  mode: "plan" | "apply";
  action: "would_link" | "linked" | "already_linked";
  plan: Plan;
  project: Project;
  tasks: Task[];
  receipt: PlanProjectLinkReceipt | null;
}

export interface PlanProjectLinkRollbackResult {
  schema_version: "todos.plan-project-link.v1";
  action: "restored";
  plan: Plan;
  tasks: Task[];
  accepted_receipt_id: string;
  rollback_receipt_id: string;
  restored_at: string;
}

// Org
export interface Org {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateOrgInput {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// Plan
export interface Plan {
  id: string;
  slug: string | null;
  project_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  name: string;
  description: string | null;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  machine_id?: string | null;
  synced_at?: string | null;
}

export interface CreatePlanInput {
  name: string;
  slug?: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  description?: string;
  status?: PlanStatus;
}

export interface UpdatePlanInput {
  name?: string;
  slug?: string;
  description?: string;
  status?: PlanStatus;
  task_list_id?: string;
  agent_id?: string;
}

// Machine
export interface Machine {
  id: string;
  name: string;
  hostname: string | null;
  platform: string | null;
  ssh_address: string | null;
  is_primary: boolean;
  last_seen_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MachineTopologyMetadata {
  tailscale_name?: string;
  tailscale_ip?: string;
  lan_address?: string;
  workspace_path?: string;
  git_root?: string;
  arch?: string;
}

export interface MachineTopologySummary {
  id: string;
  name: string;
  hostname: string | null;
  platform: string | null;
  ssh_address: string | null;
  is_primary: boolean;
  archived_at: string | null;
  last_seen_at: string;
  stale: boolean;
  stale_minutes: number;
  topology: MachineTopologyMetadata;
}

export type MachinePathIssueType = "missing_local_path" | "path_mismatch" | "path_missing";

export interface MachinePathIssue {
  type: MachinePathIssueType;
  project_id: string;
  project_name: string;
  machine_id?: string;
  machine_name?: string;
  path?: string;
  paths?: Array<{ machine_id: string; machine_name: string; path: string }>;
  message: string;
}

export interface MachineTopologyDiagnostics {
  generated_at: string;
  stale_after_minutes: number;
  local_machine: Machine | null;
  machines: MachineTopologySummary[];
  stale_machines: MachineTopologySummary[];
  path_issues: MachinePathIssue[];
}

export interface MachineRow {
  id: string;
  name: string;
  hostname: string | null;
  platform: string | null;
  ssh_address: string | null;
  is_primary: number;
  last_seen_at: string;
  archived_at: string | null;
  metadata: string | null;
  created_at: string;
}

// Agent
export type AgentStatus = "active" | "archived";

export interface Agent {
  id: string; // 8-char short UUID
  name: string;
  identity_id?: string | null; // immutable canonical authority; labels never populate this field
  description: string | null;
  role: string | null;
  title: string | null; // job title: "Senior Engineer", "QA Lead", etc.
  level: string | null; // ic, lead, manager, director, vp, c-level
  permissions: string[];
  reports_to: string | null; // agent ID of manager
  org_id: string | null;
  capabilities: string[]; // agent skills/capabilities for task routing
  status: AgentStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
  session_id: string | null; // bound session — used to detect name conflicts
  working_dir: string | null;
  project_id?: string | null; // structured identity-projection metadata
  runtime_instance_id?: string | null; // external runtime actor instance; not a lease/fence owner
  active_project_id: string | null; // project this agent's session is locked to
  machine_id?: string | null;
  synced_at?: string | null;
}

export interface AgentRow {
  id: string;
  name: string;
  identity_id?: string | null;
  description: string | null;
  role: string | null;
  title: string | null;
  level: string | null;
  permissions: string | null;
  capabilities: string | null;
  reports_to: string | null;
  org_id: string | null;
  status: string;
  metadata: string | null;
  created_at: string;
  last_seen_at: string;
  session_id: string | null;
  working_dir: string | null;
  project_id?: string | null;
  runtime_instance_id?: string | null;
  active_project_id: string | null;
  machine_id?: string | null;
  synced_at?: string | null;
}

export interface RegisterAgentInput {
  name: string;
  identity_id?: string;
  description?: string;
  role?: string;
  title?: string;
  level?: string;
  pool?: string[]; // advisory pool — used for suggestions on conflict, not enforced
  permissions?: string[];
  capabilities?: string[];
  reports_to?: string;
  org_id?: string;
  metadata?: Record<string, unknown>;
  session_id?: string;
  runtime_instance_id?: string;
  working_dir?: string;
  project_id?: string;
  force?: boolean; // skip active-agent check and force takeover
}

export type IdentityMappingBasis = "authoritative" | "imported" | "candidate" | "name_similarity";
export type IdentityMappingStatus = "active" | "retired" | "quarantined" | "revoked";
export type IdentityReadPreference = "canonical_first" | "legacy_first" | "canonical_only" | "legacy_only";
export type IdentityResolutionTrust = "authoritative" | "non_authoritative" | "denied";
export type IdentityMappingLifecycleAction =
  | "create"
  | "unchanged"
  | "promote"
  | "correct"
  | "retire"
  | "quarantine"
  | "blocked";

export interface IdentitySourceLineage {
  source_authority: string;
  source_tenant_id: string;
  source_namespace: string;
  source_entity_type: string;
  source_record_id: string;
}

export interface AgentIdentitySourceMapping extends IdentitySourceLineage {
  id: string;
  local_agent_id: string | null;
  identity_id: string | null;
  observed_label: string | null;
  evidence: Record<string, unknown>;
  mapping_basis: IdentityMappingBasis;
  status: IdentityMappingStatus;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface AgentIdentityAlias {
  id: string;
  local_agent_id: string;
  label: string;
  normalized_label: string;
  alias_kind: "historical" | "candidate";
  status: "active" | "quarantined" | "revoked";
  created_at: string;
}

export interface AgentIdentityMappingInput extends IdentitySourceLineage {
  local_agent_id?: string | null;
  identity_id?: string | null;
  observed_label?: string | null;
  evidence?: Record<string, unknown>;
  mapping_basis: IdentityMappingBasis;
  status?: "active" | "retired";
}

export interface AgentIdentityResolutionInput {
  identity_id?: string | null;
  source?: IdentitySourceLineage | null;
  local_agent_id?: string | null;
  alias?: string | null;
}

export interface AgentIdentityResolution {
  identity_id: string | null;
  local_agent_id: string | null;
  resolved_by: "identity_id" | "source" | "legacy_local_id" | "legacy_alias" | "none";
  trust: IdentityResolutionTrust;
}

export interface AgentIdentityMappingOutcome extends AgentIdentityMappingInput {
  classification: "uniquely_mapped" | "ambiguous" | "unmapped";
  mapping_id: string | null;
  previous_mapping_id: string | null;
  lifecycle_action: IdentityMappingLifecycleAction;
  reason: string;
}

export interface AgentIdentityReconciliationReport {
  dry_run: boolean;
  uniquely_mapped: AgentIdentityMappingOutcome[];
  ambiguous: AgentIdentityMappingOutcome[];
  unmapped: AgentIdentityMappingOutcome[];
}

export interface AgentConflictError {
  conflict: true;
  existing_id: string;
  existing_name: string;
  last_seen_at: string;
  session_hint: string | null; // first 8 chars of session_id
  working_dir: string | null;
  message: string;
  suggestions?: string[]; // available names from the project pool to try instead
}

// API Key
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

// Task List
export interface TaskList {
  id: string;
  project_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  machine_id?: string | null;
  synced_at?: string | null;
}

export interface TaskListRow {
  id: string;
  project_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  machine_id?: string | null;
  synced_at?: string | null;
}

export interface CreateTaskListInput {
  name: string;
  slug?: string;
  project_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskListInput {
  slug?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  /**
   * Rebind the list to a project scope, or clear the binding with an explicit
   * `null`. Slugs are project-scoped, so a rebind re-claims the slug in the
   * destination scope and rejects a conflict there with TASK_LIST_SLUG_CONFLICT.
   */
  project_id?: string | null;
}

// Task
export interface Task {
  id: string;
  short_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  agent_id: string | null;
  assigned_to: string | null;
  session_id: string | null;
  working_dir: string | null;
  tags: string[]; // stored as JSON in DB
  metadata: Record<string, unknown>; // stored as JSON in DB
  version: number;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  spawns_template_id: string | null;
  confidence: number | null;
  reason: string | null;
  spawned_from_session: string | null;
  assigned_by: string | null; // agent_id who handed this task over
  /** Who FILED this task. Write-once at creation; never mutated by start/claim/steal/update.
   *  Null on rows created before this field existed — that history is unattributable. */
  created_by: string | null;
  assigned_from_project: string | null; // project_id the assigning agent was in
  task_type: string | null; // bug, feature, chore, improvement, docs, test, security, or custom
  cost_tokens: number;
  cost_usd: number;
  delegated_from: string | null;
  delegation_depth: number;
  retry_count: number;
  max_retries: number;
  retry_after: string | null;
  sla_minutes: number | null;
  runner_id: string | null;
  runner_started_at: string | null;
  runner_completed_at: string | null;
  current_step: string | null;
  total_steps: number | null;
  machine_id?: string | null;
  synced_at?: string | null;
  archived_at?: string | null;
}

// Checklist item — ordered sub-steps within a task
export interface ChecklistItem {
  id: string;
  task_id: string;
  position: number;
  text: string;
  checked: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItemRow {
  id: string;
  task_id: string;
  position: number;
  text: string;
  checked: number; // SQLite integer
  created_at: string;
  updated_at: string;
}

export interface CreateChecklistItemInput {
  task_id: string;
  text: string;
  position?: number; // appended to end if omitted
}

/**
 * Whether a prerequisite in this status still blocks its dependents. A
 * completed prerequisite is satisfied; a cancelled one will never complete, so
 * treating it as blocking would deadlock the dependent forever. Single source
 * of truth for every `blocked_by` derivation (regression 4599ef37).
 */
export function isBlockingDependencyStatus(status: string): boolean {
  return status !== "completed" && status !== "cancelled";
}

/**
 * Whether a task in this status has finished for good. Terminal rows are not
 * startable — `startTask` rejects anything that is not pending/in_progress — so
 * a lock left on one can never be re-acquired and never expires into anyone
 * else's hands. Single source of truth for both backends: SQLite
 * (`db/task-crud.updateTask`) and Postgres (`storage/postgres-adapter.updateTask`)
 * released the lock on different subsets of these before, which leaked a
 * permanent holder on every `update --status failed|cancelled` (and, on the
 * cloud route, on `completed` too).
 */
export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// Task with relations loaded
export interface TaskWithRelations extends Task {
  subtasks: Task[];
  /** Prerequisites (upstream): the tasks this one depends on. */
  dependencies: Task[];
  /**
   * The prerequisites still incomplete — the tasks blocking this one right
   * now. Empty means dispatchable. (Regression 4599ef37: this used to carry
   * the dependents, inverting the meaning for every JSON consumer.)
   */
  blocked_by: Task[];
  /** Dependents (downstream): the tasks this one blocks. */
  blocks: Task[];
  comments: TaskComment[];
  parent: Task | null;
  checklist: ChecklistItem[];
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  project_id?: string;
  parent_id?: string;
  plan_id?: string;
  task_list_id?: string;
  cycle_id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  agent_id?: string;
  assigned_to?: string;
  session_id?: string;
  working_dir?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  due_at?: string;
  estimated_minutes?: number;
  sla_minutes?: number;
  confidence?: number;
  retry_count?: number;
  max_retries?: number;
  retry_after?: string | null;
  requires_approval?: boolean;
  recurrence_rule?: string;
  recurrence_parent_id?: string;
  spawns_template_id?: string;
  reason?: string;
  spawned_from_session?: string;
  assigned_by?: string;
  /** Who FILED this task. Resolved from the ambient agent identity when the caller omits it. */
  created_by?: string;
  assigned_from_project?: string;
  task_type?: string;
}

export interface UpsertTaskByFingerprintInput extends CreateTaskInput {
  /** Stable top-level metadata fingerprint used for deterministic dedupe. */
  fingerprint: string;
}

export interface UpsertTaskByFingerprintResult {
  task: Task;
  created: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: string | null;
  /** Set an existing task as this task's parent, or null to detach it. */
  parent_id?: string | null;
  assigned_to?: string;
  /** Repair the agent attributed to this row, or null it out as unattributable.
   *  There was previously NO write path for this column after creation, so a row
   *  stamped with the wrong agent at creation could not be corrected by any CLI or
   *  API call — which is why the 2026-07-31 misattribution had no remedy. This is a
   *  deliberate repair input: it is never set implicitly by assignment or claim. */
  agent_id?: string | null;
  working_dir?: string | null;
  plan_id?: string | null;
  task_list_id?: string | null;
  cycle_id?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  due_at?: string | null;
  estimated_minutes?: number;
  sla_minutes?: number | null;
  actual_minutes?: number;
  completed_at?: string | null;
  confidence?: number | null;
  retry_count?: number;
  max_retries?: number;
  retry_after?: string | null;
  requires_approval?: boolean;
  approved_by?: string;
  recurrence_rule?: string | null;
  /**
   * Who handed this row over. Stamped at creation from `agent_id` and, until
   * `todos delegate`, WRITE-ONCE by omission rather than by design — there was
   * no update branch, so a task filed by one agent and later dispatched by
   * another kept naming the filer. Distinct from `agent_id` (who owns the row)
   * and `created_by` (who filed it, which stays write-once).
   */
  assigned_by?: string | null;
  /**
   * The parent in the delegation chain. Column present since migration 520 and
   * hardcoded to `null` at every creation site, so nothing could ever set it.
   */
  delegated_from?: string | null;
  /**
   * How deep this row sits in the delegation chain. Column present since
   * migration 521 and hardcoded to `0` at every creation site.
   */
  delegation_depth?: number;
  version: number; // required for optimistic locking
  task_type?: string | null;
}

export interface TaskFilter {
  /**
   * Full-text search query. On the Postgres backend this drives a
   * weighted tsvector `websearch_to_tsquery` match with a pg_trgm word-similarity
   * fuzzy fallback, ranked by `ts_rank_cd`. On SQLite the equivalent FTS5 path is
   * `searchTasks` in src/lib/search.ts. A lone "*" means "match everything".
   */
  query?: string;
  project_id?: string;
  parent_id?: string | null;
  plan_id?: string;
  task_list_id?: string;
  /** Filter to specific task IDs. When provided, only matching tasks are returned. */
  ids?: string[];
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assigned_to?: string;
  agent_id?: string;
  /** Match tasks FILED by this agent. */
  created_by?: string;
  /** Exclude tasks filed by this agent. Combined with `assigned_to` this expresses the
   *  inbox query operating rule 29 requires: work assigned to me that someone ELSE created.
   *  Rows with a null `created_by` are unattributable and are NOT excluded. */
  not_created_by?: string;
  /**
   * Since-cursor: return only tasks whose `updated_at` is STRICTLY AFTER this
   * instant (ISO-8601). Lets a poller re-read only what changed instead of the
   * whole table.
   *
   * Measured 2026-08-07 on the deployed API: `/v1/tasks?limit=200` returns
   * 420,696 bytes for 200 of 59,547 rows, and every cursor spelling was inert —
   * a cursor dated after every row still returned the full page. `conversations`
   * already honours the equivalent parameter and answers 15 bytes.
   *
   * Compared as an INSTANT, not as a string: production rows carry both
   * "2026-08-05T18:54:55.814Z" and "2026-06-10 11:24:47", which sort
   * differently as text ("T" > " ") than they do as time.
   *
   * A STORED STAMP CARRYING NO OFFSET IS READ AS UTC ON BOTH BACKENDS. SQLite's
   * `julianday()` already does this; Postgres is pinned to match by
   * `todos_try_timestamptz` (src/storage/postgres-sync.ts), because a bare
   * `::timestamptz` cast resolves such a stamp against the session `TimeZone` and
   * the two backends then answer the same cursor differently by the server's UTC
   * offset — measured 2 rows against 3 on an identical fixture.
   *
   * The HTTP layer normalises to `YYYY-MM-DDTHH:MM:SS.sssZ` before this is set,
   * so both backends receive one grammar rather than each interpreting whatever
   * the caller typed.
   */
  updated_after?: string;
  session_id?: string;
  tags?: string[];
  has_recurrence?: boolean;
  include_subtasks?: boolean;
  task_type?: string | string[];
  limit?: number;
  offset?: number;
  /** Opaque cursor from a prior list_tasks response — stable pagination that survives concurrent mutations */
  cursor?: string;
  /** When true, include archived tasks. Default: false (archived tasks excluded) */
  include_archived?: boolean;
  /** Exact top-level metadata filters, e.g. { fingerprint: "loop:key" }. */
  metadata?: Record<string, unknown>;
}

// Task dependency
export interface TaskDependency {
  task_id: string;
  depends_on: string;
  external_project_id?: string | null;
  external_task_id?: string | null;
}

// Time log entry for task time tracking
export interface TaskTimeLog {
  id: string;
  task_id: string;
  run_id: string | null;
  focus_session_id: string | null;
  agent_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  minutes: number;
  notes: string | null;
  created_at: string;
}

export type FocusSessionStatus = "active" | "paused" | "completed" | "cancelled";

export interface FocusSession {
  id: string;
  task_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  title: string | null;
  status: FocusSessionStatus;
  started_at: string;
  last_resumed_at: string | null;
  paused_at: string | null;
  ended_at: string | null;
  actual_minutes: number;
  idle_after_minutes: number | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FocusSessionRow {
  id: string;
  task_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  title: string | null;
  status: FocusSessionStatus;
  started_at: string;
  last_resumed_at: string | null;
  paused_at: string | null;
  ended_at: string | null;
  actual_minutes: number;
  idle_after_minutes: number | null;
  notes: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export type BoardScope = "tasks" | "plans";

export interface BoardLane {
  id: string;
  name: string;
  statuses: string[];
  wip_limit: number | null;
  position: number;
}

export interface TaskBoard {
  id: string;
  name: string;
  scope: BoardScope;
  project_id: string | null;
  task_list_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  lanes: BoardLane[];
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskBoardRow {
  id: string;
  name: string;
  scope: BoardScope;
  project_id: string | null;
  task_list_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  lanes: string | null;
  filters: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardCard {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: TaskPriority | null;
  project_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  assigned_to: string | null;
  blocked: boolean;
  ready: boolean;
  badges: string[];
  updated_at: string;
}

export interface BoardLaneSnapshot {
  lane: BoardLane;
  count: number;
  wip_limit: number | null;
  wip_exceeded: boolean;
  cards: BoardCard[];
}

export interface BoardSnapshot {
  board: TaskBoard;
  generated_at: string;
  lanes: BoardLaneSnapshot[];
  totals: {
    cards: number;
    blocked: number;
    ready: number;
    wip_exceeded_lanes: number;
  };
  keyboard: {
    move_left: string;
    move_right: string;
    move_up: string;
    move_down: string;
    open: string;
    quit: string;
  };
}

export type CalendarEventKind = "task_due" | "task_sla" | "task_reminder" | "milestone" | "work_block" | "run" | "imported";

export interface LocalCalendarItem {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  project_id: string | null;
  task_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  recurrence_rule: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LocalCalendarItemRow {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  project_id: string | null;
  task_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  recurrence_rule: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  project_id: string | null;
  task_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  recurrence_rule: string | null;
  source: "task" | "run" | "local";
  badges: string[];
  metadata: Record<string, unknown>;
}

// Task watcher — agent subscription to task events
export interface TaskWatcher {
  id: string;
  task_id: string;
  agent_id: string;
  created_at: string;
}

export interface TaskWatcherRow {
  id: string;
  task_id: string;
  agent_id: string;
  created_at: string;
}

// Task comment
export interface TaskComment {
  id: string;
  task_id: string;
  agent_id: string | null;
  session_id: string | null;
  content: string;
  type: 'comment' | 'progress' | 'note';
  progress_pct: number | null;
  created_at: string;
}

export interface CreateCommentInput {
  task_id: string;
  content: string;
  agent_id?: string;
  session_id?: string;
  type?: 'comment' | 'progress' | 'note';
  progress_pct?: number;
}

// Plan comment — the plan-row analogue of TaskComment. Plans previously had no
// comment surface at all, so plan-level outcomes could not be recorded on the
// plan row (todos task 04ee08fd). The task and plan comment stores are separate
// tables by design: a comment belongs to exactly one surface, and neither list
// verb may surface the other's rows.
export interface PlanComment {
  id: string;
  plan_id: string;
  agent_id: string | null;
  session_id: string | null;
  content: string;
  type: 'comment' | 'progress' | 'note';
  progress_pct: number | null;
  created_at: string;
}

export interface CreatePlanCommentInput {
  plan_id: string;
  content: string;
  agent_id?: string;
  session_id?: string;
  type?: 'comment' | 'progress' | 'note';
  progress_pct?: number;
}

// Session
export interface Session {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  working_dir: string | null;
  started_at: string;
  last_activity: string;
  metadata: Record<string, unknown>;
}

export interface CreateSessionInput {
  agent_id?: string;
  project_id?: string;
  working_dir?: string;
  metadata?: Record<string, unknown>;
}

// DB row types (raw from SQLite - JSON fields are strings)
export interface TaskRow {
  id: string;
  short_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  agent_id: string | null;
  assigned_to: string | null;
  session_id: string | null;
  working_dir: string | null;
  tags: string | null;
  metadata: string | null;
  version: number;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  requires_approval: number;
  approved_by: string | null;
  approved_at: string | null;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  spawns_template_id: string | null;
  confidence: number | null;
  reason: string | null;
  spawned_from_session: string | null;
  assigned_by: string | null;
  created_by: string | null;
  assigned_from_project: string | null;
  task_type: string | null;
  cost_tokens: number;
  cost_usd: number;
  delegated_from: string | null;
  delegation_depth: number;
  retry_count: number;
  max_retries: number;
  retry_after: string | null;
  sla_minutes: number | null;
  actual_minutes: number | null;
  runner_id: string | null;
  runner_started_at: string | null;
  runner_completed_at: string | null;
  current_step: string | null;
  total_steps: number | null;
  cycle_id?: string | null;
  machine_id?: string | null;
  synced_at?: string | null;
  archived_at?: string | null;
}

export interface SessionRow {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  working_dir: string | null;
  started_at: string;
  last_activity: string;
  metadata: string | null;
}

// Locking
export interface LockResult {
  success: boolean;
  locked_by?: string;
  locked_at?: string;
  expires_at?: string;
  error?: string;
}

/**
 * Exact compare-and-swap input for taking over one stale task lock.
 *
 * `expected_lock_version` is the authoritative `locked_at` value read from the
 * task. It is intentionally a string token rather than a duration-derived
 * guess: holder and version must still match exactly when the backend performs
 * the mutation.
 */
export interface StaleLockHandoffInput {
  task_id: string;
  actor: string;
  expected_holder: string;
  expected_lock_version: string;
  stale_after_seconds: number;
  new_holder: string;
  reason: string;
}

/**
 * Immutable task-history receipt for a successful stale-lock handoff.
 *
 * `receipt_id` is also the owning TaskHistory row id, so the receipt can be
 * read back through the existing task history API instead of a parallel log.
 */
export interface StaleLockHandoffReceipt {
  schema_version: "todos.stale-lock-handoff.v1";
  receipt_id: string;
  task_id: string;
  actor: string;
  previous_holder: string;
  previous_lock_version: string;
  new_holder: string;
  new_lock_version: string;
  stale_after_seconds: number;
  stale_cutoff: string;
  reason: string;
  created_at: string;
}

// Task History (audit log)
export interface TaskHistory {
  id: string;
  task_id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  agent_id: string | null;
  created_at: string;
  machine_id?: string | null;
}

// Webhook
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  project_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  secret?: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  task_id?: string;
}

// Template variable definition
export interface TemplateVariable {
  name: string;        // e.g. "name"
  required: boolean;   // must be provided
  default?: string;    // fallback value
  description?: string; // help text
}

// Task Template
export interface TaskTemplate {
  id: string;
  name: string;
  title_pattern: string;
  description: string | null;
  priority: TaskPriority;
  tags: string[];
  variables: TemplateVariable[];
  version: number;
  project_id: string | null;
  plan_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  machine_id?: string | null;
  synced_at?: string | null;
}

export interface CreateTemplateInput {
  name: string;
  title_pattern: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
  variables?: TemplateVariable[];
  project_id?: string;
  plan_id?: string;
  metadata?: Record<string, unknown>;
  tasks?: TemplateTaskInput[];
}

// Template task — a single step in a multi-task template
export interface TemplateTask {
  id: string;
  template_id: string;
  position: number;
  title_pattern: string;
  description: string | null;
  priority: TaskPriority;
  tags: string[];
  task_type: string | null;
  condition: string | null;
  include_template_id: string | null;
  depends_on_positions: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TemplateTaskInput {
  title_pattern: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
  task_type?: string;
  condition?: string;
  include_template_id?: string;
  depends_on?: number[];  // position indices this task depends on
  metadata?: Record<string, unknown>;
}

export interface TemplateWithTasks extends TaskTemplate {
  tasks: TemplateTask[];
}

// Template version — historical snapshot of a template
export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  snapshot: string;
  created_at: string;
}

// Version conflict error
export class VersionConflictError extends Error {
  static readonly code = "VERSION_CONFLICT";
  static readonly suggestion = "Fetch the task with get_task to get the current version before updating.";
  constructor(
    public taskId: string,
    public expectedVersion: number,
    public actualVersion: number,
  ) {
    super(
      `Version conflict for task ${taskId}: expected ${expectedVersion}, got ${actualVersion}`,
    );
    this.name = "VersionConflictError";
  }
}

export class TaskNotFoundError extends Error {
  static readonly code = "TASK_NOT_FOUND";
  static readonly suggestion = "Verify the task ID. Use list_tasks or search_tasks to find the correct ID.";
  constructor(public taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskNotStartableError extends Error {
  static readonly code = "TASK_NOT_STARTABLE";
  static readonly suggestion = "Reset the task status to pending before starting it again.";

  constructor(
    public taskId: string,
    public status: TaskStatus,
    public agentId: string,
  ) {
    super(
      `Task ${taskId} is ${status} and cannot be started by ${agentId}; ` +
      "reset the task status to pending before starting it again",
    );
    this.name = "TaskNotStartableError";
  }
}

export interface TaskReferenceCandidate {
  task_id: string;
  project_id: string | null;
}

export class TaskReferenceAmbiguousError extends Error {
  static readonly code = "TASK_REFERENCE_AMBIGUOUS";
  readonly candidateTaskIds: string[];
  readonly candidateProjectIds: string[];

  constructor(public readonly reference: string, candidates: TaskReferenceCandidate[]) {
    const candidateTaskIds = [...new Set(candidates.map((candidate) => candidate.task_id))].sort();
    const candidateProjectIds = [...new Set(
      candidates
        .map((candidate) => candidate.project_id)
        .filter((projectId): projectId is string => typeof projectId === "string" && projectId.length > 0),
    )].sort();
    const projectList = candidateProjectIds.length > 0 ? candidateProjectIds.join(", ") : "(unscoped)";
    super(
      `Task reference is ambiguous: "${reference}". Candidate project IDs: ${projectList}. ` +
      "Use a full task UUID.",
    );
    this.name = "TaskReferenceAmbiguousError";
    this.candidateTaskIds = candidateTaskIds;
    this.candidateProjectIds = candidateProjectIds;
  }
}

export class ProjectNotFoundError extends Error {
  static readonly code = "PROJECT_NOT_FOUND";
  static readonly suggestion = "Use list_projects to see available projects.";
  constructor(public projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ResourceConflictError extends Error {
  constructor(
    public readonly code: "PROJECT_SLUG_CONFLICT" | "TASK_LIST_SLUG_CONFLICT" | "PLAN_SLUG_CONFLICT" | "PLAN_PROJECT_LINK_CONFLICT" | "TASK_PARENT_CYCLE" | "PROJECT_PARENT_CYCLE" | "SNAPSHOT_DESTINATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ResourceConflictError";
  }
}

export class PlanRevisionConflictError extends Error {
  static readonly code = "PLAN_REVISION_CONFLICT";

  constructor(
    public readonly planId: string,
    public readonly expectedUpdatedAt: string,
    public readonly currentUpdatedAt: string,
  ) {
    super(
      `Plan revision conflict for ${planId}: expected ${expectedUpdatedAt}, current ${currentUpdatedAt}`,
    );
    this.name = "PlanRevisionConflictError";
  }
}

export class PlanNotFoundError extends Error {
  static readonly code = "PLAN_NOT_FOUND";
  static readonly suggestion = "Use list_plans to see available plans.";
  constructor(public planId: string) {
    super(`Plan not found: ${planId}`);
    this.name = "PlanNotFoundError";
  }
}

export class LockError extends Error {
  static readonly code = "LOCK_ERROR";
  static readonly suggestion = "Wait for the lock to expire (30 min) or contact the lock holder.";
  constructor(
    public taskId: string,
    public lockedBy: string,
  ) {
    super(`Task ${taskId} is locked by ${lockedBy}`);
    this.name = "LockError";
  }
}

export type StaleLockHandoffErrorCode =
  | "STALE_LOCK_HANDOFF_INVALID_TASK_ID"
  | "STALE_LOCK_HANDOFF_INVALID_INPUT"
  | "STALE_LOCK_HANDOFF_ACTOR_MISMATCH"
  | "STALE_LOCK_HANDOFF_NOT_LOCKED"
  | "STALE_LOCK_HANDOFF_HOLDER_MISMATCH"
  | "STALE_LOCK_HANDOFF_VERSION_MISMATCH"
  | "STALE_LOCK_HANDOFF_NOT_STALE"
  | "STALE_LOCK_HANDOFF_TERMINAL"
  | "STALE_LOCK_HANDOFF_CONFLICT";

export class StaleLockHandoffError extends Error {
  constructor(
    public readonly code: StaleLockHandoffErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StaleLockHandoffError";
  }
}

export class AgentNotFoundError extends Error {
  static readonly code = "AGENT_NOT_FOUND";
  static readonly suggestion = "Use register_agent to create the agent first, or list_agents to find existing ones.";
  constructor(public agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

export class IdentityAliasAmbiguousError extends Error {
  readonly code = "IDENTITY_ALIAS_AMBIGUOUS" as const;
  readonly candidates: string[];

  constructor(subject: string, candidates: string[] = []) {
    super(`Identity alias or source is ambiguous: ${subject}`);
    this.name = "IdentityAliasAmbiguousError";
    this.candidates = [...new Set(candidates)].sort();
  }
}

export class IdentityIdImmutableError extends Error {
  readonly code = "IDENTITY_ID_IMMUTABLE" as const;

  constructor(agentId: string) {
    super(`IDENTITY_ID_IMMUTABLE: canonical identity for agent ${agentId} cannot be replaced`);
    this.name = "IdentityIdImmutableError";
  }
}

export class TaskListNotFoundError extends Error {
  static readonly code = "TASK_LIST_NOT_FOUND";
  static readonly suggestion = "Use list_task_lists to see available lists.";
  constructor(public taskListId: string) {
    super(`Task list not found: ${taskListId}`);
    this.name = "TaskListNotFoundError";
  }
}

export class DependencyCycleError extends Error {
  static readonly code = "DEPENDENCY_CYCLE";
  static readonly suggestion = "Check the dependency chain with get_task to avoid circular references.";
  constructor(
    public taskId: string,
    public dependsOn: string,
  ) {
    super(
      `Adding dependency ${taskId} -> ${dependsOn} would create a cycle`,
    );
    this.name = "DependencyCycleError";
  }
}

export class CompletionGuardError extends Error {
  static readonly code = "COMPLETION_BLOCKED";
  static readonly suggestion = "Wait for the cooldown period, then retry.";
  constructor(
    public reason: string,
    public retryAfterSeconds?: number,
  ) {
    super(reason);
    this.name = "CompletionGuardError";
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export const DISPATCH_STATUSES = ["pending", "sent", "failed", "cancelled"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/** Parsed tmux target: session:window.pane (all parts optional except window) */
export interface TmuxTarget {
  session: string | null;
  window: string;
  pane: string | null;
  /** Original spec string, e.g. "main", "work:1", "work:1.0" */
  raw: string;
}

export interface Dispatch {
  id: string;
  title: string | null;
  target_window: string;
  task_ids: string[];
  task_list_id: string | null;
  /** Pre-formatted message, or null to format at send time */
  message: string | null;
  /** Delay in ms between send and Enter. null = auto-calculated */
  delay_ms: number | null;
  scheduled_at: string | null;
  status: DispatchStatus;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface DispatchRow {
  id: string;
  title: string | null;
  target_window: string;
  task_ids: string;
  task_list_id: string | null;
  message: string | null;
  delay_ms: number | null;
  scheduled_at: string | null;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface DispatchLog {
  id: string;
  dispatch_id: string;
  target_window: string;
  message: string;
  delay_ms: number;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
}

export interface CreateDispatchInput {
  title?: string;
  target_window: string;
  task_ids?: string[];
  task_list_id?: string;
  /** Pre-format the message. If omitted, formatted at send time from task_ids/task_list_id. */
  message?: string;
  /** Explicit delay in ms. If omitted, auto-calculated from message length. */
  delay_ms?: number;
  /** ISO string. If omitted, dispatch is immediate. */
  scheduled_at?: string;
}

export interface ListDispatchesFilter {
  status?: DispatchStatus | DispatchStatus[];
  limit?: number;
  offset?: number;
}

export class DispatchNotFoundError extends Error {
  static readonly code = "DISPATCH_NOT_FOUND";
  static readonly suggestion = "Check the dispatch ID with list_dispatches.";
  constructor(public dispatchId: string) {
    super(`Dispatch not found: ${dispatchId}`);
    this.name = "DispatchNotFoundError";
  }
}

// ── SDK types (formerly in src/sdk.ts) ──────────────────────────────────────

/** Compact task representation returned by list endpoints */
export interface TaskSummary {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  project_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  assigned_to: string | null;
  locked_by: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  due_at: string | null;
  recurrence_rule: string | null;
}

/** Progress log entry for a task */
export interface ProgressEntry {
  id: string;
  task_id: string;
  content: string;
  type: "comment" | "progress" | "note";
  progress_pct: number | null;
  agent_id: string | null;
  created_at: string;
}

/** Dashboard statistics */
export interface DashboardStats {
  total_tasks: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  projects: number;
  agents: number;
  stale_count?: number;
  overdue_recurring?: number;
  recurring_tasks?: number;
}

/** Task status summary response */
export interface StatusSummaryResponse {
  pending: number;
  in_progress: number;
  completed: number;
  total: number;
  active_work: {
    id: string;
    short_id: string | null;
    title: string;
    priority: string;
    assigned_to: string | null;
    locked_by: string | null;
    updated_at: string;
  }[];
  next_task: TaskSummary | null;
  stale_count: number;
  overdue_recurring: number;
}
