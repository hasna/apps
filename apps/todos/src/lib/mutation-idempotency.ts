import { createHash } from "node:crypto";

/**
 * Derive a stable UUID-shaped record id for a retried task sub-resource write.
 *
 * The opaque request key is hashed rather than persisted. Including both the
 * resource kind and task id keeps a caller that reuses one key from colliding
 * across projects, tasks, comments, and verification evidence.
 */
export function taskMutationRecordId(
  resource: "comment" | "verification",
  taskId: string,
  requestId: string | undefined,
): string | undefined {
  if (!requestId) return undefined;
  const hex = createHash("sha256")
    .update("todos-task-mutation-v1\0")
    .update(resource)
    .update("\0")
    .update(taskId)
    .update("\0")
    .update(requestId)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
