export { getTodosMode, getTodosCloudEnvironment, TODOS_MODE_ENV } from "./runtime-mode.js";
export type { TodosMode, TodosCloudEnvironment } from "./runtime-mode.js";

export {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
} from "./db/task-crud.js";
export {
  startTask,
  completeTask,
  failTask,
  claimNextTask,
  getNextTask,
} from "./db/task-lifecycle.js";
export { getStatus } from "./db/task-status.js";
export { createProject, getProject, listProjects } from "./db/projects.js";
export { registerAgent, getAgent, listAgents } from "./db/agents.js";
export { getDatabase, getDatabasePath, closeDatabase } from "./db/database.js";

export { TodosV1Client, ApiError } from "./client.generated.js";
export type {
  TodosV1ClientOptions,
  Task as CloudTask,
  Project as CloudProject,
  CreateTaskInput as CloudCreateTaskInput,
  UpdateTaskInput as CloudUpdateTaskInput,
} from "./client.generated.js";

export type {
  Agent,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  RegisterAgentInput,
  Task,
  TaskFilter,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from "./types/index.js";
