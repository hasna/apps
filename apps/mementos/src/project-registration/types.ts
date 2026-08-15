export const MEMENTOS_PROJECT_REGISTRATION_ROUTE = "mementos.project-registration.v1" as const;
export const MEMENTOS_PROJECT_REGISTRATION_CALLER_ROUTE = "projects.full-registration.v1" as const;
export const MEMENTOS_PROJECT_REGISTRATION_SCHEMA_VERSION = 1 as const;
export const MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE =
  "mementos.project-guarded-update.v1" as const;
export const MEMENTOS_PROJECT_RESOURCE_ROUTE =
  "mementos.project-resources.v1" as const;
export const MEMENTOS_PROJECT_RESOURCE_KINDS = [
  "project",
  "knowledge",
  "memory",
  "session",
] as const;
export type MementosProjectResourceKind =
  (typeof MEMENTOS_PROJECT_RESOURCE_KINDS)[number];

export type MementosProjectRegistrationResourceKind = "project";
export type MementosProjectRegistrationDirection = "forward" | "inverse";
export type MementosProjectRegistrationOutcome =
  | "accepted"
  | "duplicate_of_accepted"
  | "terminal_nonacceptance";

export interface MementosProjectRegistrationBounds {
  response_byte_limit: number;
  time_budget_ms: number;
}

export interface MementosProjectRegistrationResponseControl
extends MementosProjectRegistrationBounds {
  response_bytes: number;
  elapsed_ms: number;
  complete: true;
  truncated: false;
}

export interface MementosProjectRegistrationCapability {
  authority: "mementos";
  route: typeof MEMENTOS_PROJECT_REGISTRATION_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  supported_resources: ["project"];
  supported_historical_lookup_identities:
    MementosProjectRegistrationHistoricalLookupIdentity[];
  conditional_create: true;
  immutable_receipts: true;
  exact_terminal_lookup: true;
  exact_readback: true;
  conditional_inverse: true;
  ambiguous_outcome_reconciliation: true;
  guarded_update: true;
  guarded_update_route: typeof MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE;
  no_write_dry_run: true;
  expected_revision_compare_and_swap: true;
  caller_idempotency: true;
  exact_inverse_rollback: true;
  project_resource_enumeration: true;
  project_resource_route: typeof MEMENTOS_PROJECT_RESOURCE_ROUTE;
  project_resource_kinds: ["project", "knowledge", "memory", "session"];
  stable_keyset_pagination: true;
  explicit_membership_only: true;
}

export interface MementosProjectRegistrationHistoricalLookupIdentity {
  source: {
    authority: "mementos";
    authority_route: typeof MEMENTOS_PROJECT_REGISTRATION_ROUTE;
    package_version: string;
    authority_id: string;
    tenant_id: string;
    corpus_id: string;
    operation_id: string;
    step_id: string;
    resource_kind: "project";
    direction: "forward";
    target_selector: string;
    target_id: string;
    idempotency_key: string;
    receipt_id: string;
  };
  destination: {
    authority_id: string;
    tenant_id: string;
    corpus_id: string;
  };
  lookup_only: true;
  immutable_receipt: true;
}

export interface MementosProjectResourceAuthority {
  authority: "mementos";
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  package_version: string;
}

export interface MementosProjectResource {
  authority: "mementos";
  source_package: "@hasna/mementos";
  project_id: string;
  resource_kind: MementosProjectResourceKind;
  stable_id: string;
  revision: string;
  digest: string;
  membership: "project_aggregate" | "explicit_project_id_or_focus";
}

export interface MementosProjectResourcePage {
  schema: typeof MEMENTOS_PROJECT_RESOURCE_ROUTE;
  authority: MementosProjectResourceAuthority;
  project_id: string;
  project_revision: string;
  collection_revision: string;
  resource_kinds: MementosProjectResourceKind[];
  resources: MementosProjectResource[];
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
  complete: true;
  truncated: false;
}

export interface MementosProjectResourceExactResult {
  schema: "mementos.project-resource.v1";
  authority: MementosProjectResourceAuthority;
  project_id: string;
  project_revision: string;
  collection_revision: string;
  resource: MementosProjectResource;
  complete: true;
  truncated: false;
}

export interface MementosProjectRegistrationReceipt {
  receipt_id: string;
  authority: "mementos";
  route: typeof MEMENTOS_PROJECT_REGISTRATION_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  resource_kind: "project";
  direction: MementosProjectRegistrationDirection;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: MementosProjectRegistrationOutcome;
  reason: string | null;
  target_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: boolean;
  created_at: string;
}

export interface MementosProjectRegistrationRecord {
  target_id: string;
  revision: string;
  digest: string;
}

export interface MementosProjectGuardedUpdateReceipt {
  receipt_id: string;
  authority: "mementos";
  route: typeof MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  direction: "forward" | "rollback";
  idempotency_key: string;
  request_digest: string;
  outcome: "accepted";
  target_id: string;
  expected_revision: string;
  result_revision: string;
  result_digest: string;
  accepted_receipt_id: string | null;
  created_at: string;
}

/**
 * Structural handle implemented by @hasna/projects. The absolute path can be
 * consumed by this authority but is never returned in a capability, receipt,
 * lookup, or exact-read response.
 */
export interface MementosProjectRegistrationPathHandle {
  withOwnedPath<T>(consumer: (absolutePath: string) => T): T;
}

export interface MementosProjectGuardedUpdateRequest
extends MementosProjectRegistrationBounds {
  authority: "mementos";
  authority_route: typeof MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  expected_revision: string;
  updates: {
    path: MementosProjectRegistrationPathHandle;
  };
}

