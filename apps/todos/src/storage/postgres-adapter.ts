import { randomUUID } from "node:crypto";
import { LockError, ProjectNotFoundError, ResourceConflictError } from "../types/index.js";
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
import type {
  ActiveWorkItem,
  TodosActiveWorkFilter,
  TodosAgentUpdateInput,
  CreateTodosVerificationInput,
  CreateTodosCommitInput,
  CreateTodosGitRefInput,
  TodosAgentReleaseResult,
  TodosCommentListOptions,
  TodosTaskCommitRecord,
  TodosTaskGitRefRecord,
  TodosLockResult,
  TodosStorageAdapter,
  TodosStorageContext,
  TodosStorageImportResult,
  TodosStorageSnapshot,
  TodosStorageTombstone,
  TodosTaskClaimFilter,
  TodosTaskCompletionOptions,
  TodosTaskDependencies,
  TodosTaskFailureOptions,
  TodosTaskFailureResult,
  TodosTaskVerification,
  UpdateTemplateInput,
} from "./interfaces.js";
import {
  DEFAULT_TODOS_POSTGRES_CURSOR_TABLE,
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  postgresTodosSyncSchemaSql,
  type TodosPostgresQueryClient,
  type TodosPostgresSyncRecordType,
} from "./postgres-sync.js";
import { redactEvidenceText } from "../lib/redaction.js";
import { isCanonicalSlug, normalizeSlug } from "../lib/slugs.js";

