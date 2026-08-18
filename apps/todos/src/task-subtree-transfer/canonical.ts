import {
  canonicalDigest,
  canonicalJson,
  deterministicUuid,
} from "../task-manifest/canonical.js";
import {
  TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
  type TodosTaskSubtreeTransferApplyRequest,
  type TodosTaskSubtreeTransferDirection,
  type TodosTaskSubtreeTransferRollbackRequest,
} from "./types.js";

export { canonicalDigest, canonicalJson, deterministicUuid };

export function taskSubtreeTransferRequestDigest(
  input: Omit<TodosTaskSubtreeTransferApplyRequest, "idempotency_key">,
): string {
  const { idempotency_key: _idempotencyKey, ...request } = input as TodosTaskSubtreeTransferApplyRequest;
  return canonicalDigest(request);
}

export function taskSubtreeTransferRollbackRequestDigest(
  input: Omit<TodosTaskSubtreeTransferRollbackRequest, "idempotency_key">,
): string {
  const { idempotency_key: _idempotencyKey, ...request } = input as TodosTaskSubtreeTransferRollbackRequest;
  return canonicalDigest(request);
}

export function deriveTodosTaskSubtreeTransferIdempotencyKey(input: {
  operation_id: string;
  step_id: string;
  direction: TodosTaskSubtreeTransferDirection;
  target_selector: string;
  request_digest: string;
  precondition_digest: string;
}): string {
  return `tstk_${canonicalDigest({
    route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
    ...input,
  }).slice(0, 48)}`;
}
