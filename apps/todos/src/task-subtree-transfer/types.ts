import type { Database } from "bun:sqlite";
import type { TodosPostgresQueryClient } from "../storage/postgres-sync.js";

export const TODOS_TASK_SUBTREE_TRANSFER_ROUTE = "todos.task-subtree-transfer.v1" as const;
export const TODOS_TASK_SUBTREE_TRANSFER_SCHEMA_VERSION = 1 as const;

export type TodosTaskSubtreeTransferDirection = "apply" | "rollback";
export type TodosTaskSubtreeTransferFaultPoint =
  | "after_task_writes"
  | "after_plan_writes"
  | "after_receipt_write"
  | "after_rollback_task_writes"
  | "after_rollback_plan_writes"
  | "after_rollback_receipt_write";

export interface TodosTaskSubtreeTransferExpectedTask {
  task_id: string;
  version: number;
}

export interface TodosTaskSubtreeTransferSharedPlanSplit {
  source_plan_id: string;
  destination_plan_id: string;
}

export interface TodosTaskSubtreeTransferInspectRequest {
  source_project_id: string;
  destination_project_id: string;
  destination_task_list_id: string;
  root_task_id: string;
  destination_parent_id: string | null;
}

export interface TodosTaskSubtreeTransferInspection
  extends TodosTaskSubtreeTransferInspectRequest {
  expected_root_parent_id: string | null;
  source_population_digest: string;
  expected_tasks: TodosTaskSubtreeTransferExpectedTask[];
  contained_plan_ids: string[];
  shared_plan_ids: string[];
  complete: true;
}

export interface TodosTaskSubtreeTransferApplyRequest
  extends TodosTaskSubtreeTransferInspectRequest {
  version: 1;
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  precondition_digest: string;
  expected_root_parent_id: string | null;
  source_population_digest: string;
  expected_tasks: TodosTaskSubtreeTransferExpectedTask[];
  shared_plan_splits: TodosTaskSubtreeTransferSharedPlanSplit[];
}

export interface TodosTaskSubtreeTransferRollbackRequest {
  receipt_id: string;
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  precondition_digest: string;
}

export interface TodosTaskSubtreeTransferTaskImage {
  task_id: string;
  project_id: string | null;
  parent_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  version: number;
  updated_at: string;
}

export interface TodosTaskSubtreeTransferPlanImage {
  plan_id: string;
  project_id: string | null;
  task_list_id: string | null;
  updated_at: string;
}

export interface TodosTaskSubtreeTransferImage {
  tasks: TodosTaskSubtreeTransferTaskImage[];
  plans: TodosTaskSubtreeTransferPlanImage[];
}

export interface TodosTaskSubtreeTransferReceipt {
  receipt_id: string;
  authority: "todos";
  route: typeof TODOS_TASK_SUBTREE_TRANSFER_ROUTE;
  schema_version: 1;
  kind: TodosTaskSubtreeTransferDirection;
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  result_digest: string;
  apply_receipt_id: string | null;
  source_project_id: string;
  destination_project_id: string;
  destination_task_list_id: string;
  root_task_id: string;
  source_population_digest: string;
  prior_image: TodosTaskSubtreeTransferImage;
  post_image: TodosTaskSubtreeTransferImage;
  shared_plan_splits: TodosTaskSubtreeTransferSharedPlanSplit[];
  created_at: string;
}

export interface TodosTaskSubtreeTransferResult {
  duplicate: boolean;
  receipt: TodosTaskSubtreeTransferReceipt;
  moved_task_ids: string[];
  moved_plan_ids: string[];
  complete: true;
}

export interface TodosTaskSubtreeTransferCapability {
  authority: "todos";
  route: typeof TODOS_TASK_SUBTREE_TRANSFER_ROUTE;
  schema_version: 1;
  tenant_id: string;
  backend: "sqlite" | "postgresql" | "http";
  exact_descendant_closure: true;
  complete_source_population_digest: true;
  per_task_version_cas: true;
  explicit_shared_plan_splits: true;
  atomic_apply: true;
  immutable_forward_inverse_receipts: true;
  prior_image_receipts: true;
  cas_protected_rollback: true;
  preserves_descendant_parent_ids: true;
  preserves_task_and_relation_identities: true;
}

export interface TodosTaskSubtreeTransferAuthority {
  capability(): Promise<TodosTaskSubtreeTransferCapability>;
  inspect(input: unknown): Promise<TodosTaskSubtreeTransferInspection>;
  apply(input: unknown): Promise<TodosTaskSubtreeTransferResult>;
  readExact(receiptId: string): Promise<TodosTaskSubtreeTransferResult>;
  rollback(input: unknown): Promise<TodosTaskSubtreeTransferResult>;
}

export interface TodosTaskSubtreeTransferAuthorityOptions {
  tenantId?: string;
  now?: () => string;
  faultInjector?: (
    point: TodosTaskSubtreeTransferFaultPoint,
  ) => boolean | void | Promise<boolean | void>;
}

export interface SqliteTodosTaskSubtreeTransferAuthorityOptions
  extends TodosTaskSubtreeTransferAuthorityOptions {
  database: Database;
}

export interface TodosTaskSubtreeTransferPostgresClient
  extends TodosPostgresQueryClient {
  transaction<T>(
    fn: (client: TodosPostgresQueryClient) => Promise<T>,
  ): Promise<T>;
}

export interface PostgresTodosTaskSubtreeTransferAuthorityOptions
  extends TodosTaskSubtreeTransferAuthorityOptions {
  service?: string;
  tableName?: string;
}

export interface TodosTaskSubtreeTransferHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export type TodosTaskSubtreeTransferErrorCode =
  | "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT"
  | "TODOS_TASK_SUBTREE_TRANSFER_DIGEST_MISMATCH"
  | "TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_MISMATCH"
  | "TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_CONFLICT"
  | "TODOS_TASK_SUBTREE_TRANSFER_NOT_FOUND"
  | "TODOS_TASK_SUBTREE_TRANSFER_FOREIGN_REFERENCE"
  | "TODOS_TASK_SUBTREE_TRANSFER_POPULATION_DRIFT"
  | "TODOS_TASK_SUBTREE_TRANSFER_CLOSURE_DRIFT"
  | "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT"
  | "TODOS_TASK_SUBTREE_TRANSFER_HIERARCHY_CYCLE"
  | "TODOS_TASK_SUBTREE_TRANSFER_PARTIAL_PLAN"
  | "TODOS_TASK_SUBTREE_TRANSFER_PLAN_CONFLICT"
  | "TODOS_TASK_SUBTREE_TRANSFER_ATOMICITY_UNAVAILABLE"
  | "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT"
  | "TODOS_TASK_SUBTREE_TRANSFER_RECEIPT_NOT_FOUND"
  | "TODOS_TASK_SUBTREE_TRANSFER_HTTP_ERROR";

export class TodosTaskSubtreeTransferError extends Error {
  constructor(
    readonly code: TodosTaskSubtreeTransferErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TodosTaskSubtreeTransferError";
  }
}
