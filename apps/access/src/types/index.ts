// Domain types, enums, and structured error classes for iapp-access.
//
// access = non-human-identity governance. Every record is anchored to a home
// entity (entity_id, an unguessable UUIDv4) and authorized against it.

export type IdentityKind = "agent" | "service" | "human";
export type IdentityStatus = "active" | "suspended" | "retired";
export type CredentialKind = "api_key" | "oauth" | "mcp_token" | "ssh_key" | "webhook_secret";
export type CredentialStatus = "active" | "revoked";
export type ScopeStatus = "granted" | "revoked";
export type ElevationStatus = "pending" | "active" | "expired" | "revoked";
export type ReviewStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type RevocationTarget = "credential" | "scope" | "identity" | "elevation" | "token";
export type TokenStatus = "active" | "revoked";
export type AccessRequestStatus = "pending" | "approved" | "provisioned" | "failed" | "cancelled";
export type AccessRequestPolicyDecision = "allow" | "deny" | "manual_review";

export interface Identity {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  kind: IdentityKind;
  name: string;
  owner_ref: string | null;
  status: IdentityStatus;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Credential {
  id: string;
  identity_id: string;
  entity_id: string;
  name: string;
  kind: CredentialKind;
  secret_ref: string;
  status: CredentialStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Scope {
  id: string;
  identity_id: string;
  entity_id: string;
  scope: string;
  status: ScopeStatus;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Elevation {
  id: string;
  identity_id: string;
  entity_id: string;
  scope: string;
  reason: string;
  approver: string | null;
  requested_by: string | null;
  expires_at: string;
  status: ElevationStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AccessReview {
  id: string;
  entity_id: string;
  name: string;
  status: ReviewStatus;
  scheduled_at: string;
  due_at: string | null;
  scope_filter: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Revocation {
  id: string;
  identity_id: string;
  entity_id: string;
  target_type: RevocationTarget;
  target_id: string | null;
  reason: string;
  actor: string | null;
  created_at: string;
}

export interface IssuedToken {
  id: string;
  jti: string;
  identity_id: string;
  entity_id: string;
  credential_id: string | null;
  scopes: string[];
  entity_ids: string[];
  token_hash: string;
  status: TokenStatus;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export type PublicIssuedToken = Omit<IssuedToken, "token_hash">;

export interface AccessRequest {
  id: string;
  entity_id: string;
  requested_by_identity_id: string;
  provider: string;
  resource_kind: string;
  resource_ref: string;
  status: AccessRequestStatus;
  policy_mode: string;
  policy_decision: AccessRequestPolicyDecision;
  policy_reason: string | null;
  decision_metadata: Record<string, unknown>;
  approved_by: string | null;
  approved_at: string | null;
  secret_ref: string;
  command_preview: Record<string, unknown>;
  provision_metadata: Record<string, unknown> | null;
  provisioned_at: string | null;
  provisioned_by: string | null;
  failure_reason: string | null;
  failed_at: string | null;
  failed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AuditEvent {
  id: number;
  entity_id: string | null;
  event_type: string;
  actor: string | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  row_hash: string;
  created_at: string;
}

// === Structured error classes ===
// Each carries a stable `code` and a static `suggestion` so CLI/MCP/API can
// emit an identical { code, message, suggestion } envelope (interface parity).

export class AccessError extends Error {
  readonly code: string = "INTERNAL_ERROR";
  readonly status: number = 500;
  static readonly suggestion: string = "";
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AccessError {
  override readonly code: string = "VALIDATION_ERROR";
  override readonly status: number = 400;
  static override readonly suggestion: string = "Check the required fields and value formats, then retry.";
}

export class NotFoundError extends AccessError {
  override readonly code: string = "NOT_FOUND";
  override readonly status: number = 404;
  static override readonly suggestion: string = "List the resource to find a valid id, then retry.";
}

export class IdentityNotFoundError extends NotFoundError {
  override readonly code: string = "IDENTITY_NOT_FOUND";
  static override readonly suggestion: string = "Use list_identities to find the correct identity id.";
  constructor(id: string) {
    super(`Identity not found: ${id}`);
  }
}

export class CredentialNotFoundError extends NotFoundError {
  override readonly code: string = "CREDENTIAL_NOT_FOUND";
  static override readonly suggestion: string = "Use list_credentials to find the correct credential id.";
  constructor(id: string) {
    super(`Credential not found: ${id}`);
  }
}

export class ScopeNotFoundError extends NotFoundError {
  override readonly code: string = "SCOPE_NOT_FOUND";
  static override readonly suggestion: string = "Use list_scopes to find the correct scope grant id.";
  constructor(id: string) {
    super(`Scope grant not found: ${id}`);
  }
}

export class ElevationNotFoundError extends NotFoundError {
  override readonly code: string = "ELEVATION_NOT_FOUND";
  static override readonly suggestion: string = "Use list_elevations to find the correct elevation id.";
  constructor(id: string) {
    super(`Elevation not found: ${id}`);
  }
}

export class ReviewNotFoundError extends NotFoundError {
  override readonly code: string = "REVIEW_NOT_FOUND";
  static override readonly suggestion: string = "Use list_reviews to find the correct access review id.";
  constructor(id: string) {
    super(`Access review not found: ${id}`);
  }
}

export class TokenNotFoundError extends NotFoundError {
  override readonly code: string = "TOKEN_NOT_FOUND";
  static override readonly suggestion: string = "Use list_tokens to find the correct token id.";
  constructor(id: string) {
    super(`Issued token not found: ${id}`);
  }
}

export class AccessRequestNotFoundError extends NotFoundError {
  override readonly code: string = "ACCESS_REQUEST_NOT_FOUND";
  static override readonly suggestion: string = "Use list_requests to find the correct access request id.";
  constructor(id: string) {
    super(`Access request not found: ${id}`);
  }
}

export class InvalidTransitionError extends AccessError {
  override readonly code: string = "INVALID_TRANSITION";
  override readonly status: number = 409;
  static override readonly suggestion: string = "The resource is not in a state that allows this action.";
}

export class VersionConflictError extends AccessError {
  override readonly code: string = "VERSION_CONFLICT";
  override readonly status: number = 409;
  static override readonly suggestion: string = "Re-read the record to get the latest version, then retry.";
  constructor(expected: number, actual: number) {
    super(`Version conflict: expected ${expected}, found ${actual}`);
  }
}

export class PermissionDeniedError extends AccessError {
  override readonly code: string = "PERMISSION_DENIED";
  override readonly status: number = 403;
  static override readonly suggestion: string = "The principal lacks the required scope or entity access.";
  constructor(action: string, resource?: string) {
    super(`Permission denied for ${action}${resource ? ` on ${resource}` : ""}`);
  }
}

export class TokenVerificationError extends AccessError {
  override readonly code: string = "TOKEN_INVALID";
  override readonly status: number = 401;
  static override readonly suggestion: string = "Re-issue a token via token issue; the presented token is invalid, expired, or revoked.";
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof AccessError) {
    return {
      code: error.code,
      message: error.message,
      suggestion: (error.constructor as typeof AccessError).suggestion ?? "",
    };
  }
  // Any error exposing a string `code` (and optional `suggestion`) — e.g. the
  // MCP write-confirmation error — normalizes to the same envelope.
  if (error instanceof Error && typeof (error as { code?: unknown }).code === "string") {
    const withExtras = error as Error & { code: string; suggestion?: unknown };
    return {
      code: withExtras.code,
      message: withExtras.message,
      suggestion: typeof withExtras.suggestion === "string" ? withExtras.suggestion : "",
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "INTERNAL_ERROR", message, suggestion: "" };
}

export function errorStatus(error: unknown): number {
  return error instanceof AccessError ? error.status : 500;
}
