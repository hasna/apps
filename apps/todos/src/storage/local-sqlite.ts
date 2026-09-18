import type { Database } from "bun:sqlite";
import { ResourceConflictError, TaskNotFoundError, TaskReferenceAmbiguousError, type Task, type TaskDependency, type TaskFilter, type TaskHistory } from "../types/index.js";
import { searchTasks } from "../lib/search.js";
import {
  createTask,
  getTask,
  listTasks,
  countTasks,
  updateTask,
  unlockTask,
  deleteTask,
  startTask,
  completeTask,
  failTask,
  handoffStaleTaskLock,
  claimNextTask,
  getNextTask,
  getActiveWork,
  getTasksChangedSince,
} from "../db/tasks.js";
import {
  addDependency,
  getTaskDependencies,
  getTaskDependents,
  removeDependency,
} from "../db/task-graph.js";
import {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  renameProject,
  updateProject,
  deleteProject,
} from "../db/projects.js";
import {
  createPlan,
  completePlanAtRevision,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../db/plans.js";
import {
  addPlanComment,
  listPlanComments,
} from "../db/plan-comments.js";
import {
  registerAgent,
  getAgent,
  getAgentByName,
  listAgents,
  listAgentsPage,
  updateAgent,
} from "../db/agents.js";
import {
  createTaskList,
  getTaskList,
  getTaskListBySlug,
  listTaskLists,
  updateTaskList,
  deleteTaskList,
  deleteTaskListIfUnchangedAndUnused,
} from "../db/task-lists.js";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  getTemplateWithTasks,
} from "../db/templates.js";
import {
  logTaskChange,
  getTaskHistory,
  getRecentActivity,
} from "../db/audit.js";
import { addComment, listComments } from "../db/comments.js";
import { compareCommentKeyset, isStrictlyOlder } from "../lib/comment-cursor.js";
import { getDatabase } from "../db/database.js";
import { scanSqliteIntegrity } from "../db/integrity.js";
import {
  applyPlanProjectLinkSqlite,
  getPlanProjectLinkReceipt,
  getPlanProjectLinkReceiptByIdempotencyKey,
  rollbackPlanProjectLinkSqlite,
} from "../db/plan-project-links.js";
import type {
  TodosBulkCreateReceipt,
  TodosBulkCreateTaskInput,
  TodosBulkDeleteReceipt,
  TodosStorageAdapter,
  TodosStorageContext,
  TodosTaskHistoryPage,
  TodosTaskHistoryPageOptions,
} from "./interfaces.js";
import {
  exportSqliteTodosStorageSnapshot,
  importSqliteTodosStorageSnapshot,
} from "./sqlite-snapshot.js";

export interface CreateLocalSqliteTodosStorageAdapterOptions {
  db?: Database;
}

function bulkCreateAtomicSqlite(
  db: Database,
  inputs: TodosBulkCreateTaskInput[],
): TodosBulkCreateReceipt {
  return db.transaction((): TodosBulkCreateReceipt => {
    const tempIds = new Map<string, string>();
    const created: TodosBulkCreateReceipt["created"] = [];
    const dependencies: TaskDependency[] = [];

    for (const input of inputs) {
      const { temp_id, depends_on: _dependsOn, ...taskInput } = input;
      const task = createTask(taskInput, db);
      if (temp_id) tempIds.set(temp_id, task.id);
      created.push({ temp_id: temp_id ?? null, id: task.id, short_id: task.short_id, title: task.title });
    }

    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index]!;
      const taskId = created[index]!.id;
      const seenDependencies = new Set<string>();
      for (const reference of input.depends_on ?? []) {
        const dependencyId = tempIds.get(reference) ?? resolveTaskRefLocal(db, reference)?.id;
        if (!dependencyId) throw new TaskNotFoundError(reference);
        if (seenDependencies.has(dependencyId)) {
          throw new ResourceConflictError("BULK_CREATE_DUPLICATE_DEPENDENCY", `Multiple references resolve to dependency ${dependencyId}`);
        }
        seenDependencies.add(dependencyId);
        addDependency(taskId, dependencyId, db);
        dependencies.push({ task_id: taskId, depends_on: dependencyId });
      }
    }

    return { schema_version: 1, atomic: true, created, dependencies };
  })();
}

