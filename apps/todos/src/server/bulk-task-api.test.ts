import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";

let db: Database;
let store: TodosStorageAdapter;
let scopes: string[];
let dependencies: V1RequestDependencies;

function request(path: string, method = "GET", body?: unknown): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, dependencies);
}

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
  store = createLocalSqliteTodosStorageAdapter({ db });
  scopes = ["todos:read", "todos:write", "todos:*"];
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getVerifier: () => ({
      authenticate: async (_headers: unknown, options: { requiredScopes: string[] }) =>
        options.requiredScopes.every((scope) => scopes.includes(scope) || scopes.includes("todos:*"))
          ? { ok: true, principal: { agent: "bulk-agent", scopes } }
          : { ok: false, status: 403, message: "scope denied", reason: "scope" },
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
});

afterEach(() => resetDatabase());

describe("atomic task bulk API", () => {
  test("creates every task and sibling dependency in one transaction", async () => {
    const assignee = await store.agents.register({ name: "athena" });
    const response = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [
        { temp_id: "first", title: "first" },
        {
          temp_id: "second", title: "second", depends_on: ["first"],
          agent_id: "agent-owner", created_by: "agent-filer", assigned_to: "Athena",
        },
      ],
    });
    expect(response?.status).toBe(201);
    const body = await response!.json() as { receipt: {
      schema_version: number;
      atomic: boolean;
      created: Array<{ temp_id: string; id: string; title: string }>;
      dependencies: Array<{ task_id: string; depends_on: string }>;
    } };
    expect(body.receipt).toMatchObject({ schema_version: 1, atomic: true });
    expect(body.receipt.created.map((item) => item.temp_id)).toEqual(["first", "second"]);
    expect(body.receipt.dependencies).toEqual([{
      task_id: body.receipt.created[1]!.id,
      depends_on: body.receipt.created[0]!.id,
    }]);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(2);
    expect(await store.tasks.get(body.receipt.created[1]!.id)).toMatchObject({
      agent_id: "agent-owner",
      created_by: "agent-filer",
      assigned_to: assignee.id,
    });
  });

  test("rolls back the whole create batch when a late dependency fails", async () => {
    const response = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [
        { temp_id: "first", title: "must roll back" },
        { temp_id: "second", title: "also rolls back", depends_on: ["missing-task"] },
      ],
    });
    expect(response?.status).toBe(404);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(0);
    expect(await store.dependencies!.listAll!()).toEqual([]);
  });

  test("rejects two aliases to the same dependency inside the transaction", async () => {
    const existing = await store.tasks.create({ title: "existing dependency" });
    const before = await store.tasks.count({ include_subtasks: true });
    const response = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [{ title: "must roll back", depends_on: [existing.id, existing.id.slice(0, 12)] }],
    });
    expect(response?.status).toBe(409);
    expect(await response!.json()).toMatchObject({ code: "BULK_CREATE_DUPLICATE_DEPENDENCY" });
    expect(await store.tasks.count({ include_subtasks: true })).toBe(before);
    expect((await store.tasks.list({ include_subtasks: true })).some((task) => task.title === "must roll back")).toBe(false);
  });

  test("honors force only through the authoritative route and refuses it before mutation without todos:*", async () => {
    const parent = await store.tasks.create({ title: "parent" });
    const child = await store.tasks.create({ title: "child", parent_id: parent.id });

    const skipped = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: [parent.id],
      force: false,
    });
    expect(skipped?.status).toBe(200);
    expect(await skipped!.json()).toMatchObject({ receipt: {
      schema_version: 1,
      atomic: true,
      force: false,
      results: [{ requested_id: parent.id, task_id: parent.id, outcome: "skipped", reason: "has_children" }],
    } });
    expect(await store.tasks.get(parent.id)).not.toBeNull();
    expect(await store.tasks.get(child.id)).not.toBeNull();

    scopes = ["todos:read", "todos:write"];
    const denied = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: [parent.id],
      force: true,
    });
    expect(denied?.status).toBe(403);
    expect(await store.tasks.get(parent.id)).not.toBeNull();
    expect(await store.tasks.get(child.id)).not.toBeNull();

    scopes.push("todos:*");
    const forced = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: [parent.id, "missing"],
      force: true,
    });
    expect(forced?.status).toBe(200);
    expect(await forced!.json()).toMatchObject({ receipt: {
      schema_version: 1,
      atomic: true,
      force: true,
      results: [
        { requested_id: parent.id, task_id: parent.id, outcome: "deleted", reason: null },
        { requested_id: "missing", task_id: null, outcome: "missing", reason: "not_found" },
      ],
    } });
    expect(await store.tasks.get(parent.id)).toBeNull();
    expect(await store.tasks.get(child.id)).toBeNull();
  });

  test("bulk delete is order-independent, reports cascade-covered descendants, and rejects aliases to one task", async () => {
    const parent = await store.tasks.create({ title: "ordered parent" });
    const child = await store.tasks.create({ title: "ordered child", parent_id: parent.id });
    const nonForce = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: [child.id, parent.id],
      force: false,
    });
    expect(nonForce?.status).toBe(200);
    expect(await nonForce!.json()).toMatchObject({ receipt: { results: [
      { requested_id: child.id, task_id: child.id, outcome: "deleted", reason: null },
      { requested_id: parent.id, task_id: parent.id, outcome: "skipped", reason: "has_children" },
    ] } });
    expect(await store.tasks.get(child.id)).toBeNull();
    expect(await store.tasks.get(parent.id)).not.toBeNull();

    const forcedParent = await store.tasks.create({ title: "forced parent" });
    const forcedChild = await store.tasks.create({ title: "forced child", parent_id: forcedParent.id });
    const externalBlocker = await store.tasks.create({ title: "external blocker" });
    await store.dependencies!.add(externalBlocker.id, forcedChild.id);
    const forced = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: [forcedParent.id, forcedChild.id],
      force: true,
    });
    expect(forced?.status).toBe(200);
    expect(await forced!.json()).toMatchObject({ receipt: { results: [
      { requested_id: forcedParent.id, task_id: forcedParent.id, outcome: "deleted", reason: null },
      { requested_id: forcedChild.id, task_id: forcedChild.id, outcome: "deleted", reason: null },
    ] } });
    expect(await store.tasks.get(forcedParent.id)).toBeNull();
    expect(await store.tasks.get(forcedChild.id)).toBeNull();
    expect(await store.tasks.get(externalBlocker.id)).not.toBeNull();
    expect(await store.dependencies!.listAll!()).toEqual([]);
    const tombstones = db.query(
      "SELECT object_id FROM storage_tombstones WHERE object_type = 'tasks' AND object_id IN (?, ?) ORDER BY object_id",
    ).all(forcedParent.id, forcedChild.id) as Array<{ object_id: string }>;
    expect(tombstones.map((row) => row.object_id)).toEqual([forcedChild.id, forcedParent.id].sort());

    const aliased = await store.tasks.create({ title: "alias target" });
    const aliasConflict = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: [aliased.id, aliased.id.slice(0, 12)],
      force: false,
    });
    expect(aliasConflict?.status).toBe(409);
    expect(await store.tasks.get(aliased.id)).not.toBeNull();
  });

  test("local bulk deletion rolls every prior delete back on a late storage failure", async () => {
    const first = await store.tasks.create({ title: "rollback first" });
    const second = await store.tasks.create({ title: "rollback second" });
    db.run(`CREATE TRIGGER reject_second_bulk_delete BEFORE DELETE ON tasks
      WHEN OLD.id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'fixture late delete failure'); END`);
    expect(() => store.tasks.bulkDeleteAtomic!([first.id, second.id], true)).toThrow("fixture late delete failure");
    expect(await store.tasks.get(first.id)).not.toBeNull();
    expect(await store.tasks.get(second.id)).not.toBeNull();
  });

  test("rejects malformed and oversized requests before mutation", async () => {
    const duplicate = await request("/v1/tasks/bulk-delete", "POST", {
      schema_version: 1,
      task_ids: ["same", "same"],
    });
    expect(duplicate?.status).toBe(400);

    const oversized = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: Array.from({ length: 51 }, (_, index) => ({ title: `task ${index}` })),
    });
    expect(oversized?.status).toBe(400);

    const invalidType = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [{ title: "invalid", description: 42 }],
    });
    expect(invalidType?.status).toBe(400);

    const duplicateTemp = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [{ temp_id: "same", title: "one" }, { temp_id: "same", title: "two" }],
    });
    expect(duplicateTemp?.status).toBe(400);

    const duplicateDependency = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [{ temp_id: "one", title: "one" }, { title: "two", depends_on: ["one", "one"] }],
    });
    expect(duplicateDependency?.status).toBe(400);

    const tooLarge = await request("/v1/tasks/bulk-create", "POST", {
      schema_version: 1,
      tasks: [{ title: "too large", description: "x".repeat(2 * 1024 * 1024) }],
    });
    expect(tooLarge?.status).toBe(413);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(0);
  });
});

