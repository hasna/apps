/**
 * Agent coordination — claim, steal, next task, active work, stale detection.
 * Re-exported from tasks.ts for backward compatibility.
 * Full extraction pending resolution of circular dependency (stealTask → getNextTask).
 */
export {
  getNextTask,
  claimNextTask,
  stealTask,
  claimOrSteal,
  getActiveWork,
  getStaleTasks,
  redistributeStaleTasks,
} from "./tasks.js";
