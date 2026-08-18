import {
  canonicalDigest,
  deriveTodosTaskSubtreeTransferIdempotencyKey,
  taskSubtreeTransferRequestDigest,
  taskSubtreeTransferRollbackRequestDigest,
} from "./canonical.js";
import { PostgresTodosTaskSubtreeTransferBackend } from "./postgres.js";
import { SqliteTodosTaskSubtreeTransferBackend } from "./sqlite.js";
import {
  TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
  TODOS_TASK_SUBTREE_TRANSFER_SCHEMA_VERSION,
  TodosTaskSubtreeTransferError,
  type PostgresTodosTaskSubtreeTransferAuthorityOptions,
  type SqliteTodosTaskSubtreeTransferAuthorityOptions,
  type TodosTaskSubtreeTransferApplyRequest,
  type TodosTaskSubtreeTransferAuthority,
  type TodosTaskSubtreeTransferAuthorityOptions,
  type TodosTaskSubtreeTransferCapability,
  type TodosTaskSubtreeTransferInspectRequest,
  type TodosTaskSubtreeTransferRollbackRequest,
} from "./types.js";
import type { TodosTaskSubtreeTransferBackend } from "./backend.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;

function boundedString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      `${field} must be a non-empty bounded string`,
    );
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  const parsed = boundedString(value, field, 80);
  if (!UUID.test(parsed)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      `${field} must be a UUID`,
    );
  }
  return parsed;
}

function digest(value: unknown, field: string): string {
  const parsed = boundedString(value, field, 64);
  if (!DIGEST.test(parsed)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      `${field} must be a SHA-256 digest`,
    );
  }
  return parsed.toLowerCase();
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === null) return null;
  return uuid(value, field);
}

function strictObject(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "Request must be a JSON object",
    );
  }
  const object = input as Record<string, unknown>;
  const allowed = new Set(fields);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
        `Unknown field: ${key}`,
      );
    }
  }
  return object;
}

const INSPECT_FIELDS = [
  "source_project_id",
  "destination_project_id",
  "destination_task_list_id",
  "root_task_id",
  "destination_parent_id",
] as const;

export function parseTodosTaskSubtreeTransferInspect(
  input: unknown,
): TodosTaskSubtreeTransferInspectRequest {
  const value = strictObject(input, INSPECT_FIELDS);
  const request = {
    source_project_id: uuid(value.source_project_id, "source_project_id"),
    destination_project_id: uuid(value.destination_project_id, "destination_project_id"),
    destination_task_list_id: uuid(value.destination_task_list_id, "destination_task_list_id"),
    root_task_id: uuid(value.root_task_id, "root_task_id"),
    destination_parent_id: nullableUuid(value.destination_parent_id, "destination_parent_id"),
  };
  if (request.source_project_id === request.destination_project_id) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "source_project_id and destination_project_id must identify different Projects",
    );
  }
  return request;
}

const APPLY_FIELDS = [
  ...INSPECT_FIELDS,
  "version",
  "operation_id",
  "step_id",
  "idempotency_key",
  "precondition_digest",
  "expected_root_parent_id",
  "source_population_digest",
  "expected_tasks",
  "shared_plan_splits",
] as const;

