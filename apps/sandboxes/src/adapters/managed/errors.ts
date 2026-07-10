export type AdapterErrorCodeV1 =
  | "validation_failed"
  | "unsupported_runtime_feature"
  | "dispatch_anchor_required"
  | "dispatch_anchor_mismatch"
  | "operation_target_mismatch"
  | "stale_resource_lifecycle_generation"
  | "stale_operation_execution_epoch"
  | "request_digest_mismatch"
  | "provider_state_unknown"
  | "provider_unavailable"
  | "dependency_unavailable"
  | "path_outside_workspace"
  | "path_normalization_failed"
  | "integrity_failed"
  | "output_limit_exceeded"
  | "cleanup_grant_mismatch"

export class AdapterContractError extends Error {
  override readonly name = "AdapterContractError"
  readonly code: AdapterErrorCodeV1
  readonly retryable: boolean
  readonly quarantine_required: boolean

  constructor(
    code: AdapterErrorCodeV1,
    options: { retryable?: boolean; quarantineRequired?: boolean; cause?: unknown } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    this.retryable = options.retryable ?? false
    this.quarantine_required = options.quarantineRequired ?? false
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
      quarantine_required: this.quarantine_required,
    }
  }
}

export function adapterError(
  code: AdapterErrorCodeV1,
  options?: { retryable?: boolean; quarantineRequired?: boolean; cause?: unknown },
): AdapterContractError {
  return new AdapterContractError(code, options)
}
