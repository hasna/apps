import {
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  postgresTodosSyncSchemaSql,
  type TodosPostgresQueryClient,
} from "../storage/postgres-sync.js";
import {
  canonicalDigest,
  canonicalJson,
  deterministicUuid,
  taskSubtreeTransferRequestDigest,
  taskSubtreeTransferRollbackRequestDigest,
} from "./canonical.js";
import { prepareTransfer, validateApplySnapshot, type TransferPlanRecord, type TransferSnapshot, type TransferTaskRecord } from "./planner.js";
import { postgresTodosTaskSubtreeTransferSchemaSql } from "./schema-sql.js";
import {
  TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
  TodosTaskSubtreeTransferError,
  type PostgresTodosTaskSubtreeTransferAuthorityOptions,
  type TodosTaskSubtreeTransferApplyRequest,
  type TodosTaskSubtreeTransferAuthorityOptions,
  type TodosTaskSubtreeTransferImage,
  type TodosTaskSubtreeTransferInspectRequest,
  type TodosTaskSubtreeTransferInspection,
  type TodosTaskSubtreeTransferReceipt,
  type TodosTaskSubtreeTransferResult,
  type TodosTaskSubtreeTransferRollbackRequest,
} from "./types.js";
import type { TodosTaskSubtreeTransferBackend } from "./backend.js";

