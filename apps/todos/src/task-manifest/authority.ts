import { canonicalDigest, canonicalJson, deterministicUuid } from "./canonical.js";
import type { TodosTaskManifestBackend, NormalizedTaskManifest, PreparedTaskManifestFaults } from "./backend.js";
import {
  TODOS_TASK_MANIFEST_BOUNDS,
  parseTodosTaskManifest,
  parseTodosTaskManifestBindingLookup,
  parseTodosTaskManifestCompensation,
} from "./schema.js";
import { SqliteTodosTaskManifestBackend } from "./sqlite.js";
import { PostgresTodosTaskManifestBackend } from "./postgres.js";
import { sanitizePreWriteText, sanitizePreWriteValue } from "../lib/prewrite-secrets.js";
import {
  TODOS_TASK_MANIFEST_CALLER_ROUTE,
  TODOS_TASK_MANIFEST_ROUTE,
  TODOS_TASK_MANIFEST_PLAN_SLUG_PROVENANCE,
  TODOS_TASK_MANIFEST_SCHEMA_VERSION,
  TodosTaskManifestError,
  type PostgresTodosTaskManifestAuthorityOptions,
  type SqliteTodosTaskManifestAuthorityOptions,
  type TodosTaskManifestApplyResult,
  type TodosTaskManifestAuthority,
  type TodosTaskManifestAuthorityOptions,
  type TodosTaskManifestBindingLookupRequest,
  type TodosTaskManifestBindingLookupResult,
  type TodosTaskManifestCapability,
  type TodosTaskManifestCompensateRequest,
  type TodosTaskManifestCompensationResult,
  type TodosTaskManifestFaultPoint,
  type TodosTaskManifestPostgresClient,
  type TodosTaskManifestReceipt,
  type TodosTaskManifest,
  type TodosTaskManifestDirection,
} from "./types.js";

const FAULT_POINTS: readonly TodosTaskManifestFaultPoint[] = [
  "after_plan_write", "after_task_write", "after_dependency_write",
  "after_comment_write", "after_verification_write", "after_outbox_write",
  "after_receipt_write",
];

function resolveTenantId(value: string | undefined): string {
  const tenantId = value ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(tenantId)) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_INVALID_INPUT",
      "tenantId must be a bounded exact authority identifier",
    );
  }
  return tenantId;
}

export function taskManifestRequestDigest(
  manifest: Omit<TodosTaskManifest, "idempotency_key">,
): string {
  const { idempotency_key: _idempotencyKey, ...request } = manifest as TodosTaskManifest;
  return canonicalDigest(request);
}

export function taskManifestCompensationRequestDigest(
  request: Omit<TodosTaskManifestCompensateRequest, "idempotency_key">,
): string {
  return canonicalDigest(request);
}

export function deriveTodosTaskManifestApplyPreconditionDigest(input: Pick<
  TodosTaskManifest,
  "operation_id" | "step_id" | "project_id" | "task_list_id" | "if_binding_version"
>): string {
  return canonicalDigest({
    route: TODOS_TASK_MANIFEST_CALLER_ROUTE,
    direction: "apply",
    operation_id: input.operation_id,
    step_id: input.step_id,
    project_id: input.project_id,
    task_list_id: input.task_list_id ?? null,
    expected_binding_version: input.if_binding_version ?? 0,
  });
}

export function deriveTodosTaskManifestCompensationPreconditionDigest(input: Pick<
  TodosTaskManifestCompensateRequest,
  "operation_id" | "step_id" | "receipt_id" | "if_binding_version"
>): string {
  return canonicalDigest({
    route: TODOS_TASK_MANIFEST_CALLER_ROUTE,
    direction: "compensate",
    operation_id: input.operation_id,
    step_id: input.step_id,
    apply_receipt_id: input.receipt_id,
    expected_binding_version: input.if_binding_version,
  });
}

export function deriveTodosTaskManifestIdempotencyKey(input: {
  operation_id: string;
  step_id: string;
  direction: TodosTaskManifestDirection;
  target_selector: string;
  request_digest: string;
  precondition_digest: string;
}): string {
  return `tmk_${canonicalDigest({
    route: TODOS_TASK_MANIFEST_CALLER_ROUTE,
    ...input,
  }).slice(0, 48)}`;
}

