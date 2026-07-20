import type {
  Agent,
  CreateCommentInput,
  CreatePlanInput,
  CreateProjectInput,
  CreateTaskInput,
  CreateTaskListInput,
  CreateTemplateInput,
  Plan,
  Project,
  RegisterAgentInput,
  RenameProjectInput,
  RenameProjectResult,
  Task,
  TaskComment,
  TaskDependency,
  TaskFilter,
  TaskHistory,
  TaskList,
  TaskTemplate,
  TemplateWithTasks,
  UpdatePlanInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateTaskListInput,
} from "../types/index.js";

export type MaybePromise<T> = T | Promise<T>;

export type TodosStorageKind = "sqlite" | "postgres" | "remote" | "memory" | (string & {});

export interface TodosStorageContext {
  organizationId?: string;
  projectId?: string;
  taskListId?: string;
  agentId?: string;
  sessionId?: string;
  requestId?: string;
}

export interface TodosStorageCapabilities {
  localPersistence: boolean;
  remotePersistence: boolean;
  transactions: boolean;
  auditLog: boolean;
  sync: boolean;
}

export interface TodosStorageAdapter {
  readonly kind: TodosStorageKind;
  readonly capabilities: TodosStorageCapabilities;
  readonly tasks: TodosTaskStore;
  readonly projects: TodosProjectStore;
  readonly plans: TodosPlanStore;
  readonly agents: TodosAgentStore;
  readonly taskLists: TodosTaskListStore;
  readonly templates: TodosTemplateStore;
  readonly audit: TodosAuditStore;
  readonly sync: TodosSyncStore;
  /**
   * Task dependency edges. Optional because only the cloud/remote adapters expose
   * it through the `/v1` API — the local CLI/MCP paths call the sqlite `db/*`
   * helpers directly. Present on the Postgres (self_hosted) adapter.
   */
  readonly dependencies?: TodosDependencyStore;
  /** Task verification records (optional; present on the Postgres adapter). */
  readonly verifications?: TodosVerificationStore;
  /** Git commit links (optional; present on the Postgres adapter). */
  readonly commits?: TodosCommitStore;
  /** Git branch/PR ref links (optional; present on the Postgres adapter). */
  readonly gitRefs?: TodosGitRefStore;
  transaction?<T>(fn: (adapter: TodosStorageAdapter) => MaybePromise<T>, context?: TodosStorageContext): MaybePromise<T>;
}

export interface TodosTaskCommitRecord {
  id: string;
  task_id: string;
  sha: string;
  message: string | null;
  author: string | null;
  files_changed: string[] | null;
  created_at: string;
}

export interface CreateTodosCommitInput {
  task_id: string;
  sha: string;
  message?: string | null;
  author?: string | null;
  files_changed?: string[] | null;
}

export interface TodosCommitStore {
  add(input: CreateTodosCommitInput, context?: TodosStorageContext): MaybePromise<TodosTaskCommitRecord>;
  list(taskId: string, context?: TodosStorageContext): MaybePromise<TodosTaskCommitRecord[]>;
  find(sha: string, context?: TodosStorageContext): MaybePromise<TodosTaskCommitRecord | null>;
}

