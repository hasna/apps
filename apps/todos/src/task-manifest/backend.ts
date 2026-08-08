import type {
  TodosTaskManifestApplyResult,
  TodosTaskManifestBindingLookupResult,
  TodosTaskManifestCompensateRequest,
  TodosTaskManifestCompensationResult,
  TodosTaskManifestFaultPoint,
  TodosTaskManifestGraph,
  TodosTaskManifestReadback,
  TodosTaskManifestReceipt,
  TodosTaskManifest,
} from "./types.js";
import { TodosTaskManifestError } from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface NormalizedTaskManifest {
  manifest: TodosTaskManifest;
  request_digest: string;
  result_digest: string;
  receipt_id: string;
  graph: TodosTaskManifestGraph;
  outbox: Array<{ id: string; topic: string; payload: Record<string, unknown>; digest: string }>;
  now: string;
}

export interface PreparedTaskManifestFaults {
  points: ReadonlySet<TodosTaskManifestFaultPoint>;
}

export interface TodosTaskManifestBackend {
  readonly kind: "sqlite" | "postgresql";
  apply(input: NormalizedTaskManifest, faults: PreparedTaskManifestFaults): Promise<TodosTaskManifestApplyResult>;
  readExact(receiptId: string): Promise<TodosTaskManifestApplyResult>;
  lookupBindingByPlanId(planId: string): Promise<Omit<
    TodosTaskManifestBindingLookupResult,
    "authority" | "route" | "schema_version" | "tenant_id"
  >>;
  markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<void>;
  compensate(
    input: TodosTaskManifestCompensateRequest,
    receipt: TodosTaskManifestReceipt,
    compensationReceiptId: string,
    requestDigest: string,
    now: string,
  ): Promise<TodosTaskManifestCompensationResult>;
}

export interface TaskManifestBindingLookupRow {
  apply_receipt_id: unknown;
  state: unknown;
  binding_version: unknown;
  binding_operation_id: unknown;
  binding_plan_id: unknown;
  receipt_authority: unknown;
  receipt_route: unknown;
  receipt_schema_version: unknown;
  receipt_kind: unknown;
  receipt_operation_id: unknown;
  receipt_plan_id: unknown;
}

export function validateTaskManifestBindingLookupRows(
  rows: TaskManifestBindingLookupRow[],
  planId: string,
): Omit<
  TodosTaskManifestBindingLookupResult,
  "authority" | "route" | "schema_version" | "tenant_id"
> {
  if (rows.length === 0) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_BINDING_NOT_FOUND",
      `Managed task-manifest binding not found for plan: ${planId}`,
      { plan_id: planId },
    );
  }
  if (rows.length !== 1) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_LOOKUP_CONFLICT",
      "Task-manifest plan lookup matched more than one binding",
      { plan_id: planId, matched_items: rows.length, max_items: 1 },
    );
  }
  const row = rows[0]!;
  const bindingVersion = Number(row.binding_version);
  const state = row.state;
  if (
    row.binding_plan_id !== planId
    || row.receipt_plan_id !== planId
    || row.receipt_authority !== "todos"
    || row.receipt_route !== "todos.task-manifest.v1"
    || Number(row.receipt_schema_version) !== 1
    || row.receipt_kind !== "apply"
    || row.binding_operation_id !== row.receipt_operation_id
    || typeof row.apply_receipt_id !== "string"
    || !UUID_PATTERN.test(row.apply_receipt_id)
    || !Number.isSafeInteger(bindingVersion)
    || bindingVersion < 1
    || (state !== "applied" && state !== "compensated")
  ) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_LOOKUP_CONFLICT",
      "Task-manifest binding and immutable apply receipt disagree",
      { plan_id: planId },
    );
  }
  return {
    plan_id: planId,
    apply_receipt_id: row.apply_receipt_id,
    binding_version: bindingVersion,
    state,
  };
}

export function emptyReadback(): TodosTaskManifestReadback {
  return { plans: 0, tasks: 0, dependencies: 0, comments: 0, verifications: 0, complete: true };
}