type RemoteObjectType = TodosPostgresSyncRecordType | "comments" | "dependencies" | "verifications" | "commits" | "refs";

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
      list: (filter = {}) => store.listTasks(filter),
      count: (filter = {}) => store.countTasks(filter),
      update: (id, input) => updateTask(id, input, store),
      delete: (id, context) => store.delete("tasks", id, context),
      start: (id, agentId) => startTask(id, agentId, store),
      complete: (id, agentId, options) => completeTask(id, agentId, options, store),
      fail: (id, agentId, reason, options) => failTask(id, agentId, reason, options, store),
      claimNext: (agentId, filters) => claimNextTask(agentId, filters, store),
      getNext: (_agentId, filters) => getNextTask(filters, store),
      getActiveWork: (filters) => getActiveWork(filters, store),
      getChangedSince: (since, filters) => getChangedSince(since, filters, store),
      lock: (id, agentId) => lockTask(id, agentId, store),
      unlock: (id, agentId) => unlockTask(id, agentId, store),
      getByFingerprint: (fingerprint) => store.getTaskByFingerprint(fingerprint),
    },
    dependencies: {
      add: (taskId, dependsOn, context) => addDependency(taskId, dependsOn, store, context),
      remove: (taskId, dependsOn) => removeDependency(taskId, dependsOn, store),
      list: (taskId) => listDependencies(taskId, store),
      listAll: () => store.list<TaskDependency>("dependencies"),
    },
    verifications: {
      add: (input, context) => addVerification(input, store, context),
      list: (taskId) => listVerifications(taskId, store),
    },
    commits: {
      add: (input, context) => addCommit(input, store, context),
      list: (taskId) => listCommits(taskId, store),
      find: (sha) => findCommit(sha, store),
    },
    gitRefs: {
      add: (input, context) => addGitRef(input, store, context),
      list: (taskId) => listGitRefs(taskId, store),
      find: (ref) => findGitRefs(ref, store),
    },
    projects: {
      create: (input, context) => createProject(input, store, context),
      get: (id) => store.get<Project>("projects", id),
      getByPath: async (path) => (await store.list<Project>("projects")).find((project) => project.path === path) ?? null,
      list: async () => (await store.list<Project>("projects")).sort((a, b) => a.name.localeCompare(b.name)),
      update: (id, input) => updateProject(id, input, store),
      rename: (id, input, context) => store.renameProject(id, input.new_slug, input.name, context),
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
      heartbeat: (idOrName, context) => heartbeatAgent(idOrName, store, context),
      release: (idOrName, sessionId, context) => releaseAgent(idOrName, sessionId, store, context),
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
      getComments: async (taskId) => {
        const pages: TaskComment[][] = [];
        let before: TodosCommentListOptions["before"];
        while (true) {
          const page = await store.listComments(taskId, { limit: 1_000, ...(before ? { before } : {}) });
          if (page.length === 0) break;
          pages.unshift(page);
          if (page.length < 1_000) break;
          const oldest = page[0]!;
          before = { created_at: oldest.created_at, id: oldest.id };
        }
        return pages.flat()
          .map(redactComment)
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      },
      getCommentsPage: async (taskId, options) => {
        return (await store.listComments(taskId, options))
          .map(redactComment)
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      },
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

  async listComments(taskId: string, options: TodosCommentListOptions = {}): Promise<TaskComment[]> {
    await this.ensureSchema();
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_001) {
      throw new Error("Postgres comment limit must be an integer between 1 and 1001");
    }
    const params: unknown[] = [this.service, taskId];
    let cursorPredicate = "";
    if (options.before) {
      params.push(options.before.created_at, options.before.id);
      cursorPredicate = `AND (payload->>'created_at', object_id) < ($3, $4)`;
    }
    params.push(limit);
    const result = await this.options.client.query<{ payload: unknown }>(
      `/* todos:list-comments */ SELECT payload FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'comments' AND deleted_at IS NULL
         AND payload->>'task_id' = $2
         ${cursorPredicate}
       ORDER BY payload->>'created_at' DESC, object_id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => payloadRecord<TaskComment>(row.payload)).reverse();
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

  /**
   * SQL-side task filtering, sorting, pagination and counting over the jsonb
   * payload. Historically the adapter materialized the ENTIRE tasks table into JS
   * on every list/count/stats call and filtered in memory — with ~38k tasks that
   * O(n) heap load OOM crash-looped the serve task (it now runs at 4GB). Pushing
   * the TaskFilter, priority sort, LIMIT/OFFSET and COUNT down to Postgres means a
   * request only materializes the page it returns.
   *
   * KEEP IN SYNC with the in-memory mock in storage.test.ts
   * (createMemoryPostgresClient): the condition emission order below is decoded
   * positionally there.
   */
  private buildTaskFilterSql(filter: TaskFilter): { where: string; params: unknown[] } {
    const params: unknown[] = [this.service, "tasks"];
    const conds: string[] = ["service = $1", "object_type = $2", "deleted_at IS NULL"];
    const p = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    // Expand a set filter into scalar IN placeholders rather than a bound array
    // (`= ANY($n::text[])`). The production driver is Bun.SQL (sql.unsafe), which
    // does not bind a JS array to a Postgres array — it flattens it and PG throws
    // "malformed array literal". Individual scalar params are driver-agnostic.
    const inClause = (column: string, values: readonly unknown[]): string => {
      if (values.length === 0) return "1=0";
      return `${column} IN (${values.map((v) => p(v)).join(", ")})`;
    };
    if (filter.ids) conds.push(inClause("payload->>'id'", filter.ids));
    if (filter.project_id !== undefined) conds.push(`payload->>'project_id' = ${p(filter.project_id)}`);
    if (filter.parent_id !== undefined) conds.push(`payload->>'parent_id' IS NOT DISTINCT FROM ${p(filter.parent_id)}`);
    if (filter.plan_id !== undefined) conds.push(`payload->>'plan_id' = ${p(filter.plan_id)}`);
    if (filter.task_list_id !== undefined) conds.push(`payload->>'task_list_id' = ${p(filter.task_list_id)}`);
    if (filter.status !== undefined) conds.push(inClause("payload->>'status'", toFilterArray(filter.status)));
    if (filter.priority !== undefined) conds.push(inClause("payload->>'priority'", toFilterArray(filter.priority)));
    if (filter.assigned_to !== undefined) conds.push(`payload->>'assigned_to' = ${p(filter.assigned_to)}`);
    if (filter.agent_id !== undefined) conds.push(`payload->>'agent_id' = ${p(filter.agent_id)}`);
    if (filter.session_id !== undefined) conds.push(`payload->>'session_id' = ${p(filter.session_id)}`);
    if (filter.tags?.length) conds.push(`payload->'tags' @> ${p(filter.tags)}::jsonb`);
    if (filter.has_recurrence !== undefined) {
      conds.push(`(COALESCE(payload->>'recurrence_rule', '') <> '') = ${p(filter.has_recurrence)}`);
    }
    if (filter.task_type !== undefined) {
      conds.push(inClause("COALESCE(payload->>'task_type', '')", toFilterArray(filter.task_type)));
    }
    // include_subtasks defaults to false: exclude tasks that have a parent.
    if (filter.include_subtasks !== true) conds.push(`(payload->>'parent_id' IS NULL OR payload->>'parent_id' = '')`);
    return { where: conds.join(" AND "), params };
  }

  async listTasks(filter: TaskFilter): Promise<Task[]> {
    await this.ensureSchema();
    const { where, params } = this.buildTaskFilterSql(filter);
    let sql = `/* todos:list-tasks */ SELECT payload FROM ${this.tableName} WHERE ${where} ${TASK_ORDER_BY}`;
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (filter.offset) {
      params.push(filter.offset);
      sql += ` OFFSET $${params.length}`;
    }
    const result = await this.options.client.query<{ payload: unknown }>(sql, params);
    return result.rows.map((row) => payloadRecord<Task>(row.payload));
  }

  async getTaskByFingerprint(fingerprint: string): Promise<Task | null> {
    await this.ensureSchema();
    // Dedupe key lives in the task payload metadata. Exclude tombstoned rows so a
    // deleted task never masks a fresh upsert. LIMIT 1 — the fingerprint is unique
    // per the local upsert contract; the oldest live match wins deterministically.
    const sql = `/* todos:task-by-fingerprint */ SELECT payload FROM ${this.tableName}
      WHERE service = $1 AND object_type = $2 AND deleted_at IS NULL
        AND payload->'metadata'->>'fingerprint' = $3
      ORDER BY payload->>'created_at' ASC
      LIMIT 1`;
    const result = await this.options.client.query<{ payload: unknown }>(sql, [this.service, "tasks", fingerprint]);
    const row = result.rows[0];
    return row ? payloadRecord<Task>(row.payload) : null;
  }

  async countTasks(filter: TaskFilter): Promise<number> {
    await this.ensureSchema();
    const { where, params } = this.buildTaskFilterSql(filter);
    const sql = `/* todos:count-tasks */ SELECT COUNT(*)::int AS count FROM ${this.tableName} WHERE ${where}`;
    const result = await this.options.client.query<{ count: number | string }>(sql, params);
    return Number(result.rows[0]?.count ?? 0);
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
    if (type === "projects" && !isCanonicalSlug((value as { task_list_id?: unknown }).task_list_id)) {
      throw new Error("Invalid project task-list slug — imports require non-empty canonical kebab-case");
    }
    if (type === "task_lists" && !isCanonicalSlug((value as { slug?: unknown }).slug)) {
      throw new Error("Invalid task-list slug — imports require non-empty canonical kebab-case");
    }
    await this.ensureSchema();
    const updatedAt = stringValue(value.updated_at) ?? stringValue(value.created_at) ?? new Date().toISOString();
    // M8: resolve conflicts by (updated_at, version) rather than wall-clock only.
    // A row with an equal timestamp but a higher version still wins, and a
    // stale-clock write can no longer silently overwrite a newer version.
    // RETURNING lets us detect when the guard rejected the write so we can
    // surface the record that actually won instead of a phantom success.
    let result;
    try {
      result = await this.options.client.query<{ object_id: string }>(
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
      WHERE ${this.tableName}.updated_at IS NULL
         OR ${this.tableName}.updated_at < EXCLUDED.updated_at
         OR (${this.tableName}.updated_at = EXCLUDED.updated_at
             AND COALESCE(${this.tableName}.version, 0) <= COALESCE(EXCLUDED.version, 0))
      RETURNING object_id`,
      [
        this.service,
        type,
        value.id,
        // Bind the object directly (not JSON.stringify) so the driver stores a
        // real jsonb OBJECT. Passing a JSON string to a $::jsonb param makes
        // Bun.SQL double-encode it into a jsonb STRING scalar, which breaks every
        // server-side payload->>'field' filter and jsonb_set (the short-id
        // counter). See migrations/…normalize-payload.
        jsonbParam(value),
        updatedAt,
        context.requestId ?? this.sourceMachineId ?? null,
        numberValue(value.version),
      ],
      );
    } catch (error) {
      if (type === "task_lists" && isPostgresUniqueViolation(error)) {
        throw new ResourceConflictError(
          "TASK_LIST_SLUG_CONFLICT",
          `Task list with slug "${String((value as { slug?: unknown }).slug ?? "")}" already exists in this scope`,
        );
      }
      if (type === "projects" && isPostgresUniqueViolation(error)) {
        throw new ResourceConflictError(
          "PROJECT_SLUG_CONFLICT",
          `Project slug "${String((value as { task_list_id?: unknown }).task_list_id ?? "")}" already exists`,
        );
      }
      throw error;
    }
    if (result.rows.length === 0) {
      // The write was rejected as stale by the conflict guard. Return the row
      // that actually won so the caller isn't misled into thinking it persisted.
      const current = await this.get<T>(type, value.id);
      if (current) return current;
    }
    return value;
  }

  async renameProject(
    id: string,
    newSlug: string,
    name?: string,
    context: TodosStorageContext = {},
  ): Promise<{ project: Project; task_lists_updated: number }> {
    await this.ensureSchema();
    const normalizedSlug = slugifyRaw(newSlug);
    if (!normalizedSlug) throw new Error("Invalid slug — must be non-empty kebab-case");
    const timestamp = new Date().toISOString();
    try {
      const result = await this.options.client.query<{
        found: boolean;
        project_conflict: boolean;
        task_list_conflict: boolean;
        project: unknown;
        task_lists_updated: number | string;
      }>(
        `/* todos:rename-project-atomic */ WITH target AS (
          SELECT payload, payload->>'task_list_id' AS old_slug
          FROM ${this.tableName}
          WHERE service = $1 AND object_type = 'projects' AND object_id = $2 AND deleted_at IS NULL
          FOR UPDATE
        ), project_conflict AS (
          SELECT 1 FROM ${this.tableName}
          WHERE service = $1 AND object_type = 'projects' AND object_id <> $2
            AND deleted_at IS NULL AND payload->>'task_list_id' = $3 LIMIT 1
        ), task_list_conflict AS (
          SELECT 1 FROM ${this.tableName} r, target
          WHERE r.service = $1 AND r.object_type = 'task_lists' AND r.deleted_at IS NULL
            AND r.payload->>'project_id' = $2 AND r.payload->>'slug' = $3
            AND r.payload->>'slug' IS DISTINCT FROM target.old_slug LIMIT 1
        ), updated_lists AS (
          UPDATE ${this.tableName} r SET
            payload = r.payload || jsonb_build_object('slug', $3::text, 'updated_at', $5::text)
              || CASE WHEN $4::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('name', $4::text) END,
            updated_at = $5::timestamptz, version = COALESCE(r.version, 0) + 1,
            source_machine_id = COALESCE($6, r.source_machine_id)
          FROM target
          WHERE r.service = $1 AND r.object_type = 'task_lists' AND r.deleted_at IS NULL
            AND r.payload->>'project_id' = $2 AND r.payload->>'slug' = target.old_slug
            AND NOT EXISTS (SELECT 1 FROM project_conflict)
            AND NOT EXISTS (SELECT 1 FROM task_list_conflict)
            AND (target.old_slug IS DISTINCT FROM $3
              OR ($4::text IS NOT NULL AND r.payload->>'name' IS DISTINCT FROM $4))
          RETURNING 1
        ), updated_project AS (
          UPDATE ${this.tableName} r SET
            payload = r.payload || jsonb_build_object('task_list_id', $3::text, 'updated_at', $5::text)
              || CASE WHEN $4::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('name', $4::text) END,
            updated_at = $5::timestamptz, version = COALESCE(r.version, 0) + 1,
            source_machine_id = COALESCE($6, r.source_machine_id)
          FROM target
          WHERE r.service = $1 AND r.object_type = 'projects' AND r.object_id = $2 AND r.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM project_conflict)
            AND NOT EXISTS (SELECT 1 FROM task_list_conflict)
            AND (target.old_slug IS DISTINCT FROM $3
              OR ($4::text IS NOT NULL AND target.payload->>'name' IS DISTINCT FROM $4))
          RETURNING r.payload
        ) SELECT
          EXISTS (SELECT 1 FROM target) AS found,
          EXISTS (SELECT 1 FROM project_conflict) AS project_conflict,
          EXISTS (SELECT 1 FROM task_list_conflict) AS task_list_conflict,
          COALESCE((SELECT payload FROM updated_project), (SELECT payload FROM target)) AS project,
          (SELECT count(*) FROM updated_lists) AS task_lists_updated`,
        [this.service, id, normalizedSlug, name ?? null, timestamp, this.machineId(context)],
      );
      const row = result.rows[0];
      if (!row?.found) throw new ProjectNotFoundError(id);
      if (row.project_conflict) {
        throw new ResourceConflictError("PROJECT_SLUG_CONFLICT", `Slug "${normalizedSlug}" is already used by another project`);
      }
      if (row.task_list_conflict) {
        throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", `Task-list slug "${normalizedSlug}" is already used in this project`);
      }
      return {
        project: payloadRecord<Project>(row.project),
        task_lists_updated: Number(row.task_lists_updated),
      };
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        const constraintName = postgresConstraintName(error);
        let projectConflict = constraintName.includes("project_task_list_slug_uidx");
        // Some Postgres clients omit constraint metadata. Re-read after the
        // failed statement so the public error code remains deterministic.
        if (!constraintName) {
          const conflict = await this.options.client.query<{ project_conflict: boolean }>(
            `/* todos:classify-project-rename-conflict */ SELECT EXISTS (
              SELECT 1 FROM ${this.tableName}
              WHERE service = $1 AND object_type = 'projects' AND object_id <> $2
                AND deleted_at IS NULL AND payload->>'task_list_id' = $3
            ) AS project_conflict`,
            [this.service, id, normalizedSlug],
          );
          projectConflict = Boolean(conflict.rows[0]?.project_conflict);
        }
        if (projectConflict) {
          throw new ResourceConflictError("PROJECT_SLUG_CONFLICT", `Slug "${normalizedSlug}" is already used by another project`);
        }
        throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", `Task-list slug "${normalizedSlug}" is already used in this project`);
      }
      throw error;
    }
  }

  async incrementProjectTaskCounter(
    projectId: string,
    _context: TodosStorageContext = {},
  ): Promise<number | null> {
    await this.ensureSchema();
    // M8: atomic counter increment inside the jsonb payload — replaces the
    // read-modify-write in nextTaskShortId that could hand two concurrent
    // callers the same short id.
    const result = await this.options.client.query<{ counter: string | number | null }>(
      `UPDATE ${this.tableName}
         SET payload = jsonb_set(payload, '{task_counter}',
               to_jsonb(COALESCE((payload->>'task_counter')::bigint, 0) + 1)),
             updated_at = $3::timestamptz,
             version = COALESCE(version, 0) + 1
       WHERE service = $1 AND object_type = 'projects' AND object_id = $2 AND deleted_at IS NULL
       RETURNING payload->>'task_counter' AS counter`,
      [this.service, projectId, new Date().toISOString()],
    );
    const row = result.rows[0];
    if (!row || row.counter === null || row.counter === undefined) return null;
    return Number(row.counter);
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
        jsonbParam(tombstone.payload ?? { id: tombstone.object_id, deleted_at: deletedAt }),
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
  // M8: reject starting a task that is not pending/in_progress (mirror sqlite).
  if (task.status !== "pending" && task.status !== "in_progress") {
    throw new Error(`Task is ${task.status} and cannot be started by ${agentId}`);
  }
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

// Lock lease TTL — keep in lockstep with the local sqlite path (LOCK_EXPIRY_MINUTES).
const CLOUD_LOCK_EXPIRY_MINUTES = 30;

function cloudLockExpired(lockedAt: string | null | undefined): boolean {
  if (!lockedAt) return true;
  return new Date(lockedAt).getTime() + CLOUD_LOCK_EXPIRY_MINUTES * 60 * 1000 < Date.now();
}

function cloudLockExpiresAt(lockedAt: string): string {
  return new Date(new Date(lockedAt).getTime() + CLOUD_LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

/**
 * Acquire an exclusive lock on a cloud task by setting `locked_by`/`locked_at` on
 * the shared record. Mirrors the local sqlite semantics: completed/cancelled tasks
 * cannot be locked, a same-agent re-lock renews the lease, and a live lock held by
 * a DIFFERENT agent is reported (not stolen). No transactions on this adapter, so
 * this is best-effort last-writer-wins — the same guarantee `start`/`claim` give.
 */
async function lockTask(id: string, agentId: string, store: PostgresJsonRecordStore): Promise<TodosLockResult> {
  const task = await requireRecord<Task>("tasks", id, store);
  if (task.status === "completed" || task.status === "cancelled") {
    return { success: false, error: `Task is ${task.status} and cannot be locked` };
  }
  if (task.locked_by && task.locked_by !== agentId && !cloudLockExpired(task.locked_at)) {
    return { success: false, locked_by: task.locked_by, locked_at: task.locked_at ?? undefined, error: `Task is locked by ${task.locked_by}` };
  }
  const timestamp = new Date().toISOString();
  await patchTask(task, { locked_by: agentId, locked_at: timestamp }, store);
  return { success: true, locked_by: agentId, locked_at: timestamp, expires_at: cloudLockExpiresAt(timestamp) };
}

/** Release a lock on a cloud task. A non-matching agent is rejected (parity with local). */
async function unlockTask(id: string, agentId: string | undefined, store: PostgresJsonRecordStore): Promise<boolean> {
  const task = await requireRecord<Task>("tasks", id, store);
  if (agentId && task.locked_by && task.locked_by !== agentId) {
    throw new LockError(id, task.locked_by);
  }
  await patchTask(task, { locked_by: null, locked_at: null }, store);
  return true;
}

function dependencyId(taskId: string, dependsOn: string): string {
  return `${taskId}::${dependsOn}`;
}

/** Add a dependency edge (taskId depends on dependsOn). Both tasks must exist; cycles are rejected. */
async function addDependency(
  taskId: string,
  dependsOn: string,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TaskDependency> {
  if (taskId === dependsOn) throw new Error("A task cannot depend on itself");
  if (!(await store.get<Task>("tasks", taskId))) throw new Error(`Task not found: ${taskId}`);
  if (!(await store.get<Task>("tasks", dependsOn))) throw new Error(`Task not found: ${dependsOn}`);
  // Cycle guard: adding taskId->dependsOn creates a cycle if dependsOn can already
  // reach taskId through the existing edges. BFS over the current dependency set.
  const edges = await store.list<TaskDependency & { id?: string }>("dependencies");
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.task_id)) adjacency.set(edge.task_id, []);
    adjacency.get(edge.task_id)!.push(edge.depends_on);
  }
  const queue = [dependsOn];
  const seen = new Set<string>();
  while (queue.length) {
    const node = queue.shift()!;
    if (node === taskId) throw new Error(`Adding dependency ${taskId} -> ${dependsOn} would create a cycle`);
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) queue.push(next);
  }
  const timestamp = new Date().toISOString();
  const record = { id: dependencyId(taskId, dependsOn), task_id: taskId, depends_on: dependsOn, created_at: timestamp, updated_at: timestamp };
  await store.upsert("dependencies", record, context);
  return { task_id: taskId, depends_on: dependsOn };
}

