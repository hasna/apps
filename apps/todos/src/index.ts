// Core database
export { getDatabase, closeDatabase, resetDatabase, resolvePartialId, now, uuid } from "./db/database.js";

// Tasks
export {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
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
} from "./db/tasks.js";

// Projects
export {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
  deleteProject,
  ensureProject,
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
} from "./db/comments.js";

// Agents
export {
  registerAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgentActivity,
  deleteAgent,
} from "./db/agents.js";

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

// Search
export { searchTasks } from "./lib/search.js";

// Sync
export { defaultSyncAgents, syncWithAgent, syncWithAgents } from "./lib/sync.js";
export type { SyncResult } from "./lib/sync-types.js";

// Config
export { loadConfig } from "./lib/config.js";
export type { TodosConfig, AgentConfig } from "./lib/config.js";

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
} from "./types/index.js";
