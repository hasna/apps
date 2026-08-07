import { randomUUID } from "node:crypto";
import { LockError, PlanNotFoundError, ProjectNotFoundError, ResourceConflictError, TaskNotStartableError, TaskReferenceAmbiguousError, isTerminalStatus } from "../types/index.js";
import type {
  Agent,
  CreateCommentInput,
  CreatePlanInput,
  CreateProjectInput,
  CreateTaskInput,
  CreateTaskListInput,
  CreateTemplateInput,
  Plan,
  PlanProjectLinkReceipt,
  PlanProjectLinkResult,
  PlanProjectLinkRollbackResult,
  Project,
  RegisterAgentInput,
  Task,
  TaskComment,
  TaskDependency,
  TaskFilter,
  TaskHistory,
  TaskList,
  TaskTemplate,
  TemplateTask,
  TemplateTaskInput,
  TemplateWithTasks,
  UpdatePlanInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateTaskListInput,
} from "../types/index.js";
import { normalizeAgentNameInput } from "../lib/agent-name-normalize.js";
import { canonicalAgentRef } from "../lib/creator-identity.js";
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
  TodosPlanProjectLinkApplyInput,
  TodosPlanProjectLinkRollbackInput,
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
  PLAN_PROJECT_LINK_SCHEMA_VERSION,
  PlanProjectLinkError,
  assertPlanProjectLinkReceipt,
  planProjectLinkRollbackReceiptId,
  planProjectLinkResultDigest,
} from "../lib/plan-project-link-contract.js";
import {
  DEFAULT_TODOS_POSTGRES_CURSOR_TABLE,
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  postgresTodosSyncSchemaSql,
  type TodosPostgresQueryClient,
  type TodosPostgresSyncRecordType,
} from "./postgres-sync.js";
import {
  buildIntegrityReport,
  buildPostgresIntegritySql,
  INTEGRITY_CONDITIONS,
  measuredCondition,
  unverifiedCondition,
  type IntegrityCondition,
  type IntegrityReport,
} from "../lib/integrity.js";
import { redactEvidenceText } from "../lib/redaction.js";
import {
  isCanonicalSlug,
  isValidTaskListProjectScope,
  normalizeSlug,
  validateSnapshotRoutingDestinationConflicts,
  validateSnapshotRoutingRecords,
} from "../lib/slugs.js";

