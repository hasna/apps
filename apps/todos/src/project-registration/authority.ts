import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { getPackageVersion } from "../lib/package-version.js";
import { normalizeSlug } from "../lib/slugs.js";
import type { Project, TaskList } from "../types/index.js";
import type {
  TodosProjectRegistrationAuthorityScope,
  TodosProjectRegistrationBackend,
  TodosProjectRegistrationBackendTransaction,
  TodosProjectRegistrationBindingRow,
  TodosProjectRegistrationReceiptRow,
} from "./backend.js";
import {
  PostgresTodosProjectRegistrationBackend,
  type PostgresTodosProjectRegistrationBackendOptions,
  type TodosProjectRegistrationPostgresClient,
} from "./postgres.js";
import { SqliteTodosProjectRegistrationBackend } from "./sqlite.js";
import {
  TODOS_PROJECT_REGISTRATION_CALLER_ROUTE,
  TODOS_PROJECT_REGISTRATION_ROUTE,
  TodosProjectRegistrationError,
  type TodosProjectRegistrationAuthority,
  type TodosProjectRegistrationAuthorityOptions,
  type TodosProjectRegistrationBounds,
  type TodosProjectRegistrationCapability,
  type TodosProjectRegistrationDirection,
  type TodosProjectRegistrationFaultPoint,
  type TodosProjectRegistrationInverseVerification,
  type TodosProjectRegistrationLookupRequest,
  type TodosProjectRegistrationLookupResult,
  type TodosProjectRegistrationReceipt,
  type TodosProjectRegistrationRecord,
  type TodosProjectRegistrationRequest,
  type TodosProjectRegistrationResourceKind,
} from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_ID_PATTERN = /^wks_[A-Za-z0-9][A-Za-z0-9_-]{11,}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const STEP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_PATTERN = /^prk_[0-9a-f]{48}$/;

class WriteBoundaryError extends Error {
  constructor(
    readonly point: Exclude<TodosProjectRegistrationFaultPoint, "after_commit">,
    readonly cause: unknown,
  ) {
    super(`Todos project registration failed at ${point}`);
  }
}

export function canonicalProjectRegistrationJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) out[key] = canonicalize(entry);
  }
  return out;
}

export function digestProjectRegistrationValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalProjectRegistrationJson(value))
    .digest("hex");
}

export function deriveTodosProjectRegistrationIdempotencyKey(input: {
  operation_id: string;
  step_id: string;
  direction: TodosProjectRegistrationDirection;
  target_selector: string;
  request_digest: string;
  precondition_digest: string;
}): string {
  return `prk_${digestProjectRegistrationValue({
    route: TODOS_PROJECT_REGISTRATION_CALLER_ROUTE,
    ...input,
  }).slice(0, 48)}`;
}

function responseBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function assertBounds(bounds: TodosProjectRegistrationBounds): void {
  if (!Number.isSafeInteger(bounds.response_byte_limit) || bounds.response_byte_limit <= 0) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS",
      "response_byte_limit must be a positive integer",
    );
  }
  if (!Number.isSafeInteger(bounds.time_budget_ms) || bounds.time_budget_ms <= 0) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS",
      "time_budget_ms must be a positive integer",
    );
  }
}

function assertResourceKind(value: unknown): asserts value is TodosProjectRegistrationResourceKind {
  if (value !== "project" && value !== "task_list") {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "resource_kind must be project or task_list",
    );
  }
}

function assertDirection(value: unknown): asserts value is TodosProjectRegistrationDirection {
  if (value !== "forward" && value !== "inverse") {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "direction must be forward or inverse",
    );
  }
}

function assertWithinBounds(
  value: unknown,
  bounds: TodosProjectRegistrationBounds,
  startedAt: number,
): { response_bytes: number; elapsed_ms: number } {
  const bytes = responseBytes(value);
  if (bytes > bounds.response_byte_limit) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE",
      `registration response requires ${bytes} bytes but the bound is ${bounds.response_byte_limit}`,
      { response_bytes: bytes, response_byte_limit: bounds.response_byte_limit },
    );
  }
  const elapsed = Date.now() - startedAt;
  if (elapsed > bounds.time_budget_ms) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_TIME_BUDGET_EXCEEDED",
      `registration call took ${elapsed}ms but the bound is ${bounds.time_budget_ms}ms`,
      { elapsed_ms: elapsed, time_budget_ms: bounds.time_budget_ms },
    );
  }
  return { response_bytes: bytes, elapsed_ms: elapsed };
}

function withResponseControl<T extends Record<string, unknown>>(
  payload: T,
  bounds: TodosProjectRegistrationBounds,
  startedAt: number,
): T & { response_control: TodosProjectRegistrationLookupResult["response_control"] } {
  const envelope = {
    ...payload,
    response_control: {
      response_byte_limit: bounds.response_byte_limit,
      time_budget_ms: bounds.time_budget_ms,
      response_bytes: 0,
      elapsed_ms: 0,
      complete: true as const,
      truncated: false as const,
    },
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const measured = assertWithinBounds(envelope, bounds, startedAt);
    const stable =
      envelope.response_control.response_bytes === measured.response_bytes
      && envelope.response_control.elapsed_ms === measured.elapsed_ms;
    envelope.response_control = {
      response_byte_limit: bounds.response_byte_limit,
      time_budget_ms: bounds.time_budget_ms,
      response_bytes: measured.response_bytes,
      elapsed_ms: measured.elapsed_ms,
      complete: true,
      truncated: false,
    };
    if (stable) break;
  }
  const finalMeasurement = assertWithinBounds(envelope, bounds, startedAt);
  envelope.response_control.response_bytes = finalMeasurement.response_bytes;
  envelope.response_control.elapsed_ms = finalMeasurement.elapsed_ms;
  return envelope;
}

