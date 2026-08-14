import {
  TodosProjectRegistrationError,
  type TodosPriorRegistrationAdoptionValidation,
} from "./types.js";

const VALIDATION_KEYS = [
  "valid",
  "resource_kind",
  "target_id",
  "source_receipt_id",
  "accepted_receipt_id",
  "source_outcome",
  "created_at",
  "current_revision",
  "accepted_result_digest",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function adoptionRejected(message: string): never {
  throw new TodosProjectRegistrationError(
    "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED",
    `TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED: ${message}`,
  );
}

export function assertTodosPriorRegistrationAdoptionValidationEnvelope(
  value: unknown,
  input: unknown,
): TodosPriorRegistrationAdoptionValidation {
  if (!isRecord(input) || !hasExactKeys(input, [
    "source_request",
    "source_receipt",
    "current_record",
  ])) {
    adoptionRejected("prior-adoption validation input is incomplete");
  }
  const request = input["source_request"];
  const receipt = input["source_receipt"];
  const current = input["current_record"];
  if (!isRecord(request) || !isRecord(receipt) || !isRecord(current)) {
    adoptionRejected("prior-adoption validation input records are incomplete");
  }

  const resourceKind = request["resource_kind"];
  const sourceOutcome = receipt["outcome"];
  const acceptedReceiptId = sourceOutcome === "accepted"
    ? receipt["receipt_id"]
    : sourceOutcome === "duplicate_of_accepted"
      ? receipt["duplicate_of_receipt_id"]
      : null;
  if (
    (resourceKind !== "project" && resourceKind !== "task_list")
    || request["direction"] !== "forward"
    || (sourceOutcome !== "accepted" && sourceOutcome !== "duplicate_of_accepted")
    || !isNonEmptyString(acceptedReceiptId)
    || !isNonEmptyString(receipt["receipt_id"])
    || !isNonEmptyString(receipt["target_id"])
    || !isNonEmptyString(receipt["result_revision"])
    || !isNonEmptyString(receipt["result_digest"])
    || !isNonEmptyString(current["id"])
    || !isNonEmptyString(current["created_at"])
    || !isNonEmptyString(current["updated_at"])
    || receipt["authority"] !== "todos"
    || receipt["route"] !== request["authority_route"]
    || receipt["package_version"] !== request["package_version"]
    || receipt["authority_id"] !== request["authority_id"]
    || receipt["tenant_id"] !== request["tenant_id"]
    || receipt["corpus_id"] !== request["corpus_id"]
    || receipt["operation_id"] !== request["operation_id"]
    || receipt["step_id"] !== request["step_id"]
    || receipt["resource_kind"] !== resourceKind
    || receipt["direction"] !== "forward"
    || receipt["idempotency_key"] !== request["idempotency_key"]
    || receipt["request_digest"] !== request["request_digest"]
    || receipt["precondition_digest"] !== request["precondition_digest"]
    || receipt["accepted_receipt_id"] !== null
    || receipt["target_id"] !== current["id"]
    || receipt["result_revision"] !== current["created_at"]
  ) {
    adoptionRejected(
      "prior-adoption validation input does not carry one complete accepted receipt and current target incarnation",
    );
  }
  if (
    (sourceOutcome === "accepted" && receipt["duplicate_of_receipt_id"] !== null)
    || (sourceOutcome === "duplicate_of_accepted"
      && receipt["duplicate_of_receipt_id"] !== acceptedReceiptId)
  ) {
    adoptionRejected("prior-adoption validation source receipt lineage is incomplete");
  }

  if (
    !isRecord(value)
    || !hasExactKeys(value, ["validation"])
    || !isRecord(value["validation"])
    || !hasExactKeys(value["validation"], VALIDATION_KEYS)
  ) {
    adoptionRejected("prior-adoption validation response envelope is incomplete");
  }
  const validation = value["validation"];
  if (
    validation["valid"] !== true
    || validation["resource_kind"] !== resourceKind
    || validation["target_id"] !== current["id"]
    || validation["source_receipt_id"] !== receipt["receipt_id"]
    || validation["accepted_receipt_id"] !== acceptedReceiptId
    || validation["source_outcome"] !== sourceOutcome
    || validation["created_at"] !== current["created_at"]
    || validation["current_revision"] !== current["updated_at"]
    || validation["accepted_result_digest"] !== receipt["result_digest"]
  ) {
    adoptionRejected(
      "prior-adoption validation response does not prove the exact accepted receipt and current target",
    );
  }
  return validation as unknown as TodosPriorRegistrationAdoptionValidation;
}
