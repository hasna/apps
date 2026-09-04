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

export class LoopAdvancementConflictError extends CodedError {
  constructor(loopId: string, runId: string) {
    super(
      "LOOP_ADVANCEMENT_CONFLICT",
      `loop advancement conflict after bounded retry: loop=${loopId} run=${runId}`,
    );
  }
}

export class LoopMutationConflictError extends CodedError {
  constructor(readonly reason: "revision_mismatch" | "binding_mismatch" | "lease_conflict", targetId: string) {
    super("LOOP_MUTATION_CONFLICT", `loop mutation conflict: ${targetId} (${reason})`);
  }
}

export type RunFinalizationConflictReason = "stale_claim" | "run_not_running";

export class RunFinalizationConflictError extends CodedError {
  constructor(
    readonly reason: RunFinalizationConflictReason,
    runId: string,
  ) {
    super("RUN_FINALIZATION_CONFLICT", `run finalization lost its transition: ${runId} (${reason})`);
  }
}

/**
 * The bundle namespace key is already held by another loop in this tenant.
 *
 * A conflict rather than a takeover: loop names are not unique, so two loops
 * can legitimately both want to be called `pr-drain` — but only one of them can
 * own the S3 prefix and the CLI argument, and the loser silently pushing into
 * the winner's version history would be unrecoverable.
 */
export class BundleNameTakenError extends CodedError {
  constructor(bundleName: string, holderLoopId: string) {
    super("BUNDLE_NAME_TAKEN", `bundle name '${bundleName}' already belongs to loop ${holderLoopId}`);
  }
}

export class LoopVersionNotFoundError extends CodedError {
  constructor(loopId: string, version: number | string) {
    super("LOOP_VERSION_NOT_FOUND", `loop ${loopId} has no bundle version ${version}`);
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

export function publicValidationDetails(value: unknown): Readonly<PublicValidationDetails> | undefined {
  if (!value || typeof value !== "object") return undefined;
  let code: unknown;
  let reason: unknown;
  let path: unknown;
  let index: unknown;
  let option: unknown;
  try {
    const candidate = value as Record<string, unknown>;
    // Capture every allowed primitive exactly once. Validation and projection
    // below use only these locals, never caller-controlled getters again.
    code = candidate.code;
    reason = candidate.reason;
    path = candidate.path;
    index = candidate.index;
    option = candidate.option;
  } catch {
    return undefined;
  }
  if (
    code !== "agent_extra_args_invalid" ||
    typeof reason !== "string" ||
    !AGENT_EXTRA_ARGS_VALIDATION_REASONS.has(reason) ||
    typeof path !== "string" ||
    path.length > 512 ||
    !PUBLIC_VALIDATION_PATH.test(path) ||
    (index !== undefined && (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)) ||
    (option !== undefined && (typeof option !== "string" || !PUBLIC_VALIDATION_OPTION.test(option)))
  ) {
    return undefined;
  }
  const indexedReason = reason === "invalid_item" || reason === "option_not_allowed";
  if (indexedReason !== (index !== undefined)) return undefined;
  if (index === undefined) {
    if (!path.endsWith(".extraArgs")) return undefined;
  } else if (!path.endsWith(`.extraArgs[${index}]`)) {
    return undefined;
  }
  if (option !== undefined && reason !== "option_not_allowed") return undefined;
  return Object.freeze({
    code,
    reason: reason as AgentExtraArgsValidationReason,
    path,
    ...(index === undefined ? {} : { index: index as number }),
    ...(option === undefined ? {} : { option: option as string }),
  });
}

export class ValidationError extends CodedError {
  declare readonly publicDetails?: Readonly<PublicValidationDetails>;

  constructor(message: string, publicDetails?: PublicValidationDetails) {
    super("VALIDATION_ERROR", message);
    // Treat even internal callers as untrusted at the public API boundary:
    // project only the closed, validated field set and silently hide anything
    // malformed instead of ever echoing Error.message or arbitrary metadata.
    const projected = publicValidationDetails(publicDetails);
    Object.defineProperty(this, "publicDetails", {
      configurable: false,
      enumerable: false,
      value: projected,
      writable: false,
    });
  }
}

/** Safely capture and re-project even forged/subclass validation errors. */
export function validationErrorPublicDetails(error: ValidationError): Readonly<PublicValidationDetails> | undefined {
  try {
    return publicValidationDetails(error.publicDetails);
  } catch {
    return undefined;
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

export class WorkflowRunHasLiveStepsError extends CodedError {
  constructor() {
    super(
      "WORKFLOW_RUN_HAS_LIVE_STEPS",
      "workflow run cannot be recovered while step processes are still alive",
    );
  }
}

export class WorkflowRunStepOwnershipUnverifiableError extends CodedError {
  constructor() {
    super(
      "WORKFLOW_RUN_STEP_OWNERSHIP_UNVERIFIABLE",
      "workflow run recovery ownership could not be verified",
    );
  }
}

export class WorkflowRunNotRunningError extends CodedError {
  constructor() {
    super(
      "WORKFLOW_RUN_NOT_RUNNING",
      "workflow run can only be recovered while it is running",
    );
  }
}
