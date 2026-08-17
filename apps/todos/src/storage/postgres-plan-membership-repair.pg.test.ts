/**
 * REAL Postgres coverage for repairing tasks whose plan_id references a
 * deleted plan (fleet population: 726 tasks, 139 plan ids).
 *
 * The fleet state is a plan row tombstoned WITHOUT detaching its member
 * tasks — the SQLite-era hard-delete shape, where deletePlan dropped the plan
 * row and left tasks.plan_id pointing at it, later replicated to cloud
 * Postgres as a deleted_at row. The current cloud deletePlan detaches tasks
 * atomically, so this file reproduces the legacy shape by tombstoning the
 * plan row directly.
 *
 * The membership guard must allow the exact repair writes — detach from a
 * missing plan, non-membership updates on a dangling task, and moving from a
 * missing plan into an existing one — while continuing to block every write
 * that would establish membership in a missing plan.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-plan-membership-repair.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-plan-membership-repair-${process.pid}-${Date.now()}`;

/** Tombstone the plan row directly, leaving member task plan_id dangling. */
async function legacyDeletePlan(client: TodosCloudQueryClient, planId: string): Promise<void> {
  const result = await client.query(
    `UPDATE todos_sync_records
     SET deleted_at = $2::timestamptz, updated_at = $2::timestamptz
     WHERE service = $1 AND object_type = 'plans' AND object_id = $3 AND deleted_at IS NULL`,
    [SERVICE, new Date().toISOString(), planId],
  );
  expect(result.rows).toBeDefined();
  expect((result.rows as unknown[]).length).toBeLessThanOrEqual(1);
}

describe.skipIf(!PG_URL)("postgres plan-membership repair guard", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  test("clearing plan_id on a task whose plan was deleted is a repair, not an error", async () => {
    const plan = await store.plans.create({ name: "Deleted under the task" });
    const task = await store.tasks.create({ title: "Surviving member", plan_id: plan.id });
    await legacyDeletePlan(client, plan.id);
    expect(await store.plans.get(plan.id)).toBeNull();
    expect((await store.tasks.get(task.id))?.plan_id).toBe(plan.id); // dangling

    // Regression: PATCH /tasks/:id with plan_id: null used to 404 with
    // PLAN_PROJECT_LINK_PLAN_NOT_FOUND because the guard required the plan
    // being LEFT to exist.
    const updated = await store.tasks.update(task.id, { plan_id: null, version: task.version });
    expect(updated.plan_id).toBeNull();
    expect(await store.tasks.get(task.id)).toMatchObject({ id: task.id, plan_id: null });
  });

  test("non-membership updates on a task with a dangling plan_id are allowed", async () => {
    const plan = await store.plans.create({ name: "Deleted under another member" });
    const task = await store.tasks.create({ title: "Dangling member", plan_id: plan.id });
    await legacyDeletePlan(client, plan.id);
    expect((await store.tasks.get(task.id))?.plan_id).toBe(plan.id); // dangling

    const renamed = await store.tasks.update(task.id, {
      title: "Dangling member renamed",
      version: task.version,
    });
    expect(renamed.title).toBe("Dangling member renamed");
    // The dangling reference itself is untouched by a non-membership patch.
    expect(renamed.plan_id).toBe(plan.id);
    expect(await store.tasks.get(task.id)).toMatchObject({
      id: task.id,
      title: "Dangling member renamed",
      plan_id: plan.id,
    });
  });

  test("moving a task from a deleted plan into an existing plan is allowed", async () => {
    const deletedPlan = await store.plans.create({ name: "Deleted origin" });
    const targetPlan = await store.plans.create({ name: "Live destination" });
    const task = await store.tasks.create({ title: "Rehomed member", plan_id: deletedPlan.id });
    await legacyDeletePlan(client, deletedPlan.id);
    expect((await store.tasks.get(task.id))?.plan_id).toBe(deletedPlan.id); // dangling

    const updated = await store.tasks.update(task.id, {
      plan_id: targetPlan.id,
      version: task.version,
    });
    expect(updated.plan_id).toBe(targetPlan.id);
    expect(await store.tasks.get(task.id)).toMatchObject({ id: task.id, plan_id: targetPlan.id });
  });

  test("moving a task into a missing plan is still rejected", async () => {
    const plan = await store.plans.create({ name: "Deleted under a member" });
    const task = await store.tasks.create({ title: "Must not dangle", plan_id: plan.id });
    await legacyDeletePlan(client, plan.id);

    await expect(store.tasks.update(task.id, {
      plan_id: "00000000-0000-4000-8000-000000000001",
      version: task.version,
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_PLAN_NOT_FOUND" });

    // Same guard on a task that never had a plan.
    const plain = await store.tasks.create({ title: "Plain task" });
    await expect(store.tasks.update(plain.id, {
      plan_id: "00000000-0000-4000-8000-000000000002",
      version: plain.version,
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_PLAN_NOT_FOUND" });
  });

  test("creating a task into a missing plan is still rejected", async () => {
    await expect(store.tasks.create({
      title: "Must not create dangling",
      plan_id: "00000000-0000-4000-8000-000000000003",
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_PLAN_NOT_FOUND" });
  });
});
