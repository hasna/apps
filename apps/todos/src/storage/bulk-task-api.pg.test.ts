import { expect, setDefaultTimeout, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";

setDefaultTimeout(60_000);
const pgTest = process.env.TODOS_TEST_PG_URL ? test : test.skip;

pgTest("PostgreSQL bulk task routes are atomic, bounded, and force-authorized", async () => {
  const client = createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!, { max: 4 });
  const suffix = randomUUID().replaceAll("-", "");
  const table = `todos_bulk_fixture_${suffix}`;
  const cursorTable = `${table}_cursor`;
  const service = `bulk-fixture-${suffix}`;
  const store = createPostgresTodosStorageAdapter({ client, service, tableName: table, cursorTableName: cursorTable });
  let scopes = ["todos:read", "todos:write", "todos:*"];
  const dependencies: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getMachineRegistryTenantId: () => "fixture",
    getVerifier: () => ({
      authenticate: async (_headers: unknown, options: { requiredScopes: string[] }) =>
        options.requiredScopes.every((scope) => scopes.includes(scope) || scopes.includes("todos:*"))
          ? { ok: true, principal: { kid: "fixture", tid: "fixture", agent: "bulk-agent", scopes } }
          : { ok: false, status: 403, message: "scope denied", reason: "scope" },
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
  const request = async (path: string, body: unknown) => {
    const url = new URL(`http://fixture.test/v1/${path}`);
    return (await handleV1Request(new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), url, dependencies))!;
  };

  try {
    const createdResponse = await request("tasks/bulk-create", {
      schema_version: 1,
      tasks: [
        { temp_id: "root", title: "root" },
        { temp_id: "child", title: "child", depends_on: ["root"] },
      ],
    });
    expect(createdResponse.status).toBe(201);
    const createdBody = await createdResponse.json() as { receipt: {
      atomic: boolean;
      created: Array<{ id: string }>;
      dependencies: Array<{ task_id: string; depends_on: string }>;
    } };
    expect(createdBody.receipt.atomic).toBe(true);
    expect(createdBody.receipt.dependencies).toEqual([{
      task_id: createdBody.receipt.created[1]!.id,
      depends_on: createdBody.receipt.created[0]!.id,
    }]);

    await store.audit.logTaskChange(createdBody.receipt.created[0]!.id, "updated", "priority", "medium", "high", "bulk-agent");
    await store.audit.logTaskChange(createdBody.receipt.created[0]!.id, "updated", "status", "pending", "in_progress", "bulk-agent");
    const historyPage = await store.audit.getTaskHistoryPage!(createdBody.receipt.created[0]!.id, { limit: 1, offset: 0, order: "desc" });
    expect(historyPage.total).toBeGreaterThanOrEqual(2);
    expect(historyPage.history).toHaveLength(1);
    const firstAgent = await store.agents.register({ name: `ada-${suffix.slice(0, 8)}` });
    await store.agents.register({ name: `grace-${suffix.slice(0, 8)}` });
    const agentPage = await store.agents.listPage!({ limit: 1, offset: 0 });
    expect(agentPage).toMatchObject({ total: 2, agents: [{ id: firstAgent.id }] });
    expect(await store.audit.getRecentActivity(1)).toHaveLength(1);

    const archiveTarget = await store.tasks.create({ title: "postgres archive persistence" });
    const archived = await store.tasks.update(archiveTarget.id, { archived_at: "2026-09-18T08:00:00.000Z", version: archiveTarget.version });
    expect(archived.archived_at).toBe("2026-09-18T08:00:00.000Z");
    expect((await store.tasks.get(archiveTarget.id))?.archived_at).toBe("2026-09-18T08:00:00.000Z");

    const beforeRollback = await store.tasks.count({ include_subtasks: true });
    const rejected = await request("tasks/bulk-create", {
      schema_version: 1,
      tasks: [
        { temp_id: "rollback-a", title: "rollback a" },
        { temp_id: "rollback-b", title: "rollback b", depends_on: ["missing"] },
      ],
    });
    expect(rejected.status).toBe(404);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(beforeRollback);
    expect((await store.tasks.list({ include_subtasks: true })).some((task) => task.title.startsWith("rollback"))).toBe(false);

    const rollbackFirst = await store.tasks.create({ title: "rollback delete first" });
    const rollbackSecond = await store.tasks.create({ title: "rollback delete second" });
    await client.query(`ALTER TABLE ${table} ADD CONSTRAINT fixture_reject_second_delete CHECK (object_id <> '${rollbackSecond.id}' OR deleted_at IS NULL)`);
    await expect(store.tasks.bulkDeleteAtomic!([rollbackFirst.id, rollbackSecond.id], true)).rejects.toThrow();
    expect(await store.tasks.get(rollbackFirst.id)).not.toBeNull();
    expect(await store.tasks.get(rollbackSecond.id)).not.toBeNull();
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT fixture_reject_second_delete`);

    const parent = await store.tasks.create({ title: "delete parent" });
    const child = await store.tasks.create({ title: "delete child", parent_id: parent.id });
    const skipped = await request("tasks/bulk-delete", {
      schema_version: 1,
      task_ids: [parent.id],
      force: false,
    });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({ receipt: {
      atomic: true,
      results: [{ requested_id: parent.id, task_id: parent.id, outcome: "skipped", reason: "has_children" }],
    } });

    scopes = ["todos:read", "todos:write"];
    const denied = await request("tasks/bulk-delete", {
      schema_version: 1,
      task_ids: [parent.id],
      force: true,
    });
    expect(denied.status).toBe(403);
    expect(await store.tasks.get(parent.id)).not.toBeNull();
    expect(await store.tasks.get(child.id)).not.toBeNull();

    scopes.push("todos:*");
    const forced = await request("tasks/bulk-delete", {
      schema_version: 1,
      task_ids: [parent.id],
      force: true,
    });
    expect(forced.status).toBe(200);
    expect(await forced.json()).toMatchObject({ receipt: {
      atomic: true,
      force: true,
      results: [{ requested_id: parent.id, task_id: parent.id, outcome: "deleted", reason: null }],
    } });
    expect(await store.tasks.get(parent.id)).toBeNull();
    expect(await store.tasks.get(child.id)).toBeNull();
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}, ${cursorTable}`);
    await client.close();
  }
}, 60_000);