function safeIdentifier(value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  if (!/^[a-z_][a-z0-9_]*$/.test(candidate)) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_INVALID_INPUT",
      "PostgreSQL table name must be a safe identifier",
    );
  }
  return candidate;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function payloadOf(row: Record<string, unknown>): Record<string, unknown> {
  return (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>;
}

function taskRecord(row: Record<string, unknown>): TransferTaskRecord {
  const payload = payloadOf(row);
  return {
    task_id: String(payload.id ?? row.object_id),
    project_id: payload.project_id == null ? null : String(payload.project_id),
    parent_id: payload.parent_id == null ? null : String(payload.parent_id),
    plan_id: payload.plan_id == null ? null : String(payload.plan_id),
    task_list_id: payload.task_list_id == null ? null : String(payload.task_list_id),
    version: Number(payload.version ?? row.version ?? 1),
    updated_at: timestamp(payload.updated_at ?? row.updated_at),
    archived_at: payload.archived_at == null ? null : String(payload.archived_at),
  };
}

function planRecord(row: Record<string, unknown>): TransferPlanRecord {
  const payload = payloadOf(row);
  return {
    plan_id: String(payload.id ?? row.object_id),
    project_id: payload.project_id == null ? null : String(payload.project_id),
    task_list_id: payload.task_list_id == null ? null : String(payload.task_list_id),
    updated_at: timestamp(payload.updated_at ?? row.updated_at),
  };
}

export class PostgresTodosTaskSubtreeTransferBackend implements TodosTaskSubtreeTransferBackend {
  readonly kind = "postgresql" as const;
  private readonly service: string;
  private readonly tableName: string;
  private readonly tenantId: string;
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly client: import("./types.js").TodosTaskSubtreeTransferPostgresClient,
    options: PostgresTodosTaskSubtreeTransferAuthorityOptions = {},
  ) {
    this.service = options.service ?? "todos";
    this.tableName = safeIdentifier(options.tableName, DEFAULT_TODOS_POSTGRES_SYNC_TABLE);
    this.tenantId = options.tenantId ?? "default";
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const sql of postgresTodosSyncSchemaSql(this.tableName)) await this.client.query(sql);
      for (const sql of postgresTodosTaskSubtreeTransferSchemaSql()) await this.client.query(sql);
    })();
    await this.schemaReady;
  }

  private async snapshot(
    client: TodosPostgresQueryClient,
    input: TodosTaskSubtreeTransferInspectRequest,
    forUpdate = false,
  ): Promise<TransferSnapshot> {
    const lock = forUpdate ? " FOR UPDATE" : "";
    const source = await client.query<Record<string, unknown>>(
      `SELECT object_id, payload, updated_at, version FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
         AND payload->>'project_id' = $2 ORDER BY object_id${lock}`,
      [this.service, input.source_project_id],
    );
    const allTasks = await client.query<Record<string, unknown>>(
      `SELECT object_id, payload, updated_at, version FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL ORDER BY object_id${lock}`,
      [this.service],
    );
    const plans = await client.query<Record<string, unknown>>(
      `SELECT object_id, payload, updated_at, version FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'plans' AND deleted_at IS NULL ORDER BY object_id${lock}`,
      [this.service],
    );
    const destinationProject = await client.query(
      `SELECT 1 FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'projects' AND object_id = $2
         AND deleted_at IS NULL LIMIT 1${lock}`,
      [this.service, input.destination_project_id],
    );
    const destinationList = await client.query(
      `SELECT 1 FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'task_lists' AND object_id = $2
         AND deleted_at IS NULL AND payload->>'project_id' = $3 LIMIT 1`,
      [this.service, input.destination_task_list_id, input.destination_project_id],
    );
    const destinationParent = input.destination_parent_id === null
      ? true
      : (await client.query(
        `SELECT 1 FROM ${this.tableName}
         WHERE service = $1 AND object_type = 'tasks' AND object_id = $2
           AND deleted_at IS NULL AND payload->>'project_id' = $3 LIMIT 1`,
        [this.service, input.destination_parent_id, input.destination_project_id],
      )).rows.length === 1;
    return {
      source_tasks: source.rows.map(taskRecord),
      plan_tasks: allTasks.rows.map(taskRecord),
      plans: plans.rows.map(planRecord),
      destination_project_found: destinationProject.rows.length === 1,
      destination_task_list_found: destinationList.rows.length === 1,
      destination_parent_found: destinationParent,
    };
  }

  async inspect(input: TodosTaskSubtreeTransferInspectRequest): Promise<TodosTaskSubtreeTransferInspection> {
    await this.ensureSchema();
    return prepareTransfer(await this.snapshot(this.client, input), input).inspection;
  }

  private async insertPayload(
    client: TodosPostgresQueryClient,
    task: TransferTaskRecord,
    update: { project_id: string | null; task_list_id: string | null; plan_id: string | null; parent_id: string | null },
    now: string,
  ): Promise<void> {
    const current = await client.query<Record<string, unknown>>(
      `SELECT payload FROM ${this.tableName}
       WHERE service = $1 AND object_type = 'tasks' AND object_id = $2
         AND deleted_at IS NULL FOR UPDATE`,
      [this.service, task.task_id],
    );
    const row = current.rows[0];
    if (!row) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_NOT_FOUND", `Task not found: ${task.task_id}`);
    const payload = payloadOf(row);
    if (Number(payload.version ?? 1) !== task.version) {
      throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT", "Task changed during transfer", { task_id: task.task_id });
    }
    const next = {
      ...payload,
      ...update,
      version: task.version + 1,
      updated_at: now,
    };
    const result = await client.query(
      `UPDATE ${this.tableName} SET payload = $1::jsonb, updated_at = $2, version = $3
       WHERE service = $4 AND object_type = 'tasks' AND object_id = $5
         AND deleted_at IS NULL AND version = $6
       RETURNING object_id`,
      [canonicalJson(next), now, task.version + 1, this.service, task.task_id, task.version],
    );
    if (result.rows.length !== 1) {
      throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT", "Task CAS failed", { task_id: task.task_id });
    }
  }

  async apply(input: TodosTaskSubtreeTransferApplyRequest, options: TodosTaskSubtreeTransferAuthorityOptions): Promise<TodosTaskSubtreeTransferResult> {
    await this.ensureSchema();
    if (!this.client.transaction) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_ATOMICITY_UNAVAILABLE",
        "PostgreSQL subtree transfer requires an authoritative transaction-capable client",
      );
    }
    return this.client.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('todos:task-parent-integrity', 0))");
      const requestDigest = taskSubtreeTransferRequestDigest(input);
      const existing = await tx.query<Record<string, unknown>>(
        `SELECT result_json, request_digest, precondition_digest, idempotency_key
         FROM todos_task_subtree_transfer_receipts
         WHERE tenant_id = $1 AND kind = 'apply'
           AND (idempotency_key = $2 OR (operation_id = $3 AND step_id = $4))
         ORDER BY created_at ASC LIMIT 1`,
        [this.tenantId, input.idempotency_key, input.operation_id, input.step_id],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.request_digest !== requestDigest || row.precondition_digest !== input.precondition_digest || row.idempotency_key !== input.idempotency_key) {
          throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_CONFLICT", "The operation was already accepted for a different request");
        }
        return { ...(typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json) as TodosTaskSubtreeTransferResult, duplicate: true };
      }
      const snapshot = await this.snapshot(tx, input, true);
      const prepared = prepareTransfer(snapshot, input);
      validateApplySnapshot(prepared, input, snapshot.plans);
      const now = options.now?.() ?? new Date().toISOString();
      const priorImage: TodosTaskSubtreeTransferImage = {
        tasks: prepared.prior_tasks,
        plans: prepared.prior_plans,
      };
      for (const task of prepared.prior_tasks) {
        await this.insertPayload(tx, task, {
          project_id: input.destination_project_id,
          task_list_id: input.destination_task_list_id,
          plan_id: prepared.task_plan_targets.get(task.task_id) ?? null,
          parent_id: task.task_id === input.root_task_id ? input.destination_parent_id : task.parent_id,
        }, now);
      }
      if (options.faultInjector && await options.faultInjector("after_task_writes")) throw new Error("Injected task-subtree-transfer fault at after_task_writes");
      for (const plan of prepared.prior_plans) {
        const row = await tx.query<Record<string, unknown>>(
          `SELECT payload FROM ${this.tableName}
           WHERE service = $1 AND object_type = 'plans' AND object_id = $2
             AND deleted_at IS NULL FOR UPDATE`,
          [this.service, plan.plan_id],
        );
        const current = row.rows[0] ? payloadOf(row.rows[0]) : null;
        if (!current || String(current.project_id ?? "") !== String(plan.project_id ?? "") || (current.task_list_id ?? null) !== plan.task_list_id || timestamp(current.updated_at ?? row.rows[0]?.updated_at) !== plan.updated_at) {
          throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT", "Contained plan changed during transfer", { plan_id: plan.plan_id });
        }
        const result = await tx.query(
          `UPDATE ${this.tableName} SET payload = jsonb_set(jsonb_set(jsonb_set(payload, '{project_id}', to_jsonb($1::text)), '{task_list_id}', to_jsonb($2::text)), '{updated_at}', to_jsonb($3::text)), updated_at = $3
           WHERE service = $4 AND object_type = 'plans' AND object_id = $5 AND deleted_at IS NULL
           RETURNING object_id`,
          [input.destination_project_id, input.destination_task_list_id, now, this.service, plan.plan_id],
        );
        if (result.rows.length !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT",
            "Contained plan update did not affect exactly one row",
            { plan_id: plan.plan_id },
          );
        }
      }
      if (options.faultInjector && await options.faultInjector("after_plan_writes")) throw new Error("Injected task-subtree-transfer fault at after_plan_writes");
      const postImage: TodosTaskSubtreeTransferImage = {
        tasks: prepared.prior_tasks.map((task) => ({
          ...task,
          project_id: input.destination_project_id,
          task_list_id: input.destination_task_list_id,
          plan_id: prepared.task_plan_targets.get(task.task_id) ?? null,
          parent_id: task.task_id === input.root_task_id ? input.destination_parent_id : task.parent_id,
          version: task.version + 1,
          updated_at: now,
        })),
        plans: prepared.prior_plans.map((plan) => ({ ...plan, project_id: input.destination_project_id, task_list_id: input.destination_task_list_id, updated_at: now })),
      };
      const resultDigest = canonicalDigest({ route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE, request_digest: requestDigest, prior_image: priorImage, post_image: postImage });
      const receipt: TodosTaskSubtreeTransferReceipt = {
        receipt_id: deterministicUuid(TODOS_TASK_SUBTREE_TRANSFER_ROUTE, "apply", input.operation_id, input.step_id, input.idempotency_key, requestDigest),
        authority: "todos",
        route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
        schema_version: 1,
        kind: "apply",
        operation_id: input.operation_id,
        step_id: input.step_id,
        idempotency_key: input.idempotency_key,
        request_digest: requestDigest,
        precondition_digest: input.precondition_digest,
        result_digest: resultDigest,
        apply_receipt_id: null,
        source_project_id: input.source_project_id,
        destination_project_id: input.destination_project_id,
        destination_task_list_id: input.destination_task_list_id,
        root_task_id: input.root_task_id,
        source_population_digest: input.source_population_digest,
        prior_image: priorImage,
        post_image: postImage,
        shared_plan_splits: input.shared_plan_splits,
        created_at: now,
      };
      const result: TodosTaskSubtreeTransferResult = { duplicate: false, receipt, moved_task_ids: prepared.prior_tasks.map((task) => task.task_id), moved_plan_ids: prepared.prior_plans.map((plan) => plan.plan_id), complete: true };
      await tx.query(
        `INSERT INTO todos_task_subtree_transfer_receipts (
          receipt_id, tenant_id, kind, operation_id, step_id, idempotency_key,
          request_digest, precondition_digest, result_digest, apply_receipt_id,
          request_json, result_json, created_at
        ) VALUES ($1, $2, 'apply', $3, $4, $5, $6, $7, $8, NULL, $9::jsonb, $10::jsonb, $11)`,
        [receipt.receipt_id, this.tenantId, receipt.operation_id, receipt.step_id, receipt.idempotency_key, receipt.request_digest, receipt.precondition_digest, receipt.result_digest, canonicalJson(input), canonicalJson(result), now],
      );
      if (options.faultInjector && await options.faultInjector("after_receipt_write")) throw new Error("Injected task-subtree-transfer fault at after_receipt_write");
      return result;
    });
  }

  async readExact(receiptId: string): Promise<TodosTaskSubtreeTransferResult> {
    await this.ensureSchema();
    const row = await this.client.query<Record<string, unknown>>(
      `SELECT result_json FROM todos_task_subtree_transfer_receipts WHERE tenant_id = $1 AND receipt_id = $2 LIMIT 1`,
      [this.tenantId, receiptId],
    );
    if (!row.rows[0]) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_RECEIPT_NOT_FOUND", `Transfer receipt not found: ${receiptId}`);
    return { ...(typeof row.rows[0].result_json === "string" ? JSON.parse(String(row.rows[0].result_json)) : row.rows[0].result_json) as TodosTaskSubtreeTransferResult, duplicate: false };
  }

  async rollback(input: TodosTaskSubtreeTransferRollbackRequest, options: TodosTaskSubtreeTransferAuthorityOptions): Promise<TodosTaskSubtreeTransferResult> {
    await this.ensureSchema();
    if (!this.client.transaction) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_ATOMICITY_UNAVAILABLE", "PostgreSQL subtree rollback requires a transaction-capable client");
    return this.client.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('todos:task-parent-integrity', 0))");
      const requestDigest = taskSubtreeTransferRollbackRequestDigest(input);
      const existing = await tx.query<Record<string, unknown>>(
        `SELECT result_json, request_digest, precondition_digest, idempotency_key
         FROM todos_task_subtree_transfer_receipts
         WHERE tenant_id = $1 AND kind = 'rollback'
           AND (idempotency_key = $2 OR (operation_id = $3 AND step_id = $4))
         ORDER BY created_at ASC LIMIT 1`,
        [this.tenantId, input.idempotency_key, input.operation_id, input.step_id],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.request_digest !== requestDigest || row.precondition_digest !== input.precondition_digest || row.idempotency_key !== input.idempotency_key) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_CONFLICT", "The rollback operation was already accepted for a different request");
        return { ...(typeof row.result_json === "string" ? JSON.parse(String(row.result_json)) : row.result_json) as TodosTaskSubtreeTransferResult, duplicate: true };
      }
      const applyRow = await tx.query<Record<string, unknown>>(
        `SELECT result_json FROM todos_task_subtree_transfer_receipts WHERE tenant_id = $1 AND kind = 'apply' AND receipt_id = $2 LIMIT 1`,
        [this.tenantId, input.receipt_id],
      );
      if (!applyRow.rows[0]) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_RECEIPT_NOT_FOUND", `Apply receipt not found: ${input.receipt_id}`);
      const applied = (typeof applyRow.rows[0].result_json === "string" ? JSON.parse(String(applyRow.rows[0].result_json)) : applyRow.rows[0].result_json) as TodosTaskSubtreeTransferResult;
      const expectedPrecondition = canonicalDigest({ route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE, direction: "rollback", operation_id: input.operation_id, step_id: input.step_id, apply_receipt_id: input.receipt_id, apply_result_digest: applied.receipt.result_digest });
      if (input.precondition_digest !== expectedPrecondition) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_DIGEST_MISMATCH", "Rollback precondition digest does not match the exact apply receipt", { expected_precondition_digest: expectedPrecondition });
      const now = options.now?.() ?? new Date().toISOString();
      for (const task of applied.receipt.post_image.tasks) {
        const row = await tx.query<Record<string, unknown>>(
          `SELECT payload FROM ${this.tableName} WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [this.service, task.task_id],
        );
        if (!row.rows[0]) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT", "Transferred task disappeared", { task_id: task.task_id });
        const payload = payloadOf(row.rows[0]);
        if (Number(payload.version ?? 1) !== task.version || String(payload.project_id ?? "") !== String(task.project_id ?? "") || (payload.parent_id ?? null) !== task.parent_id || (payload.plan_id ?? null) !== task.plan_id || (payload.task_list_id ?? null) !== task.task_list_id) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT", "Transferred task changed after apply", { task_id: task.task_id });
      }
      for (const task of applied.receipt.prior_image.tasks) {
        const row = await tx.query<Record<string, unknown>>(
          `SELECT payload FROM ${this.tableName} WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL`,
          [this.service, task.task_id],
        );
        const payload = row.rows[0] ? payloadOf(row.rows[0]) : null;
        if (!payload) throw new TodosTaskSubtreeTransferError("TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT", "Task disappeared during rollback", { task_id: task.task_id });
        const next = { ...payload, project_id: task.project_id, task_list_id: task.task_list_id, plan_id: task.plan_id, parent_id: task.parent_id, version: task.version + 2, updated_at: now };
        const result = await tx.query(
          `UPDATE ${this.tableName} SET payload = $1::jsonb, updated_at = $2, version = $3
           WHERE service = $4 AND object_type = 'tasks' AND object_id = $5 AND deleted_at IS NULL AND version = $6
           RETURNING object_id`,
          [canonicalJson(next), now, task.version + 2, this.service, task.task_id, task.version + 1],
        );
        if (result.rows.length !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
            "Task rollback did not affect exactly one row",
            { task_id: task.task_id },
          );
        }
      }
      if (options.faultInjector && await options.faultInjector("after_rollback_task_writes")) throw new Error("Injected task-subtree-transfer fault at after_rollback_task_writes");
      for (const plan of applied.receipt.prior_image.plans) {
        const post = applied.receipt.post_image.plans.find((candidate) => candidate.plan_id === plan.plan_id)!;
        const result = await tx.query(
          `UPDATE ${this.tableName}
           SET payload = jsonb_set(
             jsonb_set(
               jsonb_set(payload, '{project_id}', to_jsonb($1::text)),
               '{task_list_id}',
               COALESCE(to_jsonb($2::text), 'null'::jsonb)
             ),
             '{updated_at}',
             to_jsonb($3::text)
           ), updated_at = $3
           WHERE service = $4 AND object_type = 'plans' AND object_id = $5 AND deleted_at IS NULL
             AND payload->>'project_id' = $6 AND COALESCE(payload->>'task_list_id', '') = COALESCE($7, '') AND payload->>'updated_at' = $8
           RETURNING object_id`,
          [plan.project_id, plan.task_list_id, now, this.service, plan.plan_id, post.project_id, post.task_list_id, post.updated_at],
        );
        if (result.rows.length !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
            "Contained plan rollback did not affect exactly one row",
            { plan_id: plan.plan_id },
          );
        }
      }
      if (options.faultInjector && await options.faultInjector("after_rollback_plan_writes")) throw new Error("Injected task-subtree-transfer fault at after_rollback_plan_writes");
      const restored: TodosTaskSubtreeTransferImage = {
        tasks: applied.receipt.prior_image.tasks.map((task) => ({ ...task, version: task.version + 2, updated_at: now })),
        plans: applied.receipt.prior_image.plans.map((plan) => ({ ...plan, updated_at: now })),
      };
      const resultDigest = canonicalDigest({ route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE, direction: "rollback", apply_receipt_id: input.receipt_id, prior_image: applied.receipt.post_image, post_image: restored });
      const receipt: TodosTaskSubtreeTransferReceipt = { ...applied.receipt, receipt_id: deterministicUuid(TODOS_TASK_SUBTREE_TRANSFER_ROUTE, "rollback", input.operation_id, input.step_id, input.idempotency_key, input.receipt_id), kind: "rollback", step_id: input.step_id, idempotency_key: input.idempotency_key, request_digest: requestDigest, precondition_digest: input.precondition_digest, result_digest: resultDigest, apply_receipt_id: input.receipt_id, prior_image: applied.receipt.post_image, post_image: restored, created_at: now };
      const result: TodosTaskSubtreeTransferResult = { duplicate: false, receipt, moved_task_ids: applied.moved_task_ids, moved_plan_ids: applied.moved_plan_ids, complete: true };
      await tx.query(
        `INSERT INTO todos_task_subtree_transfer_receipts (
          receipt_id, tenant_id, kind, operation_id, step_id, idempotency_key,
          request_digest, precondition_digest, result_digest, apply_receipt_id,
          request_json, result_json, created_at
        ) VALUES ($1, $2, 'rollback', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)`,
        [receipt.receipt_id, this.tenantId, receipt.operation_id, receipt.step_id, receipt.idempotency_key, receipt.request_digest, receipt.precondition_digest, receipt.result_digest, receipt.apply_receipt_id, canonicalJson(input), canonicalJson(result), now],
      );
      if (options.faultInjector && await options.faultInjector("after_rollback_receipt_write")) throw new Error("Injected task-subtree-transfer fault at after_rollback_receipt_write");
      return result;
    });
  }
}
