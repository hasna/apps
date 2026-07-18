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

export class ValidationError extends CodedError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
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
