import type { Database } from "bun:sqlite";
import {
  createTask,
  getTask,
  listTasks,
  countTasks,
  updateTask,
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
      list: (filter = {}) => listTasks(filter, database()),
      count: (filter = {}) => countTasks(filter, database()),
      update: (id, input) => updateTask(id, input, database()),
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
