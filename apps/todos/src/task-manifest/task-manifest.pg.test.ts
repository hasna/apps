/**
 * Real PostgreSQL coverage for task-manifest's authoritative callback transaction.
 *
 * The lane uses a unique schema and drops that exact schema after the test. This is
 * required because authority receipts are intentionally immutable and cannot be
 * cleaned row-by-row. Point TODOS_TEST_PG_URL only at a disposable test database.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "../storage/cloud-client.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";
import {
  createPostgresTodosTaskManifestAuthority,
  deterministicTodosTaskManifestId,
  type TodosTaskManifest,
  type TodosTaskManifestAuthority,
} from "./index.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const UNIQUE = `${process.pid}_${Date.now()}`;
const SCHEMA = `taskmanifest_${UNIQUE}`;
const SERVICE = `manifest-test-${UNIQUE}`;
const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

function manifest(suffix: string): TodosTaskManifest {
  const operation = `manifest-pg-${UNIQUE}-${suffix}`;
  return {
    version: 1,
    operation_id: operation,
    idempotency_key: `${operation}:apply`,
    project_id: PROJECT_ID,
    plan: { key: "pg-graph", name: "PostgreSQL graph" },
    tasks: [
      { key: "one", title: "One", comments: [{ content: "one" }], verifications: [{ command: "one", status: "passed" }] },
      { key: "two", title: "Two" },
    ],
    dependencies: [{ task: "two", depends_on: "one" }],
    effects: [{ topic: "task-manifest.pg-test", payload: { suffix } }],
  };
}

describe.skipIf(!PG_URL)("task-manifest PostgreSQL authority", () => {
  let root: TodosCloudQueryClient | undefined;
  let client: TodosCloudQueryClient | undefined;
  let authority: TodosTaskManifestAuthority;
  let schemaCreated = false;

  beforeAll(async () => {
    root = createTodosCloudQueryClient(PG_URL!);
    await root.query(`CREATE SCHEMA ${SCHEMA}`);
    schemaCreated = true;
    const scopedUrl = new URL(PG_URL!);
    scopedUrl.searchParams.set("options", `-csearch_path=${SCHEMA}`);
    client = createTodosCloudQueryClient(scopedUrl.toString());
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    await client.query(`INSERT INTO todos_sync_records (
      service, object_type, object_id, payload, updated_at, deleted_at, version
    ) VALUES ($1, 'projects', $2, $3::jsonb, now(), NULL, 1)`, [
      SERVICE,
      PROJECT_ID,
      {
        id: PROJECT_ID, name: "Task manifest test", path: `/disposable/${UNIQUE}`,
        task_list_id: null, task_prefix: "TMF", task_counter: 0,
        created_at: "2026-08-07T00:00:00.000Z", updated_at: "2026-08-07T00:00:00.000Z",
      },
    ]);
    authority = createPostgresTodosTaskManifestAuthority(client, {
      service: SERVICE,
      now: () => "2026-08-07T00:00:00.000Z",
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

  test("atomically applies, deduplicates, reads, and conditionally compensates the full graph", async () => {
    const results = await Promise.all([
      authority.apply(manifest("success")),
      authority.apply(manifest("success")),
      authority.apply(manifest("success")),
    ]);
    const first = results.find((result) => !result.duplicate)!;
    const duplicates = results.filter((result) => result.duplicate);
    expect(first.duplicate).toBe(false);
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((result) => result.receipt.receipt_id === first.receipt.receipt_id)).toBe(true);
    expect((await authority.readExact(first.receipt.receipt_id)).graph).toEqual(first.graph);
    expect(first.readback).toEqual({ plans: 1, tasks: 2, dependencies: 1, comments: 1, verifications: 1, complete: true });

    await authority.markOutboxDelivered(first.outbox_ids[0]!);
    await expect(authority.compensate({
      receipt_id: first.receipt.receipt_id,
      idempotency_key: `${first.receipt.operation_id}:compensate`,
      if_binding_version: 1,
    })).rejects.toThrow(/delivered outbox/);

    const clean = await authority.apply(manifest("compensate"));
    const compensated = await authority.compensate({
      receipt_id: clean.receipt.receipt_id,
      idempotency_key: `${clean.receipt.operation_id}:compensate`,
      if_binding_version: 1,
    });
    expect(compensated.readback).toEqual({ plans: 0, tasks: 0, dependencies: 0, comments: 0, verifications: 0, complete: true });
    const cancelled = await client!.query<{ count: string }>(
      "SELECT count(*) AS count FROM todos_task_manifest_outbox WHERE apply_receipt_id = $1 AND status = 'cancelled'",
      [clean.receipt.receipt_id],
    );
    expect(Number(cancelled.rows[0]?.count)).toBe(2);
  });

  test("rolls back sync rows, outbox, bindings, and receipts on a late staged fault", async () => {
    const faultManifest = manifest("late-fault");
    const faultAuthority = createPostgresTodosTaskManifestAuthority(client, {
      service: SERVICE,
      faultInjector: async (point) => point === "after_verification_write",
    });
    await expect(faultAuthority.apply(faultManifest)).rejects.toThrow(/after_verification_write/);
    const planId = deterministicTodosTaskManifestId("todos.task-manifest.v1", faultManifest.operation_id, "plan", faultManifest.plan.key);
    const taskOne = deterministicTodosTaskManifestId("todos.task-manifest.v1", faultManifest.operation_id, "task", "one");
    const taskTwo = deterministicTodosTaskManifestId("todos.task-manifest.v1", faultManifest.operation_id, "task", "two");
    const commentId = deterministicTodosTaskManifestId("todos.task-manifest.v1", faultManifest.operation_id, "comment", "one", "0");
    const verificationId = deterministicTodosTaskManifestId("todos.task-manifest.v1", faultManifest.operation_id, "verification", "one", "0");
    const sync = await client!.query<{ count: string }>(`SELECT count(*) AS count FROM todos_sync_records
      WHERE service = $1 AND object_id IN ($2, $3, $4, $5, $6, $7)`, [
      SERVICE, planId, taskOne, taskTwo, commentId, verificationId, `${taskTwo}::${taskOne}`,
    ]);
    const receipts = await client!.query<{ count: string }>(
      "SELECT count(*) AS count FROM todos_task_manifest_receipts WHERE operation_id = $1",
      [faultManifest.operation_id],
    );
    const bindings = await client!.query<{ count: string }>(
      "SELECT count(*) AS count FROM todos_task_manifest_bindings WHERE operation_id = $1",
      [faultManifest.operation_id],
    );
    expect(Number(sync.rows[0]?.count)).toBe(0);
    expect(Number(receipts.rows[0]?.count)).toBe(0);
    expect(Number(bindings.rows[0]?.count)).toBe(0);
  });

  test("refuses before foreign CASCADE or SET NULL reference surfaces can be changed", async () => {
    const cascade = await authority.apply(manifest("foreign-cascade"));
    const checklistId = crypto.randomUUID();
    await client!.query(`INSERT INTO todos_sync_records (
      service, object_type, object_id, payload, updated_at, deleted_at, version
    ) VALUES ($1, 'task_checklists', $2, $3::jsonb, now(), NULL, 1)`, [
      SERVICE,
      checklistId,
      {
        id: checklistId,
        task_id: cascade.graph.task_ids.one,
        text: "Foreign checklist evidence",
      },
    ]);
    await expect(authority.compensate({
      receipt_id: cascade.receipt.receipt_id,
      idempotency_key: `${cascade.receipt.operation_id}:compensate`,
      if_binding_version: cascade.receipt.binding_version,
    })).rejects.toThrow(/foreign reference in task_checklists/i);
    const checklist = await client!.query<{ task_id: string }>(`SELECT payload->>'task_id' AS task_id
      FROM todos_sync_records WHERE service = $1 AND object_type = 'task_checklists' AND object_id = $2`,
    [SERVICE, checklistId]);
    expect(checklist.rows[0]?.task_id).toBe(cascade.graph.task_ids.one);

    const setNull = await authority.apply(manifest("foreign-set-null"));
    const snapshotId = crypto.randomUUID();
    const boardId = crypto.randomUUID();
    await client!.query(`INSERT INTO todos_sync_records (
      service, object_type, object_id, payload, updated_at, deleted_at, version
    ) VALUES
      ($1, 'context_snapshots', $2, $3::jsonb, now(), NULL, 1),
      ($1, 'task_boards', $4, $5::jsonb, now(), NULL, 1)`, [
      SERVICE,
      snapshotId,
      {
        id: snapshotId,
        task_id: setNull.graph.task_ids.one,
        snapshot_type: "checkpoint",
      },
      boardId,
      {
        id: boardId,
        plan_id: setNull.graph.plan_id,
        name: "Foreign board",
      },
    ]);
    await expect(authority.compensate({
      receipt_id: setNull.receipt.receipt_id,
      idempotency_key: `${setNull.receipt.operation_id}:task-compensate`,
      if_binding_version: setNull.receipt.binding_version,
    })).rejects.toThrow(/foreign reference in context_snapshots/i);
    const snapshot = await client!.query<{ task_id: string }>(`SELECT payload->>'task_id' AS task_id
      FROM todos_sync_records WHERE service = $1 AND object_type = 'context_snapshots' AND object_id = $2`,
    [SERVICE, snapshotId]);
    expect(snapshot.rows[0]?.task_id).toBe(setNull.graph.task_ids.one);

    await client!.query(`DELETE FROM todos_sync_records
      WHERE service = $1 AND object_type = 'context_snapshots' AND object_id = $2`, [SERVICE, snapshotId]);
    await expect(authority.compensate({
      receipt_id: setNull.receipt.receipt_id,
      idempotency_key: `${setNull.receipt.operation_id}:plan-compensate`,
      if_binding_version: setNull.receipt.binding_version,
    })).rejects.toThrow(/foreign reference in task_boards/i);
    const board = await client!.query<{ plan_id: string }>(`SELECT payload->>'plan_id' AS plan_id
      FROM todos_sync_records WHERE service = $1 AND object_type = 'task_boards' AND object_id = $2`,
    [SERVICE, boardId]);
    expect(board.rows[0]?.plan_id).toBe(setNull.graph.plan_id);
  });
});