function requireString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  const min = options.min ?? 1;
  const max = options.max ?? 512;
  if (
    typeof value !== "string"
    || value.length < min
    || value.length > max
    || /[\u0000-\u001f]/.test(value)
    || (options.pattern && !options.pattern.test(value))
  ) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      `${field} is not a valid bounded registration identifier`,
    );
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      `${field} must contain exactly: ${wanted.join(", ")}`,
    );
  }
}

function publicReceipt(
  row: TodosProjectRegistrationReceiptRow,
): TodosProjectRegistrationReceipt {
  const {
    target_selector: _targetSelector,
    normalized_call_digest: _normalizedCallDigest,
    ...receipt
  } = row;
  return receipt;
}

function projectRegistrationPath(projectId: string): string {
  return `hasna-project://${encodeURIComponent(projectId)}`;
}

function taskListSlug(projectSlug: string): string {
  const slug = normalizeSlug(projectSlug);
  if (!slug || slug !== projectSlug) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "project_slug must be canonical kebab-case",
    );
  }
  return `todos-${slug}`;
}

function deterministicTaskPrefix(projectSlug: string): string {
  const letters = projectSlug.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (letters.slice(0, 3) || "PRJ").padEnd(3, "X");
}

function projectRecord(project: Project): TodosProjectRegistrationRecord {
  return {
    target_id: project.id,
    revision: project.updated_at,
    digest: digestProjectRegistrationValue({
      id: project.id,
      name: project.name,
      path: project.path,
      description: project.description,
      task_list_id: project.task_list_id,
      task_prefix: project.task_prefix,
      task_counter: project.task_counter,
      created_at: project.created_at,
      updated_at: project.updated_at,
    }),
  };
}

function taskListRecord(taskList: TaskList): TodosProjectRegistrationRecord {
  return {
    target_id: taskList.id,
    revision: taskList.updated_at,
    digest: digestProjectRegistrationValue({
      id: taskList.id,
      project_id: taskList.project_id,
      slug: taskList.slug,
      name: taskList.name,
      description: taskList.description,
      metadata: taskList.metadata,
      created_at: taskList.created_at,
      updated_at: taskList.updated_at,
    }),
  };
}

function receiptId(input: Omit<TodosProjectRegistrationReceiptRow, "receipt_id" | "created_at">): string {
  return `tpr_${digestProjectRegistrationValue(input).slice(0, 40)}`;
}

function capabilityMatches(
  request: Pick<
    TodosProjectRegistrationRequest,
    "authority_route" | "package_version" | "authority_id" | "tenant_id" | "corpus_id"
  >,
  capability: TodosProjectRegistrationCapability,
): boolean {
  return request.authority_route === capability.route
    && request.package_version === capability.package_version
    && request.authority_id === capability.authority_id
    && request.tenant_id === capability.tenant_id
    && request.corpus_id === capability.corpus_id;
}

function authorityScope(
  capability: TodosProjectRegistrationCapability,
): TodosProjectRegistrationAuthorityScope {
  return {
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
  };
}

function assertCapabilityRequest(
  request: Pick<
    TodosProjectRegistrationRequest,
    "authority_route" | "package_version" | "authority_id" | "tenant_id" | "corpus_id"
  >,
  capability: TodosProjectRegistrationCapability,
): void {
  if (!capabilityMatches(request, capability)) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
      "registration request does not match this authority capability identity",
    );
  }
}

function normalizedCallDigest(request: TodosProjectRegistrationRequest): string {
  return digestProjectRegistrationValue({
    authority_route: request.authority_route,
    package_version: request.package_version,
    authority_id: request.authority_id,
    tenant_id: request.tenant_id,
    corpus_id: request.corpus_id,
    operation_id: request.operation_id,
    step_id: request.step_id,
    resource_kind: request.resource_kind,
    direction: request.direction,
    target_selector: request.target_selector,
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
    project_id: request.project_id,
    project_slug: request.project_slug,
    project_name: request.project_name,
    desired: request.desired,
    accepted_receipt_id: request.accepted_receipt?.receipt_id ?? null,
  });
}

function assertCommonRequest(
  request: TodosProjectRegistrationRequest,
  capability: TodosProjectRegistrationCapability,
): void {
  assertBounds(request);
  assertResourceKind(request.resource_kind);
  assertDirection(request.direction);
  assertCapabilityRequest(request, capability);
  requireString(request.operation_id, "operation_id", {
    min: 8,
    max: 128,
    pattern: OPERATION_PATTERN,
  });
  requireString(request.step_id, "step_id", {
    min: 3,
    max: 128,
    pattern: STEP_PATTERN,
  });
  requireString(request.target_selector, "target_selector", { max: 512 });
  requireString(request.project_id, "project_id", {
    min: 16,
    max: 128,
    pattern: WORKSPACE_ID_PATTERN,
  });
  requireString(request.project_name, "project_name", { max: 256 });
  requireString(request.project_slug, "project_slug", { max: 128 });
  requireString(request.request_digest, "request_digest", {
    min: 64,
    max: 64,
    pattern: SHA256_PATTERN,
  });
  requireString(request.precondition_digest, "precondition_digest", {
    min: 64,
    max: 64,
    pattern: SHA256_PATTERN,
  });
  requireString(request.idempotency_key, "idempotency_key", {
    min: 52,
    max: 52,
    pattern: IDEMPOTENCY_PATTERN,
  });
  if (!request.desired || typeof request.desired !== "object" || Array.isArray(request.desired)) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "desired must be a JSON object",
    );
  }
  const expectedKey = deriveTodosProjectRegistrationIdempotencyKey({
    operation_id: request.operation_id,
    step_id: request.step_id,
    direction: request.direction,
    target_selector: request.target_selector,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
  });
  if (request.idempotency_key !== expectedKey) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_IDEMPOTENCY_MISMATCH",
      "idempotency_key does not match the deterministic operation/step/direction payload",
      { expected: expectedKey },
    );
  }
  taskListSlug(request.project_slug);
}

