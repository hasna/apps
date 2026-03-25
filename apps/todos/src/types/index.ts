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
  created_at: string;
  updated_at: string;
  sources?: ProjectSource[];
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
  task_list_id?: string;
  task_prefix?: string;
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
  project_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  name: string;
  description: string | null;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  name: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  description?: string;
  status?: PlanStatus;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  status?: PlanStatus;
  task_list_id?: string;
  agent_id?: string;
}

// Agent
export type AgentStatus = "active" | "archived";

export interface Agent {
  id: string; // 8-char short UUID
  name: string;
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
}

export interface AgentRow {
  id: string;
  name: string;
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
}

export interface RegisterAgentInput {
  name: string;
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
  working_dir?: string;
  project_id?: string;
  force?: boolean; // skip active-agent check and force takeover
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
}

export interface CreateTaskListInput {
  name: string;
  slug?: string;
  project_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskListInput {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
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
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  spawns_template_id: string | null;
  confidence: number | null;
  reason: string | null;
  spawned_from_session: string | null;
  assigned_by: string | null; // agent_id who created/assigned this task
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

// Task with relations loaded
export interface TaskWithRelations extends Task {
  subtasks: Task[];
  dependencies: Task[];
  blocked_by: Task[];
  comments: TaskComment[];
  parent: Task | null;
  checklist: ChecklistItem[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
  plan_id?: string;
  task_list_id?: string;
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
  requires_approval?: boolean;
  recurrence_rule?: string;
  recurrence_parent_id?: string;
  spawns_template_id?: string;
  reason?: string;
  spawned_from_session?: string;
  assigned_by?: string;
  assigned_from_project?: string;
  task_type?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string;
  plan_id?: string;
  task_list_id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  due_at?: string;
  estimated_minutes?: number;
  requires_approval?: boolean;
  approved_by?: string;
  recurrence_rule?: string | null;
  version: number; // required for optimistic locking
  task_type?: string | null;
}

export interface TaskFilter {
  project_id?: string;
  parent_id?: string | null;
  plan_id?: string;
  task_list_id?: string;
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assigned_to?: string;
  agent_id?: string;
  session_id?: string;
  tags?: string[];
  has_recurrence?: boolean;
  include_subtasks?: boolean;
  task_type?: string | string[];
  limit?: number;
  offset?: number;
  /** Opaque cursor from a prior list_tasks response — stable pagination that survives concurrent mutations */
  cursor?: string;
}

// Task dependency
export interface TaskDependency {
  task_id: string;
  depends_on: string;
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
  error?: string;
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
}

// Webhook
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  secret?: string;
}

// Task Template
export interface TaskTemplate {
  id: string;
  name: string;
  title_pattern: string;
  description: string | null;
  priority: TaskPriority;
  tags: string[];
  project_id: string | null;
  plan_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreateTemplateInput {
  name: string;
  title_pattern: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
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
  depends_on?: number[];  // position indices this task depends on
  metadata?: Record<string, unknown>;
}

export interface TemplateWithTasks extends TaskTemplate {
  tasks: TemplateTask[];
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

export class ProjectNotFoundError extends Error {
  static readonly code = "PROJECT_NOT_FOUND";
  static readonly suggestion = "Use list_projects to see available projects.";
  constructor(public projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
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

export class AgentNotFoundError extends Error {
  static readonly code = "AGENT_NOT_FOUND";
  static readonly suggestion = "Use register_agent to create the agent first, or list_agents to find existing ones.";
  constructor(public agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
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
