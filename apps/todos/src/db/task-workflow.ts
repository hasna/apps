/**
 * Task workflow operations — start, complete, fail, lock/unlock, approve.
 * Re-exported from tasks.ts for backward compatibility.
 * Full extraction pending resolution of circular dependency (completeTask → createTask).
 */
export {
  startTask,
  completeTask,
  failTask,
  lockTask,
  unlockTask,
  approveTask,
  getBlockingDeps,
} from "./tasks.js";
