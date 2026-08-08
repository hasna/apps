import { createHash } from "node:crypto";
import { PLAN_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "../types/index.js";
import type {
  Plan,
  PlanProjectLinkReceipt,
  PlanProjectLinkResult,
  PlanProjectLinkRollbackResult,
  Task,
} from "../types/index.js";

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

type PlanProjectLinkResponseExpectation = {
  mode: "plan" | "apply";
  plan_id: string;
  project_id: string;
  idempotency_key?: string;
};

type PlanProjectLinkRollbackResponseExpectation = {
  plan_id: string;
  receipt_id: string;
};

function responseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactResponseKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields must be exactly: ${wanted.join(", ")}`);
  }
}

function responseString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function responseNullableString(value: unknown, label: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function responseNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function responseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function responseDateTime(value: unknown, label: string): string {
  const timestamp = responseString(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new Error(`${label} must be an RFC 3339 date-time`);
  }
  return timestamp;
}

function responseNullableDateTime(value: unknown, label: string): string | null {
  if (value === null) return null;
  return responseDateTime(value, label);
}

function responseOptionalNullableString(
  record: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (field in record) responseNullableString(record[field], `${label}.${field}`);
}

function responseOptionalNullableDateTime(
  record: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (field in record) responseNullableDateTime(record[field], `${label}.${field}`);
}

function responseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function responseProjectSources(value: unknown, expectedProjectId: string): void {
  if (!Array.isArray(value)) throw new Error("project.sources must be an array");
  value.forEach((item, index) => {
    const label = `project.sources[${index}]`;
    const source = responseRecord(item, label);
    responseString(source.id, `${label}.id`);
    if (responseString(source.project_id, `${label}.project_id`) !== expectedProjectId) {
      throw new Error(`${label}.project_id must match project.id`);
    }
    responseString(source.type, `${label}.type`);
    responseString(source.name, `${label}.name`);
    responseString(source.uri, `${label}.uri`);
    responseNullableString(source.description, `${label}.description`);
    responseRecord(source.metadata, `${label}.metadata`);
    responseDateTime(source.created_at, `${label}.created_at`);
    responseDateTime(source.updated_at, `${label}.updated_at`);
  });
}

function responsePlan(value: unknown, expectedPlanId: string): Record<string, unknown> {
  const plan = responseRecord(value, "plan");
  if (responseString(plan.id, "plan.id") !== expectedPlanId) {
    throw new Error(`plan.id must match requested plan ${expectedPlanId}`);
  }
  responseNullableString(plan.slug, "plan.slug");
  responseNullableString(plan.project_id, "plan.project_id");
  responseNullableString(plan.task_list_id, "plan.task_list_id");
  responseNullableString(plan.agent_id, "plan.agent_id");
  responseString(plan.name, "plan.name");
  responseNullableString(plan.description, "plan.description");
  if (typeof plan.status !== "string" || !PLAN_STATUSES.includes(plan.status as Plan["status"])) {
    throw new Error(`plan.status must be one of: ${PLAN_STATUSES.join(", ")}`);
  }
  responseDateTime(plan.created_at, "plan.created_at");
  responseDateTime(plan.updated_at, "plan.updated_at");
  responseOptionalNullableString(plan, "machine_id", "plan");
  responseOptionalNullableDateTime(plan, "synced_at", "plan");
  return plan;
}

function responseProject(value: unknown, expectedProjectId: string): Record<string, unknown> {
  const project = responseRecord(value, "project");
  if (responseString(project.id, "project.id") !== expectedProjectId) {
    throw new Error(`project.id must match requested project ${expectedProjectId}`);
  }
  responseString(project.name, "project.name");
  responseString(project.path, "project.path");
  responseNullableString(project.description, "project.description");
  responseNullableString(project.task_list_id, "project.task_list_id");
  responseNullableString(project.task_prefix, "project.task_prefix");
  responseNumber(project.task_counter, "project.task_counter");
  responseDateTime(project.created_at, "project.created_at");
  responseDateTime(project.updated_at, "project.updated_at");
  responseOptionalNullableString(project, "machine_id", "project");
  responseOptionalNullableDateTime(project, "synced_at", "project");
  if ("sources" in project && project.sources !== undefined) {
    responseProjectSources(project.sources, expectedProjectId);
  }
  return project;
}

function responseTasks(value: unknown, expectedPlanId: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("tasks must be an array");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const task = responseRecord(item, `tasks[${index}]`);
    const taskId = responseString(task.id, `tasks[${index}].id`);
    if (seen.has(taskId)) throw new Error(`tasks contains duplicate id ${taskId}`);
    seen.add(taskId);
    if (task.plan_id !== expectedPlanId) {
      throw new Error(`tasks[${index}].plan_id must match requested plan ${expectedPlanId}`);
    }
    const label = `tasks[${index}]`;
    responseNullableString(task.short_id, `${label}.short_id`);
    responseNullableString(task.project_id, `tasks[${index}].project_id`);
    responseNullableString(task.parent_id, `${label}.parent_id`);
    responseNullableString(task.task_list_id, `${label}.task_list_id`);
    responseString(task.title, `${label}.title`);
    responseNullableString(task.description, `${label}.description`);
    if (typeof task.status !== "string" || !TASK_STATUSES.includes(task.status as Task["status"])) {
      throw new Error(`${label}.status must be one of: ${TASK_STATUSES.join(", ")}`);
    }
    if (typeof task.priority !== "string" || !TASK_PRIORITIES.includes(task.priority as Task["priority"])) {
      throw new Error(`${label}.priority must be one of: ${TASK_PRIORITIES.join(", ")}`);
    }
    for (const field of [
      "agent_id", "assigned_to", "session_id", "working_dir", "locked_by",
      "approved_by", "recurrence_rule", "recurrence_parent_id", "spawns_template_id",
      "reason", "spawned_from_session", "assigned_by", "created_by",
      "assigned_from_project", "task_type", "delegated_from", "runner_id", "current_step",
    ]) {
      responseNullableString(task[field], `${label}.${field}`);
    }
    responseStringArray(task.tags, `${label}.tags`);
    responseRecord(task.metadata, `${label}.metadata`);
    for (const field of [
      "version", "cost_tokens", "cost_usd", "delegation_depth", "retry_count", "max_retries",
    ]) {
      responseNumber(task[field], `${label}.${field}`);
    }
    for (const field of ["estimated_minutes", "actual_minutes", "confidence", "sla_minutes", "total_steps"]) {
      if (task[field] !== null) responseNumber(task[field], `${label}.${field}`);
    }
    responseBoolean(task.requires_approval, `${label}.requires_approval`);
    responseDateTime(task.created_at, `${label}.created_at`);
    responseDateTime(task.updated_at, `${label}.updated_at`);
    for (const field of [
      "locked_at", "started_at", "completed_at", "due_at", "approved_at", "retry_after",
      "runner_started_at", "runner_completed_at",
    ]) {
      responseNullableDateTime(task[field], `${label}.${field}`);
    }
    responseOptionalNullableString(task, "machine_id", label);
    responseOptionalNullableDateTime(task, "synced_at", label);
    responseOptionalNullableDateTime(task, "archived_at", label);
    return task;
  });
}

function responseReceipt(
  value: unknown,
  expectation: Required<PlanProjectLinkResponseExpectation>,
  planRevision: string,
  taskIds: string[],
): PlanProjectLinkReceipt {
  const receipt = responseRecord(value, "receipt");
  exactResponseKeys(receipt, [
    "schema_version",
    "receipt_id",
    "idempotency_key",
    "plan_id",
    "project_id",
    "prior_plan_project_id",
    "prior_task_project_ids",
    "task_ids",
    "task_count",
    "result_plan_revision",
    "result_digest",
    "rollback_supported",
    "created_at",
  ], "receipt");
  if (receipt.schema_version !== PLAN_PROJECT_LINK_SCHEMA_VERSION) {
    throw new Error(`receipt.schema_version must be ${PLAN_PROJECT_LINK_SCHEMA_VERSION}`);
  }
  const expectedReceiptId = planProjectLinkReceiptId(expectation.idempotency_key);
  if (responseString(receipt.receipt_id, "receipt.receipt_id") !== expectedReceiptId) {
    throw new Error("receipt.receipt_id must match the deterministic apply receipt identity");
  }
  if (responseString(receipt.idempotency_key, "receipt.idempotency_key") !== expectation.idempotency_key) {
    throw new Error("receipt.idempotency_key must match the apply request");
  }
  if (responseString(receipt.plan_id, "receipt.plan_id") !== expectation.plan_id) {
    throw new Error("receipt.plan_id must match the requested plan");
  }
  if (responseString(receipt.project_id, "receipt.project_id") !== expectation.project_id) {
    throw new Error("receipt.project_id must match the requested project");
  }
  responseNullableString(receipt.prior_plan_project_id, "receipt.prior_plan_project_id");
  const priorTaskProjectIds = responseRecord(
    receipt.prior_task_project_ids,
    "receipt.prior_task_project_ids",
  );
  for (const [taskId, projectId] of Object.entries(priorTaskProjectIds)) {
    responseString(taskId, "receipt.prior_task_project_ids key");
    responseNullableString(projectId, `receipt.prior_task_project_ids.${taskId}`);
  }
  if (!Array.isArray(receipt.task_ids) || receipt.task_ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("receipt.task_ids must be an array of non-empty strings");
  }
  const receiptTaskIds = receipt.task_ids as string[];
  if (new Set(receiptTaskIds).size !== receiptTaskIds.length) {
    throw new Error("receipt.task_ids must not contain duplicates");
  }
  if (
    receiptTaskIds.length !== taskIds.length
    || receiptTaskIds.some((taskId, index) => taskId !== taskIds[index])
  ) {
    throw new Error("receipt.task_ids must exactly match the response task identities");
  }
  const priorTaskIds = Object.keys(priorTaskProjectIds).sort();
  if (priorTaskIds.length !== taskIds.length || priorTaskIds.some((taskId, index) => taskId !== [...taskIds].sort()[index])) {
    throw new Error("receipt.prior_task_project_ids must exactly cover the response task identities");
  }
  if (!Number.isInteger(receipt.task_count) || receipt.task_count !== taskIds.length) {
    throw new Error("receipt.task_count must equal the response task count");
  }
  if (responseString(receipt.result_plan_revision, "receipt.result_plan_revision") !== planRevision) {
    throw new Error("receipt.result_plan_revision must equal plan.updated_at");
  }
  const resultDigest = responseString(receipt.result_digest, "receipt.result_digest");
  if (!/^[a-f0-9]{64}$/.test(resultDigest)) {
    throw new Error("receipt.result_digest must be a lowercase SHA-256 digest");
  }
  if (receipt.rollback_supported !== true) {
    throw new Error("receipt.rollback_supported must be true");
  }
  responseDateTime(receipt.created_at, "receipt.created_at");
  return receipt as unknown as PlanProjectLinkReceipt;
}

/** Validate an untrusted HTTP plan/apply response before the CLI can report success. */
export function assertPlanProjectLinkResponse(
  value: unknown,
  expectation: PlanProjectLinkResponseExpectation,
): PlanProjectLinkResult {
  const response = responseRecord(value, `${expectation.mode} response`);
  exactResponseKeys(response, ["mode", "action", "plan", "project", "tasks", "receipt"], `${expectation.mode} response`);
  if (response.mode !== expectation.mode) {
    throw new Error(`mode must be ${expectation.mode}`);
  }
  const allowedActions = expectation.mode === "plan"
    ? ["would_link", "already_linked"]
    : ["linked", "already_linked"];
  if (typeof response.action !== "string" || !allowedActions.includes(response.action)) {
    throw new Error(`action must be one of: ${allowedActions.join(", ")}`);
  }
  const plan = responsePlan(response.plan, expectation.plan_id);
  responseProject(response.project, expectation.project_id);
  const tasks = responseTasks(response.tasks, expectation.plan_id);
  const linkedResult = expectation.mode === "apply" || response.action === "already_linked";
  if (linkedResult) {
    if (plan.project_id !== expectation.project_id) {
      throw new Error("plan.project_id must match the requested project after linkage");
    }
    if (tasks.some((task) => task.project_id !== expectation.project_id)) {
      throw new Error("every task.project_id must match the requested project after linkage");
    }
  }
  if (expectation.mode === "plan") {
    if (response.receipt !== null) throw new Error("receipt must be null for a plan response");
  } else {
    if (!expectation.idempotency_key) throw new Error("apply validation requires the request idempotency key");
    const receipt = responseReceipt(
      response.receipt,
      expectation as Required<PlanProjectLinkResponseExpectation>,
      plan.updated_at as string,
      tasks.map((task) => task.id as string),
    );
    const expectedDigest = planProjectLinkResultDigest(
      plan as unknown as Pick<Plan, "id" | "project_id">,
      tasks as unknown as Task[],
    );
    if (receipt.result_digest !== expectedDigest) {
      throw new Error("receipt.result_digest must match the returned plan and tasks");
    }
  }
  return value as PlanProjectLinkResult;
}

/** Validate an untrusted HTTP rollback response before the CLI can report success. */
export function assertPlanProjectLinkRollbackResponse(
  value: unknown,
  expectation: PlanProjectLinkRollbackResponseExpectation,
): PlanProjectLinkRollbackResult {
  const response = responseRecord(value, "rollback response");
  exactResponseKeys(response, [
    "schema_version",
    "action",
    "plan",
    "tasks",
    "accepted_receipt_id",
    "rollback_receipt_id",
    "restored_at",
  ], "rollback response");
  if (response.schema_version !== PLAN_PROJECT_LINK_SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${PLAN_PROJECT_LINK_SCHEMA_VERSION}`);
  }
  if (response.action !== "restored") throw new Error("action must be restored");
  const plan = responsePlan(response.plan, expectation.plan_id);
  responseTasks(response.tasks, expectation.plan_id);
  if (responseString(response.accepted_receipt_id, "accepted_receipt_id") !== expectation.receipt_id) {
    throw new Error("accepted_receipt_id must match the rollback request");
  }
  const expectedRollbackReceiptId = planProjectLinkRollbackReceiptId(expectation.receipt_id);
  if (responseString(response.rollback_receipt_id, "rollback_receipt_id") !== expectedRollbackReceiptId) {
    throw new Error("rollback_receipt_id must match the deterministic rollback receipt identity");
  }
  const restoredAt = responseDateTime(response.restored_at, "restored_at");
  if (plan.updated_at !== restoredAt) {
    throw new Error("restored_at must equal plan.updated_at");
  }
  return value as PlanProjectLinkRollbackResult;
}