export function parseTodosTaskSubtreeTransferApply(
  input: unknown,
): TodosTaskSubtreeTransferApplyRequest {
  const value = strictObject(input, APPLY_FIELDS);
  if (value.version !== 1) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "version must be 1",
    );
  }
  if (!Array.isArray(value.expected_tasks) || value.expected_tasks.length === 0) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "expected_tasks must be a non-empty array",
    );
  }
  const expected_tasks = value.expected_tasks.map((item, index) => {
    const row = strictObject(item, ["task_id", "version"]);
    const version = row.version;
    if (!Number.isSafeInteger(version) || Number(version) < 1) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
        `expected_tasks.${index}.version must be a positive integer`,
      );
    }
    return { task_id: uuid(row.task_id, `expected_tasks.${index}.task_id`), version: Number(version) };
  });
  const ids = new Set<string>();
  for (const row of expected_tasks) {
    if (ids.has(row.task_id)) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
        "expected_tasks must not contain duplicate task IDs",
      );
    }
    ids.add(row.task_id);
  }
  if (!Array.isArray(value.shared_plan_splits)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "shared_plan_splits must be an array",
    );
  }
  const shared_plan_splits = value.shared_plan_splits.map((item, index) => {
    const row = strictObject(item, ["source_plan_id", "destination_plan_id"]);
    return {
      source_plan_id: uuid(row.source_plan_id, `shared_plan_splits.${index}.source_plan_id`),
      destination_plan_id: uuid(row.destination_plan_id, `shared_plan_splits.${index}.destination_plan_id`),
    };
  });
  return {
    ...parseTodosTaskSubtreeTransferInspect({
      source_project_id: value.source_project_id,
      destination_project_id: value.destination_project_id,
      destination_task_list_id: value.destination_task_list_id,
      root_task_id: value.root_task_id,
      destination_parent_id: value.destination_parent_id,
    }),
    version: 1,
    operation_id: boundedString(value.operation_id, "operation_id"),
    step_id: boundedString(value.step_id, "step_id"),
    idempotency_key: boundedString(value.idempotency_key, "idempotency_key", 240),
    precondition_digest: digest(value.precondition_digest, "precondition_digest"),
    expected_root_parent_id: nullableUuid(value.expected_root_parent_id, "expected_root_parent_id"),
    source_population_digest: digest(value.source_population_digest, "source_population_digest"),
    expected_tasks,
    shared_plan_splits,
  };
}

export function parseTodosTaskSubtreeTransferRollback(
  input: unknown,
): TodosTaskSubtreeTransferRollbackRequest {
  const value = strictObject(input, [
    "receipt_id",
    "operation_id",
    "step_id",
    "idempotency_key",
    "precondition_digest",
  ]);
  return {
    receipt_id: uuid(value.receipt_id, "receipt_id"),
    operation_id: boundedString(value.operation_id, "operation_id"),
    step_id: boundedString(value.step_id, "step_id"),
    idempotency_key: boundedString(value.idempotency_key, "idempotency_key", 240),
    precondition_digest: digest(value.precondition_digest, "precondition_digest"),
  };
}

export {
  deriveTodosTaskSubtreeTransferIdempotencyKey,
  taskSubtreeTransferRequestDigest,
  taskSubtreeTransferRollbackRequestDigest,
} from "./canonical.js";

export function deriveTodosTaskSubtreeTransferApplyPreconditionDigest(
  input: Pick<
    TodosTaskSubtreeTransferApplyRequest,
    "source_project_id"
    | "destination_project_id"
    | "destination_task_list_id"
    | "root_task_id"
    | "expected_root_parent_id"
    | "destination_parent_id"
    | "source_population_digest"
    | "expected_tasks"
    | "shared_plan_splits"
  >,
): string {
  const {
    source_project_id,
    destination_project_id,
    destination_task_list_id,
    root_task_id,
    expected_root_parent_id,
    destination_parent_id,
    source_population_digest,
    expected_tasks,
    shared_plan_splits,
  } = input;
  return canonicalDigest({
    route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
    direction: "apply",
    source_project_id,
    destination_project_id,
    destination_task_list_id,
    root_task_id,
    expected_root_parent_id,
    destination_parent_id,
    source_population_digest,
    expected_tasks,
    shared_plan_splits,
  });
}

export function deriveTodosTaskSubtreeTransferRollbackPreconditionDigest(
  input: {
    receipt_id: string;
    operation_id: string;
    step_id: string;
    apply_result_digest: string;
  },
): string {
  return canonicalDigest({
    route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
    direction: "rollback",
    apply_receipt_id: input.receipt_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    apply_result_digest: input.apply_result_digest,
  });
}

function resolveTenantId(value: string | undefined): string {
  const tenant = value ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(tenant)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "tenantId must be a bounded exact authority identifier",
    );
  }
  return tenant;
}

