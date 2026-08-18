import type { Database } from "bun:sqlite";
import {
  canonicalDigest,
  canonicalJson,
  deterministicUuid,
  taskSubtreeTransferRequestDigest,
  taskSubtreeTransferRollbackRequestDigest,
} from "./canonical.js";
import {
  prepareTransfer,
  validateApplySnapshot,
  type TransferPlanRecord,
  type TransferSnapshot,
  type TransferTaskRecord,
} from "./planner.js";
import { ensureSqliteTodosTaskSubtreeTransferSchema } from "./schema-sql.js";
import {
  TodosTaskSubtreeTransferError,
  TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
  type TodosTaskSubtreeTransferApplyRequest,
  type TodosTaskSubtreeTransferAuthorityOptions,
  type TodosTaskSubtreeTransferFaultPoint,
  type TodosTaskSubtreeTransferImage,
  type TodosTaskSubtreeTransferInspectRequest,
  type TodosTaskSubtreeTransferInspection,
  type TodosTaskSubtreeTransferReceipt,
  type TodosTaskSubtreeTransferResult,
  type TodosTaskSubtreeTransferRollbackRequest,
} from "./types.js";
import type { TodosTaskSubtreeTransferBackend } from "./backend.js";

const sqliteTails = new WeakMap<Database, Promise<void>>();

async function fault(
  options: TodosTaskSubtreeTransferAuthorityOptions,
  point: TodosTaskSubtreeTransferFaultPoint,
): Promise<void> {
  if (options.faultInjector && await options.faultInjector(point) === true) {
    throw new Error(`Injected task-subtree-transfer fault at ${point}`);
  }
}

function parseResult(value: string, duplicate: boolean): TodosTaskSubtreeTransferResult {
  return { ...(JSON.parse(value) as TodosTaskSubtreeTransferResult), duplicate };
}

function rowImage(row: Record<string, unknown>): TransferTaskRecord {
  return {
    task_id: String(row.id),
    project_id: row.project_id == null ? null : String(row.project_id),
    parent_id: row.parent_id == null ? null : String(row.parent_id),
    plan_id: row.plan_id == null ? null : String(row.plan_id),
    task_list_id: row.task_list_id == null ? null : String(row.task_list_id),
    version: Number(row.version),
    updated_at: String(row.updated_at),
    archived_at: row.archived_at == null ? null : String(row.archived_at),
  };
}

function planImage(row: Record<string, unknown>): TransferPlanRecord {
  return {
    plan_id: String(row.id),
    project_id: row.project_id == null ? null : String(row.project_id),
    task_list_id: row.task_list_id == null ? null : String(row.task_list_id),
    updated_at: String(row.updated_at),
  };
}

function imageFromTaskRow(row: Record<string, unknown>): TodosTaskSubtreeTransferImage["tasks"][number] {
  const image = rowImage(row);
  const { archived_at: _archivedAt, ...withoutArchive } = image;
  return withoutArchive;
}

function imageFromPlanRow(row: Record<string, unknown>): TodosTaskSubtreeTransferImage["plans"][number] {
  return planImage(row);
}

function receiptId(input: TodosTaskSubtreeTransferApplyRequest): string {
  return deterministicUuid(
    TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
    "apply",
    input.operation_id,
    input.step_id,
    input.idempotency_key,
    taskSubtreeTransferRequestDigest(input),
  );
}

function rollbackReceiptId(input: TodosTaskSubtreeTransferRollbackRequest): string {
  return deterministicUuid(
    TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
    "rollback",
    input.operation_id,
    input.step_id,
    input.idempotency_key,
    input.receipt_id,
  );
}

function taskWhere(db: Database, taskId: string): Record<string, unknown> {
  const row = db.query(
    `SELECT id, project_id, parent_id, plan_id, task_list_id, version, updated_at, archived_at
     FROM tasks WHERE id = ? LIMIT 1`,
  ).get(taskId) as Record<string, unknown> | null;
  if (!row) {
    throw new TodosTaskSubtreeTransferError(
      "TODOS_TASK_SUBTREE_TRANSFER_NOT_FOUND",
      `Task not found: ${taskId}`,
      { task_id: taskId },
    );
  }
  return row;
}

export class SqliteTodosTaskSubtreeTransferBackend implements TodosTaskSubtreeTransferBackend {
  readonly kind = "sqlite" as const;

  constructor(
    private readonly db: Database,
    private readonly tenantId = "default",
  ) {
    ensureSqliteTodosTaskSubtreeTransferSchema(db);
  }