export interface TodosTaskGitRefRecord {
  id: string;
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url: string | null;
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateTodosGitRefInput {
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TodosGitRefStore {
  add(input: CreateTodosGitRefInput, context?: TodosStorageContext): MaybePromise<TodosTaskGitRefRecord>;
  list(taskId: string, context?: TodosStorageContext): MaybePromise<TodosTaskGitRefRecord[]>;
  find(ref: string, context?: TodosStorageContext): MaybePromise<TodosTaskGitRefRecord[]>;
}

export interface TodosLockResult {
  success: boolean;
  locked_by?: string;
  locked_at?: string;
  expires_at?: string;
  error?: string;
}

export interface TodosTaskDependencies {
  dependencies: TaskDependency[];
  blocked_by: TaskDependency[];
}

export interface TodosDependencyStore {
  add(taskId: string, dependsOn: string, context?: TodosStorageContext): MaybePromise<TaskDependency>;
  remove(taskId: string, dependsOn: string, context?: TodosStorageContext): MaybePromise<boolean>;
  list(taskId: string, context?: TodosStorageContext): MaybePromise<TodosTaskDependencies>;
  /**
   * Every dependency edge in the dataset. Optional — present on the Postgres
   * (self_hosted) adapter so the CLI can derive blocked/ready/sprint/recap
   * dependency analytics over the shared cloud set in one round trip.
   */
  listAll?(context?: TodosStorageContext): MaybePromise<TaskDependency[]>;
}

export interface TodosTaskVerification {
  id: string;
  task_id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  run_at: string;
  created_at: string;
}

export interface CreateTodosVerificationInput {
  task_id: string;
  command: string;
  status?: "passed" | "failed" | "unknown";
  output_summary?: string | null;
  artifact_path?: string | null;
  agent_id?: string | null;
}

export interface TodosVerificationStore {
  add(input: CreateTodosVerificationInput, context?: TodosStorageContext): MaybePromise<TodosTaskVerification>;
  list(taskId: string, context?: TodosStorageContext): MaybePromise<TodosTaskVerification[]>;
}

export interface TodosTaskStore {
  create(input: CreateTaskInput, context?: TodosStorageContext): MaybePromise<Task>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Task | null>;
  /**
   * Resolve a task reference that is NOT already a full UUID — an exact `short_id`
   * (e.g. `OPE2-00125`) or a unique task-`id` prefix — to the single matching task,
   * or `null` when nothing matches. Throws when a prefix is ambiguous (matches more
   * than one task). This is a BOUNDED, index/SQL-side lookup: it must never load the
   * whole task set. It exists so the `/v1/tasks/:ref` route can resolve short refs
   * server-side instead of the CLI paging every task over HTTP to resolve them.
   * Optional — an adapter that only ever receives full UUIDs may omit it.
   */
  resolveRef?(ref: string, context?: TodosStorageContext): MaybePromise<Task | null>;
  list(filter?: TaskFilter, context?: TodosStorageContext): MaybePromise<Task[]>;
  count(filter?: Omit<TaskFilter, "limit" | "offset">, context?: TodosStorageContext): MaybePromise<number>;
  update(id: string, input: UpdateTaskInput, context?: TodosStorageContext): MaybePromise<Task>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
  start(id: string, agentId: string, context?: TodosStorageContext): MaybePromise<Task>;
  complete(id: string, agentId?: string, options?: TodosTaskCompletionOptions, context?: TodosStorageContext): MaybePromise<Task>;
  fail(
    id: string,
    agentId?: string,
    reason?: string,
    options?: TodosTaskFailureOptions,
    context?: TodosStorageContext,
  ): MaybePromise<TodosTaskFailureResult>;
  claimNext(agentId: string, filters?: TodosTaskClaimFilter, context?: TodosStorageContext): MaybePromise<Task | null>;
  getNext(agentId?: string, filters?: TodosTaskClaimFilter, context?: TodosStorageContext): MaybePromise<Task | null>;
  getActiveWork(filters?: TodosActiveWorkFilter, context?: TodosStorageContext): MaybePromise<ActiveWorkItem[]>;
  getChangedSince(since: string, filters?: TodosActiveWorkFilter, context?: TodosStorageContext): MaybePromise<Task[]>;
  /** Acquire an exclusive lock (`locked_by`/`locked_at`). Optional — cloud adapters only. */
  lock?(id: string, agentId: string, context?: TodosStorageContext): MaybePromise<TodosLockResult>;
  /** Release a lock. Optional — cloud adapters only. */
  unlock?(id: string, agentId?: string, context?: TodosStorageContext): MaybePromise<boolean>;
  /**
   * Resolve the single task carrying `metadata.fingerprint === fingerprint` in the
   * shared dataset, or null. Backs the `/v1/tasks/upsert` idempotent create-or-update
   * so `task upsert` dedupes against the cloud dataset instead of this machine's local
   * sqlite (the split-brain write it previously performed). Optional — cloud adapters only.
   */
  getByFingerprint?(fingerprint: string, context?: TodosStorageContext): MaybePromise<Task | null>;
}

export interface TodosProjectStore {
  create(input: CreateProjectInput, context?: TodosStorageContext): MaybePromise<Project>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Project | null>;
  getByPath(path: string, context?: TodosStorageContext): MaybePromise<Project | null>;
  list(context?: TodosStorageContext): MaybePromise<Project[]>;
  update(id: string, input: UpdateProjectInput, context?: TodosStorageContext): MaybePromise<Project>;
  rename(id: string, input: RenameProjectInput, context?: TodosStorageContext): MaybePromise<RenameProjectResult>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
}

export interface TodosPlanStore {
  create(input: CreatePlanInput, context?: TodosStorageContext): MaybePromise<Plan>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Plan | null>;
  list(projectId?: string, context?: TodosStorageContext): MaybePromise<Plan[]>;
  update(id: string, input: UpdatePlanInput, context?: TodosStorageContext): MaybePromise<Plan>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
}

export interface TodosAgentReleaseResult {
  agent: Agent;
  released: boolean;
}

export interface TodosAgentStore {
  register(input: RegisterAgentInput, context?: TodosStorageContext): MaybePromise<Agent | { conflict: true; message: string }>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Agent | null>;
  getByName(name: string, context?: TodosStorageContext): MaybePromise<Agent | null>;
  list(options?: { include_archived?: boolean }, context?: TodosStorageContext): MaybePromise<Agent[]>;
  update(id: string, input: TodosAgentUpdateInput, context?: TodosStorageContext): MaybePromise<Agent | null>;
  /**
   * Refresh an agent's `last_seen_at` (heartbeat), resolving by id OR name.
   * Optional — present on the Postgres (self_hosted) adapter so a flipped machine
   * heartbeats the SHARED cloud roster instead of its local sqlite island (the
   * previous CLI/MCP path 404'd cloud-only agents with "Agent not found").
   */
  heartbeat?(idOrName: string, context?: TodosStorageContext): MaybePromise<Agent | null>;
  /**
   * Release/logout an agent — clears its session binding so the name is available.
   * Resolves by id OR name. When `sessionId` is provided the release only succeeds
   * if it matches the agent's current session (returns `{ released: false }` on a
   * mismatch). Optional — present on the Postgres (self_hosted) adapter.
   */
  release?(idOrName: string, sessionId?: string, context?: TodosStorageContext): MaybePromise<TodosAgentReleaseResult | null>;
}

export interface TodosAgentUpdateInput {
  name?: string;
  description?: string;
  role?: string;
  title?: string;
  level?: string;
  permissions?: string[];
  capabilities?: string[];
  reports_to?: string | null;
  org_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TodosTaskListStore {
  create(input: CreateTaskListInput, context?: TodosStorageContext): MaybePromise<TaskList>;
  get(id: string, context?: TodosStorageContext): MaybePromise<TaskList | null>;
  getBySlug(slug: string, projectId?: string, context?: TodosStorageContext): MaybePromise<TaskList | null>;
  list(projectId?: string, context?: TodosStorageContext): MaybePromise<TaskList[]>;
  update(id: string, input: UpdateTaskListInput, context?: TodosStorageContext): MaybePromise<TaskList>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
}

export interface TodosTemplateStore {
  create(input: CreateTemplateInput, context?: TodosStorageContext): MaybePromise<TaskTemplate>;
  get(id: string, context?: TodosStorageContext): MaybePromise<TaskTemplate | null>;
  list(context?: TodosStorageContext): MaybePromise<TaskTemplate[]>;
  update(id: string, input: UpdateTemplateInput, context?: TodosStorageContext): MaybePromise<TaskTemplate | null>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
  getWithTasks(id: string, context?: TodosStorageContext): MaybePromise<TemplateWithTasks | null>;
}

export interface UpdateTemplateInput {
  name?: string;
  title_pattern?: string;
  description?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  tags?: string[];
  variables?: { name: string; required: boolean; default?: string; description?: string }[];
  project_id?: string | null;
  plan_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TodosAuditStore {
  logTaskChange(
    taskId: string,
    action: string,
    field?: string,
    oldValue?: string | null,
    newValue?: string | null,
    agentId?: string | null,
    context?: TodosStorageContext,
  ): MaybePromise<TaskHistory>;
  addComment(input: CreateCommentInput, context?: TodosStorageContext): MaybePromise<TaskComment>;
  getComments(taskId: string, context?: TodosStorageContext): MaybePromise<TaskComment[]>;
  /** Optional bounded cursor capability; legacy implementations need not provide it. */
  getCommentsPage?(
    taskId: string,
    options: TodosCommentListOptions,
    context?: TodosStorageContext,
  ): MaybePromise<TaskComment[]>;
  getTaskHistory(taskId: string, context?: TodosStorageContext): MaybePromise<TaskHistory[]>;
  getRecentActivity(limit?: number, context?: TodosStorageContext): MaybePromise<TaskHistory[]>;
}

export interface TodosCommentListOptions {
  /** Maximum rows returned. Remote adapters must enforce a finite bound. */
  limit?: number;
  /** Return comments strictly older than this stable `(created_at, id)` tuple. */
  before?: { created_at: string; id: string };
}

type TodosTypeAssertion<T extends true> = T;
type TodosLegacyGetCommentsSignature = (
  taskId: string,
  context?: TodosStorageContext,
) => MaybePromise<TaskComment[]>;

/** Compile-time guard: pre-pagination audit-store implementations stay assignable. */
export type TodosLegacyGetCommentsCompatibility = TodosTypeAssertion<
  TodosLegacyGetCommentsSignature extends TodosAuditStore["getComments"] ? true : false
>;

export interface TodosSyncStore {
  getTasksChangedSince(since: string, filters?: TodosActiveWorkFilter, context?: TodosStorageContext): MaybePromise<Task[]>;
  exportSnapshot?(context?: TodosStorageContext): MaybePromise<TodosStorageSnapshot>;
  importSnapshot?(snapshot: TodosStorageSnapshot, context?: TodosStorageContext): MaybePromise<TodosStorageImportResult>;
}

export interface TodosStorageSnapshot {
  exportedAt: string;
  source: TodosStorageKind;
  tasks: Task[];
  projects: Project[];
  projectMachinePaths?: TodosProjectMachinePath[];
  plans: Plan[];
  agents: Agent[];
  taskLists: TaskList[];
  templates: TaskTemplate[];
  auditHistory: TaskHistory[];
  tombstones?: TodosStorageTombstone[];
}

export interface TodosStorageTombstone {
  object_type: "tasks" | "projects" | "project_machine_paths" | "plans" | "agents" | "task_lists" | "templates" | "audit_history";
  object_id: string;
  deleted_at: string;
  updated_at: string;
  source_machine_id?: string | null;
  payload?: Record<string, unknown> | null;
  version?: number | null;
}

export interface TodosProjectMachinePath {
  id: string;
  project_id: string;
  machine_id: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface TodosStorageImportResult {
  inserted: number;
  updated: number;
  deleted?: number;
  skipped: number;
  errors: string[];
}

export interface TodosTaskCompletionOptions {
  files_changed?: string[];
  test_results?: string;
  commit_hash?: string;
  notes?: string;
  attachment_ids?: string[];
  skip_recurrence?: boolean;
  confidence?: number;
  completed_at?: string;
}

export interface TodosTaskFailureOptions {
  retry?: boolean;
  retry_after?: string;
  error_code?: string;
}

export interface TodosTaskFailureResult {
  task: Task;
  retryTask?: Task;
}

export interface TodosTaskClaimFilter {
  project_id?: string;
  task_list_id?: string;
  plan_id?: string;
  tags?: string[];
}

export interface TodosActiveWorkFilter {
  project_id?: string;
  task_list_id?: string;
}

export interface ActiveWorkItem {
  id: string;
  short_id: string | null;
  title: string;
  priority: string;
  assigned_to: string | null;
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
}