type RemoteObjectType = TodosPostgresSyncRecordType | "comments" | "dependencies" | "verifications" | "commits" | "refs" | "template_tasks" | "plan_project_link_receipts" | "plan_project_link_rollback_receipts";

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
      resolveRef: (ref) => store.resolveTaskRef(ref),
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
      delete: (id, context) => store.deletePlan(id, context),
    },
    planProjectLinks: {
      apply: (input, context) => store.applyPlanProjectLink(input, context),
      rollback: (input, context) => store.rollbackPlanProjectLink(input, context),
      getReceipt: (receiptId) => store.getPlanProjectLinkReceipt(receiptId),
      getReceiptByIdempotencyKey: (key) => store.getPlanProjectLinkReceiptByIdempotencyKey(key),
    },
    agents: {
      register: (input, context) => registerAgent(input, store, context),
      get: (id) => store.get<Agent>("agents", id),
      getByName: async (name) => matchAgentByName(await store.list<Agent>("agents"), name),
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
      delete: (id, context) => deleteTemplate(id, store, context),
      getWithTasks: async (id) => {
        const template = await store.get<TaskTemplate>("templates", id);
        if (!template) return null;
        const tasks = (await store.list<TemplateTask>("template_tasks"))
          .filter((task) => task.template_id === id)
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
        return { ...template, tasks } satisfies TemplateWithTasks;
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
    integrity: {
      report: () => store.integrityReport(),
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
   * Resolve a `--assigned`/`assigned_to` filter value to every stored form it
   * could legitimately appear under, so a query by an agent's id also finds
   * rows written under that agent's registered name and vice versa.
   *
   * ROOT CAUSE this closes (todos task 8f07bc15): `add --agent <id>` and
   * `update --assign <name>` both write whatever string the caller passed,
   * unresolved, into the same `assigned_to` field — so one agent's tasks end
   * up split across its id form and its name form with no overlap. Matching
   * is additionally done via `LOWER()` on both sides, because a row can also
   * hold the registered name in the wrong case (`Silvanus` vs the canonical
   * lower-cased `silvanus` — see `normalizeAgentNameInput`), independent of
   * which alias was used.
   *
   * Resolution is against exactly ONE agents-table row: `resolveAgentForAssignedFilter`
   * finds it by exact id, then by case-insensitive name, and the alias set
   * returned is that row's `{id, name}` plus the literal input. A ref matching
   * NO registered agent returns just the literal input unchanged, so an
   * unknown/free-text `assigned_to` value keeps its current exact-match
   * behaviour — this only widens a query that already resolves to a real,
   * single agent.
   *
   * Deliberately NOT covered: two independently registered agent rows for
   * what a human considers one seat (e.g. a personal name and a seat slug
   * registered as separate rows with no linking field — confirmed live,
   * `todos agents` shows no shared `identity_id`/`reports_to`). Bridging that
   * needs an identity-model decision, not a widened query filter; filed
   * separately (todos task a37a7137).
   *
   * A ref that resolves by name to 2+ registered agents (e.g. `fabricius` +
   * `Fabricius`, task 0bf5d979) is this same "not bridged" case, so it is
   * resolved to `null` — literal-only fallback, same as no match — rather
   * than crashing (as the SQLite path did pre-fix, `IdentityAliasAmbiguousError`)
   * or silently picking one of the ambiguous rows via the freshest-wins
   * tie-break `matchAgentByName` uses for other callers. See
   * `resolveAgentForAssignedFilter` below.
   */
  private async resolveAssignedToAliases(ref: string): Promise<string[]> {
    const agent = await resolveAgentForAssignedFilter(ref, this);
    const aliases = new Set<string>([ref]);
    if (agent) {
      aliases.add(agent.id);
      aliases.add(agent.name);
    }
    return [...aliases];
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
  private async buildTaskFilterSql(filter: TaskFilter): Promise<{ where: string; params: unknown[]; queryRef?: string }> {
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
    if (filter.assigned_to !== undefined) {
      // Case-insensitive alias-set match — see resolveAssignedToAliases above.
      const aliases = [...new Set((await this.resolveAssignedToAliases(filter.assigned_to)).map((a) => a.toLowerCase()))];
      conds.push(inClause("LOWER(payload->>'assigned_to')", aliases));
    }
    if (filter.agent_id !== undefined) conds.push(`payload->>'agent_id' = ${p(filter.agent_id)}`);
    // Case-insensitive for the same reason as the SQLite path: write-time
    // canonicalisation does not reach rows written before it, nor a hand-typed filter.
    if (filter.created_by !== undefined) conds.push(`LOWER(payload->>'created_by') = LOWER(${p(filter.created_by)})`);
    // NULL created_by means unattributable, not "someone else" — keep those rows.
    if (filter.not_created_by !== undefined) conds.push(`(payload->>'created_by' IS NULL OR LOWER(payload->>'created_by') <> LOWER(${p(filter.not_created_by)}))`);
    if (filter.session_id !== undefined) conds.push(`payload->>'session_id' = ${p(filter.session_id)}`);
    if (filter.tags?.length) {
      // ANY-of tag matching, parity with the SQLite path (src/db/task-crud.ts:
      // `id IN (SELECT task_id FROM task_tags WHERE tag IN (...))`). Scalar
      // params only — the previous `@> $n::jsonb` bound a JS array, which
      // Bun.SQL flattens into a malformed literal (see inClause note above).
      conds.push(
        `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(payload->'tags', '[]'::jsonb)) AS task_tags(tag) ` +
          `WHERE ${inClause("task_tags.tag", filter.tags)})`,
      );
    }
    if (filter.has_recurrence !== undefined) {
      conds.push(`(COALESCE(payload->>'recurrence_rule', '') <> '') = ${p(filter.has_recurrence)}`);
    }
    if (filter.task_type !== undefined) {
      conds.push(inClause("COALESCE(payload->>'task_type', '')", toFilterArray(filter.task_type)));
    }
    // include_subtasks defaults to false: exclude tasks that have a parent.
    if (filter.include_subtasks !== true) conds.push(`(payload->>'parent_id' IS NULL OR payload->>'parent_id' = '')`);
    // Full-text search parity with the SQLite FTS5 path (src/lib/search.ts).
    // "*" is the "match everything" sentinel — treat as filter-only (no predicate).
    let queryRef: string | undefined;
    const rawQuery = filter.query?.trim() ?? "";
    if (rawQuery && rawQuery !== "*") {
      queryRef = p(rawQuery);
      // Weighted full-text match, diacritics folded via the immutable unaccent
      // wrapper installed by migrations/0006 (mirrored in postgresTodosSyncSchemaSql).
      // websearch_to_tsquery gives AND-by-default, quoted phrases, and tolerates
      // punctuation instead of rejecting it.
      const clauses = [`task_search_tsv @@ websearch_to_tsquery('simple', todos_immutable_unaccent(${queryRef}))`];
      // A pg_trgm word-similarity fuzzy fallback catches single-word typos
      // ("authentcation" -> "authentication"). Only for single-term queries: on a
      // multi-term query it would defeat the AND semantics by matching any one word.
      if (!/\s/.test(rawQuery)) {
        clauses.push(
          `todos_immutable_unaccent(${queryRef}) <% todos_immutable_unaccent(` +
          `COALESCE(payload->>'title', '') || ' ' || COALESCE(payload->>'description', ''))`,
        );
      }
      conds.push(`(${clauses.join(" OR ")})`);
    }
    return { where: conds.join(" AND "), params, queryRef };
  }

  async listTasks(filter: TaskFilter): Promise<Task[]> {
    await this.ensureSchema();
    const { where, params, queryRef } = await this.buildTaskFilterSql(filter);
    // With a search query, rank by full-text relevance first (parity with the
    // SQLite bm25() ordering), then fall back to the standard priority/recency
    // tiebreak. Trigram-only fuzzy hits rank 0 and sort after exact matches.
    const orderBy = queryRef
      ? `ORDER BY ts_rank_cd(task_search_tsv, websearch_to_tsquery('simple', todos_immutable_unaccent(${queryRef}))) DESC, ${TASK_ORDER_TIEBREAK}`
      : TASK_ORDER_BY;
    let sql = `/* todos:list-tasks */ SELECT payload FROM ${this.tableName} WHERE ${where} ${orderBy}`;
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

  /**
   * Resolve a non-UUID task reference (exact `short_id`, or a unique `object_id`
   * prefix) to the single matching task, or null. Throws when a prefix is
   * ambiguous. Both branches are BOUNDED single queries (`LIMIT 2`): the prefix
   * branch is a byte-order (COLLATE "C") range served by the optional
   * `_task_object_id_c_idx`; the short_id branch is a case-insensitive lookup
   * served by the optional `_task_short_id_idx`. This replaces the CLI's previous
   * O(all-tasks) client-side download that paged every task over HTTP just to
   * expand a short reference.
   */
  async resolveTaskRef(ref: string): Promise<Task | null> {
    await this.ensureSchema();
    // Case-insensitive, matching the CLI's historical resolution: task ids/object_ids
    // are stored lower-case, short_ids upper-case. Normalizing to lower-case lets a
    // lower-cased id prefix and an upper-cased short_id both resolve.
    const raw = ref.trim().toLowerCase();
    if (!raw) return null;

    // id-prefix: a half-open range so it can ride a btree index with bound params
    // (unlike LIKE 'x%', which needs a literal). The upper bound is the prefix with
    // its final code unit incremented, so the comparison MUST use byte order
    // (COLLATE "C") to agree with that arithmetic — under a locale collation (e.g.
    // RDS-default en_US.utf8) ':' sorts before '9', which would drop every ref
    // ending in '9'. object_id is stored lower-case, so a lower-cased short_id
    // (non-hex leading char) never falls in a UUID range and correctly drops
    // through to the short_id lookup below. The optional `_task_object_id_c_idx`
    // (COLLATE "C") keeps this bounded at scale.
    //
    // Guard a pathological final code unit (U+FFFF): incrementing it wraps to
    // U+0000, so the upper bound would collapse below the prefix and yield an empty
    // range. Such a ref cannot be a lower-case task-id prefix anyway, so skip the
    // range and let it resolve (or not) through the short_id lookup.
    const lastCode = raw.charCodeAt(raw.length - 1);
    if (lastCode < 0xffff) {
      const upper = raw.slice(0, -1) + String.fromCharCode(lastCode + 1);
      const prefixResult = await this.options.client.query<{ payload: unknown }>(
        `/* todos:resolve-task-ref-prefix */ SELECT payload FROM ${this.tableName}
          WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
            AND object_id COLLATE "C" >= $2 AND object_id COLLATE "C" < $3
          LIMIT 2`,
        [this.service, raw, upper],
      );
      if (prefixResult.rows.length > 1) {
        const candidates = prefixResult.rows.map((row) => payloadRecord<Task>(row.payload));
        throw new TaskReferenceAmbiguousError(
          ref,
          candidates.map((task) => ({ task_id: task.id, project_id: task.project_id })),
        );
      }
      if (prefixResult.rows.length === 1) {
        return payloadRecord<Task>(prefixResult.rows[0]!.payload);
      }
    }

    const shortIdResult = await this.options.client.query<{ payload: unknown }>(
      `/* todos:resolve-task-ref-short-id */ SELECT payload FROM ${this.tableName}
        WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
          AND LOWER(payload->>'short_id') = $2
        LIMIT 2`,
      [this.service, raw],
    );
    if (shortIdResult.rows.length > 1) {
      const candidates = shortIdResult.rows.map((row) => payloadRecord<Task>(row.payload));
      throw new TaskReferenceAmbiguousError(
        ref,
        candidates.map((task) => ({ task_id: task.id, project_id: task.project_id })),
      );
    }
    if (shortIdResult.rows.length === 1) {
      return payloadRecord<Task>(shortIdResult.rows[0]!.payload);
    }

    return null;
  }

  async countTasks(filter: TaskFilter): Promise<number> {
    await this.ensureSchema();
    const { where, params } = await this.buildTaskFilterSql(filter);
    const sql = `/* todos:count-tasks */ SELECT COUNT(*)::int AS count FROM ${this.tableName} WHERE ${where}`;
    const result = await this.options.client.query<{ count: number | string }>(sql, params);
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Referential-integrity counts, one aggregate query per condition, rendered from
   * the SHARED condition list so a self-hosted Postgres deployment measures exactly
   * what a local SQLite database measures. This backend has NO foreign keys (every
   * entity is a jsonb payload in one record table), so the orphan classes SQLite
   * forbids structurally are the ones that actually accumulate here.
   *
   * Read-only by construction: COUNT queries only.
   */
  async integrityReport(): Promise<IntegrityReport> {
    await this.ensureSchema();
    const conditions: IntegrityCondition[] = [];
    for (const spec of INTEGRITY_CONDITIONS) {
      const { sql, params } = buildPostgresIntegritySql(spec, { table: this.tableName, service: this.service });
      try {
        const result = await this.options.client.query<{ count: number | string | null; open_count: number | string | null }>(sql, params);
        const row = result.rows[0];
        conditions.push(measuredCondition(
          spec,
          {
            count: Number(row?.count ?? 0),
            open_count: spec.entity === "task" ? Number(row?.open_count ?? 0) : null,
          },
          "postgres",
        ));
      } catch (error) {
        // A condition that could not be counted is UNVERIFIED, never clean.
        conditions.push(unverifiedCondition(spec, error instanceof Error ? error.message : String(error)));
      }
    }
    return buildIntegrityReport(conditions, new Date().toISOString());
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
    if (type === "task_lists") {
      if (!isCanonicalSlug((value as { slug?: unknown }).slug)) {
        throw new Error("Invalid task-list slug — imports require non-empty canonical kebab-case");
      }
      if (!isValidTaskListProjectScope((value as { project_id?: unknown }).project_id)) {
        throw new Error("Invalid task-list project scope — project_id must be null, missing, or a non-empty string");
      }
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

  /**
   * Serialize task membership changes with guarded plan/project linkage.
   * Both this write and the link transaction lock the same plan row before
   * reading or changing membership, so an apply snapshot cannot miss a task
   * inserted into or moved out of the plan at the CAS point.
   */
  async upsertTaskWithPlanMembershipGuard(
    value: Task,
    guardedPlanIds: string[],
    explicitProject: boolean,
    context: TodosStorageContext = {},
  ): Promise<Task> {
    const planIds = [...new Set(guardedPlanIds.filter(Boolean))].sort();
    if (planIds.length === 0) return this.upsert("tasks", value, context);
    await this.ensureSchema();
    const updatedAt = value.updated_at;
    const targetPlanId = value.plan_id;
    const result = await this.options.client.query<{
      all_plans_found: boolean;
      target_plan_found: boolean;
      project_conflict: boolean;
      payload: unknown | null;
    }>(
      `/* todos:task-plan-membership-guard */ WITH
       locked_plans AS MATERIALIZED (
         SELECT object_id, payload FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'plans' AND deleted_at IS NULL
           AND object_id IN (SELECT value FROM jsonb_array_elements_text($7::jsonb))
         ORDER BY object_id
         FOR UPDATE
       ), validation AS (
         SELECT
           (SELECT count(*) FROM locked_plans) = jsonb_array_length($7::jsonb) AS all_plans_found,
           ($8::text IS NULL OR EXISTS (SELECT 1 FROM locked_plans WHERE object_id = $8)) AS target_plan_found,
           (SELECT payload->>'project_id' FROM locked_plans WHERE object_id = $8) AS target_project_id
       ), guarded AS (
         SELECT
           validation.*,
           ($9::boolean AND validation.target_project_id IS NOT NULL
             AND ($3::jsonb->>'project_id') IS DISTINCT FROM validation.target_project_id) AS project_conflict,
           CASE
             WHEN validation.target_project_id IS NULL THEN $3::jsonb
             ELSE jsonb_set($3::jsonb, '{project_id}', to_jsonb(validation.target_project_id), true)
           END AS payload
         FROM validation
       ), stored AS (
         INSERT INTO ${this.tableName} (
           service, object_type, object_id, payload, updated_at,
           deleted_at, source_machine_id, version
         )
         SELECT $1, 'tasks', $2, guarded.payload, $4::timestamptz, NULL, $5, $6
         FROM guarded
         WHERE guarded.all_plans_found AND guarded.target_plan_found AND NOT guarded.project_conflict
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
         RETURNING payload
       )
       SELECT guarded.all_plans_found, guarded.target_plan_found, guarded.project_conflict,
              (SELECT payload FROM stored) AS payload
       FROM guarded`,
      [
        this.service,
        value.id,
        jsonbParam(value),
        updatedAt,
        context.requestId ?? this.sourceMachineId ?? null,
        numberValue(value.version),
        jsonbParam(planIds),
        targetPlanId,
        explicitProject,
      ],
    );
    const row = result.rows[0];
    if (!row?.all_plans_found || !row.target_plan_found) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PLAN_NOT_FOUND",
        `Plan membership changed through a missing plan: ${targetPlanId ?? planIds.join(", ")}`,
        { plan_ids: planIds, target_plan_id: targetPlanId },
      );
    }
    if (row.project_conflict) {
      throw new ResourceConflictError(
        "PLAN_PROJECT_LINK_CONFLICT",
        `Task project conflicts with linked plan ${targetPlanId}`,
      );
    }
    if (!row.payload) {
      return await requireRecord<Task>("tasks", value.id, this);
    }
    return payloadRecord<Task>(row.payload);
  }

  /** Serialize ordinary plan updates with linkage and preserve its project. */
  async updatePlanWithProjectLinkGuard(
    value: Plan,
    context: TodosStorageContext = {},
  ): Promise<Plan> {
    await this.ensureSchema();
    const result = await this.options.client.query<{ plan_found: boolean; payload: unknown | null }>(
      `/* todos:plan-update-project-link-guard */ WITH locked_plan AS MATERIALIZED (
         SELECT payload FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'plans' AND object_id = $2 AND deleted_at IS NULL
         FOR UPDATE
       ), stored AS (
         UPDATE ${this.tableName} r SET
           payload = jsonb_set(
             $3::jsonb,
             '{project_id}',
             COALESCE((SELECT payload->'project_id' FROM locked_plan), 'null'::jsonb),
             true
           ),
           updated_at = $4::timestamptz,
           deleted_at = NULL,
           source_machine_id = COALESCE($5, r.source_machine_id),
           version = COALESCE(r.version, 0) + 1
         FROM locked_plan
         WHERE r.service = $1 AND r.object_type = 'plans' AND r.object_id = $2 AND r.deleted_at IS NULL
         RETURNING r.payload
       )
       SELECT EXISTS (SELECT 1 FROM locked_plan) AS plan_found,
              (SELECT payload FROM stored) AS payload`,
      [
        this.service,
        value.id,
        jsonbParam(value),
        value.updated_at,
        context.requestId ?? this.sourceMachineId ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row?.plan_found || !row.payload) throw new PlanNotFoundError(value.id);
    return payloadRecord<Plan>(row.payload);
  }

  /**
   * Create a template and all of its ordered checklist steps in one SQL statement.
   * This is deliberately not composed from `upsert` calls: a server crash or a
   * rejected child write must never expose a half-created reusable checklist.
   */
  async createTemplateWithTasks(
    template: TaskTemplate,
    tasks: TemplateTask[],
    context: TodosStorageContext = {},
  ): Promise<void> {
    await this.ensureSchema();
    const records = [
      { object_type: "templates", object_id: template.id, payload: template, updated_at: template.created_at, version: template.version },
      ...tasks.map((task) => ({ object_type: "template_tasks", object_id: task.id, payload: task, updated_at: task.created_at, version: 1 })),
    ];
    const result = await this.options.client.query<{ object_type: string; object_id: string }>(
      `/* todos:create-template-with-tasks-atomic */ WITH input AS (
         SELECT value->>'object_type' AS object_type,
           value->>'object_id' AS object_id,
           value->'payload' AS payload,
           value->>'updated_at' AS updated_at,
           COALESCE((value->>'version')::integer, 1) AS version
         FROM jsonb_array_elements($2::jsonb) AS value
       ) INSERT INTO ${this.tableName} (
         service, object_type, object_id, payload, updated_at,
         deleted_at, source_machine_id, version
       ) SELECT $1, object_type, object_id, payload, updated_at::timestamptz,
         NULL, $3, version
       FROM input
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
       RETURNING object_type, object_id`,
      [this.service, jsonbParam(records), this.machineId(context)],
    );
    if (result.rows.length !== records.length) {
      throw new Error("Template checklist write was rejected before completion; no partial template was committed");
    }
  }

  /** Tombstone a template and every checklist step in one atomic statement. */
  async deleteTemplateWithTasks(id: string, context: TodosStorageContext = {}): Promise<boolean> {
    await this.ensureSchema();
    const timestamp = new Date().toISOString();
    const result = await this.options.client.query<{ object_type: string }>(
      `/* todos:delete-template-with-tasks-atomic */ WITH target AS (
         SELECT 1 FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'templates' AND object_id = $2 AND deleted_at IS NULL
       ) UPDATE ${this.tableName} AS record SET
         deleted_at = $3::timestamptz,
         updated_at = $3::timestamptz,
         source_machine_id = COALESCE($4, record.source_machine_id),
         version = COALESCE(record.version, 0) + 1
       WHERE record.service = $1 AND record.deleted_at IS NULL AND EXISTS (SELECT 1 FROM target)
         AND (record.object_type = 'templates' AND record.object_id = $2
           OR record.object_type = 'template_tasks' AND record.payload->>'template_id' = $2)
       RETURNING record.object_type`,
      [this.service, id, timestamp, this.machineId(context)],
    );
    return result.rows.some((row) => row.object_type === "templates");
  }

  async completeTask(
    id: string,
    agentId: string | undefined,
    options: TodosTaskCompletionOptions | undefined,
  ): Promise<Task | null> {
    await this.ensureSchema();
    const operationTimestamp = new Date().toISOString();
    const completedAt = options?.completed_at ?? operationTimestamp;
    const evidence = options ? {
      ...(options.files_changed !== undefined ? { files_changed: options.files_changed } : {}),
      ...(options.test_results !== undefined ? { test_results: options.test_results } : {}),
      ...(options.commit_hash !== undefined ? { commit_hash: options.commit_hash } : {}),
      ...(options.notes !== undefined ? { notes: options.notes } : {}),
      ...(options.attachment_ids !== undefined ? { attachment_ids: options.attachment_ids } : {}),
    } : {};
    const hasEvidence = Object.keys(evidence).length > 0;
    const hasConfidence = options?.confidence !== undefined;
    const lockExpiryCutoff = new Date(
      new Date(operationTimestamp).getTime() - CLOUD_LOCK_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();
    const result = await this.options.client.query<{ payload: unknown }>(
      `/* todos:complete-task-atomic todos:complete-task-lock-guard todos:complete-task-clears-lock */
       UPDATE ${this.tableName}
       SET payload = payload || jsonb_build_object(
         'status', 'completed',
         'locked_by', 'null'::jsonb,
         'locked_at', 'null'::jsonb,
         'assigned_to', CASE
           WHEN jsonb_typeof(payload->'assigned_to') = 'string' THEN payload->'assigned_to'
           ELSE COALESCE(to_jsonb($3::text), 'null'::jsonb)
         END,
         'completed_at', $4::text,
         'updated_at', $9::text,
         'version', COALESCE((payload->>'version')::integer, 0) + 1,
         'metadata',
           (CASE WHEN jsonb_typeof(payload->'metadata') = 'object'
             THEN payload->'metadata' ELSE '{}'::jsonb END)
           || CASE WHEN $5::boolean THEN jsonb_build_object(
             '_evidence',
             (CASE WHEN jsonb_typeof(payload->'metadata'->'_evidence') = 'object'
               THEN payload->'metadata'->'_evidence' ELSE '{}'::jsonb END) || $6::jsonb
           ) ELSE '{}'::jsonb END
           || CASE WHEN $7::boolean THEN jsonb_build_object(
             '_completion',
             (CASE WHEN jsonb_typeof(payload->'metadata'->'_completion') = 'object'
               THEN payload->'metadata'->'_completion' ELSE '{}'::jsonb END)
               || jsonb_build_object('confidence', $8::double precision)
           ) ELSE '{}'::jsonb END
       ) || CASE WHEN $7::boolean
         THEN jsonb_build_object('confidence', $8::double precision)
         ELSE '{}'::jsonb END,
       updated_at = $9::timestamptz,
       version = COALESCE(version, 0) + 1
       WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL
         AND (
           payload->>'locked_by' IS NULL
           OR BTRIM(payload->>'locked_by') = ''
           OR payload->>'locked_at' IS NULL
           OR payload->>'locked_at' < $10::text
           OR (
             $3::text IS NOT NULL
             AND LOWER(BTRIM(payload->>'locked_by')) = LOWER(BTRIM($3::text))
           )
         )
       RETURNING payload`,
      [
        this.service,
        id,
        agentId ?? null,
        completedAt,
        hasEvidence,
        jsonbParam(evidence),
        hasConfidence,
        options?.confidence ?? null,
        operationTimestamp,
        lockExpiryCutoff,
      ],
    );
    return result.rows[0] ? payloadRecord<Task>(result.rows[0].payload) : null;
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

  async getPlanProjectLinkReceipt(receiptId: string): Promise<PlanProjectLinkReceipt | null> {
    const value = await this.get<unknown>("plan_project_link_receipts", receiptId);
    return value ? assertPlanProjectLinkReceipt(value) : null;
  }

  async getPlanProjectLinkReceiptByIdempotencyKey(idempotencyKey: string): Promise<PlanProjectLinkReceipt | null> {
    await this.ensureSchema();
    const result = await this.options.client.query<{ payload: unknown }>(
      `/* todos:plan-project-link-receipt-by-key */ SELECT payload FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'plan_project_link_receipts' AND deleted_at IS NULL
         AND payload->>'idempotency_key' = $2
       LIMIT 2`,
      [this.service, idempotencyKey],
    );
    if (result.rows.length > 1) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT",
        "More than one immutable receipt carries this idempotency key",
        { idempotency_key: idempotencyKey },
      );
    }
    return result.rows[0] ? assertPlanProjectLinkReceipt(result.rows[0].payload) : null;
  }

  private async currentPlanProjectLinkResult(
    receipt: PlanProjectLinkReceipt,
    action: "linked" | "already_linked",
  ): Promise<PlanProjectLinkResult> {
    const [plan, project, tasks] = await Promise.all([
      this.get<Plan>("plans", receipt.plan_id),
      this.get<Project>("projects", receipt.project_id),
      this.listTasks({ plan_id: receipt.plan_id, include_subtasks: true }),
    ]);
    const sortedTasks = tasks.sort((left, right) => left.id.localeCompare(right.id));
    if (!plan || !project || planProjectLinkResultDigest(plan, sortedTasks) !== receipt.result_digest) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_RESULT_DRIFT",
        "The accepted plan-project-link result has drifted",
        { receipt_id: receipt.receipt_id },
      );
    }
    return { mode: "apply", action, plan, project, tasks: sortedTasks, receipt };
  }

  async applyPlanProjectLink(
    input: TodosPlanProjectLinkApplyInput,
    context: TodosStorageContext = {},
  ): Promise<PlanProjectLinkResult> {
    await this.ensureSchema();
    const existing = await this.getPlanProjectLinkReceipt(input.receipt_id);
    if (existing) {
      if (existing.plan_id !== input.plan_id || existing.project_id !== input.project_id) {
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already accepted for a different plan-project link",
          { idempotency_key: input.idempotency_key, receipt_id: existing.receipt_id },
        );
      }
      const rolledBack = await this.get<unknown>(
        "plan_project_link_rollback_receipts",
        planProjectLinkRollbackReceiptId(input.receipt_id),
      );
      if (rolledBack) {
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT",
          "The accepted plan-project link has already been rolled back",
          { receipt_id: input.receipt_id },
        );
      }
      return this.currentPlanProjectLinkResult(existing, "already_linked");
    }

    const [plan, project, tasks, scopedPlans] = await Promise.all([
      this.get<Plan>("plans", input.plan_id),
      this.get<Project>("projects", input.project_id),
      this.listTasks({ plan_id: input.plan_id, include_subtasks: true }),
      this.list<Plan>("plans"),
    ]);
    if (!plan) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PLAN_NOT_FOUND", `Plan not found: ${input.plan_id}`);
    if (!project) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PROJECT_NOT_FOUND", `Project not found: ${input.project_id}`);
    if (plan.updated_at !== input.expected_plan_revision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT",
        "Plan changed after the link plan; fetch a fresh plan before applying",
        { expected_plan_revision: input.expected_plan_revision, current_plan_revision: plan.updated_at },
      );
    }
    if (project.updated_at !== input.expected_project_revision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PROJECT_REVISION_CONFLICT",
        "Destination project changed after the link plan; fetch a fresh plan before applying",
        { expected_project_revision: input.expected_project_revision, current_project_revision: project.updated_at },
      );
    }
    const collision = scopedPlans.find((candidate) =>
      candidate.id !== plan.id && candidate.project_id === project.id && candidate.slug !== null && candidate.slug === plan.slug
    );
    if (collision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_SCOPE_COLLISION",
        "Another plan already owns this slug in the destination project",
        { conflicting_plan_id: collision.id, slug: plan.slug },
      );
    }
    const sortedTasks = tasks.sort((left, right) => left.id.localeCompare(right.id));
    const priorTaskProjectIds = Object.fromEntries(sortedTasks.map((task) => [task.id, task.project_id])) as Record<string, string | null>;
    const projectedPlan = { ...plan, project_id: project.id, updated_at: input.created_at };
    const projectedTasks = sortedTasks.map((task) => task.project_id === project.id
      ? task
      : { ...task, project_id: project.id, updated_at: input.created_at, version: task.version + 1 });
    const alreadyLinked = plan.project_id === project.id && sortedTasks.every((task) => task.project_id === project.id);
    const receipt: PlanProjectLinkReceipt = {
      schema_version: PLAN_PROJECT_LINK_SCHEMA_VERSION,
      receipt_id: input.receipt_id,
      idempotency_key: input.idempotency_key,
      plan_id: plan.id,
      project_id: project.id,
      prior_plan_project_id: plan.project_id,
      prior_task_project_ids: priorTaskProjectIds,
      task_ids: sortedTasks.map((task) => task.id),
      task_count: sortedTasks.length,
      result_plan_revision: projectedPlan.updated_at,
      result_digest: planProjectLinkResultDigest(projectedPlan, projectedTasks),
      rollback_supported: true,
      created_at: input.created_at,
    };
    let mutation;
    try {
      mutation = await this.options.client.query<{
        plan_found: boolean;
        project_found: boolean;
        plan_revision_ok: boolean;
        project_revision_ok: boolean;
        membership_ok: boolean;
        collision: boolean;
        existing_receipt: unknown | null;
        inserted_receipt: unknown | null;
      }>(
        `/* todos:plan-project-link-atomic */ WITH
         target_plan AS MATERIALIZED (
           SELECT payload FROM ${this.tableName}
           WHERE service = $1 AND object_type = 'plans' AND object_id = $2 AND deleted_at IS NULL
           FOR UPDATE
         ), target_project AS (
           SELECT payload FROM ${this.tableName}
           WHERE service = $1 AND object_type = 'projects' AND object_id = $3 AND deleted_at IS NULL
           FOR UPDATE
         ), member_tasks AS MATERIALIZED (
           SELECT object_id, payload FROM ${this.tableName}
           WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
             AND payload->>'plan_id' = $2
             AND EXISTS (SELECT 1 FROM target_plan)
           FOR UPDATE
         ), existing AS (
           SELECT payload FROM ${this.tableName}
           WHERE service = $1 AND object_type = 'plan_project_link_receipts'
             AND object_id = $6 AND deleted_at IS NULL
           FOR UPDATE
         ), collision AS (
           SELECT 1 FROM ${this.tableName} r, target_plan p
           WHERE r.service = $1 AND r.object_type = 'plans' AND r.deleted_at IS NULL
             AND r.object_id <> $2 AND r.payload->>'project_id' = $3
             AND r.payload->>'slug' IS NOT DISTINCT FROM p.payload->>'slug'
             AND p.payload->>'slug' IS NOT NULL
           LIMIT 1
         ), checks AS (
           SELECT
             EXISTS (SELECT 1 FROM target_plan) AS plan_found,
             EXISTS (SELECT 1 FROM target_project) AS project_found,
             COALESCE((SELECT payload->>'updated_at' = $4 FROM target_plan), false) AS plan_revision_ok,
             COALESCE((SELECT payload->>'updated_at' = $5 FROM target_project), false) AS project_revision_ok,
             COALESCE((SELECT jsonb_object_agg(object_id, COALESCE(payload->'project_id', 'null'::jsonb) ORDER BY object_id) FROM member_tasks), '{}'::jsonb) = $8::jsonb
               AND COALESCE((SELECT jsonb_agg(object_id ORDER BY object_id) FROM member_tasks), '[]'::jsonb) = $9::jsonb AS membership_ok,
             EXISTS (SELECT 1 FROM collision) AS collision,
             EXISTS (SELECT 1 FROM existing) AS has_existing
         ), updated_plan AS (
           UPDATE ${this.tableName} r SET
             payload = r.payload || jsonb_build_object('project_id', $3::text, 'updated_at', $10::text),
             updated_at = $10::timestamptz,
             version = COALESCE(r.version, 0) + 1,
             source_machine_id = COALESCE($11, r.source_machine_id)
           FROM checks
           WHERE r.service = $1 AND r.object_type = 'plans' AND r.object_id = $2 AND r.deleted_at IS NULL
             AND checks.plan_found AND checks.project_found AND checks.plan_revision_ok
             AND checks.project_revision_ok AND checks.membership_ok AND NOT checks.collision AND NOT checks.has_existing
           RETURNING r.payload
         ), updated_tasks AS (
           UPDATE ${this.tableName} r SET
             payload = r.payload || jsonb_build_object(
               'project_id', $3::text,
               'updated_at', $10::text,
               'version', COALESCE((r.payload->>'version')::int, 0) + 1
             ),
             updated_at = $10::timestamptz,
             version = COALESCE(r.version, 0) + 1,
             source_machine_id = COALESCE($11, r.source_machine_id)
           WHERE r.service = $1 AND r.object_type = 'tasks' AND r.deleted_at IS NULL
             AND r.payload->>'plan_id' = $2
             AND r.payload->>'project_id' IS DISTINCT FROM $3
             AND EXISTS (SELECT 1 FROM updated_plan)
           RETURNING 1
         ), task_gate AS (
           SELECT count(*) AS count FROM updated_tasks
         ), inserted AS (
           INSERT INTO ${this.tableName}
             (service, object_type, object_id, payload, updated_at, deleted_at, source_machine_id, version)
           SELECT $1, 'plan_project_link_receipts', $6, $7::jsonb, $10::timestamptz, NULL, $11, 1
           FROM checks, task_gate
           WHERE NOT checks.has_existing AND EXISTS (SELECT 1 FROM updated_plan)
           RETURNING payload
         ) SELECT
           checks.plan_found,
           checks.project_found,
           checks.plan_revision_ok,
           checks.project_revision_ok,
           checks.membership_ok,
           checks.collision,
           (SELECT payload FROM existing) AS existing_receipt,
           (SELECT payload FROM inserted) AS inserted_receipt
         FROM checks`,
        [
          this.service,
          plan.id,
          project.id,
          input.expected_plan_revision,
          input.expected_project_revision,
          receipt.receipt_id,
          jsonbParam(receipt),
          jsonbParam(priorTaskProjectIds),
          jsonbParam(receipt.task_ids),
          input.created_at,
          this.machineId(context),
        ],
      );
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        const raced = await this.getPlanProjectLinkReceipt(input.receipt_id);
        if (raced && raced.plan_id === input.plan_id && raced.project_id === input.project_id) {
          return this.currentPlanProjectLinkResult(raced, "already_linked");
        }
        throw new PlanProjectLinkError(
          "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT",
          "The idempotency key raced with a different plan-project link",
          { idempotency_key: input.idempotency_key },
        );
      }
      throw error;
    }
    const row = mutation.rows[0];
    if (!row?.plan_found) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PLAN_NOT_FOUND", `Plan not found: ${plan.id}`);
    if (!row.project_found) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PROJECT_NOT_FOUND", `Project not found: ${project.id}`);
    if (!row.plan_revision_ok) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT", "Plan changed during the atomic link");
    if (!row.project_revision_ok) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PROJECT_REVISION_CONFLICT", "Project changed during the atomic link");
    if (!row.membership_ok) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_RESULT_DRIFT", "Plan membership changed during the atomic link");
    if (row.collision) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_SCOPE_COLLISION", "Another plan owns this slug in the destination project");
    const accepted = assertPlanProjectLinkReceipt(row.existing_receipt ?? row.inserted_receipt);
    if (accepted.plan_id !== plan.id || accepted.project_id !== project.id) {
      throw new PlanProjectLinkError("PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT", "The idempotency key was accepted for a different target");
    }
    return this.currentPlanProjectLinkResult(accepted, alreadyLinked ? "already_linked" : "linked");
  }

  async rollbackPlanProjectLink(
    input: TodosPlanProjectLinkRollbackInput,
    context: TodosStorageContext = {},
  ): Promise<PlanProjectLinkRollbackResult> {
    await this.ensureSchema();
    const existingRollback = await this.get<PlanProjectLinkRollbackResult>(
      "plan_project_link_rollback_receipts",
      input.rollback_receipt_id,
    );
    if (existingRollback) return existingRollback;
    const receipt = await this.getPlanProjectLinkReceipt(input.receipt_id);
    if (!receipt || receipt.plan_id !== input.plan_id || receipt.project_id !== input.project_id) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_RECEIPT_NOT_FOUND",
        "No exact plan-project-link receipt matches this rollback request",
        { receipt_id: input.receipt_id },
      );
    }
    const [plan, tasks] = await Promise.all([
      this.get<Plan>("plans", input.plan_id),
      this.listTasks({ plan_id: input.plan_id, include_subtasks: true }),
    ]);
    const sortedTasks = tasks.sort((left, right) => left.id.localeCompare(right.id));
    if (!plan || plan.updated_at !== input.expected_plan_revision) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT",
        "Plan changed after the accepted link; fetch an exact readback before rollback",
      );
    }
    if (planProjectLinkResultDigest(plan, sortedTasks) !== receipt.result_digest) {
      throw new PlanProjectLinkError(
        "PLAN_PROJECT_LINK_ROLLBACK_CONFLICT",
        "Plan membership or project linkage drifted; refusing conditional rollback",
      );
    }
    const projectedPlan = { ...plan, project_id: receipt.prior_plan_project_id, updated_at: input.restored_at };
    const projectedTasks = sortedTasks.map((task) => ({
      ...task,
      project_id: receipt.prior_task_project_ids[task.id] ?? null,
      updated_at: input.restored_at,
      version: task.version + 1,
    }));
    const rollback: PlanProjectLinkRollbackResult = {
      schema_version: PLAN_PROJECT_LINK_SCHEMA_VERSION,
      action: "restored",
      plan: projectedPlan,
      tasks: projectedTasks,
      accepted_receipt_id: receipt.receipt_id,
      rollback_receipt_id: input.rollback_receipt_id,
      restored_at: input.restored_at,
    };
    const currentTaskProjects = Object.fromEntries(sortedTasks.map((task) => [task.id, task.project_id]));
    const result = await this.options.client.query<{
      plan_found: boolean;
      plan_revision_ok: boolean;
      membership_ok: boolean;
      existing_rollback: unknown | null;
      inserted_rollback: unknown | null;
    }>(
      `/* todos:plan-project-link-rollback-atomic */ WITH
       target_plan AS MATERIALIZED (
         SELECT payload FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'plans' AND object_id = $2 AND deleted_at IS NULL
         FOR UPDATE
       ), member_tasks AS MATERIALIZED (
         SELECT object_id, payload FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
           AND payload->>'plan_id' = $2
           AND EXISTS (SELECT 1 FROM target_plan)
         FOR UPDATE
       ), existing AS (
         SELECT payload FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'plan_project_link_rollback_receipts'
           AND object_id = $5 AND deleted_at IS NULL
         FOR UPDATE
       ), checks AS (
         SELECT
           EXISTS (SELECT 1 FROM target_plan) AS plan_found,
           COALESCE((SELECT payload->>'updated_at' = $3 FROM target_plan), false) AS plan_revision_ok,
           COALESCE((SELECT jsonb_object_agg(object_id, COALESCE(payload->'project_id', 'null'::jsonb) ORDER BY object_id) FROM member_tasks), '{}'::jsonb) = $7::jsonb
             AND COALESCE((SELECT jsonb_agg(object_id ORDER BY object_id) FROM member_tasks), '[]'::jsonb) = $8::jsonb AS membership_ok,
           EXISTS (SELECT 1 FROM existing) AS has_existing
       ), updated_plan AS (
         UPDATE ${this.tableName} r SET
           payload = r.payload || jsonb_build_object('project_id', $9::jsonb, 'updated_at', $10::text),
           updated_at = $10::timestamptz,
           version = COALESCE(r.version, 0) + 1,
           source_machine_id = COALESCE($11, r.source_machine_id)
         FROM checks
         WHERE r.service = $1 AND r.object_type = 'plans' AND r.object_id = $2 AND r.deleted_at IS NULL
           AND checks.plan_found AND checks.plan_revision_ok AND checks.membership_ok AND NOT checks.has_existing
         RETURNING 1
       ), updated_tasks AS (
         UPDATE ${this.tableName} r SET
           payload = r.payload || jsonb_build_object(
             'project_id', COALESCE($12::jsonb -> r.object_id, 'null'::jsonb),
             'updated_at', $10::text,
             'version', COALESCE((r.payload->>'version')::int, 0) + 1
           ),
           updated_at = $10::timestamptz,
           version = COALESCE(r.version, 0) + 1,
           source_machine_id = COALESCE($11, r.source_machine_id)
         WHERE r.service = $1 AND r.object_type = 'tasks' AND r.deleted_at IS NULL
           AND r.payload->>'plan_id' = $2 AND EXISTS (SELECT 1 FROM updated_plan)
         RETURNING 1
       ), task_gate AS (SELECT count(*) AS count FROM updated_tasks), inserted AS (
         INSERT INTO ${this.tableName}
           (service, object_type, object_id, payload, updated_at, deleted_at, source_machine_id, version)
         SELECT $1, 'plan_project_link_rollback_receipts', $5, $6::jsonb, $10::timestamptz, NULL, $11, 1
         FROM checks, task_gate
         WHERE NOT checks.has_existing AND EXISTS (SELECT 1 FROM updated_plan)
         RETURNING payload
       ) SELECT
         checks.plan_found,
         checks.plan_revision_ok,
         checks.membership_ok,
         (SELECT payload FROM existing) AS existing_rollback,
         (SELECT payload FROM inserted) AS inserted_rollback
       FROM checks`,
      [
        this.service,
        input.plan_id,
        input.expected_plan_revision,
        input.receipt_id,
        input.rollback_receipt_id,
        jsonbParam(rollback),
        jsonbParam(currentTaskProjects),
        jsonbParam(receipt.task_ids),
        jsonbParam(receipt.prior_plan_project_id),
        input.restored_at,
        this.machineId(context),
        jsonbParam(receipt.prior_task_project_ids),
      ],
    );
    const row = result.rows[0];
    if (!row?.plan_found) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PLAN_NOT_FOUND", `Plan not found: ${input.plan_id}`);
    if (!row.plan_revision_ok) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT", "Plan changed during rollback");
    if (!row.membership_ok) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_ROLLBACK_CONFLICT", "Plan membership changed during rollback");
    const accepted = (row.existing_rollback ?? row.inserted_rollback) as PlanProjectLinkRollbackResult | null;
    if (!accepted) throw new PlanProjectLinkError("PLAN_PROJECT_LINK_ROLLBACK_CONFLICT", "Rollback did not produce an immutable receipt");
    return accepted;
  }

  async deletePlan(id: string, context: TodosStorageContext = {}): Promise<boolean> {
    await this.ensureSchema();
    const timestamp = new Date().toISOString();
    const result = await this.options.client.query<{ found: boolean; tasks_updated: number | string }>(
      `/* todos:delete-plan-atomic */ WITH target AS (
        SELECT payload FROM ${this.tableName}
        WHERE service = $1 AND object_type = 'plans' AND object_id = $2 AND deleted_at IS NULL
        FOR UPDATE
      ), updated_tasks AS (
        UPDATE ${this.tableName} r SET
          payload = jsonb_set(
              jsonb_set(r.payload, '{plan_id}', 'null'::jsonb, true),
              '{version}',
              to_jsonb(COALESCE((r.payload->>'version')::int, 0) + 1),
              true
            ) || jsonb_build_object('updated_at', $3::text),
          updated_at = $3::timestamptz,
          source_machine_id = COALESCE($4, r.source_machine_id),
          version = COALESCE(r.version, 0) + 1
        WHERE r.service = $1 AND r.object_type = 'tasks' AND r.deleted_at IS NULL
          AND r.payload->>'plan_id' = $2 AND EXISTS (SELECT 1 FROM target)
        RETURNING 1
      ), deleted_plan AS (
        UPDATE ${this.tableName} r SET
          deleted_at = $3::timestamptz,
          updated_at = $3::timestamptz,
          source_machine_id = COALESCE($4, r.source_machine_id),
          version = COALESCE(r.version, 0) + 1
        FROM target
        WHERE r.service = $1 AND r.object_type = 'plans' AND r.object_id = $2 AND r.deleted_at IS NULL
        RETURNING 1
      ) SELECT
        EXISTS (SELECT 1 FROM target) AS found,
        (SELECT count(*) FROM updated_tasks) AS tasks_updated`,
      [this.service, id, timestamp, this.machineId(context)],
    );
    return Boolean(result.rows[0]?.found);
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
  const linkedPlan = input.plan_id ? await store.get<Plan>("plans", input.plan_id) : null;
  const requestedProjectId = input.project_id ?? context?.projectId ?? null;
  if (linkedPlan?.project_id && requestedProjectId && requestedProjectId !== linkedPlan.project_id) {
    throw new ResourceConflictError(
      "PLAN_PROJECT_LINK_CONFLICT",
      `Task project conflicts with linked plan ${input.plan_id}: expected ${linkedPlan.project_id}`,
    );
  }
  const effectiveProjectId = linkedPlan?.project_id ?? requestedProjectId;
  const shortId = effectiveProjectId ? await nextTaskShortId(effectiveProjectId, store, context) : null;
  const task: Task = {
    id: randomUUID(),
    short_id: shortId,
    project_id: effectiveProjectId,
    parent_id: input.parent_id ?? null,
    plan_id: input.plan_id ?? null,
    task_list_id: input.task_list_id ?? context?.taskListId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "pending",
    priority: input.priority ?? "medium",
    // The server knows who called it — the API-key principal arrives as
    // context.agentId. Dropping it here is why agent_id was populated on 8% of
    // rows and assigned_by on 0%: only clients that passed --agent by hand were
    // ever attributed.
    agent_id: input.agent_id ?? context?.agentId ?? null,
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
    assigned_by: input.assigned_by ?? input.agent_id ?? context?.agentId ?? null,
    // created_by — who FILED it. Write-once; the storage update path never touches it.
    created_by: input.created_by ?? input.agent_id ?? context?.agentId ?? null,
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
  const storedTask = await store.upsertTaskWithPlanMembershipGuard(
    task,
    task.plan_id ? [task.plan_id] : [],
    input.project_id !== undefined || context?.projectId !== undefined,
    context,
  );
  await logTaskChange(
    storedTask.id,
    "created",
    "status",
    null,
    storedTask.status,
    storedTask.assigned_by ?? storedTask.agent_id,
    store,
    context,
  );
  return storedTask;
}

async function updateTask(id: string, input: UpdateTaskInput, store: PostgresJsonRecordStore): Promise<Task> {
  const existing = await requireRecord<Task>("tasks", id, store);
  if (existing.version !== input.version) {
    throw new Error(`Task ${id} version conflict: expected ${existing.version}, got ${input.version}`);
  }
  const effectivePlanId = input.plan_id !== undefined ? input.plan_id : existing.plan_id;
  const linkedPlan = effectivePlanId ? await store.get<Plan>("plans", effectivePlanId) : null;
  if (linkedPlan?.project_id) {
    const effectiveProjectId = input.project_id !== undefined ? input.project_id : existing.project_id;
    if (effectiveProjectId !== linkedPlan.project_id) {
      if (input.project_id === undefined && (input.plan_id !== undefined || existing.project_id === null)) {
        input = { ...input, project_id: linkedPlan.project_id };
      } else {
        throw new ResourceConflictError(
          "PLAN_PROJECT_LINK_CONFLICT",
          `Task project conflicts with linked plan ${effectivePlanId}: expected ${linkedPlan.project_id}`,
        );
      }
    }
  }
  const reopened = existing.status === "completed"
    && input.status !== undefined
    && input.status !== "completed"
    && input.completed_at === undefined;
  // Mirror SQLite (`db/task-crud.updateTask`): reaching a TERMINAL state releases
  // the lock. `definedPatch` never touches locked_by/locked_at, so without this
  // the cloud route left a holder on every task completed, failed or cancelled
  // through the generic PATCH — and a terminal row is not startable, so nothing
  // could ever re-acquire or expire that lock. Measured 2026-08-02: 2,205 of the
  // fleet's 2,597 locked rows were terminal, and 100% of the completed ones were
  // completed after the lock was taken.
  const terminalNow = input.status !== undefined && isTerminalStatus(input.status);
  const task: Task = {
    ...existing,
    ...definedPatch(input),
    ...(terminalNow ? { locked_by: null, locked_at: null } : {}),
    version: existing.version + 1,
    updated_at: new Date().toISOString(),
    tags: input.tags ?? existing.tags,
    metadata: input.metadata ?? existing.metadata,
    requires_approval: input.requires_approval ?? existing.requires_approval,
    // `??` would coalesce an explicit `null` (detach) back to the existing list,
    // making a task un-detachable and re-parenting leave a dangling cross-project
    // reference. Only fall back when the field is absent from the patch.
    task_list_id: input.task_list_id !== undefined ? input.task_list_id : existing.task_list_id,
    // created_by is write-once. `definedPatch` spreads whatever keys the caller
    // actually sent — and the /v1 PATCH route forwards the raw request body — so
    // without this pin an API client could rewrite a task's authorship after the
    // fact, which would make the field worthless as an audit signal.
    created_by: existing.created_by,
    // Match SQLite lifecycle semantics: reopening clears the current completion
    // clock, while evidence and completion metadata remain as immutable history.
    completed_at: reopened
      ? null
      : input.completed_at !== undefined ? input.completed_at : existing.completed_at,
  };
  return store.upsertTaskWithPlanMembershipGuard(
    task,
    [existing.plan_id, effectivePlanId].filter((planId): planId is string => Boolean(planId)),
    input.project_id !== undefined,
  );
}

async function startTask(id: string, agentId: string, store: PostgresJsonRecordStore): Promise<Task> {
  const task = await requireRecord<Task>("tasks", id, store);
  // M8: reject starting a task that is not pending/in_progress (mirror sqlite).
  if (task.status !== "pending" && task.status !== "in_progress") {
    throw new TaskNotStartableError(task.id, task.status, agentId);
  }
  const started = await patchTask(task, {
    status: "in_progress",
    // Legacy remote rows may encode "unassigned" as an empty string. Nullish
    // coalescing preserves that sentinel, so start would take the lock without
    // assigning the caller.
    assigned_to: task.assigned_to || agentId,
    agent_id: task.agent_id ?? agentId,
    locked_by: agentId,
    locked_at: new Date().toISOString(),
    started_at: task.started_at ?? new Date().toISOString(),
  }, store);
  await logTaskChange(task.id, "start", "status", task.status, "in_progress", agentId, store);
  return started;
}

async function completeTask(
  id: string,
  agentId: string | undefined,
  options: TodosTaskCompletionOptions | undefined,
  store: PostgresJsonRecordStore,
): Promise<Task> {
  const task = await store.completeTask(id, agentId, options);
  if (!task) {
    const current = await store.get<Task>("tasks", id);
    if (
      current?.locked_by &&
      !cloudLockExpired(current.locked_at) &&
      !sameCloudLockHolder(current.locked_by, agentId)
    ) {
      throw new LockError(id, current.locked_by);
    }
    throw new Error(`tasks record not found: ${id}`);
  }
  return task;
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
  return store.upsertTaskWithPlanMembershipGuard(
    updated,
    [task.plan_id, updated.plan_id].filter((planId): planId is string => Boolean(planId)),
    Object.prototype.hasOwnProperty.call(patch, "project_id"),
  );
}

// Lock lease TTL — keep in lockstep with the local sqlite path (LOCK_EXPIRY_MINUTES).
const CLOUD_LOCK_EXPIRY_MINUTES = 30;

function sameCloudLockHolder(stored: string | null | undefined, incoming: string | null | undefined): boolean {
  if (!stored || !incoming) return false;
  return canonicalAgentRef(stored) === canonicalAgentRef(incoming);
}

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

/**
 * List a task's outgoing (`dependencies`) and incoming (`blocks`) dependency
 * edges. The incoming edges are ALSO emitted under the deprecated legacy wire
 * name `blocked_by` for fleet clients up to 0.13.1, which read that field for
 * the `Blocks:` rendering — see {@link TodosTaskDependencies}.
 */
async function listDependencies(taskId: string, store: PostgresJsonRecordStore): Promise<TodosTaskDependencies> {
  const edges = await store.list<TaskDependency>("dependencies");
  const incoming = edges
    .filter((edge) => edge.depends_on === taskId)
    .map((edge) => ({ task_id: edge.task_id, depends_on: edge.depends_on }));
  return {
    dependencies: edges.filter((edge) => edge.task_id === taskId).map((edge) => ({ task_id: edge.task_id, depends_on: edge.depends_on })),
    blocks: incoming,
    blocked_by: incoming,
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
const TASK_ORDER_TIEBREAK =
  "CASE payload->>'priority' WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, payload->>'created_at' ASC, payload->>'id' ASC";
const TASK_ORDER_BY = `ORDER BY ${TASK_ORDER_TIEBREAK}`;

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
  return store.updatePlanWithProjectLinkGuard({
    ...plan,
    ...patch,
    project_id: plan.project_id,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Resolve an agent by name, case-insensitively.
 *
 * Agent names are a case-INSENSITIVE identity. The SQLite engine has always
 * enforced this (`validateAgentName` lowercases on the way in, `getAgentByName`
 * matches on `LOWER(name)`); this adapter compared with `===` and so let one
 * agent occupy two roster rows — `fabricius` and `Fabricius` — with independent
 * `last_seen_at`. Both lookups returned success, so nothing reported a fault.
 *
 * When historical rows already hold both spellings, the FRESHEST record wins.
 * That is the safe tie-break rather than an arbitrary one: the caller most
 * likely to be reading a name is a coordinator deciding whether a dispatched
 * agent is still alive, and handing it the stale twin makes "kill the live
 * agent" the rule-following answer. Preferring the freshest row also lets the
 * defect heal without deleting anyone else's record.
 */
function matchAgentByName(
  agents: readonly Agent[],
  name: string,
  options?: { includeArchived?: boolean },
): Agent | null {
  const target = normalizeAgentNameInput(name);
  if (!target) return null;
  const matches = agents.filter(
    (agent) =>
      normalizeAgentNameInput(agent.name) === target &&
      (options?.includeArchived !== false || agent.status !== "archived"),
  );
  if (matches.length === 0) return null;
  return matches.reduce((freshest, candidate) =>
    new Date(candidate.last_seen_at).getTime() > new Date(freshest.last_seen_at).getTime()
      ? candidate
      : freshest,
  );
}

async function registerAgent(
  input: RegisterAgentInput,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<Agent | { conflict: true; message: string }> {
  const canonicalName = normalizeAgentNameInput(input.name);
  const existing = matchAgentByName(await store.list<Agent>("agents"), canonicalName, {
    includeArchived: false,
  });
  if (existing && !input.force && existing.session_id && existing.session_id !== input.session_id) {
    return { conflict: true, message: `Agent name '${canonicalName}' is already active` };
  }
  const timestamp = new Date().toISOString();
  const agent: Agent = {
    id: existing?.id ?? randomUUID().slice(0, 8),
    name: canonicalName,
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
  return matchAgentByName(await store.list<Agent>("agents"), idOrName);
}

/**
 * Resolve `idOrName` to an agent for `--assigned` filter aliasing specifically
 * — refusing to silently narrow to one row when the name is genuinely
 * ambiguous (2+ independently-registered agents share it case-insensitively,
 * e.g. `fabricius` + `Fabricius`, task 0bf5d979).
 *
 * This deliberately does NOT reuse `resolveAgent`/`matchAgentByName`'s
 * freshest-wins tie-break. That tie-break is correct for its own callers
 * (heartbeat, registration) where the caller wants exactly one live agent and
 * the stale twin is noise. For a task-ownership FILTER it is the wrong
 * default: picking one ambiguous row and searching only its alias set
 * silently excludes the other row's own tasks, which is a different
 * instance of the exact silent-subset bug this resolver exists to fix
 * (task 8f07bc15). Bridging the two rows is a deliberate non-goal (task
 * a37a7137), so ambiguous input here returns `null` and the caller falls
 * back to literal-only matching — never a crash, and never a silent pick.
 * Must stay behaviourally identical to the SQLite-side `IdentityAliasAmbiguousError`
 * catch in task-crud.ts's `resolveAssignedToAliases`.
 */
async function resolveAgentForAssignedFilter(idOrName: string, store: PostgresJsonRecordStore): Promise<Agent | null> {
  const byId = await store.get<Agent>("agents", idOrName);
  if (byId) return byId;
  const target = normalizeAgentNameInput(idOrName);
  if (!target) return null;
  const matches = (await store.list<Agent>("agents")).filter(
    (agent) => normalizeAgentNameInput(agent.name) === target,
  );
  return matches.length === 1 ? matches[0]! : null;
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
  const template: TaskTemplate = {
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
  };
  const tasks = buildTemplateTasks(template.id, input.tasks ?? [], timestamp);
  await store.createTemplateWithTasks(template, tasks, context);
  return template;
}

function buildTemplateTasks(
  templateId: string,
  inputs: TemplateTaskInput[],
  timestamp: string,
): TemplateTask[] {
  return inputs.map((input, position) => ({
      id: randomUUID(),
      template_id: templateId,
      position,
      title_pattern: input.title_pattern,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      tags: input.tags ?? [],
      task_type: input.task_type ?? null,
      condition: input.condition ?? null,
      include_template_id: input.include_template_id ?? null,
      depends_on_positions: input.depends_on ?? [],
      metadata: input.metadata ?? {},
      created_at: timestamp,
    }));
}

async function deleteTemplate(
  id: string,
  store: PostgresJsonRecordStore,
  context?: TodosStorageContext,
): Promise<boolean> {
  return store.deleteTemplateWithTasks(id, context);
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
    templateTasks: await store.list<TemplateTask>("template_tasks"),
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
  result.errors.push(...validateSnapshotRoutingRecords(snapshot.projects, snapshot.taskLists));
  if (result.errors.length > 0) return result;
  const [existingProjects, existingTaskLists] = await Promise.all([
    store.list<Project>("projects"),
    store.list<TaskList>("task_lists"),
  ]);
  result.errors.push(...validateSnapshotRoutingDestinationConflicts(
    snapshot.projects,
    snapshot.taskLists,
    existingProjects,
    existingTaskLists,
  ));
  if (result.errors.length > 0) return result;
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
    ...(snapshot.templateTasks ?? []).map((row) => ["template_tasks", row] as const),
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
    if (used.has(slug)) {
      throw new ResourceConflictError("PLAN_SLUG_CONFLICT", `Plan slug already exists in this scope: ${slug}`);
    }
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
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    sqlState?: unknown;
    sqlstate?: unknown;
    cause?: unknown;
  };
  const states = [candidate.code, candidate.errno, candidate.sqlState, candidate.sqlstate];
  if (typeof candidate.cause === "object" && candidate.cause !== null) {
    const cause = candidate.cause as { code?: unknown; errno?: unknown; sqlState?: unknown; sqlstate?: unknown };
    states.push(cause.code, cause.errno, cause.sqlState, cause.sqlstate);
  }
  return states.some((state) => String(state) === "23505");
}

function postgresConstraintName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as { constraint?: unknown; constraint_name?: unknown; cause?: unknown };
  const cause = typeof candidate.cause === "object" && candidate.cause !== null
    ? candidate.cause as { constraint?: unknown; constraint_name?: unknown }
    : undefined;
  const constraint = candidate.constraint ?? candidate.constraint_name ?? cause?.constraint ?? cause?.constraint_name;
  return typeof constraint === "string" ? constraint : "";
}
