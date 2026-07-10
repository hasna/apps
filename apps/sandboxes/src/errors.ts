export const SANDBOX_ERROR_CODES = [
  "validation_failed",
  "protocol_incompatible",
  "not_found",
  "forbidden",
  "policy_denied",
  "idempotency_key_reused",
  "stale_revision",
  "stale_file_digest",
  "stale_lease_epoch",
  "stale_resource_lifecycle_generation",
  "stale_operation_execution_epoch",
  "authority_epoch_mismatch",
  "lease_expired",
  "capability_denied",
  "capability_replayed",
  "request_digest_mismatch",
  "sandbox_not_active",
  "exec_not_running",
  "unsupported_runtime_feature",
  "resource_limit_exceeded",
  "capacity_unavailable",
  "path_outside_workspace",
  "path_normalization_failed",
  "symlink_escape",
  "unsafe_file_type",
  "integrity_failed",
  "checkpoint_not_quiescent",
  "checkpoint_not_durable",
  "activation_receipt_required",
  "cleanup_grant_required",
  "cleanup_grant_mismatch",
  "cleanup_receipt_mismatch",
  "provider_state_unknown",
  "provider_unavailable",
  "dependency_unavailable",
  "cursor_expired",
  "output_limit_exceeded",
  "internal_failure"
] as const;

export type SandboxErrorCode = (typeof SANDBOX_ERROR_CODES)[number];

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: SandboxErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    this.details = details;
  }
}

export function asSandboxError(error: unknown): SandboxError {
  if (error instanceof SandboxError) return error;
  return new SandboxError("internal_failure", "The operation failed internally");
}

export function exitCodeFor(error: SandboxError): number {
  switch (error.code) {
    case "validation_failed":
      return 2;
    case "protocol_incompatible":
      return 12;
    case "not_found":
      return 5;
    case "forbidden":
    case "policy_denied":
    case "capability_denied":
    case "capability_replayed":
      return 4;
    case "idempotency_key_reused":
    case "stale_revision":
    case "stale_file_digest":
    case "stale_lease_epoch":
    case "stale_resource_lifecycle_generation":
    case "stale_operation_execution_epoch":
    case "authority_epoch_mismatch":
    case "request_digest_mismatch":
      return 6;
    case "sandbox_not_active":
    case "exec_not_running":
    case "checkpoint_not_quiescent":
    case "checkpoint_not_durable":
    case "activation_receipt_required":
    case "cleanup_grant_required":
    case "cleanup_grant_mismatch":
    case "cleanup_receipt_mismatch":
    case "provider_state_unknown":
      return 7;
    case "unsupported_runtime_feature":
    case "resource_limit_exceeded":
    case "capacity_unavailable":
      return 8;
    case "provider_unavailable":
    case "dependency_unavailable":
      return 9;
    case "integrity_failed":
    case "path_outside_workspace":
    case "path_normalization_failed":
    case "symlink_escape":
    case "unsafe_file_type":
      return 13;
    default:
      return 14;
  }
}
