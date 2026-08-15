import type { TaskHistory } from "../types/index.js";

export const AUDIT_HISTORY_DIVERGENT_REPLAY = "AUDIT_HISTORY_DIVERGENT_REPLAY";
export const AUDIT_HISTORY_TOMBSTONE_FORBIDDEN = "AUDIT_HISTORY_TOMBSTONE_FORBIDDEN";

const AUDIT_HISTORY_FIELDS = [
  "id",
  "task_id",
  "action",
  "field",
  "old_value",
  "new_value",
  "agent_id",
  "created_at",
  "machine_id",
] as const satisfies ReadonlyArray<keyof TaskHistory>;

export interface AuditHistoryImportFailure {
  code: typeof AUDIT_HISTORY_DIVERGENT_REPLAY | typeof AUDIT_HISTORY_TOMBSTONE_FORBIDDEN;
  auditHistoryId: string;
  conflict: boolean;
  status: 400 | 409;
}

export function auditHistoryRowsAreFieldIdentical(left: TaskHistory, right: TaskHistory): boolean {
  return AUDIT_HISTORY_FIELDS.every((field) => {
    const leftValue = field === "machine_id" ? left[field] ?? null : left[field];
    const rightValue = field === "machine_id" ? right[field] ?? null : right[field];
    return leftValue === rightValue;
  });
}

export function divergentAuditHistoryReplayError(id: string): string {
  return `${AUDIT_HISTORY_DIVERGENT_REPLAY}: immutable audit_history row ${id} differs from stored row`;
}

export function forbiddenAuditHistoryTombstoneError(id: string): string {
  return `${AUDIT_HISTORY_TOMBSTONE_FORBIDDEN}: audit_history tombstone ${id} is not allowed`;
}

export function parseAuditHistoryImportFailure(message: string): AuditHistoryImportFailure | null {
  const divergentPrefix = `${AUDIT_HISTORY_DIVERGENT_REPLAY}: immutable audit_history row `;
  const divergentSuffix = " differs from stored row";
  if (message.startsWith(divergentPrefix) && message.endsWith(divergentSuffix)) {
    return {
      code: AUDIT_HISTORY_DIVERGENT_REPLAY,
      auditHistoryId: message.slice(divergentPrefix.length, -divergentSuffix.length),
      conflict: true,
      status: 409,
    };
  }

  const tombstonePrefix = `${AUDIT_HISTORY_TOMBSTONE_FORBIDDEN}: audit_history tombstone `;
  const tombstoneSuffix = " is not allowed";
  if (message.startsWith(tombstonePrefix) && message.endsWith(tombstoneSuffix)) {
    return {
      code: AUDIT_HISTORY_TOMBSTONE_FORBIDDEN,
      auditHistoryId: message.slice(tombstonePrefix.length, -tombstoneSuffix.length),
      conflict: false,
      status: 400,
    };
  }

  return null;
}
