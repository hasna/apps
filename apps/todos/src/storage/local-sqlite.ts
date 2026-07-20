import type { Database } from "bun:sqlite";
import type { Task } from "../types/index.js";
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
  claimNextTask,
  getNextTask,
  getActiveWork,
  getTasksChangedSince,
} from "../db/tasks.js";
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
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../db/plans.js";
import {
  registerAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgent,
} from "../db/agents.js";
import {
  createTaskList,
  getTaskList,
  getTaskListBySlug,
  listTaskLists,
  updateTaskList,
  deleteTaskList,
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
import { getDatabase } from "../db/database.js";
import type { TodosStorageAdapter } from "./interfaces.js";
import {
  exportSqliteTodosStorageSnapshot,
  importSqliteTodosStorageSnapshot,
} from "./sqlite-snapshot.js";

export interface CreateLocalSqliteTodosStorageAdapterOptions {
  db?: Database;
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
    .query("SELECT id FROM tasks WHERE LOWER(id) LIKE ? ESCAPE '\\' LIMIT 2")
    .all(`${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as { id: string }[];
  if (prefixRows.length > 1) {
    throw new Error(`Task reference is ambiguous: "${ref}"`);
  }
  if (prefixRows.length === 1) return getTask(prefixRows[0]!.id, db);

  const shortIdRows = db
    .query("SELECT id FROM tasks WHERE LOWER(short_id) = ? LIMIT 2")
    .all(raw) as { id: string }[];
  if (shortIdRows.length > 1) {
    throw new Error(`Task reference is ambiguous: "${ref}"`);
  }
  if (shortIdRows.length === 1) return getTask(shortIdRows[0]!.id, db);

  return null;
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
      create: (input) => createTask(input, database()),
      get: (id) => getTask(id, database()),
      resolveRef: (ref) => resolveTaskRefLocal(database(), ref),
      list: (filter = {}) => listTasks(filter, database()),
      count: (filter = {}) => countTasks(filter, database()),
      update: (id, input) => updateTask(id, input, database()),
      unlock: (id, agentId) => {
        unlockTask(id, agentId, database());
        return true;
      },
      delete: (id) => deleteTask(id, database()),
      start: (id, agentId) => startTask(id, agentId, database()),
      complete: (id, agentId, options) => completeTask(id, agentId, database(), options),
      fail: (id, agentId, reason, options) => failTask(id, agentId, reason, options, database()),
      claimNext: (agentId, filters) => claimNextTask(agentId, filters, database()),
      getNext: (agentId, filters) => getNextTask(agentId, filters, database()),
      getActiveWork: (filters) => getActiveWork(filters, database()),
      getChangedSince: (since, filters) => getTasksChangedSince(since, filters, database()),
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
      delete: (id) => deletePlan(id, database()),
    },
    agents: {
      register: (input) => registerAgent(input, database()),
      get: (id) => getAgent(id, database()),
      getByName: (name) => getAgentByName(name, database()),
      list: (options) => listAgents(options, database()),
      update: (id, input) => updateAgent(id, input, database()),
    },
    taskLists: {
      create: (input) => createTaskList(input, database()),
      get: (id) => getTaskList(id, database()),
      getBySlug: (slug, projectId) => getTaskListBySlug(slug, projectId, database()),
      list: (projectId) => listTaskLists(projectId, database()),
      update: (id, input) => updateTaskList(id, input, database()),
      delete: (id) => deleteTaskList(id, database()),
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
        comments = comments.sort((left, right) =>
          left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
        if (options?.before) {
          const before = options.before;
          comments = comments.filter((comment) =>
            comment.created_at < before.created_at ||
            (comment.created_at === before.created_at && comment.id < before.id));
        }
        if (options?.limit !== undefined) comments = comments.slice(-options.limit);
        return comments;
      },
      getTaskHistory: (taskId) => getTaskHistory(taskId, database()),
      getRecentActivity: (limit) => getRecentActivity(limit, database()),
    },
    sync: {
      getTasksChangedSince: (since, filters) => getTasksChangedSince(since, filters, database()),
      exportSnapshot: () => exportSqliteTodosStorageSnapshot(database()),
      importSnapshot: (snapshot) => importSqliteTodosStorageSnapshot(snapshot, database()),
    },
    transaction: (fn) => {
      const tx = database().transaction(() => fn(adapter));
      return tx();
    },
  };

  return adapter;
}