test("agent and recent-activity reads are storage-bounded", async () => {
  await store.agents.register({ name: "ada" });
  await store.agents.register({ name: "grace" });
  const first = await request("/v1/agents?limit=1&offset=0");
  expect(first?.status).toBe(200);
  expect(await first!.json()).toMatchObject({ count: 1, total: 2, limit: 1, offset: 0, has_more: true, next_offset: 1 });
  const second = await request("/v1/agents?limit=1&offset=1");
  expect(await second!.json()).toMatchObject({ count: 1, total: 2, limit: 1, offset: 1, has_more: false, next_offset: null });
  expect((await request("/v1/agents?limit=501"))?.status).toBe(400);

  const task = await store.tasks.create({ title: "activity bound" });
  await store.audit.logTaskChange(task.id, "one");
  await store.audit.logTaskChange(task.id, "two");
  const activity = await request("/v1/activity?limit=1");
  expect(activity?.status).toBe(200);
  expect(await activity!.json()).toMatchObject({ count: 1, limit: 1 });
  expect((await request("/v1/activity?limit=10001"))?.status).toBe(400);
});

test("archived-only task pagination filters before the bounded page", async () => {
  for (let index = 0; index < 1_001; index++) {
    db.run(
      `INSERT INTO tasks (id, title, status, priority, version, tags, metadata, created_at, updated_at)
       VALUES (?, ?, 'completed', 'low', 1, '[]', '{}', ?, ?)`,
      [`live-${index}`, `live ${index}`, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
    );
  }
  for (let index = 0; index < 2; index++) {
    db.run(
      `INSERT INTO tasks (id, title, status, priority, version, tags, metadata, created_at, updated_at, archived_at)
       VALUES (?, ?, 'completed', 'low', 1, '[]', '{}', ?, ?, ?)`,
      [`archived-${index}`, `archived ${index}`, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"],
    );
  }
  const response = await request("/v1/tasks?archived_only=true&include_archived=true&limit=1&offset=0");
  expect(response?.status).toBe(200);
  const body = await response!.json() as { tasks: Array<{ archived_at: string | null }>; count: number; total: number };
  expect(body).toMatchObject({ count: 1, total: 2 });
  expect(body.tasks[0]!.archived_at).not.toBeNull();
  expect((await request("/v1/tasks?archived_only=true&include_archived=false&limit=1"))?.status).toBe(400);
});

test("archived_at PATCH persists and clears on the authoritative SQLite adapter", async () => {
  const task = await store.tasks.create({ title: "archive persistence" });
  const stamp = "2026-09-18T08:00:00.000Z";
  const archived = await request(`/v1/tasks/${task.id}`, "PATCH", { archived_at: stamp, version: task.version });
  expect(archived?.status).toBe(200);
  expect((await archived!.json() as { task: { archived_at: string } }).task.archived_at).toBe(stamp);
  expect((await store.tasks.get(task.id))?.archived_at).toBe(stamp);
  const current = await store.tasks.get(task.id);
  const cleared = await request(`/v1/tasks/${task.id}`, "PATCH", { archived_at: null, version: current!.version });
  expect(cleared?.status).toBe(200);
  expect((await store.tasks.get(task.id))?.archived_at).toBeNull();
});

test("task history pagination is storage-bounded and globally ordered", async () => {
  const task = await store.tasks.create({ title: "history target" });
  db.run("DELETE FROM task_history WHERE task_id = ?", [task.id]);
  db.run(
    "INSERT INTO task_history (id, task_id, action, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
    ["history-old", task.id, "old", "2026-01-01T00:00:00.000Z", "history-new", task.id, "new", "2026-02-01T00:00:00.000Z"],
  );
  const newest = await request(`/v1/tasks/${task.id}/history?limit=1&offset=0&order=desc`);
  expect(newest?.status).toBe(200);
  expect(await newest!.json()).toMatchObject({
    history: [{ id: "history-new" }], count: 1, total: 2, limit: 1, offset: 0, order: "desc", has_more: true, next_offset: 1,
  });
  const oldest = await request(`/v1/tasks/${task.id}/history?limit=1&offset=0&order=asc`);
  expect(await oldest!.json()).toMatchObject({ history: [{ id: "history-old" }], order: "asc" });
  expect((await request(`/v1/tasks/${task.id}/history?limit=501&offset=0`))?.status).toBe(400);

  const originalAudit = store.audit;
  store = {
    ...store,
    audit: {
      ...originalAudit,
      getTaskHistory: () => { throw new Error("legacy full history must not be materialized"); },
      getTaskHistoryPage: async () => ({ history: Array.from({ length: 500 }, (_, index) => ({
        id: `bounded-${index}`, task_id: task.id, action: "bounded", field: null, old_value: null, new_value: null, agent_id: null,
        created_at: `2026-03-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      })), total: 501 }),
    },
  };
  const legacy = await request(`/v1/tasks/${task.id}/history`);
  expect(legacy?.status).toBe(426);
});

test("OpenAPI and generated SDK expose the atomic bulk routes", async () => {
  const document = buildV1OpenApiDocument();
  expect(document.paths["/v1/tasks/bulk-create"].post.operationId).toBe("bulkCreateTasks");
  expect(document.paths["/v1/tasks/bulk-delete"].post.operationId).toBe("bulkDeleteTasks");
  const taskListParameters = document.paths["/v1/tasks"].get.parameters as Array<{ name: string }>;
  expect(taskListParameters.some((parameter) => parameter.name === "archived_only")).toBe(true);

  const requests: Array<{ url: string; body: unknown }> = [];
  const client = new TodosV1Client({
    baseUrl: "https://api.hasna.com/todos",
    apiKey: "fixture-key",
    fetch: async (input, init) => {
      requests.push({ url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (String(input).endsWith("/bulk-create")) {
        return Response.json({ receipt: { schema_version: 1, atomic: true, created: [], dependencies: [] } }, { status: 201 });
      }
      if (String(input).includes("/history?")) {
        return Response.json({ history: [], count: 0, total: 0, limit: 10, offset: 20, order: "desc", has_more: false, next_offset: null });
      }
      return Response.json({ receipt: { schema_version: 1, atomic: true, force: false, results: [] } });
    },
  });
  await client.bulkCreateTasks({ schema_version: 1, tasks: [{ title: "one" }] });
  await client.bulkDeleteTasks({ schema_version: 1, task_ids: ["one"], force: false });
  await client.listTaskHistory("task-one", { limit: 10, offset: 20 });
  expect(requests.map((entry) => entry.url)).toEqual([
    "https://api.hasna.com/todos/v1/tasks/bulk-create",
    "https://api.hasna.com/todos/v1/tasks/bulk-delete",
    "https://api.hasna.com/todos/v1/tasks/task-one/history?limit=10&offset=20",
  ]);
  expect(requests[0]!.body).toMatchObject({ schema_version: 1, tasks: [{ title: "one" }] });
  expect(requests[1]!.body).toEqual({ schema_version: 1, task_ids: ["one"], force: false });
});
