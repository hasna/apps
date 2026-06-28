import { randomUUID } from "node:crypto";
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
  TaskPriority,
  TaskTemplate,
  TemplateWithTasks,
  UpdatePlanInput,
  UpdateTaskInput,
  UpdateTaskListInput,
} from "../types/index.js";
import type {
  ActiveWorkItem,
  TodosActiveWorkFilter,
  TodosAgentUpdateInput,
  TodosStorageAdapter,
  TodosStorageContext,
  TodosStorageImportResult,
  TodosStorageSnapshot,
  TodosStorageTombstone,
  TodosTaskClaimFilter,
  TodosTaskCompletionOptions,
  TodosTaskFailureOptions,
  TodosTaskFailureResult,
  UpdateTemplateInput,
} from "./interfaces.js";
import {
  DEFAULT_TODOS_POSTGRES_CURSOR_TABLE,
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  postgresTodosSyncSchemaSql,
  type TodosPostgresQueryClient,
  type TodosPostgresSyncRecordType,
} from "./postgres-sync.js";

type RemoteObjectType = TodosPostgresSyncRecordType | "comments";

export interface CreatePostgresTodosStorageAdapterOptions {
  client: TodosPostgresQueryClient;
  service?: string;
  sourceMachineId?: string;
  tableName?: string;
  cursorTableName?: string;
}

interface RemoteRecordRow {
  object_type: string;
  object_id: string;
  payload: unknown;
  updated_at?: string | Date;
  deleted_at?: string | Date | null;
  source_machine_id?: string | null;
  version?: number | null;
}

interface RemoteRecord<T> {
  objectId: string;
  payload: T;
  updatedAt: string;
}

interface RemoteRecordClock {
  updatedAt: string;
  deletedAt: string | null;
}

export function createPostgresTodosStorageAdapter(
  options: CreatePostgresTodosStorageAdapterOptions,
): TodosStorageAdapter {
  const store = new PostgresJsonRecordStore(options);
  const adapter: TodosStorageAdapter = {
    kind: "postgres",
    capabilities: {
      localPersistence: false,
      remotePersistence: true,
      transactions: false,
      auditLog: true,
      sync: true,
    },
    tasks: {
      create: (input, context) => createTask(input, store, context),
      get: (id) => store.get<Task>("tasks", id),
      list: (filter = {}) => listTasks(filter, store),
      count: async (filter = {}) => (await listTasks(filter, store)).length,
      update: (id, input) => updateTask(id, input, store),
      delete: (id, context) => store.delete("tasks", id, context),
      start: (id, agentId) => startTask(id, agentId, store),
      complete: (id, agentId, options) => completeTask(id, agentId, options, store),
      fail: (id, agentId, reason, options) => failTask(id, agentId, reason, options, store),
      claimNext: (agentId, filters) => claimNextTask(agentId, filters, store),
      getNext: (_agentId, filters) => getNextTask(filters, store),
      getActiveWork: (filters) => getActiveWork(filters, store),
      getChangedSince: (since, filters) => getChangedSince(since, filters, store),
    },
    projects: {
      create: (input, context) => createProject(input, store, context),
      get: (id) => store.get<Project>("projects", id),
      getByPath: async (path) => (await store.list<Project>("projects")).find((project) => project.path === path) ?? null,
      list: async () => (await store.list<Project>("projects")).sort((a, b) => a.name.localeCompare(b.name)),
      update: (id, input) => updateProject(id, input, store),
      delete: (id, context) => store.delete("projects", id, context),
    },
    plans: {
      create: (input, context) => createPlan(input, store, context),
      get: (id) => store.get<Plan>("plans", id),
      list: async (projectId) => (await store.list<Plan>("plans"))
        .filter((plan) => projectId === undefined || plan.project_id === projectId)
        .sort((a, b) => a.name.localeCompare(b.name)),
      update: (id, input) => updatePlan(id, input, store),
      delete: (id, context) => store.delete("plans", id, context),
    },
    agents: {
      register: (input, context) => registerAgent(input, store, context),
      get: (id) => store.get<Agent>("agents", id),
      getByName: async (name) => (await store.list<Agent>("agents")).find((agent) => agent.name === name) ?? null,
      list: async (options) => (await store.list<Agent>("agents"))
        .filter((agent) => options?.include_archived || agent.status !== "archived")
        .sort((a, b) => a.name.localeCompare(b.name)),
      update: (id, input) => updateAgent(id, input, store),
    },
    taskLists: {
      create: (input, context) => createTaskList(input, store, context),
      get: (id) => store.get<TaskList>("task_lists", id),
      getBySlug: async (slug, projectId) => (await store.list<TaskList>("task_lists"))
        .find((list) => list.slug === slug && (projectId === undefined || list.project_id === projectId)) ?? null,
      list: async (projectId) => (await store.list<TaskList>("task_lists"))
        .filter((list) => projectId === undefined || list.project_id === projectId)
        .sort((a, b) => a.name.localeCompare(b.name)),
      update: (id, input) => updateTaskList(id, input, store),
      delete: (id, context) => store.delete("task_lists", id, context),
    },
    templates: {
      create: (input, context) => createTemplate(input, store, context),
      get: (id) => store.get<TaskTemplate>("templates", id),
      list: async () => (await store.list<TaskTemplate>("templates")).sort((a, b) => a.name.localeCompare(b.name)),
      update: (id, input) => updateTemplate(id, input, store),
      delete: (id, context) => store.delete("templates", id, context),
      getWithTasks: async (id) => {
        const template = await store.get<TaskTemplate>("templates", id);
        return template ? { ...template, tasks: [] } satisfies TemplateWithTasks : null;
      },
    },
    audit: {
      logTaskChange: (taskId, action, field, oldValue, newValue, agentId, context) =>
        logTaskChange(taskId, action, field, oldValue, newValue, agentId, store, context),
      addComment: (input, context) => addComment(input, store, context),
      getTaskHistory: async (taskId) => (await store.list<TaskHistory>("audit_history"))
        .filter((entry) => entry.task_id === taskId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      getRecentActivity: async (limit = 20) => (await store.list<TaskHistory>("audit_history"))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit),
    },
    sync: {
      getTasksChangedSince: (since, filters) => getChangedSince(since, filters, store),
      exportSnapshot: () => exportSnapshot(store),
      importSnapshot: (snapshot, context) => importSnapshot(snapshot, store, context),
    },
    transaction: (fn) => fn(adapter),
  };
  return adapter;
}