pgTest("PostgreSQL bulk create reuses the outer transaction for parent and plan guards", async () => {
  const client = createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!, { max: 4 });
  const suffix = randomUUID().replaceAll("-", "");
  const table = `todos_bulk_guard_fixture_${suffix}`;
  const cursorTable = `${table}_cursor`;
  const service = `bulk-guard-fixture-${suffix}`;
  const store = createPostgresTodosStorageAdapter({ client, service, tableName: table, cursorTableName: cursorTable });
  const dependencies: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getMachineRegistryTenantId: () => "fixture",
    getVerifier: () => ({
      authenticate: async () => ({
        ok: true,
        principal: { kid: "fixture", tid: "fixture", agent: "bulk-agent", scopes: ["todos:read", "todos:write", "todos:*"] },
      }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
  const post = async (body: unknown) => {
    const url = new URL("http://fixture.test/v1/tasks/bulk-create");
    return (await handleV1Request(new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), url, dependencies))!;
  };

  try {
    const parent = await store.tasks.create({ title: "guard parent" });
    const plan = await store.plans.create({ name: "guard plan" });
    const accepted = await post({
      schema_version: 1,
      tasks: [
        { temp_id: "parented", title: "accepted parented", parent_id: parent.id },
        { temp_id: "planned", title: "accepted planned", plan_id: plan.id },
      ],
    });
    expect(accepted.status).toBe(201);
    const acceptedBody = await accepted.json() as { receipt: { created: Array<{ id: string }> } };
    expect(await store.tasks.get(acceptedBody.receipt.created[0]!.id)).toMatchObject({ parent_id: parent.id });
    expect(await store.tasks.get(acceptedBody.receipt.created[1]!.id)).toMatchObject({ plan_id: plan.id });

    const beforeRollback = await store.tasks.count({ include_subtasks: true });
    const rejected = await post({
      schema_version: 1,
      tasks: [
        { temp_id: "rollback-parented", title: "rollback parented", parent_id: parent.id },
        { temp_id: "rollback-planned", title: "rollback planned", plan_id: plan.id, depends_on: ["missing-late-edge"] },
      ],
    });
    expect(rejected.status).toBe(404);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(beforeRollback);
    expect((await store.tasks.list({ include_subtasks: true })).filter((task) => task.title.startsWith("rollback "))).toEqual([]);
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}, ${cursorTable}`);
    await client.close();
  }
}, 60_000);

pgTest("PostgreSQL archived-only route pages a tiny archive inside a fleet-sized corpus", async () => {
  const client = createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!, { max: 4 });
  const suffix = randomUUID().replaceAll("-", "");
  const table = `todos_archive_page_fixture_${suffix}`;
  const cursorTable = `${table}_cursor`;
  const service = `archive-page-fixture-${suffix}`;
  const store = createPostgresTodosStorageAdapter({ client, service, tableName: table, cursorTableName: cursorTable });
  const projectId = `fleet-project-${suffix}`;
  const dependencies: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getMachineRegistryTenantId: () => "fixture",
    getVerifier: () => ({
      authenticate: async () => ({
        ok: true,
        principal: { kid: "fixture", tid: "fixture", agent: "reader", scopes: ["todos:read"] },
      }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };

  try {
    await store.tasks.count(); // ensure the disposable schema exists
    await client.query(
      `INSERT INTO ${table} (service, object_type, object_id, payload, updated_at, deleted_at, version)
       SELECT $1, 'tasks', $2 || '-' || n::text,
              jsonb_build_object(
                'id', $2 || '-' || n::text,
                'title', 'fleet task ' || n::text,
                'status', 'completed',
                'priority', 'low',
                'project_id', $3::text,
                'parent_id', NULL,
                'archived_at', CASE WHEN n > 10001 THEN '2026-09-01T00:00:00.000Z' ELSE NULL END,
                'created_at', '2026-08-01T00:00:00.000Z',
                'updated_at', '2026-09-01T00:00:00.000Z'
              ),
              '2026-09-01T00:00:00.000Z'::timestamptz, NULL, 1
       FROM generate_series(1, 10003) AS n`,
      [service, `fleet-${suffix}`, projectId],
    );
    const url = new URL(`http://fixture.test/v1/tasks?project_id=${encodeURIComponent(projectId)}&archived_only=true&include_archived=true&limit=1&offset=0`);
    const response = (await handleV1Request(new Request(url), url, dependencies))!;
    expect(response.status).toBe(200);
    const body = await response.json() as { tasks: Array<{ archived_at: string | null }>; count: number; total: number };
    expect(body).toMatchObject({ count: 1, total: 2 });
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]!.archived_at).not.toBeNull();
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}, ${cursorTable}`);
    await client.close();
  }
}, 60_000);