function normalize(input: unknown, now: string): NormalizedTaskManifest {
  const parsed = parseTodosTaskManifest(input);
  const requestBytes = Buffer.byteLength(canonicalJson(parsed), "utf8");
  if (requestBytes > TODOS_TASK_MANIFEST_BOUNDS.request_bytes) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED",
      `Task manifest requires ${requestBytes} bytes but the bound is ${TODOS_TASK_MANIFEST_BOUNDS.request_bytes}`,
      { request_bytes: requestBytes, request_byte_limit: TODOS_TASK_MANIFEST_BOUNDS.request_bytes },
    );
  }
  const { idempotency_key: _idempotencyKey, ...request } = parsed;
  const request_digest = taskManifestRequestDigest(request);
  const manifest = sanitizeManifest(parsed);
  const expectedPreconditionDigest = deriveTodosTaskManifestApplyPreconditionDigest(manifest);
  if (manifest.precondition_digest !== expectedPreconditionDigest) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_DIGEST_MISMATCH",
      "precondition_digest does not match the exact apply target and binding version",
      { expected_precondition_digest: expectedPreconditionDigest },
    );
  }
  const expectedIdempotencyKey = deriveTodosTaskManifestIdempotencyKey({
    operation_id: manifest.operation_id,
    step_id: manifest.step_id,
    direction: "apply",
    target_selector: manifest.project_id,
    request_digest,
    precondition_digest: manifest.precondition_digest,
  });
  const task_ids = Object.fromEntries(manifest.tasks.map((task) => [
    task.key,
    deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, manifest.step_id, "task", task.key),
  ]));
  const graph = {
    plan_id: deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, manifest.step_id, "plan", manifest.plan.key),
    task_ids,
    comment_ids: manifest.tasks.flatMap((task) => (task.comments ?? []).map((_, index) =>
      deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, manifest.step_id, "comment", task.key, String(index)))),
    verification_ids: manifest.tasks.flatMap((task) => (task.verifications ?? []).map((_, index) =>
      deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, manifest.step_id, "verification", task.key, String(index)))),
    dependency_ids: (manifest.dependencies ?? []).map((edge) =>
      `${task_ids[edge.task]!}::${task_ids[edge.depends_on]!}`),
  };
  const effectInputs = [
    {
      topic: "todos.task-manifest.applied",
      payload: { operation_id: manifest.operation_id, step_id: manifest.step_id, project_id: manifest.project_id },
    },
    ...(manifest.effects ?? []),
  ];
  const outbox = effectInputs.map((effect, index) => {
    const payload = { ...effect.payload } as Record<string, unknown>;
    return {
      id: deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, manifest.step_id, "outbox", String(index)),
      topic: effect.topic,
      payload,
      digest: canonicalDigest({ topic: effect.topic, payload }),
    };
  });
  const result_digest = canonicalDigest({ manifest, graph, outbox });
  return {
    manifest,
    request_digest,
    expected_idempotency_key: expectedIdempotencyKey,
    result_digest,
    receipt_id: deterministicUuid(
      TODOS_TASK_MANIFEST_ROUTE,
      "apply",
      manifest.operation_id,
      manifest.step_id,
      manifest.idempotency_key,
      request_digest,
    ),
    terminal_receipt_id: deterministicUuid(
      TODOS_TASK_MANIFEST_ROUTE,
      "terminal",
      "apply",
      manifest.operation_id,
      manifest.step_id,
      manifest.idempotency_key,
      request_digest,
    ),
    graph,
    outbox,
    now,
    plan_slug_provenance: TODOS_TASK_MANIFEST_PLAN_SLUG_PROVENANCE,
  };
}

function sanitizeManifest(manifest: ReturnType<typeof parseTodosTaskManifest>): ReturnType<typeof parseTodosTaskManifest> {
  return {
    ...manifest,
    plan: {
      ...manifest.plan,
      name: sanitizePreWriteText(manifest.plan.name, "task_manifest.plan.name"),
      ...(manifest.plan.description !== undefined
        ? { description: sanitizePreWriteText(manifest.plan.description, "task_manifest.plan.description") }
        : {}),
    },
    tasks: manifest.tasks.map((task) => ({
      ...task,
      title: sanitizePreWriteText(task.title, `task_manifest.tasks.${task.key}.title`),
      ...(task.description !== undefined
        ? { description: sanitizePreWriteText(task.description, `task_manifest.tasks.${task.key}.description`) }
        : {}),
      ...(task.tags !== undefined
        ? { tags: sanitizePreWriteValue(task.tags, `task_manifest.tasks.${task.key}.tags`) }
        : {}),
      ...(task.metadata !== undefined
        ? { metadata: sanitizePreWriteValue(task.metadata, `task_manifest.tasks.${task.key}.metadata`) }
        : {}),
      ...(task.comments !== undefined
        ? {
            comments: task.comments.map((comment, index) => ({
              ...comment,
              content: sanitizePreWriteText(comment.content, `task_manifest.tasks.${task.key}.comments.${index}.content`),
            })),
          }
        : {}),
      ...(task.verifications !== undefined
        ? {
            verifications: task.verifications.map((verification, index) => ({
              ...verification,
              command: sanitizePreWriteText(verification.command, `task_manifest.tasks.${task.key}.verifications.${index}.command`),
              ...(verification.output_summary !== undefined
                ? { output_summary: sanitizePreWriteText(verification.output_summary, `task_manifest.tasks.${task.key}.verifications.${index}.output_summary`) }
                : {}),
              ...(verification.artifact_path !== undefined
                ? { artifact_path: sanitizePreWriteText(verification.artifact_path, `task_manifest.tasks.${task.key}.verifications.${index}.artifact_path`) }
                : {}),
            })),
          }
        : {}),
    })),
    ...(manifest.effects !== undefined
      ? {
          effects: manifest.effects.map((effect, index) => ({
            topic: sanitizePreWriteText(effect.topic, `task_manifest.effects.${index}.topic`),
            payload: sanitizePreWriteValue(effect.payload, `task_manifest.effects.${index}.payload`),
          })),
        }
      : {}),
  };
}

