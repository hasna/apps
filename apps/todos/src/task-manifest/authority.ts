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
  TODOS_TASK_MANIFEST_ROUTE,
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
  const manifest = sanitizeManifest(parsed);
  const task_ids = Object.fromEntries(manifest.tasks.map((task) => [
    task.key,
    deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, "task", task.key),
  ]));
  const graph = {
    plan_id: deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, "plan", manifest.plan.key),
    task_ids,
    comment_ids: manifest.tasks.flatMap((task) => (task.comments ?? []).map((_, index) =>
      deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, "comment", task.key, String(index)))),
    verification_ids: manifest.tasks.flatMap((task) => (task.verifications ?? []).map((_, index) =>
      deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, "verification", task.key, String(index)))),
    dependency_ids: (manifest.dependencies ?? []).map((edge) =>
      `${task_ids[edge.task]!}::${task_ids[edge.depends_on]!}`),
  };
  const request_digest = canonicalDigest(parsed);
  const effectInputs = [
    {
      topic: "todos.task-manifest.applied",
      payload: { operation_id: manifest.operation_id, project_id: manifest.project_id },
    },
    ...(manifest.effects ?? []),
  ];
  const outbox = effectInputs.map((effect, index) => {
    const payload = { ...effect.payload } as Record<string, unknown>;
    return {
      id: deterministicUuid(TODOS_TASK_MANIFEST_ROUTE, manifest.operation_id, "outbox", String(index)),
      topic: effect.topic,
      payload,
      digest: canonicalDigest({ topic: effect.topic, payload }),
    };
  });
  const result_digest = canonicalDigest({ manifest, graph, outbox });
  return {
    manifest,
    request_digest,
    result_digest,
    receipt_id: deterministicUuid(
      TODOS_TASK_MANIFEST_ROUTE,
      "apply",
      manifest.operation_id,
      manifest.idempotency_key,
      request_digest,
    ),
    graph,
    outbox,
    now,
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
      immutable_receipts: true,
      transactional_outbox: true,
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
    return this.bounded(await this.backend.apply(normalized, faults));
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
    const requestDigest = canonicalDigest(request);
    const compensationReceiptId = deterministicUuid(
      TODOS_TASK_MANIFEST_ROUTE,
      "compensate",
      applied.receipt.operation_id,
      request.idempotency_key,
      requestDigest,
    );
    const receipt: TodosTaskManifestReceipt = {
      receipt_id: compensationReceiptId,
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      kind: "compensate",
      operation_id: applied.receipt.operation_id,
      idempotency_key: request.idempotency_key,
      request_digest: requestDigest,
      result_digest: canonicalDigest({ absent: true, apply_receipt_id: applied.receipt.receipt_id }),
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