function deleteTaskHierarchySqlite(db: Database, rootId: string): void {
  const rows = db.query(`WITH RECURSIVE tree(id, depth) AS (
    SELECT id, 0 FROM tasks WHERE id = ?
    UNION ALL
    SELECT child.id, tree.depth + 1 FROM tasks child JOIN tree ON child.parent_id = tree.id
  ) SELECT id FROM tree ORDER BY depth DESC, id`).all(rootId) as Array<{ id: string }>;
  if (rows.length === 0) throw new TaskNotFoundError(rootId);
  for (const row of rows) {
    if (!deleteTask(row.id, db)) throw new Error(`Atomic hierarchy delete lost task ${row.id}`);
  }
}

function bulkDeleteAtomicSqlite(
  db: Database,
  ids: string[],
  force: boolean,
): TodosBulkDeleteReceipt {
  return db.transaction((): TodosBulkDeleteReceipt => {
    const resolved = ids.map((reference) => ({ reference, task: resolveTaskRefLocal(db, reference) }));
    const seen = new Set<string>();
    for (const item of resolved) {
      if (!item.task) continue;
      if (seen.has(item.task.id)) {
        throw new ResourceConflictError("BULK_DELETE_DUPLICATE_TASK", `Multiple references resolve to task ${item.task.id}`);
      }
      seen.add(item.task.id);
    }

    const childState = new Map<string, boolean>();
    for (const item of resolved) {
      if (!item.task) continue;
      childState.set(item.task.id, Boolean(db.query("SELECT id FROM tasks WHERE parent_id = ? LIMIT 1").get(item.task.id)));
    }
    const planned = resolved.filter((item) => item.task && (force || !childState.get(item.task.id))) as Array<{ reference: string; task: Task }>;
    const plannedIds = new Set(planned.map((item) => item.task.id));
    const roots = planned.filter((item) => {
      if (!force) return true;
      let parentId = item.task.parent_id;
      while (parentId) {
        if (plannedIds.has(parentId)) return false;
        parentId = getTask(parentId, db)?.parent_id ?? null;
      }
      return true;
    });
    for (const item of roots) deleteTaskHierarchySqlite(db, item.task.id);

    return {
      schema_version: 1,
      atomic: true,
      force,
      results: resolved.map((item) => {
        if (!item.task) return { requested_id: item.reference, task_id: null, outcome: "missing" as const, reason: "not_found" as const };
        if (!force && childState.get(item.task.id)) {
          return { requested_id: item.reference, task_id: item.task.id, outcome: "skipped" as const, reason: "has_children" as const };
        }
        return { requested_id: item.reference, task_id: item.task.id, outcome: "deleted" as const, reason: null };
      }),
    };
  })();
}

const TASK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bounded resolution of a non-UUID task reference (exact `short_id`, or a unique
 * task-`id` prefix) to its full task. Mirrors {@link resolvePartialId} matching
 * order (id-prefix first, then short_id) but distinguishes ambiguity from
 * not-found so the caller can surface a 409 rather than a silent 404. Every query
 * is `LIMIT 2` and hits the `tasks` primary key / `short_id`, so it never scans
 * the whole table.
 */
