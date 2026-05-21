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
  getTaskLockStatus,
  claimNextTask,
  getNextTask,
  getActiveWork,
  getTasksChangedSince,
  stealTask,
  claimOrSteal,
  getBlockingDeps,
  getStaleTasks,
} from "./task-lifecycle.js";

export type { ActiveWorkItem, StaleTaskQuery, TaskLockStatus } from "./task-lifecycle.js";

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
  bulkDeleteTasks,
  archiveTasks,
  archiveCompletedTasks,
  getArchivedTasks,
  unarchiveTask,
  getOverdueTasks,
  getEscalatedTasks,
  notifyUpcomingDeadlines,
  getBlockedTasks,
  getBlockingTasks,
  logTime,
  getTimeLogs,
  getTimeReport,
  startFocusSession,
  getFocusSession,
  listFocusSessions,
  pauseFocusSession,
  resumeFocusSession,
  stopFocusSession,
  getIdleFocusSessionPrompts,
  watchTask,
  unwatchTask,
  getTaskWatchers,
  notifyWatchers,
  logCost,
} from "./task-relations.js";

export type {
  BulkCreateTaskInput,
  EscalatedTask,
  FocusSessionQuery,
  IdleFocusSessionPrompt,
  LogTimeInput,
  StartFocusSessionInput,
  StopFocusSessionInput,
  TimeReportEntry,
} from "./task-relations.ts";

export {
  buildTaskBoardSnapshot,
  createTaskBoard,
  deleteTaskBoard,
  exportTaskBoardBundle,
  getTaskBoard,
  importTaskBoardBundle,
  listTaskBoards,
  moveBoardCard,
  renderTaskBoard,
  updateTaskBoard,
} from "./boards.js";

export type {
  CreateTaskBoardInput,
  MoveBoardCardInput,
  TaskBoardBundle,
  TaskBoardQuery,
  UpdateTaskBoardInput,
} from "./boards.ts";

export {
  createCalendarItem,
  exportCalendarIcs,
  getCalendarItem,
  importCalendarIcs,
  listCalendarEvents,
  listCalendarItems,
} from "./calendar.js";

export type {
  CalendarQuery,
  CreateCalendarItemInput,
  IcsExportOptions,
  IcsImportResult,
} from "./calendar.ts";

// Re-export types that were previously exported from this file
export type { TaskFilter } from "../types/index.js";
