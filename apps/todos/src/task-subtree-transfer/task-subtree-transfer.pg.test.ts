/**
 * Real PostgreSQL coverage for the package-owned task-subtree transfer authority.
 *
 * The test uses a unique schema and removes that exact schema afterward. Point
 * TODOS_TEST_PG_URL only at a disposable test database.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTodosCloudQueryClient,
  type TodosCloudQueryClient,
} from "../storage/cloud-client.js";
import {
  createPostgresTodosTaskSubtreeTransferAuthority,
  deriveTodosTaskSubtreeTransferApplyPreconditionDigest,
  deriveTodosTaskSubtreeTransferIdempotencyKey,
  deriveTodosTaskSubtreeTransferRollbackPreconditionDigest,
  taskSubtreeTransferRequestDigest,
  taskSubtreeTransferRollbackRequestDigest,
  type TodosTaskSubtreeTransferApplyRequest,
  type TodosTaskSubtreeTransferAuthority,
  type TodosTaskSubtreeTransferFaultPoint,
  type TodosTaskSubtreeTransferInspection,
  type TodosTaskSubtreeTransferResult,
} from "./index.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const UNIQUE = `${process.pid}_${Date.now()}`;
const SCHEMA = `subtree_transfer_${UNIQUE}`;
const SERVICE = `subtree-transfer-${UNIQUE}`;
const TENANT = `subtree-transfer-${UNIQUE}`;
const NOW = "2026-08-18T20:00:00.000Z";

const SOURCE_PROJECT_ID = "11000000-0000-4000-8000-000000000001";
const DESTINATION_PROJECT_ID = "22000000-0000-4000-8000-000000000002";
const DESTINATION_TASK_LIST_ID = "33000000-0000-4000-8000-000000000003";
const DESTINATION_PARENT_ID = "44000000-0000-4000-8000-000000000004";
const ROOT_TASK_ID = "55000000-0000-4000-8000-000000000005";
const CHILD_TASK_ID = "66000000-0000-4000-8000-000000000006";
const RETAINED_TASK_ID = "77000000-0000-4000-8000-000000000007";
const CONTAINED_PLAN_ID = "88000000-0000-4000-8000-000000000008";
const SHARED_PLAN_ID = "99000000-0000-4000-8000-000000000009";
const DESTINATION_SPLIT_PLAN_ID = "aa000000-0000-4000-8000-00000000000a";

function applyRequest(
  inspection: TodosTaskSubtreeTransferInspection,
  operationId: string,
): TodosTaskSubtreeTransferApplyRequest {
  const base = {
    version: 1 as const,
    operation_id: operationId,
    step_id: "apply",
    idempotency_key: "",
    precondition_digest: "",
    source_project_id: SOURCE_PROJECT_ID,
    destination_project_id: DESTINATION_PROJECT_ID,
    destination_task_list_id: DESTINATION_TASK_LIST_ID,
    root_task_id: ROOT_TASK_ID,
    expected_root_parent_id: inspection.expected_root_parent_id,
    destination_parent_id: DESTINATION_PARENT_ID,
    source_population_digest: inspection.source_population_digest,
    expected_tasks: inspection.expected_tasks.map((task) => ({ ...task })),
    shared_plan_splits: [{
      source_plan_id: SHARED_PLAN_ID,
      destination_plan_id: DESTINATION_SPLIT_PLAN_ID,
    }],
  };
  const precondition_digest = deriveTodosTaskSubtreeTransferApplyPreconditionDigest(base);
  const request_digest = taskSubtreeTransferRequestDigest({
    ...base,
    precondition_digest,
  });
  return {
    ...base,
    precondition_digest,
    idempotency_key: deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: operationId,
      step_id: base.step_id,
      direction: "apply",
      target_selector: ROOT_TASK_ID,
      request_digest,
      precondition_digest,
    }),
  };
}

function rollbackRequest(
  applied: TodosTaskSubtreeTransferResult,
  operationId = applied.receipt.operation_id,
) {
  const base = {
    receipt_id: applied.receipt.receipt_id,
    operation_id: operationId,
    step_id: "rollback",
    idempotency_key: "",
    precondition_digest: "",
  };
  const precondition_digest = deriveTodosTaskSubtreeTransferRollbackPreconditionDigest({
    ...base,
    apply_result_digest: applied.receipt.result_digest,
  });
  const request_digest = taskSubtreeTransferRollbackRequestDigest({
    ...base,
    precondition_digest,
  });
  return {
    ...base,
    precondition_digest,
    idempotency_key: deriveTodosTaskSubtreeTransferIdempotencyKey({
      operation_id: base.operation_id,
      step_id: base.step_id,
      direction: "rollback",
      target_selector: base.receipt_id,
      request_digest,
      precondition_digest,
    }),
  };
}

describe.skipIf(!PG_URL)("task-subtree-transfer PostgreSQL authority", () => {
  let root: TodosCloudQueryClient | undefined;
  let client: TodosCloudQueryClient | undefined;
  let authority: TodosTaskSubtreeTransferAuthority;
  let schemaCreated = false;
  let failAt: TodosTaskSubtreeTransferFaultPoint | null = null;

  async function insertRecord(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
    version = 1,
  ): Promise<void> {
    await client!.query(
      `INSERT INTO todos_sync_records (
        service, object_type, object_id, payload, updated_at, deleted_at, version
      ) VALUES ($1, $2, $3, $4::jsonb, $5, NULL, $6)`,
      [SERVICE, objectType, objectId, payload, NOW, version],
    );
  }

  async function taskPayload(taskId: string): Promise<Record<string, unknown>> {
    const row = await client!.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM todos_sync_records
       WHERE service = $1 AND object_type = 'tasks' AND object_id = $2`,
      [SERVICE, taskId],
    );
    return row.rows[0]!.payload;
  }

  async function planPayload(planId: string): Promise<Record<string, unknown>> {
    const row = await client!.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM todos_sync_records
       WHERE service = $1 AND object_type = 'plans' AND object_id = $2`,
      [SERVICE, planId],
    );
    return row.rows[0]!.payload;
  }

  async function receiptCount(): Promise<string> {
    const row = await client!.query<{ count: string }>(
      "SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts",
    );
    return row.rows[0]!.count;
  }

  beforeAll(async () => {
    root = createTodosCloudQueryClient(PG_URL!);
    await root.query(`CREATE SCHEMA ${SCHEMA}`);
    schemaCreated = true;
    const scopedUrl = new URL(PG_URL!);
    scopedUrl.searchParams.set("options", `-csearch_path=${SCHEMA}`);
    client = createTodosCloudQueryClient(scopedUrl.toString());

    await insertRecord("projects", SOURCE_PROJECT_ID, {
      id: SOURCE_PROJECT_ID,
      name: "Source",
      updated_at: NOW,
    });
    await insertRecord("projects", DESTINATION_PROJECT_ID, {
      id: DESTINATION_PROJECT_ID,
      name: "Destination",
      updated_at: NOW,
    });
    await insertRecord("task_lists", DESTINATION_TASK_LIST_ID, {
      id: DESTINATION_TASK_LIST_ID,
      project_id: DESTINATION_PROJECT_ID,
      name: "Destination",
      updated_at: NOW,
    });
    await insertRecord("plans", CONTAINED_PLAN_ID, {
      id: CONTAINED_PLAN_ID,
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      name: "Contained",
      updated_at: NOW,
    });
    await insertRecord("plans", SHARED_PLAN_ID, {
      id: SHARED_PLAN_ID,
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      name: "Shared",
      updated_at: NOW,
    });
    await insertRecord("plans", DESTINATION_SPLIT_PLAN_ID, {
      id: DESTINATION_SPLIT_PLAN_ID,
      project_id: DESTINATION_PROJECT_ID,
      task_list_id: DESTINATION_TASK_LIST_ID,
      name: "Shared split",
      updated_at: NOW,
    });
    await insertRecord("tasks", DESTINATION_PARENT_ID, {
      id: DESTINATION_PARENT_ID,
      project_id: DESTINATION_PROJECT_ID,
      task_list_id: DESTINATION_TASK_LIST_ID,
      parent_id: null,
      plan_id: null,
      title: "Destination parent",
      status: "pending",
      version: 1,
      updated_at: NOW,
    });
    await insertRecord("tasks", ROOT_TASK_ID, {
      id: ROOT_TASK_ID,
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      parent_id: null,
      plan_id: CONTAINED_PLAN_ID,
      title: "Root",
      status: "in_progress",
      assigned_to: "fleet",
      comments: [{ id: "preserved-comment", content: "preserved" }],
      version: 1,
      updated_at: NOW,
    });
    await insertRecord("tasks", CHILD_TASK_ID, {
      id: CHILD_TASK_ID,
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      parent_id: ROOT_TASK_ID,
      plan_id: SHARED_PLAN_ID,
      title: "Child",
      status: "pending",
      depends_on: [ROOT_TASK_ID],
      version: 1,
      updated_at: NOW,
    });
    await insertRecord("tasks", RETAINED_TASK_ID, {
      id: RETAINED_TASK_ID,
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      parent_id: null,
      plan_id: SHARED_PLAN_ID,
      title: "Retained",
      status: "pending",
      version: 1,
      updated_at: NOW,
    });

    authority = createPostgresTodosTaskSubtreeTransferAuthority(client, {
      service: SERVICE,
      tenantId: TENANT,
      now: () => NOW,
      faultInjector: async (point) => {
        await Promise.resolve();
        return point === failAt;
      },
    });
  });

  afterAll(async () => {
    if (!PG_URL) return;
    if (client) await client.close();
    if (root) {
      if (schemaCreated) await root.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
      await root.close();
    }
  });

  test("applies, replays, reads, and CAS-rolls back the exact PostgreSQL subtree", async () => {
    const inspection = await authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    });
    expect(inspection).toMatchObject({
      expected_tasks: [
        { task_id: ROOT_TASK_ID, version: 1 },
        { task_id: CHILD_TASK_ID, version: 1 },
      ],
      contained_plan_ids: [CONTAINED_PLAN_ID],
      shared_plan_ids: [SHARED_PLAN_ID],
      complete: true,
    });

    const request = applyRequest(inspection, `subtree-pg-${UNIQUE}`);
    const applied = await authority.apply(request);
    const duplicate = await authority.apply(request);
    expect(applied.duplicate).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      receipt: { receipt_id: applied.receipt.receipt_id },
    });
    expect(await authority.readExact(applied.receipt.receipt_id)).toEqual(applied);

    expect(await taskPayload(ROOT_TASK_ID)).toMatchObject({
      id: ROOT_TASK_ID,
      project_id: DESTINATION_PROJECT_ID,
      task_list_id: DESTINATION_TASK_LIST_ID,
      parent_id: DESTINATION_PARENT_ID,
      plan_id: CONTAINED_PLAN_ID,
      status: "in_progress",
      assigned_to: "fleet",
      comments: [{ id: "preserved-comment", content: "preserved" }],
      version: 2,
    });
    expect(await taskPayload(CHILD_TASK_ID)).toMatchObject({
      id: CHILD_TASK_ID,
      project_id: DESTINATION_PROJECT_ID,
      task_list_id: DESTINATION_TASK_LIST_ID,
      parent_id: ROOT_TASK_ID,
      plan_id: DESTINATION_SPLIT_PLAN_ID,
      depends_on: [ROOT_TASK_ID],
      version: 2,
    });
    expect(await taskPayload(RETAINED_TASK_ID)).toMatchObject({
      project_id: SOURCE_PROJECT_ID,
      plan_id: SHARED_PLAN_ID,
      version: 1,
    });
    const movedPlan = await client!.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM todos_sync_records
       WHERE service = $1 AND object_type = 'plans' AND object_id = $2`,
      [SERVICE, CONTAINED_PLAN_ID],
    );
    expect(movedPlan.rows[0]!.payload).toMatchObject({
      project_id: DESTINATION_PROJECT_ID,
      task_list_id: DESTINATION_TASK_LIST_ID,
    });
    await expect(client!.query(
      "UPDATE todos_task_subtree_transfer_receipts SET result_digest = 'changed'",
    )).rejects.toThrow(/immutable/);

    const beforeWrongOperationRollback = {
      root: await taskPayload(ROOT_TASK_ID),
      child: await taskPayload(CHILD_TASK_ID),
      retained: await taskPayload(RETAINED_TASK_ID),
      containedPlan: await planPayload(CONTAINED_PLAN_ID),
      receipts: await receiptCount(),
    };
    await expect(authority.rollback(
      rollbackRequest(applied, `wrong-operation-${UNIQUE}`),
    )).rejects.toMatchObject({
      code: "TODOS_TASK_SUBTREE_TRANSFER_ROLLBACK_CONFLICT",
    });
    expect({
      root: await taskPayload(ROOT_TASK_ID),
      child: await taskPayload(CHILD_TASK_ID),
      retained: await taskPayload(RETAINED_TASK_ID),
      containedPlan: await planPayload(CONTAINED_PLAN_ID),
      receipts: await receiptCount(),
    }).toEqual(beforeWrongOperationRollback);

    const rolledBack = await authority.rollback(rollbackRequest(applied));
    const duplicateRollback = await authority.rollback(rollbackRequest(applied));
    expect(rolledBack.duplicate).toBe(false);
    expect(duplicateRollback).toMatchObject({
      duplicate: true,
      receipt: { receipt_id: rolledBack.receipt.receipt_id },
    });
    expect(await taskPayload(ROOT_TASK_ID)).toMatchObject({
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      parent_id: null,
      plan_id: CONTAINED_PLAN_ID,
      version: 3,
    });
    expect(await taskPayload(CHILD_TASK_ID)).toMatchObject({
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      parent_id: ROOT_TASK_ID,
      plan_id: SHARED_PLAN_ID,
      version: 3,
    });
  });

  test("rolls PostgreSQL task and plan writes back when an async fault fires", async () => {
    const inspection = await authority.inspect({
      source_project_id: SOURCE_PROJECT_ID,
      destination_project_id: DESTINATION_PROJECT_ID,
      destination_task_list_id: DESTINATION_TASK_LIST_ID,
      root_task_id: ROOT_TASK_ID,
      destination_parent_id: DESTINATION_PARENT_ID,
    });
    const receiptCountBefore = await client!.query<{ count: string }>(
      "SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts",
    );
    failAt = "after_plan_writes";
    await expect(authority.apply(
      applyRequest(inspection, `subtree-pg-fault-${UNIQUE}`),
    )).rejects.toThrow(/Injected/);
    failAt = null;

    expect(await taskPayload(ROOT_TASK_ID)).toMatchObject({
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
      parent_id: null,
      plan_id: CONTAINED_PLAN_ID,
      version: 3,
    });
    const plan = await client!.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM todos_sync_records
       WHERE service = $1 AND object_type = 'plans' AND object_id = $2`,
      [SERVICE, CONTAINED_PLAN_ID],
    );
    expect(plan.rows[0]!.payload).toMatchObject({
      project_id: SOURCE_PROJECT_ID,
      task_list_id: null,
    });
    const receiptCountAfter = await client!.query<{ count: string }>(
      "SELECT count(*) AS count FROM todos_task_subtree_transfer_receipts",
    );
    expect(receiptCountAfter.rows).toEqual(receiptCountBefore.rows);
  });
});
