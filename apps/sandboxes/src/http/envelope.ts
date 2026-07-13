/**
 * HTTP response envelope shared by the /v1 API. The shape mirrors the CLI
 * envelope so a client can treat CLI-over-stdin and API-over-HTTP identically.
 */
import { nowRfc3339 } from "../canonical.js";
import { SandboxError, type SandboxErrorCode } from "../errors.js";
import { SCHEMA_VERSION, type SchemaVersion } from "../types.js";

export interface Envelope {
  schema_version: SchemaVersion;
  ok: boolean;
  request_id: string;
  operation: string;
  server_time: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details: Readonly<Record<string, string | number | boolean>>;
  };
  warnings: string[];
  next_actions: Array<{ action: string }>;
}

/** Server-layer error that carries an explicit HTTP status (auth/routing). */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
  constructor(
    status: number,
    code: string,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function requestId(): string {
  return `request_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function successEnvelope(operation: string, data: unknown): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    ok: true,
    request_id: requestId(),
    operation,
    server_time: nowRfc3339(),
    data,
    warnings: [],
    next_actions: [],
  };
}

export function errorEnvelope(
  operation: string,
  code: string,
  message: string,
  details: Readonly<Record<string, string | number | boolean>> = {},
): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    ok: false,
    request_id: requestId(),
    operation,
    server_time: nowRfc3339(),
    error: { code, message, details },
    warnings: [],
    next_actions: [],
  };
}

/** Map a domain SandboxError code to an HTTP status. */
export function statusForSandboxError(code: SandboxErrorCode): number {
  switch (code) {
    case "validation_failed":
    case "protocol_incompatible":
    case "request_digest_mismatch":
      return 400;
    case "not_found":
      return 404;
    case "forbidden":
    case "policy_denied":
    case "capability_denied":
    case "capability_replayed":
    case "activation_receipt_required":
    case "cleanup_grant_required":
    case "cleanup_grant_mismatch":
      return 403;
    case "idempotency_key_reused":
    case "stale_revision":
    case "stale_file_digest":
    case "stale_lease_epoch":
    case "stale_resource_lifecycle_generation":
    case "stale_operation_execution_epoch":
    case "authority_epoch_mismatch":
    case "sandbox_not_active":
    case "exec_not_running":
    case "checkpoint_not_quiescent":
    case "checkpoint_not_durable":
      return 409;
    case "resource_limit_exceeded":
    case "capacity_unavailable":
    case "output_limit_exceeded":
      return 429;
    case "provider_unavailable":
    case "dependency_unavailable":
    case "provider_state_unknown":
      return 503;
    default:
      return 500;
  }
}

/** Normalize any thrown value into { status, envelope }. */
export function toErrorResponse(operation: string, error: unknown): { status: number; envelope: Envelope } {
  if (error instanceof HttpError) {
    return { status: error.status, envelope: errorEnvelope(operation, error.code, error.message, error.details) };
  }
  if (error instanceof SandboxError) {
    return {
      status: statusForSandboxError(error.code),
      envelope: errorEnvelope(operation, error.code, error.message, error.details),
    };
  }
  return { status: 500, envelope: errorEnvelope(operation, "internal_failure", "The operation failed internally") };
}
