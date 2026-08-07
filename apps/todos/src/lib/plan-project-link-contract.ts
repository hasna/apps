import { createHash } from "node:crypto";
import type { Plan, PlanProjectLinkReceipt, Task } from "../types/index.js";

export const PLAN_PROJECT_LINK_SCHEMA_VERSION = "todos.plan-project-link.v1" as const;

export type PlanProjectLinkErrorCode =
  | "PLAN_PROJECT_LINK_PLAN_NOT_FOUND"
  | "PLAN_PROJECT_LINK_PROJECT_NOT_FOUND"
  | "PLAN_PROJECT_LINK_PLAN_REVISION_CONFLICT"
  | "PLAN_PROJECT_LINK_PROJECT_REVISION_CONFLICT"
  | "PLAN_PROJECT_LINK_SCOPE_COLLISION"
  | "PLAN_PROJECT_LINK_IDEMPOTENCY_KEY_INVALID"
  | "PLAN_PROJECT_LINK_IDEMPOTENCY_CONFLICT"
  | "PLAN_PROJECT_LINK_RECEIPT_NOT_FOUND"
  | "PLAN_PROJECT_LINK_RESULT_DRIFT"
  | "PLAN_PROJECT_LINK_ROLLBACK_CONFLICT"
  | "PLAN_PROJECT_LINK_UNSUPPORTED";

export class PlanProjectLinkError extends Error {
  constructor(
    readonly code: PlanProjectLinkErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PlanProjectLinkError";
  }
}

export function canonicalPlanProjectLinkJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPlanProjectLinkJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalPlanProjectLinkJson(item)}`)
    .join(",")}}`;
}

export function planProjectLinkDigest(value: unknown): string {
  return createHash("sha256").update(canonicalPlanProjectLinkJson(value)).digest("hex");
}

export function normalizePlanProjectLinkIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_IDEMPOTENCY_KEY_INVALID",
      "idempotency_key must be 8-128 ASCII letters, digits, dots, underscores, colons, or hyphens",
    );
  }
  return key;
}

export function planProjectLinkReceiptId(idempotencyKey: string): string {
  return `pplr_${planProjectLinkDigest({ idempotency_key: idempotencyKey }).slice(0, 48)}`;
}

export function planProjectLinkRollbackReceiptId(receiptId: string): string {
  return `pplr_inverse_${planProjectLinkDigest({ accepted_receipt_id: receiptId }).slice(0, 38)}`;
}

export function planProjectLinkRequestHash(planId: string, projectId: string): string {
  return planProjectLinkDigest({ plan_id: planId, project_id: projectId });
}

export function planProjectLinkResultDigest(plan: Pick<Plan, "id" | "project_id">, tasks: Task[]): string {
  return planProjectLinkDigest({
    plan_id: plan.id,
    plan_project_id: plan.project_id,
    tasks: tasks
      .map((task) => ({ id: task.id, plan_id: task.plan_id, project_id: task.project_id }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function assertPlanProjectLinkReceipt(value: unknown): PlanProjectLinkReceipt {
  const receipt = value as PlanProjectLinkReceipt;
  if (
    !receipt
    || typeof receipt !== "object"
    || receipt.schema_version !== PLAN_PROJECT_LINK_SCHEMA_VERSION
    || typeof receipt.receipt_id !== "string"
    || typeof receipt.idempotency_key !== "string"
    || typeof receipt.plan_id !== "string"
    || typeof receipt.project_id !== "string"
    || !Array.isArray(receipt.task_ids)
    || receipt.task_ids.some((id) => typeof id !== "string")
    || !receipt.prior_task_project_ids
    || typeof receipt.prior_task_project_ids !== "object"
    || typeof receipt.result_digest !== "string"
  ) {
    throw new PlanProjectLinkError(
      "PLAN_PROJECT_LINK_RECEIPT_NOT_FOUND",
      "Stored plan-project-link receipt is invalid",
    );
  }
  return receipt;
}
