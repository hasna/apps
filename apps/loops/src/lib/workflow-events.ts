import type {
  AgentRoutingSpec,
  AgentSessionContract,
  PublicWorkflowEvent,
  StoredWorkflowEvent,
  WorkflowEvent,
  WorkflowLifecycleEventType,
} from "../types.js";
import { ValidationError } from "./errors.js";
import { isRedactionPlaceholder, scrubSecrets } from "./redact.js";

export const WORKFLOW_LIFECYCLE_EVENT_TYPES = [
  "created",
  "workflow_archived",
  "todos_workflow_pointers_synced",
  "todos_workflow_pointers_sync_failed",
  "step_started",
  "step_progress",
  "recovered",
  "step_pending",
  "step_running",
  "step_succeeded",
  "step_failed",
  "step_timed_out",
  "step_skipped",
  "step_cancelled",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
] as const satisfies readonly WorkflowLifecycleEventType[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isOptionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isRecord(value);
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

const SENSITIVE_CUSTOM_EVENT_KEYS = new Set(["env", "error", "prompt", "reason", "stderr", "stdout"]);
const BENIGN_CUSTOM_EVENT_KEY_NAMES = new Set(["dedupekey", "idempotencykey", "routekey"]);

function isSensitiveCustomEventKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (SENSITIVE_CUSTOM_EVENT_KEYS.has(normalized)) return true;
  if (BENIGN_CUSTOM_EVENT_KEY_NAMES.has(normalized)) return false;
  return normalized === "authorization" ||
    /(?:apikey|token|secret|password|passwd|passphrase|credential|credentials)$/.test(normalized);
}

function sanitizeCustomEventValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveCustomEventKey(key)) {
    if (typeof value === "string") {
      if (isRedactionPlaceholder(value)) return value;
      return `[redacted ${value.length} chars]`;
    }
    if (value === undefined || value === null) return value;
    return "[redacted]";
  }
  if (typeof value === "string") return scrubSecrets(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeCustomEventValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeCustomEventValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function sanitizeCustomEventPayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return payload === undefined
    ? undefined
    : sanitizeCustomEventValue(payload) as Record<string, unknown>;
}

function isAgentRoutingSpec(value: unknown): value is AgentRoutingSpec | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["projectPath", "projectGroup", "taskId", "eventId", "eventType", "eventSource", "role"])) {
    return false;
  }
  if (!["projectPath", "projectGroup", "taskId", "eventId", "eventType", "eventSource"].every((key) =>
    isOptionalString(value[key])
  )) return false;
  return value.role === undefined || isOneOf(value.role, ["triage", "planner", "worker", "verifier"] as const);
}

export function isAgentSessionContract(value: unknown): value is AgentSessionContract {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!hasOnlyKeys(value, [
    "version", "provider", "model", "cwd", "permissionMode", "sandbox", "manualBreakGlass",
    "routing", "timeoutMs", "restrictions", "safetyReason",
  ])) return false;
  if (!isOneOf(value.provider, ["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"] as const)) return false;
  if (!isOptionalString(value.model) || !isOptionalString(value.cwd) || !isOptionalNonEmptyString(value.safetyReason)) return false;
  if (!isOneOf(value.permissionMode, ["default", "plan", "auto", "bypass"] as const)) return false;
  if (!isOneOf(value.sandbox, ["read-only", "workspace-write", "danger-full-access", "enabled", "disabled", "provider-default"] as const)) return false;
  if (typeof value.manualBreakGlass !== "boolean") return false;
  if (value.timeoutMs !== null && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) <= 0)) return false;
  if (!isAgentRoutingSpec(value.routing) || !isRecord(value.restrictions)) return false;
  if (!hasOnlyKeys(value.restrictions, ["tools", "commands", "enforcement", "providerEnforced"])) return false;
  if (!isOptionalStringArray(value.restrictions.tools) || !isOptionalStringArray(value.restrictions.commands)) return false;
  return value.restrictions.enforcement === "metadata_only" && value.restrictions.providerEnforced === false;
}

export function isWorkflowLifecycleEventType(value: string): value is WorkflowLifecycleEventType {
  return WORKFLOW_LIFECYCLE_EVENT_TYPES.some((eventType) => eventType === value);
}

function isRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  // Reject leap-second `:60` deliberately: JavaScript cannot parse it without
  // normalization, so the public boundary accepts only timestamps it can
  // validate without silently changing their represented instant.
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(year, month - 1, day);
  calendarDay.setUTCHours(0, 0, 0, 0);
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

type WorkflowEventCandidate = StoredWorkflowEvent & { eventKind?: unknown };

function assertStoredWorkflowEvent(value: unknown): asserts value is WorkflowEventCandidate {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "workflowRunId", "sequence", "eventType", "eventKind", "stepId", "payload", "createdAt",
  ])) {
    throw new ValidationError("invalid workflow event envelope");
  }
  if (typeof value.id !== "string" || value.id.length === 0) throw new ValidationError("invalid workflow event id");
  if (typeof value.workflowRunId !== "string" || value.workflowRunId.length === 0) {
    throw new ValidationError("invalid workflow event workflowRunId");
  }
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1) {
    throw new ValidationError("invalid workflow event sequence");
  }
  if (typeof value.eventType !== "string" || value.eventType.length === 0) {
    throw new ValidationError("invalid workflow event type");
  }
  if (value.eventKind !== undefined && value.eventKind !== "custom") {
    throw new ValidationError("invalid workflow event kind");
  }
  if (value.stepId !== undefined && typeof value.stepId !== "string") {
    throw new ValidationError("invalid workflow event stepId");
  }
  if (!isOptionalRecord(value.payload)) throw new ValidationError("invalid workflow event payload");
  if (!isRfc3339DateTime(value.createdAt)) throw new ValidationError("invalid workflow event createdAt");
}

/** Validate a raw storage/API row before exposing the public discriminated union. */
export function publicWorkflowEvent(
  event: StoredWorkflowEvent | PublicWorkflowEvent,
): PublicWorkflowEvent {
  assertStoredWorkflowEvent(event);
  if (event.eventType === "agent_session_contract") {
    if (event.eventKind !== undefined || !event.stepId || !isAgentSessionContract(event.payload)) {
      throw new ValidationError("invalid agent_session_contract workflow event");
    }
    return {
      id: event.id,
      workflowRunId: event.workflowRunId,
      sequence: event.sequence,
      eventType: "agent_session_contract",
      stepId: event.stepId,
      payload: event.payload,
      createdAt: event.createdAt,
    };
  }
  if (isWorkflowLifecycleEventType(event.eventType)) {
    if (event.eventKind !== undefined) {
      throw new ValidationError(`invalid workflow event kind for ${event.eventType}`);
    }
    if (!isOptionalRecord(event.payload)) {
      throw new ValidationError(`invalid workflow event payload for ${event.eventType}`);
    }
    return {
      id: event.id,
      workflowRunId: event.workflowRunId,
      sequence: event.sequence,
      eventType: event.eventType,
      stepId: event.stepId,
      payload: event.payload,
      createdAt: event.createdAt,
    };
  }
  return {
    id: event.id,
    workflowRunId: event.workflowRunId,
    sequence: event.sequence,
    eventType: event.eventType,
    eventKind: "custom",
    stepId: event.stepId,
    payload: sanitizeCustomEventPayload(event.payload),
    createdAt: event.createdAt,
  };
}
