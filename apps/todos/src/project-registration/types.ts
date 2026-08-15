import type { Project, TaskList } from "../types/index.js";

export const TODOS_PROJECT_REGISTRATION_ROUTE = "todos.project-registration.v1" as const;
export const TODOS_PROJECT_REGISTRATION_CALLER_ROUTE = "projects.full-registration.v1" as const;
export const TODOS_PROJECT_REGISTRATION_SCHEMA_VERSION = 1 as const;

export type TodosProjectRegistrationResourceKind = "project" | "task_list";
export type TodosProjectResourceKind =
  | TodosProjectRegistrationResourceKind
  | "plan"
  | "task";
export type TodosProjectResourceScope = "collection" | "resource";
export type TodosProjectRegistrationDirection = "forward" | "inverse";
export type TodosProjectRegistrationOutcome =
  | "accepted"
  | "duplicate_of_accepted"
  | "terminal_nonacceptance";

export interface TodosProjectRegistrationBounds {
  response_byte_limit: number;
  time_budget_ms: number;
}

export interface TodosProjectRegistrationResponseControl extends TodosProjectRegistrationBounds {
  response_bytes: number;
  elapsed_ms: number;
  complete: true;
  truncated: false;
}

export interface TodosProjectRegistrationCapability {
  authority: "todos";
  route: typeof TODOS_PROJECT_REGISTRATION_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  supported_resources: TodosProjectRegistrationResourceKind[];
  conditional_create: true;
  immutable_receipts: true;
  exact_terminal_lookup: true;
  exact_readback: true;
  bind_existing_adoption: true;
  prior_registration_adoption_validation: true;
  project_resource_enumeration: true;
  project_resource_page_limit: number;
  conditional_inverse: true;
  ambiguous_outcome_reconciliation: true;
}

export interface TodosProjectRegistrationReceipt {
  receipt_id: string;
  authority: "todos";
  route: typeof TODOS_PROJECT_REGISTRATION_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  resource_kind: TodosProjectRegistrationResourceKind;
  direction: TodosProjectRegistrationDirection;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  outcome: TodosProjectRegistrationOutcome;
  reason: string | null;
  target_id: string | null;
  result_revision: string | null;
  result_digest: string | null;
  duplicate_of_receipt_id: string | null;
  accepted_receipt_id: string | null;
  created_by_operation: boolean;
  created_at: string;
}

export interface TodosProjectRegistrationRecord {
  target_id: string;
  revision: string;
  digest: string;
}

export type TodosPriorRegistrationAdoptionCurrentRecord = Project | TaskList;

export interface TodosPriorRegistrationAdoptionValidation {
  valid: true;
  resource_kind: TodosProjectRegistrationResourceKind;
  target_id: string;
  source_receipt_id: string;
  accepted_receipt_id: string;
  source_outcome: "accepted" | "duplicate_of_accepted";
  created_at: string;
  current_revision: string;
  accepted_result_digest: string;
}

export interface TodosPriorRegistrationAdoptionValidationRequest {
  source_request: TodosProjectRegistrationRequest;
  source_receipt: TodosProjectRegistrationReceipt;
  current_record: TodosPriorRegistrationAdoptionCurrentRecord;
}

export interface TodosProjectRegistrationRequest extends TodosProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: TodosProjectRegistrationResourceKind;
  direction: TodosProjectRegistrationDirection;
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
  /**
   * Adopt a deterministic, exact-path/slug match instead of creating it.
   * Adopted receipts are explicitly not owned by the operation and therefore
   * cannot be compensated.
   */
  bind_existing?: boolean;
  /**
   * The Projects package supplies an opaque path handle. Todos deliberately
   * does not inspect or serialize it: the registered Todos project uses a
   * stable package-owned URI keyed by the complete Projects workspace id.
   */
  target: unknown;
  accepted_receipt?: TodosProjectRegistrationReceipt;
}

export interface TodosProjectResource {
  source_project_id: string;
  kind: TodosProjectResourceKind;
  scope: TodosProjectResourceScope;
  target_id: string;
  parent_id: string | null;
  revision: string;
  digest: string;
}