function assertForwardRequest(
  request: TodosProjectRegistrationRequest,
  capability: TodosProjectRegistrationCapability,
): void {
  assertCommonRequest(request, capability);
  if (request.direction !== "forward") {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "create requires direction=forward",
    );
  }
  const expectedRequestDigest = digestProjectRegistrationValue(request.desired);
  const expectedPreconditionDigest = digestProjectRegistrationValue({
    target_selector: request.target_selector,
    expected: "absent",
  });
  if (
    request.request_digest !== expectedRequestDigest
    || request.precondition_digest !== expectedPreconditionDigest
  ) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_DIGEST_MISMATCH",
      "request_digest or precondition_digest does not match normalized forward semantics",
      {
        expected_request_digest: expectedRequestDigest,
        expected_precondition_digest: expectedPreconditionDigest,
      },
    );
  }

  if (request.resource_kind === "project") {
    exactKeys(
      request.desired,
      ["source_project_id", "source_project_slug", "name"],
      "project desired",
    );
    if (
      request.desired["source_project_id"] !== request.project_id
      || request.desired["source_project_slug"] !== request.project_slug
      || request.desired["name"] !== request.project_name
      || request.target_selector !== request.project_id
    ) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
        "project desired state and target selector must match the complete Projects identity",
      );
    }
    return;
  }

  if (request.resource_kind === "task_list") {
    exactKeys(
      request.desired,
      ["todos_project_id", "source_project_id", "name"],
      "task-list desired",
    );
    const todosProjectId = request.desired["todos_project_id"];
    if (typeof todosProjectId !== "string" || !UUID_PATTERN.test(todosProjectId)) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED",
        "task-list create requires the exact full Todos project UUID",
      );
    }
    if (
      request.target_selector !== `${todosProjectId}:default`
      || request.desired["source_project_id"] !== request.project_id
      || request.desired["name"] !== request.project_name
    ) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
        "task-list desired state must bind the exact Todos project id and Projects identity",
      );
    }
    return;
  }

  throw new TodosProjectRegistrationError(
    "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
    "unsupported registration resource kind",
  );
}

function assertInverseRequest(
  request: TodosProjectRegistrationRequest,
  capability: TodosProjectRegistrationCapability,
): TodosProjectRegistrationReceipt {
  assertCommonRequest(request, capability);
  if (request.direction !== "inverse") {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "compensate requires direction=inverse",
    );
  }
  const accepted = request.accepted_receipt;
  if (
    !accepted
    || accepted.authority !== "todos"
    || accepted.route !== capability.route
    || accepted.package_version !== capability.package_version
    || accepted.authority_id !== capability.authority_id
    || accepted.tenant_id !== capability.tenant_id
    || accepted.corpus_id !== capability.corpus_id
    || accepted.operation_id !== request.operation_id
    || accepted.step_id !== request.step_id
    || accepted.resource_kind !== request.resource_kind
    || accepted.direction !== "forward"
    || accepted.outcome !== "accepted"
    || !accepted.created_by_operation
    || !accepted.target_id
    || !accepted.result_revision
    || !accepted.result_digest
  ) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_INVALID_INPUT",
      "inverse requires the complete accepted forward receipt created by this operation",
    );
  }
  exactKeys(
    request.desired,
    ["accepted_receipt_id", "target_id"],
    "inverse desired",
  );
  const expectedDesired = {
    accepted_receipt_id: accepted.receipt_id,
    target_id: accepted.target_id,
  };
  const expectedPrecondition = {
    expected_revision: accepted.result_revision,
    expected_digest: accepted.result_digest,
  };
  const expectedRequestDigest = digestProjectRegistrationValue(expectedDesired);
  const expectedPreconditionDigest = digestProjectRegistrationValue(expectedPrecondition);
  if (
    canonicalProjectRegistrationJson(request.desired)
      !== canonicalProjectRegistrationJson(expectedDesired)
    || request.request_digest !== expectedRequestDigest
    || request.precondition_digest !== expectedPreconditionDigest
    || request.target_selector !== accepted.target_id
  ) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_DIGEST_MISMATCH",
      "inverse request does not match the accepted receipt and exact readback precondition",
    );
  }
  return accepted;
}

function makeReceipt(
  input: Omit<TodosProjectRegistrationReceiptRow, "receipt_id" | "created_at">,
  createdAt: string,
): TodosProjectRegistrationReceiptRow {
  return {
    ...input,
    receipt_id: receiptId(input),
    created_at: createdAt,
  };
}

function receiptBase(
  request: TodosProjectRegistrationRequest,
  callDigest: string,
  capability: TodosProjectRegistrationCapability,
): Pick<
  TodosProjectRegistrationReceiptRow,
  | "authority"
  | "route"
  | "package_version"
  | "authority_id"
  | "tenant_id"
  | "corpus_id"
  | "operation_id"
  | "step_id"
  | "resource_kind"
  | "direction"
  | "target_selector"
  | "idempotency_key"
  | "request_digest"
  | "precondition_digest"
  | "normalized_call_digest"