function resolveTaskRefLocal(db: Database, ref: string): Task | null {
  // Case-insensitive, matching the CLI's historical resolution: ids are stored
  // lower-case, short_ids upper-case.
  const raw = ref.trim().toLowerCase();
  if (!raw) return null;
  if (TASK_UUID_RE.test(raw)) return getTask(raw, db);

  const prefixRows = db
    .query("SELECT id, project_id FROM tasks WHERE LOWER(id) LIKE ? ESCAPE '\\' ORDER BY project_id, id LIMIT 2")
    .all(`${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as Array<{ id: string; project_id: string | null }>;
  if (prefixRows.length > 1) {
    throw new TaskReferenceAmbiguousError(
      ref,
      prefixRows.map((row) => ({ task_id: row.id, project_id: row.project_id })),
    );
  }
  if (prefixRows.length === 1) return getTask(prefixRows[0]!.id, db);

  const shortIdRows = db
    .query("SELECT id, project_id FROM tasks WHERE LOWER(short_id) = ? ORDER BY project_id, id LIMIT 2")
    .all(raw) as Array<{ id: string; project_id: string | null }>;
  if (shortIdRows.length > 1) {
    throw new TaskReferenceAmbiguousError(
      ref,
      shortIdRows.map((row) => ({ task_id: row.id, project_id: row.project_id })),
    );
  }
  if (shortIdRows.length === 1) return getTask(shortIdRows[0]!.id, db);

  return null;
}

function isSearchQuery(filter: TaskFilter): boolean {
  const q = filter.query?.trim();
  return !!q && q !== "*";
}

/**
 * TaskFilter fields the FTS `searchTasks` path does not itself constrain but the
 * Postgres adapter's buildTaskFilterSql does. Applied in JS after the FTS match
 * so a SQLite-backed `/v1/tasks?q=` behaves like the Postgres one (e.g. subtasks
 * excluded by default).
 */
function matchesExtraFilters(task: Task, filter: TaskFilter): boolean {
  if (filter.ids && !filter.ids.includes(task.id)) return false;
  if (filter.parent_id !== undefined && (task.parent_id ?? null) !== filter.parent_id) return false;
  if (filter.plan_id !== undefined && task.plan_id !== filter.plan_id) return false;
  if (filter.session_id !== undefined && task.session_id !== filter.session_id) return false;
  if (filter.has_recurrence !== undefined && Boolean(task.recurrence_rule) !== filter.has_recurrence) return false;
  if (filter.task_type !== undefined) {
    const allowed = Array.isArray(filter.task_type) ? filter.task_type : [filter.task_type];
    if (!allowed.includes(task.task_type ?? "")) return false;
  }
  if (filter.tags?.length) {
    const taskTags = new Set(task.tags ?? []);
    // ANY-of tag matching, parity with the plain SQLite list path
    // (src/db/task-crud.ts: `id IN (SELECT task_id FROM task_tags WHERE tag IN
    // (...))`) and the Postgres adapter — a query must not flip multi-tag
    // filters to ALL-of.
    if (!filter.tags.some((tag) => taskTags.has(tag))) return false;
  }
  // include_subtasks defaults to false: exclude tasks that have a parent, unless
  // a parent_id filter is explicitly targeting children.
  if (filter.include_subtasks !== true && filter.parent_id === undefined && task.parent_id) return false;
  return true;
}

/**
 * Route a free-text `filter.query` through the local FTS5 search (searchTasks),
 * then apply the remaining TaskFilter constraints, so the storage abstraction's
 * `tasks.list` honors search on SQLite exactly as the Postgres adapter does.
 * Without a query, defers to the plain indexed listTasks.
 */
function listTasksMaybeSearch(filter: TaskFilter, db: Database): Task[] {
  if (!isSearchQuery(filter)) return listTasks(filter, db);
  const matched = searchTasks({
    query: filter.query,
    project_id: filter.project_id,
    task_list_id: filter.task_list_id,
    status: filter.status,
    priority: filter.priority,
    assigned_to: filter.assigned_to,
    agent_id: filter.agent_id,
  }, undefined, undefined, db).filter((task) => matchesExtraFilters(task, filter));
  const offset = filter.offset && filter.offset > 0 ? Math.trunc(filter.offset) : 0;
  if (filter.limit !== undefined && filter.limit >= 0) return matched.slice(offset, offset + filter.limit);
  return offset ? matched.slice(offset) : matched;
}

export function createLocalSqliteTodosStorageAdapter(
  options: CreateLocalSqliteTodosStorageAdapterOptions = {},
): TodosStorageAdapter {
  const database = () => options.db ?? getDatabase();
  let adapter: TodosStorageAdapter;

  adapter = {
    kind: "sqlite",
    capabilities: {
      localPersistence: true,
      remotePersistence: false,
      transactions: true,
      auditLog: true,
      sync: true,
    },
    tasks: {
      // The principal arrives as context.agentId — a self-hosted SQLite-backed /v1
      // server is a supported deployment shape, and dropping the context here
      // reproduced the exact defect this field exists to close: the server knowing
      // who called and discarding it. Mirrors the Postgres adapter.
      create: (input, context) =>
        createTask(
          {
            ...input,
            agent_id: input.agent_id ?? context?.agentId,
            created_by: input.created_by ?? input.agent_id ?? context?.agentId,
          },
          database(),
        ),
      get: (id) => getTask(id, database()),
      resolveRef: (ref) => resolveTaskRefLocal(database(), ref),
      list: (filter = {}) => listTasksMaybeSearch(filter, database()),
      count: (filter = {}) =>
        isSearchQuery(filter)
          ? listTasksMaybeSearch({ ...filter, limit: undefined, offset: undefined }, database()).length
          : countTasks(filter, database()),
      update: (id, input) => updateTask(id, input, database()),
      unlock: (id, agentId) => {
        unlockTask(id, agentId, database());
        return true;
      },
      handoffStaleLock: (input) => handoffStaleTaskLock(input, database()),
      delete: (id) => deleteTask(id, database()),
      bulkCreateAtomic: (inputs: TodosBulkCreateTaskInput[], _context?: TodosStorageContext) =>
        bulkCreateAtomicSqlite(database(), inputs),
      bulkDeleteAtomic: (ids: string[], force: boolean, _context?: TodosStorageContext) =>
        bulkDeleteAtomicSqlite(database(), ids, force),
      start: (id, agentId) => startTask(id, agentId, database()),
      complete: (id, agentId, options) => completeTask(id, agentId, database(), options),
      fail: (id, agentId, reason, options) => failTask(id, agentId, reason, options, database()),
      claimNext: (agentId, filters) => claimNextTask(agentId, filters, database()),
      getNext: (agentId, filters) => getNextTask(agentId, filters, database()),
      getActiveWork: (filters) => getActiveWork(filters, database()),
      getChangedSince: (since, filters) => getTasksChangedSince(since, filters, database()),
    },
    dependencies: {
      add: (taskId, dependsOn) => {
        addDependency(taskId, dependsOn, database());
        return { task_id: taskId, depends_on: dependsOn };
      },
      remove: (taskId, dependsOn) => removeDependency(taskId, dependsOn, database()),
      list: (taskId) => {
        const dependencies = getTaskDependencies(taskId, database());
        const blocks = getTaskDependents(taskId, database());
        return { dependencies, blocks, blocked_by: blocks };
      },
      listPage: ({ limit, offset }) => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          throw new Error("SQLite dependency page limit must be an integer from 1 to 500");
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          throw new Error("SQLite dependency page offset must be a non-negative integer");
        }
        const totalRow = database()
          .query("SELECT COUNT(*) AS total FROM task_dependencies")
          .get() as { total: number };
        const dependencies = database()
          .query("SELECT task_id, depends_on FROM task_dependencies ORDER BY task_id, depends_on LIMIT ? OFFSET ?")
          .all(limit, offset) as TaskDependency[];
        return { dependencies, total: totalRow.total };
      },
      listAll: () => database()
        .query("SELECT task_id, depends_on FROM task_dependencies ORDER BY task_id, depends_on")
        .all() as TaskDependency[],
    },
    projects: {
      create: (input) => createProject(input, database()),
      get: (id) => getProject(id, database()),
      getByPath: (path) => getProjectByPath(path, database()),
      list: () => listProjects(database()),
      update: (id, input) => updateProject(id, input, database()),
      rename: (id, input) => renameProject(id, input, database()),
      delete: (id) => deleteProject(id, database()),
    },
    plans: {
      create: (input) => createPlan(input, database()),
      get: (id) => getPlan(id, database()),
      list: (projectId) => listPlans(projectId, database()),
      update: (id, input) => updatePlan(id, input, database()),
      completeAtRevision: (id, expectedUpdatedAt) =>
        completePlanAtRevision(id, expectedUpdatedAt, database()),
      delete: (id) => deletePlan(id, database()),
      addComment: (input) => addPlanComment(input, database()),
      getComments: (planId) => listPlanComments(planId, database()),
      getCommentsPage: (planId, options) => {
        if (options?.limit !== undefined &&
            (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1_001)) {
          throw new Error("Plan comment limit must be an integer between 1 and 1001");
        }
        let comments = listPlanComments(planId, database());
        comments = comments.sort(compareCommentKeyset);
        if (options?.before) {
          const before = options.before;
          comments = comments.filter((comment) => isStrictlyOlder(comment, before));
        }
        const limit = options?.limit ?? 100;
        return comments.slice(-limit);
      },
    },
    planProjectLinks: {
      apply: (input) => applyPlanProjectLinkSqlite(input, database()),
      rollback: (input) => rollbackPlanProjectLinkSqlite(input, database()),
      getReceipt: (receiptId) => getPlanProjectLinkReceipt(receiptId, database()),
      getReceiptByIdempotencyKey: (key) => getPlanProjectLinkReceiptByIdempotencyKey(key, database()),
    },
    agents: {
      register: (input) => registerAgent(input, database()),
      get: (id) => getAgent(id, database()),
      getByName: (name) => getAgentByName(name, database()),
      list: (options) => listAgents(options, database()),
      listPage: (options) => listAgentsPage(options, database()),
      update: (id, input) => updateAgent(id, input, database()),
    },
    taskLists: {
      create: (input) => createTaskList(input, database()),
      get: (id) => getTaskList(id, database()),
      getBySlug: (slug, projectId) => getTaskListBySlug(slug, projectId, database()),
      list: (projectId) => listTaskLists(projectId, database()),
      update: (id, input) => updateTaskList(id, input, database()),
      delete: (id) => deleteTaskList(id, database()),
      deleteIfUnchangedAndUnused: (id, expected) =>
        deleteTaskListIfUnchangedAndUnused(id, expected, database()),
    },
    templates: {
      create: (input) => createTemplate(input, database()),
      get: (id) => getTemplate(id, database()),
      list: () => listTemplates(database()),
      update: (id, input) => updateTemplate(id, input, database()),
      delete: (id) => deleteTemplate(id, database()),
      getWithTasks: (id) => getTemplateWithTasks(id, database()),
    },
    audit: {
      logTaskChange: (taskId, action, field, oldValue, newValue, agentId) =>
        logTaskChange(taskId, action, field, oldValue, newValue, agentId, database()),
      addComment: (input) => addComment(input, database()),
      getComments: (taskId) => listComments(taskId, database()),
      getCommentsPage: (taskId, options) => {
        if (options?.limit !== undefined &&
            (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1_001)) {
          throw new Error("Comment limit must be an integer between 1 and 1001");
        }
        let comments = listComments(taskId, database());
        // Sort and cursor-filter must use ONE keyset definition; see
        // compareCommentKeyset in lib/comment-cursor.ts for why a second,
        // locally-inlined comparator is how a page window and a cursor filter
        // drift into describing different orderings.
        comments = comments.sort(compareCommentKeyset);
        if (options?.before) {
          const before = options.before;
          comments = comments.filter((comment) => isStrictlyOlder(comment, before));
        }
        if (options?.limit !== undefined) comments = comments.slice(-options.limit);
        return comments;
      },
      getTaskHistory: (taskId) => getTaskHistory(taskId, database()),
      getTaskHistoryPage: (taskId, options: TodosTaskHistoryPageOptions): TodosTaskHistoryPage => {
        if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 500) {
          throw new Error("Task history limit must be an integer from 1 to 500");
        }
        if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
          throw new Error("Task history offset must be a non-negative integer");
        }
        const conditions = ["task_id = ?"];
        const values: Array<string | number> = [taskId];
        if (options.since) { conditions.push("created_at >= ?"); values.push(options.since); }
        if (options.until) { conditions.push("created_at <= ?"); values.push(options.until); }
        const where = conditions.join(" AND ");
        const total = (database().query(`SELECT COUNT(*) AS total FROM task_history WHERE ${where}`).get(...values) as { total: number }).total;
        const direction = options.order === "asc" ? "ASC" : "DESC";
        const history = database().query(
          `SELECT * FROM task_history WHERE ${where} ORDER BY created_at ${direction}, id ${direction} LIMIT ? OFFSET ?`,
        ).all(...values, options.limit, options.offset) as TaskHistory[];
        return { history, total };
      },
      getRecentActivity: (limit) => getRecentActivity(limit, database()),
    },
    sync: {
      getTasksChangedSince: (since, filters) => getTasksChangedSince(since, filters, database()),
      exportSnapshot: () => exportSqliteTodosStorageSnapshot(database()),
      importSnapshot: (snapshot) => importSqliteTodosStorageSnapshot(snapshot, database()),
    },
    integrity: {
      report: () => scanSqliteIntegrity(database()),
    },
    transaction: (fn) => {
      const tx = database().transaction(() => fn(adapter));
      return tx();
    },
  };

  return adapter;
}