/** Remove a dependency edge. Returns false when the edge did not exist. */
async function removeDependency(taskId: string, dependsOn: string, store: PostgresJsonRecordStore): Promise<boolean> {
  const existing = await store.get<unknown>("dependencies", dependencyId(taskId, dependsOn));
  if (!existing) return false;
  await store.delete("dependencies", dependencyId(taskId, dependsOn));
  return true;
}

/** List a task's outgoing (dependencies) and incoming (blocked_by) dependency edges. */
async function listDependencies(taskId: string, store: PostgresJsonRecordStore): Promise<TodosTaskDependencies> {
  const edges = await store.list<TaskDependency>("dependencies");
  return {
    dependencies: edges.filter((edge) => edge.task_id === taskId).map((edge) => ({ task_id: edge.task_id, depends_on: edge.depends_on })),
    blocked_by: edges.filter((edge) => edge.depends_on === taskId).map((edge) => ({ task_id: edge.task_id, depends_on: edge.depends_on })),
  };
}

/** Record a verification against a task. The task must exist (parity with the local FK). */
async function addVerification(
  input: CreateTodosVerificationInput,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TodosTaskVerification> {
  if (!(await store.get<Task>("tasks", input.task_id))) throw new Error(`Task not found: ${input.task_id}`);
  const timestamp = new Date().toISOString();
  const verification: TodosTaskVerification = {
    id: randomUUID(),
    task_id: input.task_id,
    command: input.command,
    status: input.status ?? "unknown",
    output_summary: input.output_summary ?? null,
    artifact_path: input.artifact_path ?? null,
    agent_id: input.agent_id ?? context?.agentId ?? null,
    run_at: timestamp,
    created_at: timestamp,
  };
  await store.upsert("verifications", { ...verification, updated_at: timestamp }, context);
  return verification;
}

/** List verifications recorded for a task, newest first. */
async function listVerifications(taskId: string, store: PostgresJsonRecordStore): Promise<TodosTaskVerification[]> {
  return (await store.list<TodosTaskVerification>("verifications"))
    .filter((verification) => verification.task_id === taskId)
    .sort((a, b) => b.run_at.localeCompare(a.run_at));
}

/**
 * Link a git commit to a task in the shared cloud dataset. The task must exist
 * (parity with the local FK). The previous CLI/MCP path wrote the row to this
 * machine's sqlite where a cloud task does not exist, tripping a FOREIGN KEY
 * constraint failure — routing to the shared store attaches it to the real task.
 */
async function addCommit(
  input: CreateTodosCommitInput,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TodosTaskCommitRecord> {
  if (!(await store.get<Task>("tasks", input.task_id))) throw new Error(`Task not found: ${input.task_id}`);
  const timestamp = new Date().toISOString();
  const commit: TodosTaskCommitRecord = {
    id: randomUUID(),
    task_id: input.task_id,
    sha: input.sha,
    message: input.message ?? null,
    author: input.author ?? null,
    files_changed: input.files_changed ?? null,
    created_at: timestamp,
  };
  await store.upsert("commits", { ...commit, updated_at: timestamp }, context);
  return commit;
}

/** List commits linked to a task, newest first. */
async function listCommits(taskId: string, store: PostgresJsonRecordStore): Promise<TodosTaskCommitRecord[]> {
  return (await store.list<TodosTaskCommitRecord>("commits"))
    .filter((commit) => commit.task_id === taskId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Find the most recent commit link for a SHA (exact or prefix match). */
async function findCommit(sha: string, store: PostgresJsonRecordStore): Promise<TodosTaskCommitRecord | null> {
  const matches = (await store.list<TodosTaskCommitRecord>("commits"))
    .filter((commit) => commit.sha === sha || commit.sha.startsWith(sha) || sha.startsWith(commit.sha))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return matches[0] ?? null;
}

/**
 * Link a git branch or pull request to a task in the shared cloud dataset. The
 * task must exist (parity with the local FK) so a ref link on a missing cloud
 * task 404s loudly instead of tripping a FOREIGN KEY constraint on local sqlite.
 */
async function addGitRef(
  input: CreateTodosGitRefInput,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TodosTaskGitRefRecord> {
  if (!(await store.get<Task>("tasks", input.task_id))) throw new Error(`Task not found: ${input.task_id}`);
  const timestamp = new Date().toISOString();
  const gitRef: TodosTaskGitRefRecord = {
    id: randomUUID(),
    task_id: input.task_id,
    ref_type: input.ref_type,
    name: input.name,
    url: input.url ?? null,
    provider: input.provider ?? null,
    metadata: input.metadata ?? {},
    created_at: timestamp,
    updated_at: timestamp,
  };
  await store.upsert("refs", gitRef, context);
  return gitRef;
}

/** List git refs linked to a task, newest first. */
async function listGitRefs(taskId: string, store: PostgresJsonRecordStore): Promise<TodosTaskGitRefRecord[]> {
  return (await store.list<TodosTaskGitRefRecord>("refs"))
    .filter((ref) => ref.task_id === taskId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Find every task linked to a branch/PR ref by name. */
async function findGitRefs(ref: string, store: PostgresJsonRecordStore): Promise<TodosTaskGitRefRecord[]> {
  return (await store.list<TodosTaskGitRefRecord>("refs"))
    .filter((r) => r.name === ref)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// SQL fragment: order by priority rank (critical→low) then created_at, matching
// the previous in-JS sort. Kept as a constant so listTasks/countTasks and the
// test mock stay in lockstep.
const TASK_ORDER_BY =
  "ORDER BY CASE payload->>'priority' WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, payload->>'created_at' ASC, payload->>'id' ASC";

function toFilterArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

// Bind a value to a $::jsonb param. The driver (Bun.SQL / node-pg) serializes a
// JS object/array to jsonb natively — pre-encoding with JSON.stringify would
// make Bun.SQL store a double-encoded jsonb STRING scalar instead.
function jsonbParam(value: unknown): unknown {
  return value;
}

async function listTasks(filter: TaskFilter, store: PostgresJsonRecordStore): Promise<Task[]> {
  return store.listTasks(filter);
}

async function getNextTask(filters: TodosTaskClaimFilter | undefined, store: PostgresJsonRecordStore): Promise<Task | null> {
  return (await listTasks({ ...filters, status: "pending", limit: 1 }, store))[0] ?? null;
}

async function claimNextTask(agentId: string, filters: TodosTaskClaimFilter | undefined, store: PostgresJsonRecordStore): Promise<Task | null> {
  // M8: if another worker wins a candidate between getNextTask and startTask,
  // move on to the next pending task instead of failing the whole claim. NOTE:
  // the Postgres adapter has no transactions (capabilities.transactions=false),
  // so this remains best-effort last-writer-wins rather than a hard atomic
  // claim. Unverified without a live Postgres.
  const MAX_ATTEMPTS = 25;
  const tried = new Set<string>();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const task = await getNextTask(filters, store);
    if (!task) return null;
    if (tried.has(task.id)) return null;
    tried.add(task.id);
    try {
      return await startTask(task.id, agentId, store);
    } catch {
      // Candidate no longer startable — try the next pending task.
    }
  }
  return null;
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
  const derivedSlug = slugifyRaw(input.name);
  const taskListId = input.task_list_id === undefined ? `todos-${derivedSlug}` : slugifyRaw(input.task_list_id);
  if (!derivedSlug || !taskListId) throw new Error("Project name and task-list slug must be non-empty");
  const project: Project = {
    id: randomUUID(),
    name: input.name,
    path: input.path,
    description: input.description ?? null,
    task_list_id: taskListId,
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
  input: UpdateProjectInput,
  store: PostgresJsonRecordStore,
): Promise<Project> {
  if ("task_list_id" in input) {
    throw new Error("task_list_id cannot be changed by updateProject; use renameProject for an atomic canonical rename");
  }
  const project = await requireRecord<Project>("projects", id, store);
  const updated = { ...project, ...definedPatch(input), updated_at: new Date().toISOString() };
  return store.upsert("projects", updated);
}

async function createPlan(input: CreatePlanInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<Plan> {
  const timestamp = new Date().toISOString();
  const projectId = input.project_id ?? context?.projectId ?? null;
  const slug = await resolvePostgresPlanSlug({
    name: input.name,
    slug: input.slug,
    projectId,
    store,
  });
  return store.upsert("plans", {
    id: randomUUID(),
    slug,
    project_id: projectId,
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
  const patch = definedPatch(input);
  if (input.slug !== undefined) {
    patch.slug = await resolvePostgresPlanSlug({
      name: plan.name,
      slug: input.slug,
      projectId: plan.project_id,
      store,
      excludeId: id,
    });
  }
  return store.upsert("plans", { ...plan, ...patch, updated_at: new Date().toISOString() });
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

/** Resolve an agent by id first, then by (active) name. */
async function resolveAgent(idOrName: string, store: PostgresJsonRecordStore): Promise<Agent | null> {
  const byId = await store.get<Agent>("agents", idOrName);
  if (byId) return byId;
  return (await store.list<Agent>("agents")).find((agent) => agent.name === idOrName) ?? null;
}

/** Refresh an agent's last_seen_at in the shared cloud roster (heartbeat). */
async function heartbeatAgent(
  idOrName: string,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<Agent | null> {
  const agent = await resolveAgent(idOrName, store);
  if (!agent) return null;
  return store.upsert("agents", { ...agent, last_seen_at: new Date().toISOString() }, context);
}

/** Clear an agent's session binding (release/logout) in the shared cloud roster. */
async function releaseAgent(
  idOrName: string,
  sessionId: string | undefined,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<TodosAgentReleaseResult | null> {
  const agent = await resolveAgent(idOrName, store);
  if (!agent) return null;
  // Session guard: if a session id is supplied, only release when it matches the
  // agent's current binding (prevents another session from releasing your agent).
  if (sessionId && agent.session_id && agent.session_id !== sessionId) {
    return { agent, released: false };
  }
  const updated = await store.upsert(
    "agents",
    { ...agent, session_id: null, last_seen_at: new Date().toISOString() },
    context,
  );
  return { agent: updated, released: true };
}

async function createTaskList(input: CreateTaskListInput, store: PostgresJsonRecordStore, context?: TodosStorageContext): Promise<TaskList> {
  const timestamp = new Date().toISOString();
  const slug = slugifyRaw(input.slug === undefined ? input.name : input.slug);
  if (!slug) throw new Error("Invalid task-list slug — must be non-empty kebab-case");
  return store.upsert("task_lists", {
    id: randomUUID(),
    project_id: input.project_id ?? context?.projectId ?? null,
    slug,
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
  const patch = definedPatch(input);
  if (input.slug !== undefined) {
    const slug = slugifyRaw(input.slug);
    if (!slug) throw new Error("Invalid task-list slug — must be non-empty kebab-case");
    const duplicate = (await store.list<TaskList>("task_lists")).find((candidate) =>
      candidate.id !== id && candidate.project_id === list.project_id && candidate.slug === slug
    );
    if (duplicate) {
      throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", `Task list with slug "${slug}" already exists in this scope`);
    }
    patch.slug = slug;
  }
  return store.upsert("task_lists", {
    ...list,
    ...patch,
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
    content: redactEvidenceText(input.content),
    type: input.type ?? "comment",
    progress_pct: input.progress_pct ?? null,
    created_at: new Date().toISOString(),
  };
  return store.upsert("comments", comment, context);
}

function redactComment(comment: TaskComment): TaskComment {
  return { ...comment, content: redactEvidenceText(comment.content) };
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
  // M8: atomic increment (no read-modify-write race) — two concurrent callers
  // now get distinct counters.
  const counter = await store.incrementProjectTaskCounter(projectId, context);
  if (counter === null) return null;
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

function slugifyRaw(value: string): string {
  return normalizeSlug(value);
}

function normalizePlanSlug(value: string): string {
  const slug = slugifyRaw(value);
  if (!slug) throw new Error("Invalid plan slug");
  return slug;
}

function planSlugBase(value: string): string {
  return slugifyRaw(value) || "plan";
}

async function resolvePostgresPlanSlug(options: {
  name: string;
  slug?: string;
  projectId: string | null;
  store: PostgresJsonRecordStore;
  excludeId?: string;
}): Promise<string> {
  const plans = await options.store.list<Plan>("plans");
  const used = new Set(plans
    .filter((plan) => plan.project_id === options.projectId && plan.id !== options.excludeId && plan.slug)
    .map((plan) => plan.slug!));

  if (options.slug !== undefined) {
    const slug = normalizePlanSlug(options.slug);
    if (used.has(slug)) throw new Error(`Plan slug already exists in this scope: ${slug}`);
    return slug;
  }

  const base = planSlugBase(options.name);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
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

function isPostgresUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

function postgresConstraintName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as { constraint?: unknown; constraint_name?: unknown };
  const constraint = candidate.constraint ?? candidate.constraint_name;
  return typeof constraint === "string" ? constraint : "";
}
