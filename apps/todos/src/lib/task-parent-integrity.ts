import type { Task } from "../types/index.js";
import { ResourceConflictError, TaskNotFoundError } from "../types/index.js";

type TaskParentRecord = Pick<Task, "id" | "parent_id">;

function parentCycleError(taskId: string, parentId: string): ResourceConflictError {
  return new ResourceConflictError(
    "TASK_PARENT_CYCLE",
    `TASK_PARENT_CYCLE: assigning parent ${parentId} to task ${taskId} would create or retain a parent cycle`,
  );
}

/**
 * Validate a task parent assignment before a SQLite write.
 *
 * Parentage is intentionally independent of project/list routing: an existing
 * task in another project is valid. Only missing rows and cyclic ancestry are
 * rejected.
 */
export function assertTaskParentIntegrity(
  taskId: string,
  parentId: string | null | undefined,
  getTask: (id: string) => TaskParentRecord | null,
): void {
  if (parentId === undefined || parentId === null) return;

  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === taskId || visited.has(cursor)) {
      throw parentCycleError(taskId, parentId);
    }
    visited.add(cursor);
    const parent = getTask(cursor);
    if (!parent) throw new TaskNotFoundError(cursor);
    cursor = parent.parent_id;
  }
}

/** Async storage equivalent of {@link assertTaskParentIntegrity}. */
export async function assertTaskParentIntegrityAsync(
  taskId: string,
  parentId: string | null | undefined,
  getTask: (id: string) => Promise<TaskParentRecord | null>,
): Promise<void> {
  if (parentId === undefined || parentId === null) return;

  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === taskId || visited.has(cursor)) {
      throw parentCycleError(taskId, parentId);
    }
    visited.add(cursor);
    const parent = await getTask(cursor);
    if (!parent) throw new TaskNotFoundError(cursor);
    cursor = parent.parent_id;
  }
}
