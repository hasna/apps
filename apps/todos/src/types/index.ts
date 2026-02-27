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

// Project
export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  task_list_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
  task_list_id?: string;
}

// Plan
export interface Plan {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  name: string;
  project_id?: string;
  description?: string;
  status?: PlanStatus;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  status?: PlanStatus;
}

// Task
export interface Task {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  plan_id: string | null;
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
  completed_at: string | null;
}

// Task with relations loaded
export interface TaskWithRelations extends Task {
  subtasks: Task[];
  dependencies: Task[];
  blocked_by: Task[];
  comments: TaskComment[];
  parent: Task | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
  plan_id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  agent_id?: string;
  assigned_to?: string;
  session_id?: string;
  working_dir?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string;
  plan_id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  version: number; // required for optimistic locking
}

export interface TaskFilter {
  project_id?: string;
  parent_id?: string | null;
  plan_id?: string;
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assigned_to?: string;
  agent_id?: string;
  session_id?: string;
  tags?: string[];
  include_subtasks?: boolean;
  limit?: number;
  offset?: number;
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
  created_at: string;
}

export interface CreateCommentInput {
  task_id: string;
  content: string;
  agent_id?: string;
  session_id?: string;
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
  project_id: string | null;
  parent_id: string | null;
  plan_id: string | null;
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
  completed_at: string | null;
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

// Version conflict error
export class VersionConflictError extends Error {
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
  constructor(public taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(public projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class PlanNotFoundError extends Error {
  constructor(public planId: string) {
    super(`Plan not found: ${planId}`);
    this.name = "PlanNotFoundError";
  }
}

export class LockError extends Error {
  constructor(
    public taskId: string,
    public lockedBy: string,
  ) {
    super(`Task ${taskId} is locked by ${lockedBy}`);
    this.name = "LockError";
  }
}

export class DependencyCycleError extends Error {
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
