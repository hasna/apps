// Thin re-export file — all task functions are defined in focused sub-modules.
// This file re-exports everything for backward compatibility.

// Re-export functions from sub-modules
export {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
  rowToTask,
  insertTaskTags,
  replaceTaskTags,
} from "./task-crud.js";

export {
  startTask,
  completeTask,
  failTask,
  lockTask,
  unlockTask,
  claimNextTask,
  getNextTask,
  getActiveWork,
  getTasksChangedSince,
  stealTask,
  claimOrSteal,
  getBlockingDeps,
  getStaleTasks,
} from "./task-lifecycle.js";

export type { ActiveWorkItem } from "./task-lifecycle.js";

export {
  addDependency,
  removeDependency,
  getTaskDependencies,
  getTaskDependents,
  cloneTask,
  getTaskGraph,
  moveTask,
} from "./task-graph.js";

export type { TaskGraphNode, TaskGraph } from "./task-graph.js";

export {
  getStatus,
  decomposeTasks,
  setTaskStatus,
  setTaskPriority,
  redistributeStaleTasks,
  getTaskStats,
} from "./task-status.js";

export type { StatusSummary, DecomposeSubtaskInput } from "./task-status.js";

export {
  bulkCreateTasks,
  bulkUpdateTasks,
  archiveTasks,
  unarchiveTask,
  getOverdueTasks,
  logTime,
  getTimeLogs,
  getTimeReport,
  watchTask,
  unwatchTask,
  getTaskWatchers,
  notifyWatchers,
  logCost,
} from "./task-relations.js";

export type { BulkCreateTaskInput, LogTimeInput } from "./task-relations.ts";

// Re-export types that were previously exported from this file
export type { TaskFilter } from "../types/index.js";