export class PackageOwnedTodosTaskSubtreeTransferAuthority implements TodosTaskSubtreeTransferAuthority {
  private readonly tenantId: string;
  private readonly backendOptions: TodosTaskSubtreeTransferAuthorityOptions;
  constructor(
    private readonly backend: TodosTaskSubtreeTransferBackend,
    options: TodosTaskSubtreeTransferAuthorityOptions = {},
  ) {
    this.tenantId = resolveTenantId(options.tenantId);
    this.backendOptions = { ...options, tenantId: this.tenantId };
  }

  async capability(): Promise<TodosTaskSubtreeTransferCapability> {
    return {
      authority: "todos",
      route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
      schema_version: TODOS_TASK_SUBTREE_TRANSFER_SCHEMA_VERSION,
      tenant_id: this.tenantId,
      backend: this.backend.kind,
      exact_descendant_closure: true,
      complete_source_population_digest: true,
      per_task_version_cas: true,
      explicit_shared_plan_splits: true,
      atomic_apply: true,
      immutable_forward_inverse_receipts: true,
      prior_image_receipts: true,
      cas_protected_rollback: true,
      preserves_descendant_parent_ids: true,
      preserves_task_and_relation_identities: true,
    };
  }

  async inspect(input: unknown) {
    return this.backend.inspect(parseTodosTaskSubtreeTransferInspect(input));
  }

  async apply(input: unknown) {
    const request = parseTodosTaskSubtreeTransferApply(input);
    const expected = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(request);
    if (request.precondition_digest !== expected) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_DIGEST_MISMATCH",
        "precondition_digest does not match the exact transfer target and source snapshot",
        { expected_precondition_digest: expected },
      );
    }
    const requestDigest = taskSubtreeTransferRequestDigest(request);
    const expectedKey = deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: request.operation_id,
      step_id: request.step_id,
      direction: "apply",
      target_selector: request.root_task_id,
      request_digest: requestDigest,
      precondition_digest: request.precondition_digest,
    });
    if (request.idempotency_key !== expectedKey) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_MISMATCH",
        "idempotency_key does not match the exact transfer request",
        { expected_idempotency_key: expectedKey },
      );
    }
    return this.backend.apply(request, this.backendOptions);
  }

  async readExact(receiptIdValue: string) {
    return this.backend.readExact(uuid(receiptIdValue, "receipt_id"));
  }

  async rollback(input: unknown) {
    const request = parseTodosTaskSubtreeTransferRollback(input);
    const requestDigest = taskSubtreeTransferRollbackRequestDigest(request);
    const expectedKey = deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: request.operation_id,
      step_id: request.step_id,
      direction: "rollback",
      target_selector: request.receipt_id,
      request_digest: requestDigest,
      precondition_digest: request.precondition_digest,
    });
    if (request.idempotency_key !== expectedKey) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_MISMATCH",
        "rollback idempotency_key does not match the exact rollback request",
        { expected_idempotency_key: expectedKey },
      );
    }
    return this.backend.rollback(request, this.backendOptions);
  }
}

export function createSqliteTodosTaskSubtreeTransferAuthority(
  options: SqliteTodosTaskSubtreeTransferAuthorityOptions,
): TodosTaskSubtreeTransferAuthority {
  return new PackageOwnedTodosTaskSubtreeTransferAuthority(
    new SqliteTodosTaskSubtreeTransferBackend(options.database, resolveTenantId(options.tenantId)),
    options,
  );
}

export function createPostgresTodosTaskSubtreeTransferAuthority(
  client: import("./types.js").TodosTaskSubtreeTransferPostgresClient,
  options: PostgresTodosTaskSubtreeTransferAuthorityOptions = {},
): TodosTaskSubtreeTransferAuthority {
  return new PackageOwnedTodosTaskSubtreeTransferAuthority(
    new PostgresTodosTaskSubtreeTransferBackend(client, options),
    options,
  );
}