> {
  return {
    authority: "todos",
    route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    operation_id: request.operation_id,
    step_id: request.step_id,
    resource_kind: request.resource_kind,
    direction: request.direction,
    target_selector: request.target_selector,
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
    normalized_call_digest: callDigest,
  };
}

function makeAcceptedReceipt(
  request: TodosProjectRegistrationRequest,
  callDigest: string,
  capability: TodosProjectRegistrationCapability,
  record: TodosProjectRegistrationRecord,
  createdAt: string,
): TodosProjectRegistrationReceiptRow {
  return makeReceipt({
    ...receiptBase(request, callDigest, capability),
    outcome: "accepted",
    reason: null,
    target_id: record.target_id,
    result_revision: record.revision,
    result_digest: record.digest,
    duplicate_of_receipt_id: null,
    accepted_receipt_id: request.direction === "inverse"
      ? request.accepted_receipt!.receipt_id
      : null,
    created_by_operation: true,
  }, createdAt);
}

function makeDuplicateReceipt(
  request: TodosProjectRegistrationRequest,
  callDigest: string,
  capability: TodosProjectRegistrationCapability,
  accepted: TodosProjectRegistrationReceiptRow,
  createdAt: string,
): TodosProjectRegistrationReceiptRow {
  return makeReceipt({
    ...receiptBase(request, callDigest, capability),
    outcome: "duplicate_of_accepted",
    reason: null,
    target_id: accepted.target_id,
    result_revision: accepted.result_revision,
    result_digest: accepted.result_digest,
    duplicate_of_receipt_id: accepted.receipt_id,
    accepted_receipt_id: null,
    created_by_operation: false,
  }, createdAt);
}

function makeTerminalReceipt(
  request: TodosProjectRegistrationRequest,
  callDigest: string,
  capability: TodosProjectRegistrationCapability,
  reason: string,
  createdAt: string,
  options: {
    targetId?: string | null;
    acceptedReceiptId?: string | null;
  } = {},
): TodosProjectRegistrationReceiptRow {
  return makeReceipt({
    ...receiptBase(request, callDigest, capability),
    outcome: "terminal_nonacceptance",
    reason,
    target_id: options.targetId ?? null,
    result_revision: null,
    result_digest: null,
    duplicate_of_receipt_id: null,
    accepted_receipt_id: options.acceptedReceiptId ?? null,
    created_by_operation: false,
  }, createdAt);
}

async function insertDeterministicReceipt(
  transaction: TodosProjectRegistrationBackendTransaction,
  receipt: TodosProjectRegistrationReceiptRow,
): Promise<TodosProjectRegistrationReceiptRow> {
  if (await transaction.insertReceipt(receipt)) return receipt;
  const existing = await transaction.getReceiptById(receipt.receipt_id);
  const { created_at: _existingCreatedAt, ...existingContent } = existing ?? {};
  const { created_at: _receiptCreatedAt, ...receiptContent } = receipt;
  if (
    !existing
    || canonicalProjectRegistrationJson(existingContent)
      !== canonicalProjectRegistrationJson(receiptContent)
  ) {
    throw new TodosProjectRegistrationError(
      "TODOS_PROJECT_REGISTRATION_CONFLICT",
      "deterministic receipt id is occupied by different immutable content",
      { receipt_id: receipt.receipt_id },
    );
  }
  return existing;
}