class PostgresJsonRecordStore {
  private readonly service: string;
  private readonly sourceMachineId?: string;
  private readonly tableName: string;
  private readonly cursorTableName: string;
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly options: CreatePostgresTodosStorageAdapterOptions) {
    this.service = options.service ?? "todos";
    this.sourceMachineId = options.sourceMachineId;
    this.tableName = options.tableName ?? DEFAULT_TODOS_POSTGRES_SYNC_TABLE;
    this.cursorTableName = options.cursorTableName ?? DEFAULT_TODOS_POSTGRES_CURSOR_TABLE;
  }

  machineId(context?: TodosStorageContext): string | null {
    return context?.requestId ?? this.sourceMachineId ?? null;
  }

  async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const sql of postgresTodosSyncSchemaSql(this.tableName, this.cursorTableName)) {
        await this.options.client.query(sql);
      }
    })();
    await this.schemaReady;
  }

  async get<T>(type: RemoteObjectType, id: string): Promise<T | null> {
    await this.ensureSchema();
    const result = await this.options.client.query<RemoteRecordRow>(
      `SELECT object_type, object_id, payload, updated_at
       FROM ${this.tableName}
       WHERE service = $1 AND object_type = $2 AND object_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [this.service, type, id],
    );
    return result.rows[0] ? payloadRecord<T>(result.rows[0].payload) : null;
  }

  async list<T>(type: RemoteObjectType): Promise<T[]> {
    return (await this.listRecords<T>(type)).map((record) => record.payload);
  }

  async listRecords<T>(type: RemoteObjectType): Promise<RemoteRecord<T>[]> {
    await this.ensureSchema();
    const result = await this.options.client.query<RemoteRecordRow>(
      `SELECT object_type, object_id, payload, updated_at
       FROM ${this.tableName}
       WHERE service = $1 AND object_type = $2 AND deleted_at IS NULL
       ORDER BY updated_at ASC, object_id ASC`,
      [this.service, type],
    );
    return result.rows.map((row) => ({
      objectId: row.object_id,
      payload: payloadRecord<T>(row.payload),
      updatedAt: stringValue(row.updated_at) ?? new Date().toISOString(),
    }));
  }

  async listTombstones(): Promise<TodosStorageTombstone[]> {
    await this.ensureSchema();
    const result = await this.options.client.query<RemoteRecordRow>(
      `SELECT object_type, object_id, payload, updated_at, deleted_at, source_machine_id, version
       FROM ${this.tableName}
       WHERE service = $1 AND deleted_at IS NOT NULL
       ORDER BY updated_at ASC, object_type ASC, object_id ASC`,
      [this.service],
    );
    return result.rows.map((row) => {
      const deletedAt = stringValue(row.deleted_at) ?? stringValue(row.updated_at) ?? new Date().toISOString();
      return {
        object_type: row.object_type as TodosStorageTombstone["object_type"],
        object_id: row.object_id,
        deleted_at: deletedAt,
        updated_at: stringValue(row.updated_at) ?? deletedAt,
        source_machine_id: stringValue(row.source_machine_id),
        payload: payloadRecord<Record<string, unknown>>(row.payload),
        version: numberValue(row.version),
      };
    });
  }

  async upsert<T extends { id: string; updated_at?: string; created_at?: string; version?: number }>(
    type: RemoteObjectType,
    value: T,
    context: TodosStorageContext = {},
  ): Promise<T> {
    await this.ensureSchema();
    const updatedAt = stringValue(value.updated_at) ?? stringValue(value.created_at) ?? new Date().toISOString();
    await this.options.client.query(
      `INSERT INTO ${this.tableName} (
        service, object_type, object_id, payload, updated_at,
        deleted_at, source_machine_id, version
      ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, NULL, $6, $7)
      ON CONFLICT (service, object_type, object_id) DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at,
        deleted_at = NULL,
        source_machine_id = EXCLUDED.source_machine_id,
        version = EXCLUDED.version
      WHERE ${this.tableName}.updated_at IS NULL OR ${this.tableName}.updated_at <= EXCLUDED.updated_at`,
      [
        this.service,
        type,
        value.id,
        JSON.stringify(value),
        updatedAt,
        context.requestId ?? this.sourceMachineId ?? null,
        numberValue(value.version),
      ],
    );
    return value;
  }

  async delete(type: RemoteObjectType, id: string, context: TodosStorageContext = {}): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.get<Record<string, unknown>>(type, id);
    if (!existing) return false;
    const timestamp = new Date().toISOString();
    return this.tombstone({
      object_type: type,
      object_id: id,
      deleted_at: timestamp,
      updated_at: timestamp,
      payload: existing,
      version: numberValue(existing["version"]),
    }, context);
  }

  async tombstone(
    tombstone: {
      object_type: RemoteObjectType;
      object_id: string;
      deleted_at: string;
      updated_at?: string;
      source_machine_id?: string | null;
      payload?: Record<string, unknown> | null;
      version?: number | null;
    },
    context: TodosStorageContext = {},
  ): Promise<boolean> {
    await this.ensureSchema();
    const deletedAt = stringValue(tombstone.deleted_at) ?? new Date().toISOString();
    const updatedAt = stringValue(tombstone.updated_at) ?? deletedAt;
    const existing = await this.clock(tombstone.object_type, tombstone.object_id);
    if (existing && compareClock(existing.updatedAt, updatedAt) > 0) return false;
    await this.options.client.query(
      `INSERT INTO ${this.tableName} (
        service, object_type, object_id, payload, updated_at,
        deleted_at, source_machine_id, version
      ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7, $8)
      ON CONFLICT (service, object_type, object_id) DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at,
        source_machine_id = EXCLUDED.source_machine_id,
        version = EXCLUDED.version
      WHERE ${this.tableName}.updated_at IS NULL OR ${this.tableName}.updated_at <= EXCLUDED.updated_at`,
      [
        this.service,
        tombstone.object_type,
        tombstone.object_id,
        JSON.stringify(tombstone.payload ?? { id: tombstone.object_id, deleted_at: deletedAt }),
        updatedAt,
        deletedAt,
        tombstone.source_machine_id ?? context.requestId ?? this.sourceMachineId ?? null,
        tombstone.version ?? null,
      ],
    );
    return true;
  }

  async clock(type: RemoteObjectType, id: string): Promise<RemoteRecordClock | null> {
    await this.ensureSchema();
    const result = await this.options.client.query<RemoteRecordRow>(
      `SELECT object_type, object_id, updated_at, deleted_at
       FROM ${this.tableName}
       WHERE service = $1 AND object_type = $2 AND object_id = $3
       LIMIT 1`,
      [this.service, type, id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      updatedAt: stringValue(row.updated_at) ?? new Date().toISOString(),
      deletedAt: stringValue(row.deleted_at),
    };
  }

  async getCursor(name: string): Promise<string | null> {
    await this.ensureSchema();
    const result = await this.options.client.query<{ value: string }>(
      `SELECT value FROM ${this.cursorTableName} WHERE service = $1 AND cursor_name = $2`,
      [this.service, name],
    );
    return result.rows[0]?.value ?? null;
  }

  async setCursor(name: string, value: string): Promise<void> {
    await this.ensureSchema();
    await this.options.client.query(
      `INSERT INTO ${this.cursorTableName} (service, cursor_name, value, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (service, cursor_name) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at`,
      [this.service, name, value],
    );
  }
}

async function createTask(input: CreateTaskInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<Task> {
  const timestamp = new Date().toISOString();
  const shortId = input.project_id ? await nextTaskShortId(input.project_id, store, context) : null;
  const task: Task = {
    id: randomUUID(),
    short_id: shortId,
    project_id: input.project_id ?? context?.projectId ?? null,
    parent_id: input.parent_id ?? null,
    plan_id: input.plan_id ?? null,
    task_list_id: input.task_list_id ?? context?.taskListId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "pending",
    priority: input.priority ?? "medium",
    agent_id: input.agent_id ?? null,
    assigned_to: input.assigned_to ?? null,
    session_id: input.session_id ?? context?.sessionId ?? null,
    working_dir: input.working_dir ?? null,
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    started_at: null,
    completed_at: null,
    due_at: input.due_at ?? null,
    estimated_minutes: input.estimated_minutes ?? null,
    actual_minutes: null,
    requires_approval: input.requires_approval ?? false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: input.recurrence_rule ?? null,
    recurrence_parent_id: input.recurrence_parent_id ?? null,
    spawns_template_id: input.spawns_template_id ?? null,
    confidence: input.confidence ?? null,
    reason: input.reason ?? null,
    spawned_from_session: input.spawned_from_session ?? null,
    assigned_by: input.assigned_by ?? null,
    assigned_from_project: input.assigned_from_project ?? null,
    task_type: input.task_type ?? null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: input.retry_count ?? 0,
    max_retries: input.max_retries ?? 0,
    retry_after: input.retry_after ?? null,
    sla_minutes: input.sla_minutes ?? null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    machine_id: store.machineId(context),
    synced_at: null,
    archived_at: null,
  };
  await store.upsert("tasks", task, context);
  await logTaskChange(task.id, "created", "status", null, task.status, task.assigned_by ?? task.agent_id, store, context);
  return task;
}

async function updateTask(id: string, input: UpdateTaskInput, store: PostgresJsonRecordStore): Promise<Task> {
  const existing = await requireRecord<Task>("tasks", id, store);
  if (existing.version !== input.version) {
    throw new Error(`Task ${id} version conflict: expected ${existing.version}, got ${input.version}`);
  }
  const task: Task = {
    ...existing,
    ...definedPatch(input),
    version: existing.version + 1,
    updated_at: new Date().toISOString(),
    tags: input.tags ?? existing.tags,
    metadata: input.metadata ?? existing.metadata,
    requires_approval: input.requires_approval ?? existing.requires_approval,
    task_list_id: input.task_list_id ?? existing.task_list_id,
  };
  await store.upsert("tasks", task);
  return task;
}

async function startTask(id: string, agentId: string, store: PostgresJsonRecordStore): Promise<Task> {
  const task = await requireRecord<Task>("tasks", id, store);
  return patchTask(task, {
    status: "in_progress",
    assigned_to: task.assigned_to ?? agentId,
    agent_id: task.agent_id ?? agentId,
    locked_by: agentId,
    locked_at: new Date().toISOString(),
    started_at: task.started_at ?? new Date().toISOString(),
  }, store);
}

async function completeTask(
  id: string,
  agentId: string | undefined,
  options: TodosTaskCompletionOptions | undefined,
  store: PostgresJsonRecordStore,
): Promise<Task> {
  const task = await requireRecord<Task>("tasks", id, store);
  return patchTask(task, {
    status: "completed",
    assigned_to: task.assigned_to ?? agentId ?? null,
    completed_at: options?.completed_at ?? new Date().toISOString(),
    actual_minutes: task.actual_minutes,
    confidence: options?.confidence ?? task.confidence,
  }, store);
}

async function failTask(
  id: string,
  agentId: string | undefined,
  reason: string | undefined,
  options: TodosTaskFailureOptions | undefined,
  store: PostgresJsonRecordStore,
): Promise<TodosTaskFailureResult> {
  const task = await requireRecord<Task>("tasks", id, store);
  const failed = await patchTask(task, {
    status: "failed",
    assigned_to: task.assigned_to ?? agentId ?? null,
    reason: reason ?? task.reason,
    retry_after: options?.retry_after ?? task.retry_after,
  }, store);
  if (!options?.retry) return { task: failed };
  const retryTask = await createTask({
    title: task.title,
    description: task.description ?? undefined,
    project_id: task.project_id ?? undefined,
    parent_id: task.parent_id ?? undefined,
    plan_id: task.plan_id ?? undefined,
    task_list_id: task.task_list_id ?? undefined,
    priority: task.priority,
    assigned_to: task.assigned_to ?? undefined,
    tags: task.tags,
    metadata: task.metadata,
    retry_count: task.retry_count + 1,
    max_retries: task.max_retries,
    reason: reason ?? undefined,
    task_type: task.task_type ?? undefined,
  }, store);
  return { task: failed, retryTask };
}

async function patchTask(task: Task, patch: Partial<Task>, store: PostgresJsonRecordStore): Promise<Task> {
  const updated: Task = {
    ...task,
    ...patch,
    version: task.version + 1,
    updated_at: new Date().toISOString(),
  };
  await store.upsert("tasks", updated);
  return updated;
}

async function listTasks(filter: TaskFilter, store: PostgresJsonRecordStore): Promise<Task[]> {
  let tasks = await store.list<Task>("tasks");
  tasks = tasks.filter((task) => taskMatchesFilter(task, filter));
  tasks.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.created_at.localeCompare(b.created_at));
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? tasks.length;
  return tasks.slice(offset, offset + limit);
}

async function getNextTask(filters: TodosTaskClaimFilter | undefined, store: PostgresJsonRecordStore): Promise<Task | null> {
  return (await listTasks({ ...filters, status: "pending", limit: 1 }, store))[0] ?? null;
}

async function claimNextTask(agentId: string, filters: TodosTaskClaimFilter | undefined, store: PostgresJsonRecordStore): Promise<Task | null> {
  const task = await getNextTask(filters, store);
  return task ? startTask(task.id, agentId, store) : null;
}

async function getActiveWork(filters: TodosActiveWorkFilter | undefined, store: PostgresJsonRecordStore): Promise<ActiveWorkItem[]> {
  const tasks = await listTasks({ ...filters, status: "in_progress" }, store);
  return tasks.map((task) => ({
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    priority: task.priority,
    assigned_to: task.assigned_to,
    locked_by: task.locked_by,
    locked_at: task.locked_at,
    updated_at: task.updated_at,
  }));
}

async function getChangedSince(since: string, filters: TodosActiveWorkFilter | undefined, store: PostgresJsonRecordStore): Promise<Task[]> {
  return (await listTasks(filters ?? {}, store)).filter((task) => task.updated_at > since);
}

async function createProject(input: CreateProjectInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<Project> {
  const timestamp = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: input.name,
    path: input.path,
    description: input.description ?? null,
    task_list_id: input.task_list_id ?? `todos-${slugify(input.name)}`,
    task_prefix: input.task_prefix ?? await generateProjectPrefix(input.name, store),
    task_counter: 0,
    created_at: timestamp,
    updated_at: timestamp,
    machine_id: store.machineId(context),
    synced_at: null,
  };
  return store.upsert("projects", project, context);
}

async function updateProject(
  id: string,
  input: Partial<Pick<Project, "name" | "description" | "task_list_id" | "path">>,
  store: PostgresJsonRecordStore,
): Promise<Project> {
  const project = await requireRecord<Project>("projects", id, store);
  const updated = { ...project, ...definedPatch(input), updated_at: new Date().toISOString() };
  return store.upsert("projects", updated);
}

async function createPlan(input: CreatePlanInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<Plan> {
  const timestamp = new Date().toISOString();
  return store.upsert("plans", {
    id: randomUUID(),
    project_id: input.project_id ?? context?.projectId ?? null,
    task_list_id: input.task_list_id ?? context?.taskListId ?? null,
    agent_id: input.agent_id ?? context?.agentId ?? null,
    name: input.name,
    description: input.description ?? null,
    status: input.status ?? "active",
    created_at: timestamp,
    updated_at: timestamp,
    machine_id: store.machineId(context),
    synced_at: null,
  }, context);
}

async function updatePlan(id: string, input: UpdatePlanInput, store: PostgresJsonRecordStore): Promise<Plan> {
  const plan = await requireRecord<Plan>("plans", id, store);
  return store.upsert("plans", { ...plan, ...definedPatch(input), updated_at: new Date().toISOString() });
}

async function registerAgent(
  input: RegisterAgentInput,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<Agent | { conflict: true; message: string }> {
  const existing = (await store.list<Agent>("agents")).find((agent) => agent.name === input.name && agent.status !== "archived");
  if (existing && !input.force && existing.session_id && existing.session_id !== input.session_id) {
    return { conflict: true, message: `Agent name '${input.name}' is already active` };
  }
  const timestamp = new Date().toISOString();
  const agent: Agent = {
    id: existing?.id ?? randomUUID().slice(0, 8),
    name: input.name,
    description: input.description ?? existing?.description ?? null,
    role: input.role ?? existing?.role ?? null,
    title: input.title ?? existing?.title ?? null,
    level: input.level ?? existing?.level ?? null,
    permissions: input.permissions ?? existing?.permissions ?? [],
    reports_to: input.reports_to ?? existing?.reports_to ?? null,
    org_id: input.org_id ?? existing?.org_id ?? null,
    capabilities: input.capabilities ?? existing?.capabilities ?? [],
    status: "active",
    metadata: input.metadata ?? existing?.metadata ?? {},
    created_at: existing?.created_at ?? timestamp,
    last_seen_at: timestamp,
    session_id: input.session_id ?? context?.sessionId ?? existing?.session_id ?? null,
    working_dir: input.working_dir ?? existing?.working_dir ?? null,
    active_project_id: input.project_id ?? context?.projectId ?? existing?.active_project_id ?? null,
    machine_id: existing?.machine_id ?? store.machineId(context),
    synced_at: existing?.synced_at ?? null,
  };
  return store.upsert("agents", agent, context);
}

async function updateAgent(id: string, input: TodosAgentUpdateInput, store: PostgresJsonRecordStore): Promise<Agent | null> {
  const agent = await store.get<Agent>("agents", id);
  if (!agent) return null;
  return store.upsert("agents", {
    ...agent,
    ...definedPatch(input),
    permissions: input.permissions ?? agent.permissions,
    capabilities: input.capabilities ?? agent.capabilities,
    metadata: input.metadata ?? agent.metadata,
    last_seen_at: new Date().toISOString(),
  });
}

async function createTaskList(input: CreateTaskListInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<TaskList> {
  const timestamp = new Date().toISOString();
  return store.upsert("task_lists", {
    id: randomUUID(),
    project_id: input.project_id ?? context?.projectId ?? null,
    slug: input.slug ?? slugify(input.name),
    name: input.name,
    description: input.description ?? null,
    metadata: input.metadata ?? {},
    created_at: timestamp,
    updated_at: timestamp,
    machine_id: store.machineId(context),
    synced_at: null,
  }, context);
}

async function updateTaskList(id: string, input: UpdateTaskListInput, store: PostgresJsonRecordStore): Promise<TaskList> {
  const list = await requireRecord<TaskList>("task_lists", id, store);
  return store.upsert("task_lists", {
    ...list,
    ...definedPatch(input),
    metadata: input.metadata ?? list.metadata,
    updated_at: new Date().toISOString(),
  });
}

async function createTemplate(input: CreateTemplateInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<TaskTemplate> {
  const timestamp = new Date().toISOString();
  return store.upsert("templates", {
    id: randomUUID(),
    name: input.name,
    title_pattern: input.title_pattern,
    description: input.description ?? null,
    priority: input.priority ?? "medium",
    tags: input.tags ?? [],
    variables: input.variables ?? [],
    version: 1,
    project_id: input.project_id ?? context?.projectId ?? null,
    plan_id: input.plan_id ?? null,
    metadata: input.metadata ?? {},
    created_at: timestamp,
    machine_id: store.machineId(context),
    synced_at: null,
  }, context);
}

async function updateTemplate(id: string, input: UpdateTemplateInput, store: PostgresJsonRecordStore): Promise<TaskTemplate | null> {
  const template = await store.get<TaskTemplate>("templates", id);
  if (!template) return null;
  return store.upsert("templates", {
    ...template,
    ...definedPatch(input),
    tags: input.tags ?? template.tags,
    variables: input.variables ?? template.variables,
    metadata: input.metadata ?? template.metadata,
    version: template.version + 1,
  });
}

async function logTaskChange(
  taskId: string,
  action: string,
  field: string | undefined,
  oldValue: string | null | undefined,
  newValue: string | null | undefined,
  agentId: string | null | undefined,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TaskHistory> {
  const entry: TaskHistory = {
    id: randomUUID(),
    task_id: taskId,
    action,
    field: field ?? null,
    old_value: oldValue ?? null,
    new_value: newValue ?? null,
    agent_id: agentId ?? context?.agentId ?? null,
    created_at: new Date().toISOString(),
    machine_id: store.machineId(context),
  };
  return store.upsert("audit_history", entry, context);
}

async function addComment(input: CreateCommentInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<TaskComment> {
  const comment: TaskComment = {
    id: randomUUID(),
    task_id: input.task_id,
    agent_id: input.agent_id ?? context?.agentId ?? null,
    session_id: input.session_id ?? context?.sessionId ?? null,
    content: input.content,
    type: input.type ?? "comment",
    progress_pct: input.progress_pct ?? null,
    created_at: new Date().toISOString(),
  };
  return store.upsert("comments", comment, context);
}

async function exportSnapshot(store: PostgresJsonRecordStore): Promise<TodosStorageSnapshot> {
  return {
    exportedAt: new Date().toISOString(),
    source: "postgres",
    tasks: await store.list<Task>("tasks"),
    projects: await store.list<Project>("projects"),
    projectMachinePaths: await store.list<NonNullable<TodosStorageSnapshot["projectMachinePaths"]>[number]>("project_machine_paths"),
    plans: await store.list<Plan>("plans"),
    agents: await store.list<Agent>("agents"),
    taskLists: await store.list<TaskList>("task_lists"),
    templates: await store.list<TaskTemplate>("templates"),
    auditHistory: await store.list<TaskHistory>("audit_history"),
    tombstones: await store.listTombstones(),
  };
}

async function importSnapshot(
  snapshot: TodosStorageSnapshot,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TodosStorageImportResult> {
  const result: TodosStorageImportResult = { inserted: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };
  const entries: ReadonlyArray<readonly [
    RemoteObjectType,
    { id: string; updated_at?: string; created_at?: string; version?: number },
  ]> = [
    ...snapshot.tasks.map((row) => ["tasks", row] as const),
    ...snapshot.projects.map((row) => ["projects", row] as const),
    ...(snapshot.projectMachinePaths ?? []).map((row) => ["project_machine_paths", row] as const),
    ...snapshot.plans.map((row) => ["plans", row] as const),
    ...snapshot.agents.map((row) => ["agents", row] as const),
    ...snapshot.taskLists.map((row) => ["task_lists", row] as const),
    ...snapshot.templates.map((row) => ["templates", row] as const),
    ...snapshot.auditHistory.map((row) => ["audit_history", row] as const),
  ];
  for (const [type, row] of entries) {
    try {
      const existing = await store.get(type, row.id);
      await store.upsert(type, row, context);
      if (existing) result.updated += 1;
      else result.inserted += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const tombstone of snapshot.tombstones ?? []) {
    try {
      const deleted = await store.tombstone({
        object_type: tombstone.object_type,
        object_id: tombstone.object_id,
        deleted_at: tombstone.deleted_at,
        updated_at: tombstone.updated_at,
        source_machine_id: tombstone.source_machine_id ?? null,
        payload: tombstone.payload ?? null,
        version: tombstone.version ?? null,
      }, context);
      if (deleted) result.deleted = (result.deleted ?? 0) + 1;
      else result.skipped += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

async function requireRecord<T>(type: RemoteObjectType, id: string, store: PostgresJsonRecordStore): Promise<T> {
  const record = await store.get<T>(type, id);
  if (!record) throw new Error(`${type} record not found: ${id}`);
  return record;
}

async function nextTaskShortId(projectId: string, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<string | null> {
  const project = await store.get<Project>("projects", projectId);
  if (!project?.task_prefix) return null;
  const counter = project.task_counter + 1;
  await store.upsert("projects", {
    ...project,
    task_counter: counter,
    updated_at: new Date().toISOString(),
  }, context);
  return `${project.task_prefix}-${String(counter).padStart(5, "0")}`;
}

async function generateProjectPrefix(name: string, store: PostgresJsonRecordStore): Promise<string> {
  const base = (name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0]).join("") || name.slice(0, 3) || "TOD").toUpperCase();
  const existing = new Set((await store.list<Project>("projects")).map((project) => project.task_prefix).filter(Boolean));
  let candidate = base;
  let suffix = 1;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

function taskMatchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter.ids && !filter.ids.includes(task.id)) return false;
  if (filter.project_id !== undefined && task.project_id !== filter.project_id) return false;
  if (filter.parent_id !== undefined && task.parent_id !== filter.parent_id) return false;
  if (filter.plan_id !== undefined && task.plan_id !== filter.plan_id) return false;
  if (filter.task_list_id !== undefined && task.task_list_id !== filter.task_list_id) return false;
  if (filter.status !== undefined && !matchesOne(task.status, filter.status)) return false;
  if (filter.priority !== undefined && !matchesOne(task.priority, filter.priority)) return false;
  if (filter.assigned_to !== undefined && task.assigned_to !== filter.assigned_to) return false;
  if (filter.agent_id !== undefined && task.agent_id !== filter.agent_id) return false;
  if (filter.session_id !== undefined && task.session_id !== filter.session_id) return false;
  if (filter.tags?.length && !filter.tags.every((tag) => task.tags.includes(tag))) return false;
  if (filter.has_recurrence !== undefined && Boolean(task.recurrence_rule) !== filter.has_recurrence) return false;
  if (filter.include_subtasks !== true && task.parent_id) return false;
  if (filter.task_type !== undefined && !matchesOne(task.task_type ?? "", filter.task_type)) return false;
  return true;
}

function matchesOne<T extends string>(value: T, expected: T | T[]): boolean {
  return Array.isArray(expected) ? expected.includes(value) : value === expected;
}

function priorityRank(priority: TaskPriority): number {
  return ({ critical: 0, high: 1, medium: 2, low: 3 } satisfies Record<TaskPriority, number>)[priority];
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "todos";
}

function definedPatch<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function payloadRecord<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  throw new Error("Postgres storage payload must be a JSON object");
}

function stringValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function compareClock(left: string, right: string): number {
  const leftClock = Date.parse(left);
  const rightClock = Date.parse(right);
  if (Number.isNaN(leftClock) || Number.isNaN(rightClock)) return left.localeCompare(right);
  return leftClock - rightClock;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