export class PackageOwnedTodosTaskManifestAuthority implements TodosTaskManifestAuthority {
  private readonly tenantId: string;

  constructor(
    private readonly backend: TodosTaskManifestBackend,
    private readonly options: TodosTaskManifestAuthorityOptions = {},
  ) {
    this.tenantId = resolveTenantId(options.tenantId);
  }

  async capability(): Promise<TodosTaskManifestCapability> {
    return {
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: TODOS_TASK_MANIFEST_SCHEMA_VERSION,
      tenant_id: this.tenantId,
      backend: this.backend.kind,
      deterministic_ids: true,
      operation_step_identity: true,
      deterministic_idempotency_keys: true,
      terminal_nonacceptance_receipts: true,
      plan_slug_provenance: TODOS_TASK_MANIFEST_PLAN_SLUG_PROVENANCE,
      immutable_receipts: true,
      transactional_outbox: true,
      idempotent_outbox_delivery: true,
      exact_bounded_readback: true,
      conditional_compensation: true,
      transcript_safe: false,
      bounds: { ...TODOS_TASK_MANIFEST_BOUNDS },
    };
  }

  private now(): string {
    const value = this.options.now?.() ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(value))) {
      throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", "now() returned an invalid timestamp");
    }
    return value;
  }

  private async prepareFaults(): Promise<PreparedTaskManifestFaults> {
    const points = new Set<TodosTaskManifestFaultPoint>();
    if (this.options.faultInjector) {
      for (const point of FAULT_POINTS) {
        if (await this.options.faultInjector(point) === true) points.add(point);
      }
    }
    return { points };
  }

  async apply(input: unknown): Promise<TodosTaskManifestApplyResult> {
    const normalized = normalize(input, this.now());
    const faults = await this.prepareFaults();
    const result = this.bounded(await this.backend.apply(normalized, faults));
    if (result.receipt.outcome === "terminal_nonacceptance") {
      throw new TodosTaskManifestError(
        result.receipt.reason ?? "TODOS_TASK_MANIFEST_GRAPH_CONFLICT",
        "Task-manifest apply reached an immutable terminal nonacceptance",
        { receipt: result.receipt },
      );
    }
    return result;
  }

  readExact(receiptId: string): Promise<TodosTaskManifestApplyResult> {
    if (!receiptId || receiptId.length > 200) {
      throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", "receiptId must be a bounded exact identifier");
    }
    return this.backend.readExact(receiptId).then((result) => this.bounded(result));
  }

  async lookupBinding(
    input: TodosTaskManifestBindingLookupRequest,
  ): Promise<TodosTaskManifestBindingLookupResult> {
    const request = parseTodosTaskManifestBindingLookup(input);
    if (request.max_items !== 1) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED",
        "max_items must be exactly 1 for task-manifest binding lookup",
        { max_items: request.max_items, max_items_limit: 1 },
      );
    }
    if (
      request.authority !== "todos"
      || request.route !== TODOS_TASK_MANIFEST_ROUTE
      || request.schema_version !== TODOS_TASK_MANIFEST_SCHEMA_VERSION
      || request.tenant_id !== this.tenantId
    ) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_CAPABILITY_MISMATCH",
        "Task-manifest binding lookup does not match this authority identity",
      );
    }
    return this.bounded({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: TODOS_TASK_MANIFEST_SCHEMA_VERSION,
      tenant_id: this.tenantId,
      ...await this.backend.lookupBindingByPlanId(request.plan_id),
    });
  }

  markOutboxDelivered(outboxId: string): Promise<void> {
    if (!outboxId || outboxId.length > 200) {
      throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", "outboxId must be a bounded exact identifier");
    }
    return this.backend.markOutboxDelivered(outboxId, this.now());
  }

  async compensate(input: TodosTaskManifestCompensateRequest): Promise<TodosTaskManifestCompensationResult> {
    const request = parseTodosTaskManifestCompensation(input);
    const applied = await this.backend.readExact(request.receipt_id);
    if (applied.receipt.outcome !== "accepted") {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED",
        "Compensation refused: apply receipt is terminal nonacceptance",
      );
    }
    if (request.operation_id !== applied.receipt.operation_id) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT",
        "Compensation operation_id must match the accepted apply operation",
      );
    }
    if (request.step_id === applied.receipt.step_id) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_INVALID_INPUT",
        "Compensation must use a distinct step_id from apply",
      );
    }
    const expectedPreconditionDigest = deriveTodosTaskManifestCompensationPreconditionDigest(request);
    if (request.precondition_digest !== expectedPreconditionDigest) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_DIGEST_MISMATCH",
        "precondition_digest does not match the exact compensation receipt and binding version",
        { expected_precondition_digest: expectedPreconditionDigest },
      );
    }
    const { idempotency_key: _requestIdempotencyKey, ...compensationRequestWithoutKey } = request;
    const requestDigest = taskManifestCompensationRequestDigest(compensationRequestWithoutKey);
    const expectedIdempotencyKey = deriveTodosTaskManifestIdempotencyKey({
      operation_id: request.operation_id,
      step_id: request.step_id,
      direction: "compensate",
      target_selector: request.receipt_id,
      request_digest: requestDigest,
      precondition_digest: request.precondition_digest,
    });
    if (request.idempotency_key !== expectedIdempotencyKey) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_IDEMPOTENCY_MISMATCH",
        "idempotency_key does not match the deterministic operation/step/compensation semantics",
        { expected_idempotency_key: expectedIdempotencyKey },
      );
    }
    const compensationReceiptId = deterministicUuid(
      TODOS_TASK_MANIFEST_ROUTE,
      "compensate",
      request.operation_id,
      request.step_id,
      request.idempotency_key,
      requestDigest,
    );
    const receipt: TodosTaskManifestReceipt = {
      receipt_id: compensationReceiptId,
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      kind: "compensate",
      operation_id: request.operation_id,
      step_id: request.step_id,
      idempotency_key: request.idempotency_key,
      request_digest: requestDigest,
      precondition_digest: request.precondition_digest,
      result_digest: canonicalDigest({ absent: true, apply_receipt_id: applied.receipt.receipt_id }),
      outcome: "accepted",
      reason: null,
      duplicate_of_receipt_id: null,
      binding_version: request.if_binding_version + 1,
      apply_receipt_id: applied.receipt.receipt_id,
      created_at: this.now(),
    };
    return this.bounded(await this.backend.compensate(
      request,
      receipt,
      compensationReceiptId,
      requestDigest,
      receipt.created_at,
    ));
  }

  private bounded<T>(result: T): T {
    const responseBytes = Buffer.byteLength(canonicalJson(result), "utf8");
    if (responseBytes > TODOS_TASK_MANIFEST_BOUNDS.response_bytes) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED",
        `Task-manifest response requires ${responseBytes} bytes but the bound is ${TODOS_TASK_MANIFEST_BOUNDS.response_bytes}`,
        { response_bytes: responseBytes, response_byte_limit: TODOS_TASK_MANIFEST_BOUNDS.response_bytes },
      );
    }
    return result;
  }
}

export function createSqliteTodosTaskManifestAuthority(
  options: SqliteTodosTaskManifestAuthorityOptions,
): TodosTaskManifestAuthority {
  if (!options?.database) {
    throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_ATOMICITY_UNAVAILABLE", "An explicit SQLite Database is required");
  }
  const tenantId = resolveTenantId(options.tenantId);
  return new PackageOwnedTodosTaskManifestAuthority(
    new SqliteTodosTaskManifestBackend(options.database, tenantId),
    { ...options, tenantId },
  );
}

export function createPostgresTodosTaskManifestAuthority(
  client: TodosTaskManifestPostgresClient,
  options: PostgresTodosTaskManifestAuthorityOptions = {},
): TodosTaskManifestAuthority {
  if (!client || typeof client.transaction !== "function") {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_ATOMICITY_UNAVAILABLE",
      "An authoritative PostgreSQL transaction(callback) client is required",
    );
  }
  const tenantId = resolveTenantId(options.tenantId);
  return new PackageOwnedTodosTaskManifestAuthority(
    new PostgresTodosTaskManifestBackend(client, { ...options, tenantId }),
    { ...options, tenantId },
  );
}

export { parseTodosTaskManifest } from "./schema.js";
