/**
 * Coded errors thrown by the store and CLI layers. Each class carries a stable
 * machine-readable `.code` so callers can branch on failure kind without
 * parsing human-readable messages.
 */
export class CodedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class LoopNotFoundError extends CodedError {
  constructor(idOrName: string) {
    super("LOOP_NOT_FOUND", `loop not found: ${idOrName}`);
  }
}

export class LoopArchivedError extends CodedError {
  constructor(idOrName: string) {
    super("LOOP_ARCHIVED", `loop is archived: ${idOrName}; unarchive it before modifying`);
  }
}

export class AmbiguousNameError extends CodedError {
  constructor(name: string) {
    super("AMBIGUOUS_NAME", `ambiguous loop name: ${name}; use a loop id`);
  }
}

export type AgentExtraArgsValidationReason =
  | "not_array"
  | "invalid_array"
  | "invalid_item"
  | "option_not_allowed";

/**
 * Deliberately public, bounded validation metadata. API boundaries may expose
 * this object, but must never expose the accompanying Error.message.
 */
export interface PublicValidationDetails {
  code: "agent_extra_args_invalid";
  reason: AgentExtraArgsValidationReason;
  path: string;
  index?: number;
  option?: string;
}

const AGENT_EXTRA_ARGS_VALIDATION_REASONS: ReadonlySet<string> = new Set([
  "not_array",
  "invalid_array",
  "invalid_item",
  "option_not_allowed",
]);
const PUBLIC_VALIDATION_PATH = /^[A-Za-z][A-Za-z0-9_-]*(?:(?:\[\d+\])|(?:\.[A-Za-z][A-Za-z0-9_-]*))*$/;
const PUBLIC_VALIDATION_OPTION = /^(?:--[A-Za-z0-9][A-Za-z0-9-]{0,63}|-[A-Za-z0-9])$/;

function boundedPublicValidationDetails(value: PublicValidationDetails): Readonly<PublicValidationDetails> | undefined {
  if (
    value.code !== "agent_extra_args_invalid" ||
    !AGENT_EXTRA_ARGS_VALIDATION_REASONS.has(value.reason) ||
    typeof value.path !== "string" ||
    value.path.length > 512 ||
    !PUBLIC_VALIDATION_PATH.test(value.path) ||
    (value.index !== undefined && (!Number.isSafeInteger(value.index) || value.index < 0)) ||
    (value.option !== undefined && (typeof value.option !== "string" || !PUBLIC_VALIDATION_OPTION.test(value.option)))
  ) {
    return undefined;
  }
  if (
    (["invalid_item", "option_not_allowed"] as AgentExtraArgsValidationReason[]).includes(value.reason) !==
      (value.index !== undefined)
  ) {
    return undefined;
  }
  if (["not_array", "invalid_array"].includes(value.reason) && value.option !== undefined) return undefined;
  return Object.freeze({
    code: value.code,
    reason: value.reason,
    path: value.path,
    ...(value.index === undefined ? {} : { index: value.index }),
    ...(value.option === undefined ? {} : { option: value.option }),
  });
}

export class ValidationError extends CodedError {
  readonly publicDetails?: Readonly<PublicValidationDetails>;

  constructor(message: string, publicDetails?: PublicValidationDetails) {
    super("VALIDATION_ERROR", message);
    // Treat even internal callers as untrusted at the public API boundary:
    // project only the closed, validated field set and silently hide anything
    // malformed instead of ever echoing Error.message or arbitrary metadata.
    this.publicDetails = publicDetails ? boundedPublicValidationDetails(publicDetails) : undefined;
  }
}

export class DuplicateWorkflowEventError extends CodedError {
  constructor(workflowRunId: string, eventType: string, stepId?: string) {
    super(
      "DUPLICATE_WORKFLOW_EVENT",
      `workflow event already exists: run=${workflowRunId} type=${eventType} step=${stepId ?? "-"}`,
    );
  }
}

export class LegacyWorkflowRunProvenanceError extends CodedError {
  constructor(workflowRunId: string) {
    super(
      "WORKFLOW_RUN_PROVENANCE_MISSING",
      `workflow run idempotency provenance is missing: ${workflowRunId}; legacy runs must be restarted with a new idempotency key`,
    );
  }
}

export class WorkflowRunDefinitionConflictError extends CodedError {
  constructor(workflowRunId: string) {
    super(
      "WORKFLOW_RUN_DEFINITION_CONFLICT",
      `workflow run idempotency definition conflict: ${workflowRunId}; the creating workflow definition differs`,
    );
  }
}
