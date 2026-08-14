/**
 * REAL Postgres regression coverage for re-parenting a task through
 * `tasks.update` (the /v1 PATCH path).
 *
 * The cloud backend once merged `task_list_id: input.task_list_id ?? existing`,
 * so an explicit `null` (detach) coalesced back to the old list — a task could
 * never be detached and a cross-project move left a dangling reference to the
 * source project's list. This runs against a real Postgres and fails if that
 * coalesce regression returns. SQLite already handled null (v1.test.ts).
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-reparent.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql, type TodosPostgresQueryClient } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";
import { ResourceConflictError, TaskNotFoundError, type Task } from "../types/index.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-reparent-${process.pid}-${Date.now()}`;

const TASK_ID = "f0000000-0000-4000-8000-000000000001";
const PROJECT_A = "a0000000-0000-4000-8000-00000000000a";
const PROJECT_B = "b0000000-0000-4000-8000-00000000000b";
const LIST_A = "c0000000-0000-4000-8000-00000000000c";
const LIST_B = "d0000000-0000-4000-8000-00000000000d";

describe.skipIf(!PG_URL)("postgres tasks.update — re-parent semantics", () => {
  let client: TodosCloudQueryClient;
  let locker: TodosCloudQueryClient;
  let observer: TodosCloudQueryClient;
  let racingClient: TodosCloudQueryClient;
  let store: TodosStorageAdapter;
  let racingStore: TodosStorageAdapter;

  const seedTask = async () => {
    const payload = {
      id: TASK_ID,
      short_id: "REPARENT-1",
      title: "Portable task",
      status: "pending",
      priority: "medium",
      parent_id: null,
      project_id: PROJECT_A,
      task_list_id: LIST_A,
      tags: [],
      metadata: {},
      version: 1,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, 'tasks', $2, $3::jsonb, now(), NULL)
       ON CONFLICT (service, object_type, object_id)
         DO UPDATE SET payload = EXCLUDED.payload, deleted_at = NULL`,
      [SERVICE, TASK_ID, payload],
    );
  };

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    locker = createTodosCloudQueryClient(PG_URL!, { max: 1 });
    observer = createTodosCloudQueryClient(PG_URL!, { max: 1 });
    racingClient = createTodosCloudQueryClient(PG_URL!, { max: 1 });
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
    racingStore = createPostgresTodosStorageAdapter({ client: racingClient, service: SERVICE });
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await racingClient.close();
    await observer.close();
    await locker.close();
    await client.close();
  });

  async function waitForParentLockWait(holderPid: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await observer.query<{ waiting: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_stat_activity
           WHERE query LIKE '%todos:task-parent-integrity-lock%'
             AND $1::integer = ANY(pg_blocking_pids(pid))
         ) AS waiting`,
        [holderPid],
      );
      if (result.rows[0]?.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for the guarded task operation to block on the parent-integrity lock");
  }

  async function withHeldParentLock(
    fn: (transaction: TodosPostgresQueryClient, holderPid: number) => Promise<void>,
  ): Promise<void> {
    await locker.transaction(async (transaction) => {
      await transaction.query(
        "/* todos:test-parent-integrity-holder */ SELECT pg_advisory_xact_lock(hashtextextended($1 || ':task-parent-integrity', 0))",
        [SERVICE],
      );
      const pid = await transaction.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await fn(transaction, Number(pid.rows[0]!.pid));
    });
  }

  test("moving to another project detaches the source project's list when task_list_id is null", async () => {
    await seedTask();
    const moved = await store.tasks.update(TASK_ID, { version: 1, project_id: PROJECT_B, task_list_id: null });
    expect(moved.id).toBe(TASK_ID);
    expect(moved.project_id).toBe(PROJECT_B);
    expect(moved.task_list_id).toBeNull();
    // Persisted, not just returned.
    const readBack = await store.tasks.get(TASK_ID);
    expect(readBack?.project_id).toBe(PROJECT_B);
    expect(readBack?.task_list_id).toBeNull();
  });

  test("moving with an explicit destination list sets task_list_id", async () => {
    await seedTask();
    const moved = await store.tasks.update(TASK_ID, { version: 1, project_id: PROJECT_B, task_list_id: LIST_B });
    expect(moved.project_id).toBe(PROJECT_B);
    expect(moved.task_list_id).toBe(LIST_B);
  });

  test("omitting task_list_id leaves the existing list untouched", async () => {
    await seedTask();
    const moved = await store.tasks.update(TASK_ID, { version: 1, project_id: PROJECT_B });
    expect(moved.project_id).toBe(PROJECT_B);
    expect(moved.task_list_id).toBe(LIST_A);
  });

  test("repairs and clears parent_id while preserving cross-project routing", async () => {
    const childProject = await store.projects.create({
      name: "PG parent child project",
      path: "/tmp/pg-parent-child-project",
    });
    const parentProject = await store.projects.create({
      name: "PG parent target project",
      path: "/tmp/pg-parent-target-project",
    });
    const originalParent = await store.tasks.create({
      title: "PG original parent",
      project_id: childProject.id,
    });
    const crossProjectParent = await store.tasks.create({
      title: "PG cross-project parent",
      project_id: parentProject.id,
    });
    const child = await store.tasks.create({
      title: "PG repairable child",
      project_id: childProject.id,
      parent_id: originalParent.id,
    });

    const repaired = await store.tasks.update(child.id, {
      version: child.version,
      parent_id: crossProjectParent.id,
    });
    expect(repaired).toMatchObject({
      id: child.id,
      project_id: childProject.id,
      parent_id: crossProjectParent.id,
    });
    expect(await store.tasks.get(child.id)).toMatchObject({
      id: child.id,
      project_id: childProject.id,
      parent_id: crossProjectParent.id,
    });

    const cleared = await store.tasks.update(child.id, {
      version: repaired.version,
      parent_id: null,
    });
    expect(cleared.parent_id).toBeNull();
    expect((await store.tasks.get(child.id))?.parent_id).toBeNull();
  });

  test("serializes opposite parent updates so at most one edge can persist", async () => {
    const first = await store.tasks.create({ title: "PG concurrent first" });
    const second = await store.tasks.create({ title: "PG concurrent second" });

    const results = await Promise.allSettled([
      store.tasks.update(first.id, { version: first.version, parent_id: second.id }),
      store.tasks.update(second.id, { version: second.version, parent_id: first.id }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const persistedFirst = await store.tasks.get(first.id);
    const persistedSecond = await store.tasks.get(second.id);
    expect(
      persistedFirst?.parent_id === second.id && persistedSecond?.parent_id === first.id,
    ).toBe(false);
  });

  test("deleting a parent atomically tombstones its descendants", async () => {
    const parent = await store.tasks.create({ title: "PG delete parent" });
    const child = await store.tasks.create({
      title: "PG delete child",
      parent_id: parent.id,
    });
    const grandchild = await store.tasks.create({
      title: "PG delete grandchild",
      parent_id: child.id,
    });

    expect(await store.tasks.delete(parent.id)).toBe(true);
    expect(await store.tasks.get(parent.id)).toBeNull();
    expect(await store.tasks.get(child.id)).toBeNull();
    expect(await store.tasks.get(grandchild.id)).toBeNull();
  });

  test("deleting a hierarchy atomically tombstones task-owned records", async () => {
    const parent = await store.tasks.create({ title: "PG related delete parent" });
    const child = await store.tasks.create({
      title: "PG related delete child",
      parent_id: parent.id,
    });
    const dependent = await store.tasks.create({ title: "PG related delete dependent" });
    const externalBlocker = await store.tasks.create({ title: "PG related delete external blocker" });
    const commitSha = "a".repeat(40);
    const refName = `pr284-related-${child.id}`;

    await store.dependencies!.add(dependent.id, child.id);
    await store.dependencies!.add(child.id, externalBlocker.id);
    await store.audit.addComment({ task_id: child.id, content: "Cascade this comment" });
    await store.verifications!.add({
      task_id: child.id,
      command: "bun run test",
      status: "passed",
    });
    await store.commits!.add({ task_id: child.id, sha: commitSha });
    await store.gitRefs!.add({ task_id: child.id, ref_type: "branch", name: refName });

    expect(await store.tasks.delete(parent.id)).toBe(true);
    expect(await store.tasks.get(parent.id)).toBeNull();
    expect(await store.tasks.get(child.id)).toBeNull();
    expect(await store.tasks.get(dependent.id)).not.toBeNull();
    expect(await store.tasks.get(externalBlocker.id)).not.toBeNull();

    expect(await store.dependencies!.list(dependent.id)).toEqual({
      dependencies: [],
      blocks: [],
      blocked_by: [],
    });
    expect(
      (await store.dependencies!.listAll!()).filter(
        (edge) =>
          edge.task_id === child.id ||
          edge.depends_on === child.id,
      ),
    ).toEqual([]);
    expect(await store.audit.getComments(child.id)).toEqual([]);
    expect(await store.verifications!.list(child.id)).toEqual([]);
    expect(await store.commits!.list(child.id)).toEqual([]);
    expect(await store.commits!.find(commitSha)).toBeNull();
    expect(await store.gitRefs!.list(child.id)).toEqual([]);
    expect(await store.gitRefs!.find(refName)).toEqual([]);
  });

  test("concurrent parented create and parent delete cannot leave a dangling child", async () => {
    const parent = await store.tasks.create({ title: "PG create/delete parent" });
    const [createResult, deleteResult] = await Promise.allSettled([
      store.tasks.create({
        title: "PG concurrent parented create",
        parent_id: parent.id,
      }),
      store.tasks.delete(parent.id),
    ]);

    expect(deleteResult.status).toBe("fulfilled");
    if (createResult.status === "fulfilled") {
      const persistedParent = await store.tasks.get(parent.id);
      const persistedChild = await store.tasks.get(createResult.value.id);
      expect(
        persistedChild?.parent_id === parent.id && persistedParent === null,
      ).toBe(false);
    }
  });

  test("concurrent reparent and parent delete cannot leave a dangling child", async () => {
    const parent = await store.tasks.create({ title: "PG update/delete parent" });
    const child = await store.tasks.create({ title: "PG concurrent reparent child" });
    const [updateResult, deleteResult] = await Promise.allSettled([
      store.tasks.update(child.id, {
        version: child.version,
        parent_id: parent.id,
      }),
      store.tasks.delete(parent.id),
    ]);

    expect(deleteResult.status).toBe("fulfilled");
    const persistedParent = await store.tasks.get(parent.id);
    const persistedChild = await store.tasks.get(child.id);
    expect(
      persistedChild?.parent_id === parent.id && persistedParent === null,
    ).toBe(false);
    if (updateResult.status === "fulfilled" && persistedParent === null) {
      expect(persistedChild).toBeNull();
    }
  });

  test("a parented create waiting on the lock revalidates after parent deletion commits", async () => {
    const parent = await store.tasks.create({ title: "PG barrier create parent" });
    let operation!: Promise<PromiseSettledResult<Task>>;

    await withHeldParentLock(async (transaction, holderPid) => {
      operation = Promise.allSettled([
        racingStore.tasks.create({
          title: "PG barrier parented create",
          parent_id: parent.id,
        }),
      ]).then(([result]) => result!);
      await waitForParentLockWait(holderPid);
      await transaction.query(
        `UPDATE todos_sync_records
         SET deleted_at = now(), updated_at = now()
         WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL`,
        [SERVICE, parent.id],
      );
    });

    const result = await operation;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(TaskNotFoundError);
    }
  });

  test("a delete waiting on the lock sees a newly reparented descendant", async () => {
    const parent = await store.tasks.create({ title: "PG barrier delete parent" });
    const child = await store.tasks.create({ title: "PG barrier delete child" });
    let operation!: Promise<PromiseSettledResult<boolean>>;

    await withHeldParentLock(async (transaction, holderPid) => {
      operation = Promise.allSettled([
        racingStore.tasks.delete(parent.id),
      ]).then(([result]) => result!);
      await waitForParentLockWait(holderPid);
      await transaction.query(
        `UPDATE todos_sync_records
         SET payload = jsonb_set(payload, '{parent_id}', to_jsonb($3::text), true),
             updated_at = now(),
             version = COALESCE(version, 0) + 1
         WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL`,
        [SERVICE, child.id, parent.id],
      );
    });

    expect(await operation).toMatchObject({ status: "fulfilled", value: true });
    expect(await store.tasks.get(parent.id)).toBeNull();
    expect(await store.tasks.get(child.id)).toBeNull();
  });

  test("an opposite parent update waiting on the lock sees the committed edge and rejects the cycle", async () => {
    const first = await store.tasks.create({ title: "PG barrier cycle first" });
    const second = await store.tasks.create({ title: "PG barrier cycle second" });
    let operation!: Promise<PromiseSettledResult<Task>>;

    await withHeldParentLock(async (transaction, holderPid) => {
      operation = Promise.allSettled([
        racingStore.tasks.update(first.id, {
          version: first.version,
          parent_id: second.id,
        }),
      ]).then(([result]) => result!);
      await waitForParentLockWait(holderPid);
      await transaction.query(
        `UPDATE todos_sync_records
         SET payload = jsonb_set(payload, '{parent_id}', to_jsonb($3::text), true),
             updated_at = now(),
             version = COALESCE(version, 0) + 1
         WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL`,
        [SERVICE, second.id, first.id],
      );
    });

    const result = await operation;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(ResourceConflictError);
      expect((result.reason as ResourceConflictError).code).toBe("TASK_PARENT_CYCLE");
    }
    expect((await store.tasks.get(first.id))?.parent_id).toBeNull();
    expect((await store.tasks.get(second.id))?.parent_id).toBe(first.id);
  });

  test("a generic child update waiting on the lock cannot resurrect a cascaded descendant", async () => {
    const parent = await store.tasks.create({ title: "PG barrier resurrection parent" });
    const child = await store.tasks.create({
      title: "PG barrier resurrection child",
      parent_id: parent.id,
    });
    let operation!: Promise<PromiseSettledResult<Task>>;

    await withHeldParentLock(async (transaction, holderPid) => {
      operation = Promise.allSettled([
        racingStore.tasks.update(child.id, {
          version: child.version,
          title: "PG stale generic update",
        }),
      ]).then(([result]) => result!);
      await waitForParentLockWait(holderPid);
      await transaction.query(
        `UPDATE todos_sync_records
         SET deleted_at = now(), updated_at = now()
         WHERE service = $1
           AND object_type = 'tasks'
           AND object_id = ANY($2::text[])
           AND deleted_at IS NULL`,
        [SERVICE, [parent.id, child.id]],
      );
    });

    const result = await operation;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(TaskNotFoundError);
    }
    expect(await store.tasks.get(parent.id)).toBeNull();
    expect(await store.tasks.get(child.id)).toBeNull();
  });
});