function bindingFor(
  request: TodosProjectRegistrationRequest,
  callDigest: string,
  timestamp: string,
  capability: TodosProjectRegistrationCapability,
): TodosProjectRegistrationBindingRow {
  return {
    ...authorityScope(capability),
    resource_kind: request.resource_kind,
    target_selector: request.target_selector,
    operation_id: request.operation_id,
    step_id: request.step_id,
    direction: "forward",
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
    normalized_call_digest: callDigest,
    state: "pending",
    target_id: null,
    accepted_receipt_id: null,
    result_revision: null,
    result_digest: null,
    removed_receipt_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export class PackageOwnedTodosProjectRegistrationAuthority
implements TodosProjectRegistrationAuthority {
  readonly authority = "todos" as const;
  private readonly capabilityValue: TodosProjectRegistrationCapability;
  private readonly now: () => string;
  private readonly faultInjector?: TodosProjectRegistrationAuthorityOptions["faultInjector"];

  constructor(
    private readonly backend: TodosProjectRegistrationBackend,
    options: TodosProjectRegistrationAuthorityOptions = {},
  ) {
    this.capabilityValue = {
      authority: "todos",
      route: TODOS_PROJECT_REGISTRATION_ROUTE,
      package_version: options.packageVersion ?? getPackageVersion(import.meta.url),
      authority_id: options.authorityId ?? "todos",
      tenant_id: options.tenantId ?? backend.kind,
      corpus_id: options.corpusId ?? `todos:${backend.kind}`,
      supported_resources: ["project", "task_list"],
      conditional_create: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      ambiguous_outcome_reconciliation: true,
    };
    this.now = options.now ?? (() => new Date().toISOString());
    this.faultInjector = options.faultInjector;
  }

  async capability(): Promise<TodosProjectRegistrationCapability> {
    return {
      ...this.capabilityValue,
      supported_resources: [...this.capabilityValue.supported_resources],
    };
  }

  private async fault(
    point: Exclude<TodosProjectRegistrationFaultPoint, "after_commit">,
    request: TodosProjectRegistrationRequest,
  ): Promise<void> {
    if (!this.faultInjector) return;
    try {
      await this.faultInjector(point, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        resource_kind: request.resource_kind,
        direction: request.direction,
      });
    } catch (cause) {
      throw new WriteBoundaryError(point, cause);
    }
  }

  private async afterCommit(request: TodosProjectRegistrationRequest): Promise<void> {
    await this.faultInjector?.("after_commit", {
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
    });
  }

  private async duplicateFor(
    transaction: TodosProjectRegistrationBackendTransaction,
    request: TodosProjectRegistrationRequest,
    callDigest: string,
    accepted: TodosProjectRegistrationReceiptRow,
  ): Promise<TodosProjectRegistrationReceiptRow> {
    const duplicate = makeDuplicateReceipt(
      request,
      callDigest,
      this.capabilityValue,
      accepted,
      this.now(),
    );
    return insertDeterministicReceipt(transaction, duplicate);
  }

  private async terminalFor(
    transaction: TodosProjectRegistrationBackendTransaction,
    request: TodosProjectRegistrationRequest,
    callDigest: string,
    reason: string,
    options: {
      targetId?: string | null;
      acceptedReceiptId?: string | null;
    } = {},
  ): Promise<TodosProjectRegistrationReceiptRow> {
    return insertDeterministicReceipt(
      transaction,
      makeTerminalReceipt(
        request,
        callDigest,
        this.capabilityValue,
        reason,
        this.now(),
        options,
      ),
    );
  }

  private async existingForwardResolution(
    transaction: TodosProjectRegistrationBackendTransaction,
    request: TodosProjectRegistrationRequest,
    callDigest: string,
  ): Promise<TodosProjectRegistrationReceiptRow | null> {
    const exact = await transaction.getReceiptForLookup({
      ...authorityScope(this.capabilityValue),
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      idempotency_key: request.idempotency_key,
      target_selector: request.target_selector,
    });
    if (exact) {
      if (exact.outcome === "terminal_nonacceptance") return exact;
      const accepted = exact.outcome === "accepted"
        ? exact
        : await transaction.getReceiptById(exact.duplicate_of_receipt_id!);
      if (!accepted) {
        throw new TodosProjectRegistrationError(
          "TODOS_PROJECT_REGISTRATION_CONFLICT",
          "duplicate receipt points to a missing accepted receipt",
        );
      }
      if (accepted.normalized_call_digest !== callDigest) {
        return this.terminalFor(
          transaction,
          request,
          callDigest,
          "operation_step_semantics_changed",
          { targetId: accepted.target_id },
        );
      }
      return this.duplicateFor(transaction, request, callDigest, accepted);
    }

    const accepted = await transaction.getAcceptedReceiptForStep({
      ...authorityScope(this.capabilityValue),
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: "forward",
    });
    if (!accepted) return null;
    if (accepted.normalized_call_digest === callDigest) {
      return this.duplicateFor(transaction, request, callDigest, accepted);
    }
    return this.terminalFor(
      transaction,
      request,
      callDigest,
      "operation_step_semantics_changed",
      { targetId: accepted.target_id },
    );
  }

  private async createObject(
    transaction: TodosProjectRegistrationBackendTransaction,
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationRecord | TodosProjectRegistrationReceiptRow> {
    if (request.resource_kind === "project") {
      const path = projectRegistrationPath(request.project_id);
      const slug = taskListSlug(request.project_slug);
      const conflict = await transaction.findProjectConflict(path, slug);
      if (conflict) {
        return this.terminalFor(
          transaction,
          request,
          normalizedCallDigest(request),
          "target_already_exists",
          { targetId: conflict.id },
        );
      }
      await this.fault("before_object_write", request);
      const project = await transaction.createProject({
        name: request.project_name,
        path,
        description: `Registered from Projects workspace ${request.project_id}`,
        task_list_id: slug,
        task_prefix: deterministicTaskPrefix(request.project_slug),
      });
      await this.fault("after_object_write", request);
      return projectRecord(project);
    }

    const todosProjectId = String(request.desired["todos_project_id"]);
    const sourceBinding = await transaction.getBinding(
      authorityScope(this.capabilityValue),
      "project",
      request.project_id,
    );
    if (
      !sourceBinding
      || sourceBinding.state !== "accepted"
      || sourceBinding.target_id !== todosProjectId
    ) {
      return this.terminalFor(
        transaction,
        request,
        normalizedCallDigest(request),
        "exact_parent_registration_missing",
        { targetId: todosProjectId },
      );
    }
    const parent = await transaction.getProject(todosProjectId);
    if (!parent) {
      return this.terminalFor(
        transaction,
        request,
        normalizedCallDigest(request),
        "exact_parent_project_missing",
        { targetId: todosProjectId },
      );
    }
    const slug = taskListSlug(request.project_slug);
    const conflict = await transaction.findTaskListConflict(todosProjectId, slug);
    if (conflict) {
      return this.terminalFor(
        transaction,
        request,
        normalizedCallDigest(request),
        "target_already_exists",
        { targetId: conflict.id },
      );
    }
    await this.fault("before_object_write", request);
    const taskList = await transaction.createTaskList({
      name: request.project_name,
      slug,
      project_id: todosProjectId,
      metadata: {
        source_project_id: request.project_id,
        registration_authority: "todos",
      },
    });
    await this.fault("after_object_write", request);
    if (taskList.project_id !== todosProjectId) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_CONFLICT",
        "task-list create did not preserve the exact full Todos project id",
      );
    }
    return taskListRecord(taskList);
  }

  async create(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationReceipt> {
    const startedAt = Date.now();
    assertForwardRequest(request, this.capabilityValue);
    const callDigest = normalizedCallDigest(request);
    try {
      const row = await this.backend.transaction(async (transaction) => {
        await transaction.lockStep({
          ...authorityScope(this.capabilityValue),
          operation_id: request.operation_id,
          step_id: request.step_id,
          resource_kind: request.resource_kind,
          direction: request.direction,
        });
        const resolved = await this.existingForwardResolution(
          transaction,
          request,
          callDigest,
        );
        if (resolved) return resolved;

        const timestamp = this.now();
        const claimed = await transaction.claimBinding(
          bindingFor(request, callDigest, timestamp, this.capabilityValue),
        );
        if (!claimed) {
          const binding = await transaction.getBinding(
            authorityScope(this.capabilityValue),
            request.resource_kind,
            request.target_selector,
          );
          if (
            binding?.state === "accepted"
            && binding.normalized_call_digest === callDigest
            && binding.accepted_receipt_id
          ) {
            const accepted = await transaction.getReceiptById(binding.accepted_receipt_id);
            if (accepted) {
              return this.duplicateFor(transaction, request, callDigest, accepted);
            }
          }
          return this.terminalFor(
            transaction,
            request,
            callDigest,
            binding?.state === "removed"
              ? "target_registration_was_removed"
              : "target_already_registered",
            { targetId: binding?.target_id ?? null },
          );
        }

        const recordOrTerminal = await this.createObject(transaction, request);
        if ("outcome" in recordOrTerminal) {
          await transaction.setBindingTerminal(
            authorityScope(this.capabilityValue),
            request.resource_kind,
            request.target_selector,
            this.now(),
          );
          return recordOrTerminal;
        }
        const accepted = makeAcceptedReceipt(
          request,
          callDigest,
          this.capabilityValue,
          recordOrTerminal,
          this.now(),
        );
        await this.fault("before_receipt_write", request);
        const stored = await insertDeterministicReceipt(transaction, accepted);
        await this.fault("after_receipt_write", request);
        await transaction.setBindingAccepted(
          authorityScope(this.capabilityValue),
          request.resource_kind,
          request.target_selector,
          {
            target_id: recordOrTerminal.target_id,
            accepted_receipt_id: stored.receipt_id,
            result_revision: recordOrTerminal.revision,
            result_digest: recordOrTerminal.digest,
            updated_at: this.now(),
          },
        );
        return stored;
      });
      await this.afterCommit(request);
      const receipt = publicReceipt(row);
      assertWithinBounds(receipt, request, startedAt);
      return receipt;
    } catch (error) {
      if (!(error instanceof WriteBoundaryError)) throw error;
      const terminal = await this.recordWriteFailure(request, callDigest, error.point);
      const receipt = publicReceipt(terminal);
      assertWithinBounds(receipt, request, startedAt);
      return receipt;
    }
  }

  private async recordWriteFailure(
    request: TodosProjectRegistrationRequest,
    callDigest: string,
    point: Exclude<TodosProjectRegistrationFaultPoint, "after_commit">,
  ): Promise<TodosProjectRegistrationReceiptRow> {
    return this.backend.transaction(async (transaction) => {
      await transaction.lockStep({
        ...authorityScope(this.capabilityValue),
        operation_id: request.operation_id,
        step_id: request.step_id,
        resource_kind: request.resource_kind,
        direction: request.direction,
      });
      const exact = await transaction.getReceiptForLookup({
        ...authorityScope(this.capabilityValue),
        operation_id: request.operation_id,
        step_id: request.step_id,
        resource_kind: request.resource_kind,
        direction: request.direction,
        idempotency_key: request.idempotency_key,
        target_selector: request.target_selector,
      });
      if (exact) return exact;
      const accepted = await transaction.getAcceptedReceiptForStep({
        ...authorityScope(this.capabilityValue),
        operation_id: request.operation_id,
        step_id: request.step_id,
        resource_kind: request.resource_kind,
        direction: request.direction,
      });
      if (accepted) {
        return accepted.normalized_call_digest === callDigest
          ? this.duplicateFor(transaction, request, callDigest, accepted)
          : this.terminalFor(
            transaction,
            request,
            callDigest,
            "operation_step_semantics_changed",
            { targetId: accepted.target_id },
          );
      }
      const timestamp = this.now();
      const claimed = await transaction.claimBinding(
        bindingFor(request, callDigest, timestamp, this.capabilityValue),
      );
      const terminal = await this.terminalFor(
        transaction,
        request,
        callDigest,
        `write_failed:${point}`,
      );
      if (claimed) {
        await transaction.setBindingTerminal(
          authorityScope(this.capabilityValue),
          request.resource_kind,
          request.target_selector,
          this.now(),
        );
      }
      return terminal;
    });
  }

  async readExact(request: {
    resource_kind: TodosProjectRegistrationResourceKind;
    target_id: string;
    target: unknown;
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<TodosProjectRegistrationRecord> {
    const startedAt = Date.now();
    assertBounds(request);
    assertResourceKind(request.resource_kind);
    if (!UUID_PATTERN.test(request.target_id)) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED",
        "exact readback requires a complete Todos object UUID",
      );
    }
    const record = request.resource_kind === "project"
      ? await this.backend.getProject(request.target_id).then((value) =>
        value ? projectRecord(value) : null)
      : await this.backend.getTaskList(request.target_id).then((value) =>
        value ? taskListRecord(value) : null);
    if (!record) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_RECORD_NOT_FOUND",
        `registered ${request.resource_kind} was not found by exact id`,
        { target_id: request.target_id },
      );
    }
    assertWithinBounds(record, request, startedAt);
    return record;
  }

  async lookupReceipt(
    request: TodosProjectRegistrationLookupRequest,
  ): Promise<TodosProjectRegistrationLookupResult> {
    const startedAt = Date.now();
    assertBounds(request);
    assertResourceKind(request.resource_kind);
    assertDirection(request.direction);
    if (request.max_items !== 1) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS",
        "max_items must be exactly 1 for terminal receipt lookup",
      );
    }
    if (
      request.authority !== "todos"
      || request.authority_route !== this.capabilityValue.route
      || request.package_version !== this.capabilityValue.package_version
      || request.authority_id !== this.capabilityValue.authority_id
      || request.tenant_id !== this.capabilityValue.tenant_id
      || request.corpus_id !== this.capabilityValue.corpus_id
    ) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
        "receipt lookup does not match this authority capability identity",
      );
    }
    requireString(request.operation_id, "operation_id", {
      min: 8,
      max: 128,
      pattern: OPERATION_PATTERN,
    });
    requireString(request.step_id, "step_id", {
      min: 3,
      max: 128,
      pattern: STEP_PATTERN,
    });
    requireString(request.target_selector, "target_selector", { max: 512 });
    requireString(request.idempotency_key, "idempotency_key", {
      min: 52,
      max: 52,
      pattern: IDEMPOTENCY_PATTERN,
    });
    if (request.target_id !== undefined && !UUID_PATTERN.test(request.target_id)) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED",
        "receipt lookup target_id must be a complete Todos object UUID",
      );
    }
    const receipt = await this.backend.getReceiptForLookup({
      ...authorityScope(this.capabilityValue),
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      idempotency_key: request.idempotency_key,
      target_selector: request.target_selector,
    });
    if (!receipt || (request.target_id && receipt.target_id !== request.target_id)) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND",
        "no exact terminal receipt matched the bounded lookup",
      );
    }
    return withResponseControl(
      { receipt: publicReceipt(receipt) },
      request,
      startedAt,
    );
  }

  private async storedAcceptedReceipt(
    request: TodosProjectRegistrationRequest,
    supplied: TodosProjectRegistrationReceipt,
  ): Promise<TodosProjectRegistrationReceiptRow> {
    const stored = await this.backend.getReceiptById(supplied.receipt_id);
    if (
      !stored
      || stored.outcome !== "accepted"
      || !stored.created_by_operation
      || canonicalProjectRegistrationJson(publicReceipt(stored))
        !== canonicalProjectRegistrationJson(supplied)
    ) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND",
        "accepted receipt is not an exact immutable receipt owned by this authority",
        { receipt_id: supplied.receipt_id },
      );
    }
    if (
      stored.operation_id !== request.operation_id
      || stored.step_id !== request.step_id
      || stored.resource_kind !== request.resource_kind
      || stored.target_id !== supplied.target_id
    ) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND",
        "accepted receipt does not own this exact operation step and target",
      );
    }
    return stored;
  }

  async compensate(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationReceipt> {
    const startedAt = Date.now();
    const suppliedAccepted = assertInverseRequest(request, this.capabilityValue);
    const accepted = await this.storedAcceptedReceipt(request, suppliedAccepted);
    const callDigest = normalizedCallDigest(request);
    try {
      const row = await this.backend.transaction(async (transaction) => {
        await transaction.lockStep({
          ...authorityScope(this.capabilityValue),
          operation_id: request.operation_id,
          step_id: request.step_id,
          resource_kind: request.resource_kind,
          direction: request.direction,
        });
        const exact = await transaction.getReceiptForLookup({
          ...authorityScope(this.capabilityValue),
          operation_id: request.operation_id,
          step_id: request.step_id,
          resource_kind: request.resource_kind,
          direction: "inverse",
          idempotency_key: request.idempotency_key,
          target_selector: request.target_selector,
        });
        if (exact) return exact;

        const storedAccepted = await transaction.getReceiptById(accepted.receipt_id);
        if (
          !storedAccepted
          || storedAccepted.outcome !== "accepted"
          || !storedAccepted.created_by_operation
        ) {
          throw new TodosProjectRegistrationError(
            "TODOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND",
            "accepted receipt disappeared before conditional inverse",
          );
        }
        const binding = await transaction.getBinding(
          authorityScope(this.capabilityValue),
          accepted.resource_kind,
          accepted.target_selector,
        );
        if (
          !binding
          || binding.state !== "accepted"
          || binding.accepted_receipt_id !== accepted.receipt_id
          || binding.target_id !== accepted.target_id
        ) {
          return this.terminalFor(
            transaction,
            request,
            callDigest,
            "target_not_owned_by_receipt",
            {
              targetId: accepted.target_id,
              acceptedReceiptId: accepted.receipt_id,
            },
          );
        }

        await transaction.lockCompensationWrites();
        const object = request.resource_kind === "project"
          ? await transaction.getProject(accepted.target_id!)
          : await transaction.getTaskList(accepted.target_id!);
        if (!object) {
          return this.terminalFor(
            transaction,
            request,
            callDigest,
            "target_missing_before_inverse",
            {
              targetId: accepted.target_id,
              acceptedReceiptId: accepted.receipt_id,
            },
          );
        }
        const current = request.resource_kind === "project"
          ? projectRecord(object as Project)
          : taskListRecord(object as TaskList);
        if (
          current.revision !== accepted.result_revision
          || current.digest !== accepted.result_digest
        ) {
          return this.terminalFor(
            transaction,
            request,
            callDigest,
            "target_drifted",
            {
              targetId: accepted.target_id,
              acceptedReceiptId: accepted.receipt_id,
            },
          );
        }
        if (await transaction.hasDependents(
          request.resource_kind,
          accepted.target_id!,
        )) {
          return this.terminalFor(
            transaction,
            request,
            callDigest,
            "target_has_dependents",
            {
              targetId: accepted.target_id,
              acceptedReceiptId: accepted.receipt_id,
            },
          );
        }

        await this.fault("before_object_write", request);
        const deleted = request.resource_kind === "project"
          ? await transaction.deleteProject(accepted.target_id!)
          : await transaction.deleteTaskList(accepted.target_id!);
        if (!deleted) {
          throw new TodosProjectRegistrationError(
            "TODOS_PROJECT_REGISTRATION_CONFLICT",
            "conditional inverse could not delete the exact accepted target",
          );
        }
        await this.fault("after_object_write", request);
        const inverseRecord: TodosProjectRegistrationRecord = {
          target_id: accepted.target_id!,
          revision: "absent",
          digest: digestProjectRegistrationValue({
            target_id: accepted.target_id,
            accepted_receipt_id: accepted.receipt_id,
            absent: true,
          }),
        };
        const inverse = makeAcceptedReceipt(
          request,
          callDigest,
          this.capabilityValue,
          inverseRecord,
          this.now(),
        );
        await this.fault("before_receipt_write", request);
        const stored = await insertDeterministicReceipt(transaction, inverse);
        await this.fault("after_receipt_write", request);
        await transaction.setBindingRemoved(
          authorityScope(this.capabilityValue),
          accepted.resource_kind,
          accepted.target_selector,
          stored.receipt_id,
          this.now(),
        );
        return stored;
      });
      await this.afterCommit(request);
      const receipt = publicReceipt(row);
      assertWithinBounds(receipt, request, startedAt);
      return receipt;
    } catch (error) {
      if (!(error instanceof WriteBoundaryError)) throw error;
      const terminal = await this.backend.transaction(async (transaction) => {
        await transaction.lockStep({
          ...authorityScope(this.capabilityValue),
          operation_id: request.operation_id,
          step_id: request.step_id,
          resource_kind: request.resource_kind,
          direction: request.direction,
        });
        return this.terminalFor(
          transaction,
          request,
          callDigest,
          `write_failed:${error.point}`,
          {
            targetId: accepted.target_id,
            acceptedReceiptId: accepted.receipt_id,
          },
        );
      });
      const receipt = publicReceipt(terminal);
      assertWithinBounds(receipt, request, startedAt);
      return receipt;
    }
  }

  async verifyInverse(
    request: TodosProjectRegistrationRequest,
  ): Promise<TodosProjectRegistrationInverseVerification> {
    const startedAt = Date.now();
    const accepted = assertInverseRequest(request, this.capabilityValue);
    await this.storedAcceptedReceipt(request, accepted);
    const receipt = await this.backend.getReceiptForLookup({
      ...authorityScope(this.capabilityValue),
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: "inverse",
      idempotency_key: request.idempotency_key,
      target_selector: request.target_selector,
    });
    if (
      !receipt
      || receipt.outcome !== "accepted"
      || receipt.accepted_receipt_id !== accepted.receipt_id
      || receipt.result_revision !== "absent"
      || !receipt.result_digest
    ) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND",
        "accepted conditional inverse receipt was not found",
      );
    }
    const object = request.resource_kind === "project"
      ? await this.backend.getProject(accepted.target_id!)
      : await this.backend.getTaskList(accepted.target_id!);
    if (object) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_CONFLICT",
        "inverse verification found the accepted target still present",
      );
    }
    const verification = {
      target_id: accepted.target_id!,
      accepted_receipt_id: accepted.receipt_id,
      absent: true as const,
      digest: digestProjectRegistrationValue({
        target_id: accepted.target_id,
        accepted_receipt_id: accepted.receipt_id,
        absent: true,
      }),
    };
    assertWithinBounds(verification, request, startedAt);
    if (verification.digest !== receipt.result_digest) {
      throw new TodosProjectRegistrationError(
        "TODOS_PROJECT_REGISTRATION_CONFLICT",
        "inverse verification digest does not match the immutable receipt",
      );
    }
    return verification;
  }
}

export function createLocalTodosProjectRegistrationAuthority(
  db: Database,
  options: TodosProjectRegistrationAuthorityOptions = {},
): TodosProjectRegistrationAuthority {
  return new PackageOwnedTodosProjectRegistrationAuthority(
    new SqliteTodosProjectRegistrationBackend(db),
    options,
  );
}

export function createPostgresTodosProjectRegistrationAuthority(
  client: TodosProjectRegistrationPostgresClient,
  options: TodosProjectRegistrationAuthorityOptions
    & PostgresTodosProjectRegistrationBackendOptions = {},
): TodosProjectRegistrationAuthority {
  const {
    service,
    tableName,
    cursorTableName,
    ...authorityOptions
  } = options;
  return new PackageOwnedTodosProjectRegistrationAuthority(
    new PostgresTodosProjectRegistrationBackend(client, {
      service,
      tableName,
      cursorTableName,
    }),
    authorityOptions,
  );
}
