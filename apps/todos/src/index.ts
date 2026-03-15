// REST SDK Client (for cross-process/cross-machine use)
export { TodosClient, createClient } from "./sdk.js";
export type { TodosClientOptions } from "./sdk.js";

// Core database
export { getDatabase, closeDatabase, resetDatabase, resolvePartialId, now, uuid } from "./db/database.js";

// Tasks
export {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
  getTaskDependencies,
  getTaskDependents,
  getBlockingDeps,
  bulkUpdateTasks,
  bulkCreateTasks,
  cloneTask,
  getTaskStats,
  getTaskGraph,
  moveTask,
  getNextTask,
  claimNextTask,
  getActiveWork,
  failTask,
  getTasksChangedSince,
  getStaleTasks,
  getStatus,
  decomposeTasks,
  setTaskStatus,
  setTaskPriority,
  redistributeStaleTasks,
  getOverdueTasks,
} from "./db/tasks.js";
export type { TaskGraphNode, TaskGraph, BulkCreateTaskInput, ActiveWorkItem, StatusSummary, DecomposeSubtaskInput } from "./db/tasks.js";

// Projects
export {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
  deleteProject,
  ensureProject,
  nextTaskShortId,
  slugify,
} from "./db/projects.js";

// Plans
export {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "./db/plans.js";

// Comments
export {
  addComment,
  getComment,
  listComments,
  deleteComment,
  logProgress,
} from "./db/comments.js";

// Agents
export {
  registerAgent,
  isAgentConflict,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgent,
  updateAgentActivity,
  deleteAgent,
  getDirectReports,
  getOrgChart,
} from "./db/agents.js";
export type { OrgNode } from "./db/agents.js";

// Task Lists
export {
  createTaskList,
  getTaskList,
  getTaskListBySlug,
  listTaskLists,
  updateTaskList,
  deleteTaskList,
  ensureTaskList,
} from "./db/task-lists.js";

// Sessions
export {
  createSession,
  getSession,
  listSessions,
  updateSessionActivity,
  deleteSession,
} from "./db/sessions.js";

// Audit
export { logTaskChange, getTaskHistory, getRecentActivity } from "./db/audit.js";

// Webhooks
export { createWebhook, getWebhook, listWebhooks, deleteWebhook, dispatchWebhook } from "./db/webhooks.js";

// Templates
export { createTemplate, getTemplate, listTemplates, deleteTemplate, taskFromTemplate } from "./db/templates.js";

// Orgs
export { createOrg, getOrg, getOrgByName, listOrgs, updateOrg, deleteOrg } from "./db/orgs.js";

// Search
export { searchTasks } from "./lib/search.js";
export type { SearchOptions } from "./lib/search.js";

// Sync
export { defaultSyncAgents, syncWithAgent, syncWithAgents } from "./lib/sync.js";
export type { SyncResult } from "./lib/sync-types.js";

// Config
export { loadConfig, getCompletionGuardConfig } from "./lib/config.js";
export type { TodosConfig, AgentConfig, CompletionGuardConfig } from "./lib/config.js";

// Completion Guard
export { checkCompletionGuard } from "./lib/completion-guard.js";

// Recurrence
export { parseRecurrenceRule, isValidRecurrenceRule, nextOccurrence } from "./lib/recurrence.js";
export type { ParsedRule } from "./lib/recurrence.js";

// Types
export type {
  Task,
  TaskWithRelations,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
  TaskPriority,
  TaskDependency,
  TaskComment,
  CreateCommentInput,
  Project,
  CreateProjectInput,
  Plan,
  CreatePlanInput,
  UpdatePlanInput,
  PlanStatus,
  Session,
  CreateSessionInput,
  Agent,
  AgentRow,
  RegisterAgentInput,
  TaskList,
  TaskListRow,
  CreateTaskListInput,
  UpdateTaskListInput,
  LockResult,
  TaskRow,
  SessionRow,
  TaskHistory,
  Webhook,
  CreateWebhookInput,
  TaskTemplate,
  CreateTemplateInput,
  Org,
  CreateOrgInput,
} from "./types/index.js";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  PLAN_STATUSES,
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  DependencyCycleError,
  AgentNotFoundError,
  TaskListNotFoundError,
  CompletionGuardError,
} from "./types/index.js";
