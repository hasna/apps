import {
  StaleLockHandoffError,
  isTerminalStatus,
  type StaleLockHandoffInput,
  type StaleLockHandoffReceipt,
  type Task,
  type TaskHistory,
} from "../types/index.js";
import { canonicalAgentRef } from "./creator-identity.js";
import { sanitizePreWriteText } from "./prewrite-secrets.js";

export const STALE_LOCK_HANDOFF_SCHEMA_VERSION = "todos.stale-lock-handoff.v1" as const;
export const STALE_LOCK_HANDOFF_ACTION = "stale_lock_handoff";
export const STALE_LOCK_HANDOFF_FIELD = "lock";

const EXACT_TASK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_LOCK_VERSION_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REASON_LENGTH = 4_096;

export interface PreparedStaleLockHandoff extends StaleLockHandoffInput {
  task_id: string;
  actor: string;
  expected_holder: string;
  expected_lock_version: string;
  new_holder: string;
  reason: string;
  operation_timestamp: string;
  stale_cutoff: string;
  receipt_id: string;
}

export function normalizeExactTaskId(value: unknown): string {
  if (typeof value !== "string" || !EXACT_TASK_UUID_RE.test(value.trim())) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_TASK_ID",
      "stale-lock handoff requires one exact full task UUID",
      { task_id: typeof value === "string" ? value : null },
    );
  }
  return value.trim().toLowerCase();
}

function requireNonEmptyString(
  value: unknown,
  field: "actor" | "expected_holder" | "new_holder" | "reason",
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      `${field} must be a non-empty string`,
      { field },
    );
  }
  const trimmed = value.trim();
  if (field === "reason" && trimmed.length > MAX_REASON_LENGTH) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      `reason must be at most ${MAX_REASON_LENGTH} characters`,
      { field, max_length: MAX_REASON_LENGTH },
    );
  }
  return trimmed;
}

function requireCanonicalLockVersion(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_LOCK_VERSION_RE.test(value)) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      "expected_lock_version must be the exact canonical locked_at timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)",
      { field: "expected_lock_version" },
    );
  }
  const parsed = Date.parse(value);
  // PostgreSQL timestamptz has no year zero, although JavaScript Date accepts it.
  if (value.startsWith("0000-")
      || Number.isNaN(parsed)
      || new Date(parsed).toISOString() !== value) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      "expected_lock_version must name a real canonical UTC instant",
      { field: "expected_lock_version" },
    );
  }
  return value;
}

function requireStaleThreshold(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      "stale_after_seconds must be a positive safe integer",
      { field: "stale_after_seconds" },
    );
  }
  return Number(value);
}

export function prepareStaleLockHandoff(
  input: StaleLockHandoffInput,
  options: { now?: string; receiptId?: string } = {},
): PreparedStaleLockHandoff {
  const taskId = normalizeExactTaskId(input.task_id);
  const actor = requireNonEmptyString(input.actor, "actor");
  const expectedHolder = requireNonEmptyString(input.expected_holder, "expected_holder");
  const newHolder = requireNonEmptyString(input.new_holder, "new_holder");
  const expectedLockVersion = requireCanonicalLockVersion(input.expected_lock_version);
  const staleAfterSeconds = requireStaleThreshold(input.stale_after_seconds);
  const reason = sanitizePreWriteText(
    requireNonEmptyString(input.reason, "reason"),
    "stale_lock_handoff.reason",
  ).trim();
  if (!reason) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      "reason must remain non-empty after safety filtering",
      { field: "reason" },
    );
  }
  if (canonicalAgentRef(actor) !== canonicalAgentRef(newHolder)) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_ACTOR_MISMATCH",
      "new_holder must match the authenticated actor",
      { actor, new_holder: newHolder },
    );
  }
  const operationTimestamp = options.now ?? new Date().toISOString();
  if (!CANONICAL_LOCK_VERSION_RE.test(operationTimestamp)
      || new Date(Date.parse(operationTimestamp)).toISOString() !== operationTimestamp) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_INVALID_INPUT",
      "operation timestamp must be a canonical UTC instant",
    );
  }
  const staleCutoff = new Date(
    Date.parse(operationTimestamp) - staleAfterSeconds * 1_000,
  ).toISOString();

  return {
    task_id: taskId,
    actor,
    expected_holder: expectedHolder,
    expected_lock_version: expectedLockVersion,
    stale_after_seconds: staleAfterSeconds,
    new_holder: newHolder,
    reason,
    operation_timestamp: operationTimestamp,
    stale_cutoff: staleCutoff,
    receipt_id: options.receiptId ?? crypto.randomUUID(),
  };
}

