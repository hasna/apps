/**
 * REAL Postgres coverage for guarded existing-plan/project linkage.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-plan-project-link.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyPlanProjectLink, planPlanProjectLink } from "../lib/plan-project-link.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-plan-project-link-${process.pid}-${Date.now()}`;

describe.skipIf(!PG_URL)("postgres guarded plan/project linkage", () => {
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

  test("executes atomic SQL, receipts the exact CAS membership, and guards future members", async () => {
    const project = await store.projects.create({
      name: "Postgres target",
      path: `/postgres-target-${Date.now()}`,
    });
    const plan = await store.plans.create({ name: "Postgres existing plan" });
    const first = await store.tasks.create({ title: "First member", plan_id: plan.id });
    const second = await store.tasks.create({ title: "Second member", plan_id: plan.id });
    const planned = await planPlanProjectLink(store, plan.id, project.id);
    const applied = await applyPlanProjectLink(store, plan.id, project.id, {
      expected_plan_revision: planned.plan.updated_at,
      expected_project_revision: planned.project.updated_at,
      idempotency_key: `postgres-plan-project-${Date.now()}`,
    });

    expect(applied.receipt?.task_ids).toEqual([first.id, second.id].sort());
    expect(applied.receipt?.task_count).toBe(2);
    expect(applied.tasks.map((task) => task.project_id)).toEqual([project.id, project.id]);

    const future = await store.tasks.create({ title: "Future member", plan_id: plan.id });
    expect(future.project_id).toBe(project.id);
    await expect(store.tasks.create({
      title: "Conflicting future member",
      plan_id: plan.id,
      project_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    })).rejects.toMatchObject({ code: "PLAN_PROJECT_LINK_CONFLICT" });
  });

  test("serializes a concurrent member create with the apply CAS point", async () => {
    const project = await store.projects.create({
      name: "Concurrent target",
      path: `/concurrent-target-${Date.now()}`,
    });
    const plan = await store.plans.create({ name: "Concurrent existing plan" });
    await store.tasks.create({ title: "Initial member", plan_id: plan.id });
    const planned = await planPlanProjectLink(store, plan.id, project.id);

    const [applied, concurrent] = await Promise.all([
      applyPlanProjectLink(store, plan.id, project.id, {
        expected_plan_revision: planned.plan.updated_at,
        expected_project_revision: planned.project.updated_at,
        idempotency_key: `postgres-plan-project-race-${Date.now()}`,
      }),
      store.tasks.create({ title: "Concurrent member", plan_id: plan.id }),
    ]);
    const readBack = await store.tasks.get(concurrent.id);
    expect(readBack?.project_id).toBe(project.id);
    expect(applied.receipt?.task_count).toBe(applied.receipt?.task_ids.length);
    expect(applied.tasks.every((task) => task.project_id === project.id)).toBe(true);
  });
});
