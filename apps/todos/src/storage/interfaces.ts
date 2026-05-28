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
  Task,
  TaskComment,
  TaskFilter,
  TaskHistory,
  TaskList,
  TaskTemplate,
  TemplateWithTasks,
  UpdatePlanInput,
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
  transaction?<T>(fn: (adapter: TodosStorageAdapter) => MaybePromise<T>, context?: TodosStorageContext): MaybePromise<T>;
}

export interface TodosTaskStore {
  create(input: CreateTaskInput, context?: TodosStorageContext): MaybePromise<Task>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Task | null>;
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
}

export interface TodosProjectStore {
  create(input: CreateProjectInput, context?: TodosStorageContext): MaybePromise<Project>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Project | null>;
  getByPath(path: string, context?: TodosStorageContext): MaybePromise<Project | null>;
  list(context?: TodosStorageContext): MaybePromise<Project[]>;
  update(id: string, input: Partial<Pick<Project, "name" | "description" | "task_list_id" | "path">>, context?: TodosStorageContext): MaybePromise<Project>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
}

export interface TodosPlanStore {
  create(input: CreatePlanInput, context?: TodosStorageContext): MaybePromise<Plan>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Plan | null>;
  list(projectId?: string, context?: TodosStorageContext): MaybePromise<Plan[]>;
  update(id: string, input: UpdatePlanInput, context?: TodosStorageContext): MaybePromise<Plan>;
  delete(id: string, context?: TodosStorageContext): MaybePromise<boolean>;
}

export interface TodosAgentStore {
  register(input: RegisterAgentInput, context?: TodosStorageContext): MaybePromise<Agent | { conflict: true; message: string }>;
  get(id: string, context?: TodosStorageContext): MaybePromise<Agent | null>;
  getByName(name: string, context?: TodosStorageContext): MaybePromise<Agent | null>;
  list(options?: { include_archived?: boolean }, context?: TodosStorageContext): MaybePromise<Agent[]>;
  update(id: string, input: TodosAgentUpdateInput, context?: TodosStorageContext): MaybePromise<Agent | null>;
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
  getTaskHistory(taskId: string, context?: TodosStorageContext): MaybePromise<TaskHistory[]>;
  getRecentActivity(limit?: number, context?: TodosStorageContext): MaybePromise<TaskHistory[]>;
}

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
  plans: Plan[];
  agents: Agent[];
  taskLists: TaskList[];
  templates: TaskTemplate[];
  auditHistory: TaskHistory[];
}

export interface TodosStorageImportResult {
  inserted: number;
  updated: number;
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