export function buildStaleLockHandoffReceipt(
  input: PreparedStaleLockHandoff,
): StaleLockHandoffReceipt {
  return {
    schema_version: STALE_LOCK_HANDOFF_SCHEMA_VERSION,
    receipt_id: input.receipt_id,
    task_id: input.task_id,
    actor: input.actor,
    previous_holder: input.expected_holder,
    previous_lock_version: input.expected_lock_version,
    new_holder: input.new_holder,
    new_lock_version: input.operation_timestamp,
    stale_after_seconds: input.stale_after_seconds,
    stale_cutoff: input.stale_cutoff,
    reason: input.reason,
    created_at: input.operation_timestamp,
  };
}

export function staleLockHandoffHistory(
  receipt: StaleLockHandoffReceipt,
  machineId: string | null,
): TaskHistory {
  return {
    id: receipt.receipt_id,
    task_id: receipt.task_id,
    action: STALE_LOCK_HANDOFF_ACTION,
    field: STALE_LOCK_HANDOFF_FIELD,
    old_value: JSON.stringify({
      holder: receipt.previous_holder,
      lock_version: receipt.previous_lock_version,
    }),
    new_value: JSON.stringify(receipt),
    agent_id: receipt.actor,
    created_at: receipt.created_at,
    machine_id: machineId,
  };
}

export function receiptFromStaleLockHandoffHistory(
  history: TaskHistory,
): StaleLockHandoffReceipt | null {
  if (history.action !== STALE_LOCK_HANDOFF_ACTION || !history.new_value) return null;
  try {
    const value = JSON.parse(history.new_value) as Partial<StaleLockHandoffReceipt>;
    if (value.schema_version !== STALE_LOCK_HANDOFF_SCHEMA_VERSION) return null;
    if (value.receipt_id !== history.id || value.task_id !== history.task_id) return null;
    return value as StaleLockHandoffReceipt;
  } catch {
    return null;
  }
}

export function throwStaleLockHandoffConflict(
  task: Task,
  input: Pick<
    PreparedStaleLockHandoff,
    "task_id" | "expected_holder" | "expected_lock_version" | "stale_cutoff"
  >,
): never {
  if (!task.locked_by || !task.locked_at) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_NOT_LOCKED",
      `Task ${input.task_id} does not have a complete lock to hand off`,
      { task_id: input.task_id },
    );
  }
  if (task.locked_at !== input.expected_lock_version) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_VERSION_MISMATCH",
      `Task ${input.task_id} lock version changed`,
      {
        task_id: input.task_id,
        expected_lock_version: input.expected_lock_version,
        current_lock_version: task.locked_at,
      },
    );
  }
  if (task.locked_by !== input.expected_holder) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_HOLDER_MISMATCH",
      `Task ${input.task_id} lock holder changed`,
      {
        task_id: input.task_id,
        expected_holder: input.expected_holder,
        current_holder: task.locked_by,
      },
    );
  }
  if (isTerminalStatus(task.status)) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_TERMINAL",
      `Task ${input.task_id} is ${task.status} and cannot transfer a lock`,
      { task_id: input.task_id, status: task.status },
    );
  }
  if (task.locked_at >= input.stale_cutoff) {
    throw new StaleLockHandoffError(
      "STALE_LOCK_HANDOFF_NOT_STALE",
      `Task ${input.task_id} lock is not older than the supplied stale threshold`,
      {
        task_id: input.task_id,
        current_lock_version: task.locked_at,
        stale_cutoff: input.stale_cutoff,
      },
    );
  }
  throw new StaleLockHandoffError(
    "STALE_LOCK_HANDOFF_CONFLICT",
    `Task ${input.task_id} changed during stale-lock handoff`,
    { task_id: input.task_id },
  );
}