  private async serialized<T>(run: () => T | Promise<T>): Promise<T> {
    const previous = sqliteTails.get(this.db) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    sqliteTails.set(this.db, tail);
    await previous;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await run();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      release();
      if (sqliteTails.get(this.db) === tail) sqliteTails.delete(this.db);
    }
  }

  private snapshot(input: TodosTaskSubtreeTransferInspectRequest): TransferSnapshot {
    const sourceTasks = (this.db.query(
      `SELECT id, project_id, parent_id, plan_id, task_list_id, version, updated_at, archived_at
       FROM tasks WHERE project_id = ? ORDER BY id`,
    ).all(input.source_project_id) as Array<Record<string, unknown>>).map(rowImage);
    const allTasks = (this.db.query(
      `SELECT id, project_id, parent_id, plan_id, task_list_id, version, updated_at, archived_at
       FROM tasks ORDER BY id`,
    ).all() as Array<Record<string, unknown>>).map(rowImage);
    const plans = (this.db.query(
      `SELECT id, project_id, task_list_id, updated_at
       FROM plans ORDER BY id`,
    ).all() as Array<Record<string, unknown>>).map(planImage);
    const destinationProjectFound = Boolean(this.db.query(
      "SELECT id FROM projects WHERE id = ? LIMIT 1",
    ).get(input.destination_project_id));
    const destinationTaskList = this.db.query(
      "SELECT id FROM task_lists WHERE id = ? AND project_id = ? LIMIT 1",
    ).get(input.destination_task_list_id, input.destination_project_id);
    const destinationParentFound = input.destination_parent_id === null
      || Boolean(this.db.query(
        "SELECT id FROM tasks WHERE id = ? AND project_id = ? LIMIT 1",
      ).get(input.destination_parent_id, input.destination_project_id));
    return {
      source_tasks: sourceTasks,
      plan_tasks: allTasks,
      plans,
      destination_project_found: destinationProjectFound,
      destination_task_list_found: Boolean(destinationTaskList),
      destination_parent_found: destinationParentFound,
    };
  }

  async inspect(input: TodosTaskSubtreeTransferInspectRequest): Promise<TodosTaskSubtreeTransferInspection> {
    return this.serialized(() => prepareTransfer(this.snapshot(input), input).inspection);
  }

  async apply(
    input: TodosTaskSubtreeTransferApplyRequest,
    options: TodosTaskSubtreeTransferAuthorityOptions,
  ): Promise<TodosTaskSubtreeTransferResult> {
    return this.serialized(async () => {
      const requestDigest = taskSubtreeTransferRequestDigest(input);
      const existing = this.db.query(
        `SELECT result_json, request_digest, precondition_digest, idempotency_key
         FROM todos_task_subtree_transfer_receipts
         WHERE tenant_id = ? AND kind = 'apply'
           AND (idempotency_key = ? OR (operation_id = ? AND step_id = ?))
         ORDER BY created_at ASC LIMIT 1`,
      ).get(this.tenantId, input.idempotency_key, input.operation_id, input.step_id) as Record<string, unknown> | null;
      if (existing) {
        if (
          existing.request_digest !== requestDigest
          || existing.precondition_digest !== input.precondition_digest
          || existing.idempotency_key !== input.idempotency_key
        ) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_CONFLICT",
            "The operation/step or idempotency key was already accepted for a different request",
          );
        }
        return parseResult(String(existing.result_json), true);
      }

      const snapshot = this.snapshot(input);
      const prepared = prepareTransfer(snapshot, input);
      validateApplySnapshot(prepared, input, snapshot.plans);
      const priorImage: TodosTaskSubtreeTransferImage = {
        tasks: prepared.prior_tasks,
        plans: prepared.prior_plans,
      };
      const now = options.now?.() ?? new Date().toISOString();
      const movedTaskIds = prepared.prior_tasks.map((task) => task.task_id);
      for (const task of prepared.prior_tasks) {
        const current = imageFromTaskRow(taskWhere(this.db, task.task_id));
        if (canonicalJson(current) !== canonicalJson(task)) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT",
            "A task changed after inspection",
            { task_id: task.task_id },
          );
        }
      }
      for (const task of prepared.prior_tasks) {
        const targetPlan = prepared.task_plan_targets.get(task.task_id) ?? null;
        const parentId = task.task_id === input.root_task_id
          ? input.destination_parent_id
          : task.parent_id;
        const result = this.db.query(
          `UPDATE tasks
           SET project_id = ?, task_list_id = ?, plan_id = ?, parent_id = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        ).run(
          input.destination_project_id,
          input.destination_task_list_id,
          targetPlan,
          parentId,
          now,
          task.task_id,
          task.version,
        );
        if (result.changes !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT",
            "A task version changed during the atomic transfer",
            { task_id: task.task_id },
          );
        }
      }
      await fault(options, "after_task_writes");
      for (const plan of prepared.prior_plans) {
        const result = this.db.query(
          `UPDATE plans SET project_id = ?, task_list_id = ?, updated_at = ?
           WHERE id = ? AND project_id IS ? AND task_list_id IS ? AND updated_at = ?`,
        ).run(
          input.destination_project_id,
          input.destination_task_list_id,
          now,
          plan.plan_id,
          plan.project_id,
          plan.task_list_id,
          plan.updated_at,
        );
        if (result.changes !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_CAS_CONFLICT",
            "A contained plan changed during the atomic transfer",
            { plan_id: plan.plan_id },
          );
        }
      }
      await fault(options, "after_plan_writes");

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
        plans: prepared.prior_plans.map((plan) => ({
          ...plan,
          project_id: input.destination_project_id,
          task_list_id: input.destination_task_list_id,
          updated_at: now,
        })),
      };
      const resultDigest = canonicalDigest({
        route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
        request_digest: requestDigest,
        prior_image: priorImage,
        post_image: postImage,
      });
      const receipt: TodosTaskSubtreeTransferReceipt = {
        receipt_id: receiptId(input),
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
      const result: TodosTaskSubtreeTransferResult = {
        duplicate: false,
        receipt,
        moved_task_ids: movedTaskIds,
        moved_plan_ids: prepared.prior_plans.map((plan) => plan.plan_id),
        complete: true,
      };
      this.db.query(
        `INSERT INTO todos_task_subtree_transfer_receipts (
          receipt_id, tenant_id, kind, operation_id, step_id, idempotency_key,
          request_digest, precondition_digest, result_digest, apply_receipt_id,
          request_json, result_json, created_at
        ) VALUES (?, ?, 'apply', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        receipt.receipt_id,
        this.tenantId,
        receipt.operation_id,
        receipt.step_id,
        receipt.idempotency_key,
        receipt.request_digest,
        receipt.precondition_digest,
        receipt.result_digest,
        canonicalJson(input),
        canonicalJson(result),
        now,
      );
      await fault(options, "after_receipt_write");
      return result;
    });
  }

  async readExact(receiptIdValue: string): Promise<TodosTaskSubtreeTransferResult> {
    const row = this.db.query(
      `SELECT result_json FROM todos_task_subtree_transfer_receipts
       WHERE tenant_id = ? AND receipt_id = ? LIMIT 1`,
    ).get(this.tenantId, receiptIdValue) as { result_json?: string } | null;
    if (!row) {
      throw new TodosTaskSubtreeTransferError(
        "TODOS_TASK_SUBTREE_TRANSFER_RECEIPT_NOT_FOUND",
        `Transfer receipt not found: ${receiptIdValue}`,
      );
    }
    return parseResult(String(row.result_json), false);
  }

  async rollback(
    input: TodosTaskSubtreeTransferRollbackRequest,
    options: TodosTaskSubtreeTransferAuthorityOptions,
  ): Promise<TodosTaskSubtreeTransferResult> {
    return this.serialized(async () => {
      const requestDigest = taskSubtreeTransferRollbackRequestDigest(input);
      const existing = this.db.query(
        `SELECT result_json, request_digest, precondition_digest, idempotency_key
         FROM todos_task_subtree_transfer_receipts
         WHERE tenant_id = ? AND kind = 'rollback'
           AND (idempotency_key = ? OR (operation_id = ? AND step_id = ?))
         ORDER BY created_at ASC LIMIT 1`,
      ).get(this.tenantId, input.idempotency_key, input.operation_id, input.step_id) as Record<string, unknown> | null;
      if (existing) {
        if (
          existing.request_digest !== requestDigest
          || existing.precondition_digest !== input.precondition_digest
          || existing.idempotency_key !== input.idempotency_key
        ) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_IDEMPOTENCY_CONFLICT",
            "The rollback operation/step or idempotency key was already accepted for a different request",
          );
        }
        return parseResult(String(existing.result_json), true);
      }
      const applyRow = this.db.query(
        `SELECT result_json FROM todos_task_subtree_transfer_receipts
         WHERE tenant_id = ? AND kind = 'apply' AND receipt_id = ? LIMIT 1`,
      ).get(this.tenantId, input.receipt_id) as { result_json?: string } | null;
      if (!applyRow) {
        throw new TodosTaskSubtreeTransferError(
          "TODOS_TASK_SUBTREE_TRANSFER_RECEIPT_NOT_FOUND",
          `Apply receipt not found: ${input.receipt_id}`,
        );
      }
      const applied = parseResult(String(applyRow.result_json), false);
      if (applied.receipt.operation_id !== input.operation_id) {
        throw new TodosTaskSubtreeTransferError(
          "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
          "Rollback operation does not match the apply receipt",
        );
      }
      const expectedPrecondition = canonicalDigest({
        route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
        direction: "rollback",
        operation_id: input.operation_id,
        step_id: input.step_id,
        apply_receipt_id: input.receipt_id,
        apply_result_digest: applied.receipt.result_digest,
      });
      if (input.precondition_digest !== expectedPrecondition) {
        throw new TodosTaskSubtreeTransferError(
          "TODOS_TASK_SUBTREE_TRANSFER_DIGEST_MISMATCH",
          "Rollback precondition digest does not match the exact apply receipt",
          { expected_precondition_digest: expectedPrecondition },
        );
      }
      const now = options.now?.() ?? new Date().toISOString();
      for (const task of applied.receipt.post_image.tasks) {
        const current = imageFromTaskRow(taskWhere(this.db, task.task_id));
        if (canonicalJson(current) !== canonicalJson(task)) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
            "Rollback refused because a transferred task changed after apply",
            { task_id: task.task_id },
          );
        }
      }
      for (const plan of applied.receipt.post_image.plans) {
        const row = this.db.query(
          "SELECT id, project_id, task_list_id, updated_at FROM plans WHERE id = ? LIMIT 1",
        ).get(plan.plan_id) as Record<string, unknown> | null;
        if (!row || canonicalJson(imageFromPlanRow(row)) !== canonicalJson(plan)) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
            "Rollback refused because a transferred plan changed after apply",
            { plan_id: plan.plan_id },
          );
        }
      }
      for (const task of applied.receipt.prior_image.tasks) {
        const result = this.db.query(
          `UPDATE tasks SET project_id = ?, task_list_id = ?, plan_id = ?, parent_id = ?,
             version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        ).run(
          task.project_id,
          task.task_list_id,
          task.plan_id,
          task.parent_id,
          now,
          task.task_id,
          applied.receipt.post_image.tasks.find((candidate) => candidate.task_id === task.task_id)!.version,
        );
        if (result.changes !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
            "Rollback task CAS failed",
            { task_id: task.task_id },
          );
        }
      }
      await fault(options, "after_rollback_task_writes");
      for (const plan of applied.receipt.prior_image.plans) {
        const post = applied.receipt.post_image.plans.find((candidate) => candidate.plan_id === plan.plan_id)!;
        const result = this.db.query(
          `UPDATE plans SET project_id = ?, task_list_id = ?, updated_at = ?
           WHERE id = ? AND project_id IS ? AND task_list_id IS ? AND updated_at = ?`,
        ).run(plan.project_id, plan.task_list_id, now, plan.plan_id, post.project_id, post.task_list_id, post.updated_at);
        if (result.changes !== 1) {
          throw new TodosTaskSubtreeTransferError(
            "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
            "Rollback plan CAS failed",
            { plan_id: plan.plan_id },
          );
        }
      }
      await fault(options, "after_rollback_plan_writes");
      const restored: TodosTaskSubtreeTransferImage = {
        tasks: applied.receipt.prior_image.tasks.map((task) => ({
          ...task,
          version: applied.receipt.post_image.tasks.find((candidate) => candidate.task_id === task.task_id)!.version + 1,
          updated_at: now,
        })),
        plans: applied.receipt.prior_image.plans.map((plan) => ({ ...plan, updated_at: now })),
      };
      const resultDigest = canonicalDigest({
        route: TODOS_TASK_SUBTREE_TRANSFER_ROUTE,
        direction: "rollback",
        apply_receipt_id: input.receipt_id,
        prior_image: applied.receipt.post_image,
        post_image: restored,
      });
      const receipt: TodosTaskSubtreeTransferReceipt = {
        ...applied.receipt,
        receipt_id: rollbackReceiptId(input),
        kind: "rollback",
        step_id: input.step_id,
        idempotency_key: input.idempotency_key,
        request_digest: requestDigest,
        precondition_digest: input.precondition_digest,
        result_digest: resultDigest,
        apply_receipt_id: input.receipt_id,
        prior_image: applied.receipt.post_image,
        post_image: restored,
        created_at: now,
      };
      const result: TodosTaskSubtreeTransferResult = {
        duplicate: false,
        receipt,
        moved_task_ids: applied.moved_task_ids,
        moved_plan_ids: applied.moved_plan_ids,
        complete: true,
      };
      this.db.query(
        `INSERT INTO todos_task_subtree_transfer_receipts (
          receipt_id, tenant_id, kind, operation_id, step_id, idempotency_key,
          request_digest, precondition_digest, result_digest, apply_receipt_id,
          request_json, result_json, created_at
        ) VALUES (?, ?, 'rollback', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receipt.receipt_id,
        this.tenantId,
        receipt.operation_id,
        receipt.step_id,
        receipt.idempotency_key,
        receipt.request_digest,
        receipt.precondition_digest,
        receipt.result_digest,
        receipt.apply_receipt_id,
        canonicalJson(input),
        canonicalJson(result),
        now,
      );
      await fault(options, "after_rollback_receipt_write");
      return result;
    });
  }
}
