import type { Digest } from "./types"

/**
 * Safe adapter error codes. `integrity_failed` includes a trusted SDK/callback Promise contract
 * breach; it is a fail-closed adapter result, not a claim that an already-rejected hostile native
 * Promise can always be contained by the JavaScript host without executing its accessors.
 */
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
    super(code)
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

/** A trusted provider bridge may use this only when the effect outcome is definitive. */
export class DefinitiveProviderEffectError extends Error {
  override readonly name = "DefinitiveProviderEffectError"

  constructor(
    readonly outcome_kind: "failed_effect" | "failed_no_effect",
    readonly provider_receipt_sha256: Digest,
    readonly safe_code: Extract<AdapterErrorCodeV1, "provider_state_unknown" | "provider_unavailable" | "integrity_failed">,
  ) {
    super(safe_code)
  }
}