export interface TodosProjectResourcePageRequest {
  source_project_id: string;
  include_anchors?: boolean;
  limit: number;
  cursor?: string;
}

export interface TodosProjectResourcePage {
  authority: "todos";
  route: typeof TODOS_PROJECT_REGISTRATION_ROUTE;
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  source_project_id: string;
  todos_project_id: string;
  task_list_id: string;
  include_anchors: boolean;
  collection_revision: string;
  limit: number;
  count: number;
  resources: TodosProjectResource[];
  has_more: boolean;
  next_cursor: string | null;
  complete: boolean;
  truncated: false;
}

export interface TodosProjectRegistrationLookupRequest extends TodosProjectRegistrationBounds {
  operation_id: string;
  step_id: string;
  resource_kind: TodosProjectRegistrationResourceKind;
  direction: TodosProjectRegistrationDirection;
  authority: "todos";
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

export interface TodosProjectRegistrationLookupResult {
  receipt: TodosProjectRegistrationReceipt;
  response_control: TodosProjectRegistrationResponseControl;
}

export interface TodosProjectRegistrationInverseVerification {
  target_id: string;
  accepted_receipt_id: string;
  absent: true;
  digest: string;
}

export interface TodosProjectRegistrationAuthority {
  readonly authority: "todos";
  capability(): Promise<TodosProjectRegistrationCapability>;
  create(request: TodosProjectRegistrationRequest): Promise<TodosProjectRegistrationReceipt>;
  readExact(request: {
    resource_kind: TodosProjectRegistrationResourceKind;
    target_id: string;
    target: unknown;
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<TodosProjectRegistrationRecord>;
  lookupReceipt(
    request: TodosProjectRegistrationLookupRequest,
  ): Promise<TodosProjectRegistrationLookupResult>;
  listProjectResources(
    request: TodosProjectResourcePageRequest,
  ): Promise<TodosProjectResourcePage>;
  validatePriorRegistrationAdoption(
    sourceRequest: TodosProjectRegistrationRequest,
    sourceReceipt: TodosProjectRegistrationReceipt,
    currentRecord: TodosPriorRegistrationAdoptionCurrentRecord,
  ): Promise<TodosPriorRegistrationAdoptionValidation>;
  compensate(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationReceipt>;
  verifyInverse(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationInverseVerification>;
}

export type TodosProjectRegistrationFaultPoint =
  | "before_object_write"
  | "after_object_write"
  | "before_receipt_write"
  | "after_receipt_write"
  | "after_commit";

export interface TodosProjectRegistrationAuthorityOptions {
  packageVersion?: string;
  authorityId?: string;
  tenantId?: string;
  corpusId?: string;
  now?: () => string;
  faultInjector?: (
    point: TodosProjectRegistrationFaultPoint,
    context: {
      operation_id: string;
      step_id: string;
      resource_kind: TodosProjectRegistrationResourceKind;
      direction: TodosProjectRegistrationDirection;
    },
  ) => void | Promise<void>;
}

export type TodosProjectRegistrationErrorCode =
  | "TODOS_PROJECT_REGISTRATION_INVALID_INPUT"
  | "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS"
  | "TODOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE"
  | "TODOS_PROJECT_REGISTRATION_TIME_BUDGET_EXCEEDED"
  | "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH"
  | "TODOS_PROJECT_REGISTRATION_DIGEST_MISMATCH"
  | "TODOS_PROJECT_REGISTRATION_IDEMPOTENCY_MISMATCH"
  | "TODOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED"
  | "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND"
  | "TODOS_PROJECT_REGISTRATION_RECORD_NOT_FOUND"
  | "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED"
  | "TODOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND"
  | "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED"
  | "TODOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE"
  | "TODOS_PROJECT_REGISTRATION_CONFLICT";

export class TodosProjectRegistrationError extends Error {
  constructor(
    readonly code: TodosProjectRegistrationErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TodosProjectRegistrationError";
  }
}

export interface TodosProjectRegistrationHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}