export interface MementosProjectGuardedUpdateReceiptLookupRequest
extends MementosProjectRegistrationBounds {
  authority: "mementos";
  authority_route: typeof MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
}

export interface MementosProjectGuardedRollbackRequest
extends MementosProjectGuardedUpdateReceiptLookupRequest {
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  expected_revision: string;
  accepted_receipt: MementosProjectGuardedUpdateReceipt;
}

export interface MementosProjectGuardedUpdateResult {
  dry_run: false;
  applied: true;
  record: MementosProjectRegistrationRecord;
  receipt: MementosProjectGuardedUpdateReceipt;
  response_control: MementosProjectRegistrationResponseControl;
}

export interface MementosProjectGuardedUpdateReceiptLookupResult {
  receipt: MementosProjectGuardedUpdateReceipt;
  response_control: MementosProjectRegistrationResponseControl;
}

export interface MementosProjectRegistrationRequest
extends MementosProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: "project";
  direction: MementosProjectRegistrationDirection;
  authority_route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  target_selector: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  desired: Record<string, unknown>;
  target: MementosProjectRegistrationPathHandle;
  accepted_receipt?: MementosProjectRegistrationReceipt;
}

export interface MementosProjectRegistrationLookupRequest
extends MementosProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: "project";
  direction: MementosProjectRegistrationDirection;
  authority: "mementos";
  authority_route: string;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  target_selector: string;
  idempotency_key: string;
  target_id?: string;
  max_items: 1;
}

export interface MementosProjectRegistrationLookupResult {
  receipt: MementosProjectRegistrationReceipt;
  response_control: MementosProjectRegistrationResponseControl;
}

export interface MementosProjectRegistrationInverseVerification {
  target_id: string;
  accepted_receipt_id: string;
  absent: true;
  digest: string;
}

export interface MementosProjectRegistrationAuthority {
  readonly authority: "mementos";
  capability(): Promise<MementosProjectRegistrationCapability>;
  create(
    request: MementosProjectRegistrationRequest,
  ): Promise<MementosProjectRegistrationReceipt>;
  readExact(request: {
    resource_kind: "project";
    target_id: string;
    target: MementosProjectRegistrationPathHandle;
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<MementosProjectRegistrationRecord>;
  lookupReceipt(
    request: MementosProjectRegistrationLookupRequest,
  ): Promise<MementosProjectRegistrationLookupResult>;
  compensate(
    request: MementosProjectRegistrationRequest,
  ): Promise<MementosProjectRegistrationReceipt>;
  verifyInverse(
    request: MementosProjectRegistrationRequest,
  ): Promise<MementosProjectRegistrationInverseVerification>;
  guardedUpdateProject(
    targetId: string,
    request: MementosProjectGuardedUpdateRequest,
  ): Promise<MementosProjectGuardedUpdateResult>;
  getGuardedProjectUpdateReceipt(
    targetId: string,
    receiptId: string,
    request: MementosProjectGuardedUpdateReceiptLookupRequest,
  ): Promise<MementosProjectGuardedUpdateReceiptLookupResult>;
  rollbackGuardedProjectUpdate(
    targetId: string,
    request: MementosProjectGuardedRollbackRequest,
  ): Promise<MementosProjectGuardedUpdateResult>;
}

export type MementosProjectRegistrationFaultPoint =
  | "before_object_write"
  | "after_object_write"
  | "before_receipt_write"
  | "after_receipt_write"
  | "after_commit";

export interface MementosProjectRegistrationAuthorityOptions {
  packageVersion?: string;
  authorityId?: string;
  tenantId?: string;
  corpusId?: string;
  now?: () => string;
  faultInjector?: (
    point: MementosProjectRegistrationFaultPoint,
    context: {
      operation_id: string;
      step_id: string;
      resource_kind: "project";
      direction: MementosProjectRegistrationDirection;
    },
  ) => void;
}

export type MementosProjectRegistrationErrorCode =
  | "MEMENTOS_PROJECT_REGISTRATION_INVALID_INPUT"
  | "MEMENTOS_PROJECT_REGISTRATION_INVALID_BOUNDS"
  | "MEMENTOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE"
  | "MEMENTOS_PROJECT_REGISTRATION_TIME_BUDGET_EXCEEDED"
  | "MEMENTOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH"
  | "MEMENTOS_PROJECT_REGISTRATION_DIGEST_MISMATCH"
  | "MEMENTOS_PROJECT_REGISTRATION_IDEMPOTENCY_MISMATCH"
  | "MEMENTOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED"
  | "MEMENTOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND"
  | "MEMENTOS_PROJECT_REGISTRATION_RECORD_NOT_FOUND"
  | "MEMENTOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND"
  | "MEMENTOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE"
  | "MEMENTOS_PROJECT_REGISTRATION_CONFLICT";

export class MementosProjectRegistrationError extends Error {
  constructor(
    readonly code: MementosProjectRegistrationErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MementosProjectRegistrationError";
  }
}

export interface MementosProjectRegistrationHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

/** Private wire request used only between the package-owned HTTP client/server. */
export interface MementosProjectRegistrationWireRequest
extends Omit<MementosProjectRegistrationRequest, "target"> {
  canonical_path: string;
}

/** Private guarded-update wire request; the raw path is request-only. */
export interface MementosProjectGuardedUpdateWireRequest
extends Omit<MementosProjectGuardedUpdateRequest, "updates"> {
  target_id: string;
  updates: {
    path: string;
  };
}
