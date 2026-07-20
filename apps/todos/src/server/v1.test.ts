import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";

let db: Database;
let store: TodosStorageAdapter;
let principal: { agent: string | null; scopes: string[] };
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
  principal = { agent: null, scopes: ["todos:*"] };
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getVerifier: () => ({
      authenticate: async () => ({ ok: true, principal }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
});

afterEach(() => resetDatabase());

describe("/v1 task-list cloud parity", () => {
  test("list tasks returns total and honors every documented filter plus offset", async () => {
    const project = await store.projects.create({ name: "Filtered", path: "/tmp/filtered" });
    const list = await store.taskLists.create({ name: "Queue", slug: "queue", project_id: project.id });
    const plan = await store.plans.create({ name: "Plan", project_id: project.id });
    await store.tasks.create({ title: "first", project_id: project.id, task_list_id: list.id, plan_id: plan.id, status: "pending", priority: "high", assigned_to: "agent-a", agent_id: "owner-a" });
    await store.tasks.create({ title: "second", project_id: project.id, task_list_id: list.id, plan_id: plan.id, status: "pending", priority: "high", assigned_to: "agent-a", agent_id: "owner-a" });
    await store.tasks.create({ title: "excluded", project_id: project.id, task_list_id: list.id, plan_id: plan.id, status: "pending", priority: "low", assigned_to: "agent-b", agent_id: "owner-b" });

    const params = new URLSearchParams({
      status: "pending",
      priority: "high",
      project_id: project.id,
      plan_id: plan.id,
      task_list_id: list.id,
      assigned_to: "agent-a",
      agent_id: "owner-a",
      limit: "1",
      offset: "1",
    });
    const response = await request(`/v1/tasks?${params}`);
    expect(response?.status).toBe(200);
    const body = await response!.json() as { tasks: Array<{ title: string }>; count: number; total: number };
    expect(body).toMatchObject({ count: 1, total: 2 });
    params.set("offset", "0");
    const firstPage = await request(`/v1/tasks?${params}`);
    const firstBody = await firstPage!.json() as { tasks: Array<{ title: string }>; count: number; total: number };
    expect(firstBody).toMatchObject({ count: 1, total: 2 });
    expect(new Set([body.tasks[0]!.title, firstBody.tasks[0]!.title])).toEqual(new Set(["first", "second"]));
  });

  test("create, project-scoped enumeration, get, update, and delete share one canonical id", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    await store.taskLists.create({ name: "Other", slug: "other" });
    const created = await request("/v1/task-lists", "POST", {
      name: "Open Emails",
      slug: "todos-open-emails",
      project_id: project.id,
    });
    expect(created?.status).toBe(201);
    const createdBody = await created!.json() as { task_list: { id: string } };

    const listed = await request(`/v1/task-lists?project_id=${project.id}`);
    const listedBody = await listed!.json() as { task_lists: Array<{ id: string }> };
    expect(listedBody.task_lists.map((list) => list.id)).toEqual([createdBody.task_list.id]);

    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`))?.status).toBe(200);
    const updated = await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", {
      slug: "emails-next",
      name: "Emails Next",
    });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toMatchObject({
      task_list: { id: createdBody.task_list.id, slug: "emails-next", name: "Emails Next" },
    });
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", { slug: 42 }))?.status).toBe(400);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", { metadata: [] }))?.status).toBe(400);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", { project_id: null }))?.status).toBe(400);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "DELETE"))?.status).toBe(200);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`))?.status).toBe(404);
  });

  test("task-list filtering does not return unrelated tasks", async () => {
    const listA = await store.taskLists.create({ name: "A", slug: "a" });
    const listB = await store.taskLists.create({ name: "B", slug: "b" });
    await store.tasks.create({ title: "in scope", task_list_id: listA.id });
    await store.tasks.create({ title: "out of scope", task_list_id: listB.id });

    const response = await request(`/v1/tasks?task_list_id=${listA.id}`);
    const body = await response!.json() as { tasks: Array<{ title: string; task_list_id: string }> };
    expect(body.tasks.map((task) => task.title)).toEqual(["in scope"]);
    expect(body.tasks.every((task) => task.task_list_id === listA.id)).toBe(true);
  });

  test("returns a stable 409 for duplicate task-list create and update", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    const first = await store.taskLists.create({ name: "Inbox", slug: "inbox", project_id: project.id });
    const second = await store.taskLists.create({ name: "Archive", slug: "archive", project_id: project.id });

    for (const response of [
      await request("/v1/task-lists", "POST", { name: "Duplicate", slug: "inbox", project_id: project.id }),
      await request(`/v1/task-lists/${second.id}`, "PATCH", { slug: first.slug }),
    ]) {
      expect(response?.status).toBe(409);
      expect(await response!.json()).toMatchObject({ code: "TASK_LIST_SLUG_CONFLICT", conflict: true });
    }
  });

  test("rejects explicit and derived empty task-list slugs before storage", async () => {
    for (const body of [
      { name: "---" },
      { name: "Inbox", slug: "" },
      { name: "Inbox", slug: "---" },
    ]) {
      expect((await request("/v1/task-lists", "POST", body))?.status).toBe(400);
    }
    const list = await store.taskLists.create({ name: "Inbox", slug: "inbox" });
    expect((await request(`/v1/task-lists/${list.id}`, "PATCH", { slug: "---" }))?.status).toBe(400);
    expect(await store.taskLists.get(list.id)).toMatchObject({ slug: "inbox" });
  });
});

describe("/v1 plan cloud parity", () => {
  test("create, list, get, complete, and delete share one canonical id", async () => {
    const created = await request("/v1/plans", "POST", {
      name: "Codila CLI control",
      slug: "codila-cli-control",
      description: "Private CLI release plan",
    });
    expect(created?.status).toBe(201);
    const createdPlan = (await created!.json() as { plan: { id: string; slug: string } }).plan;
    expect(createdPlan.slug).toBe("codila-cli-control");

    const titleAlias = await request("/v1/plans", "POST", { title: "Title alias" });
    expect(titleAlias?.status).toBe(201);
    expect(await titleAlias!.json()).toMatchObject({ plan: { name: "Title alias" } });

    for (const body of [
      {},
      { name: 42 },
      { title: "Title", name: "Different" },
      { name: "Bad status", status: "done" },
      { name: "Bad slug", slug: "---" },
      { name: "Unknown", extra: true },
    ]) {
      expect((await request("/v1/plans", "POST", body))?.status).toBe(400);
    }
    const duplicateCreate = await request("/v1/plans", "POST", { name: "Duplicate", slug: "codila cli control" });
    expect(duplicateCreate?.status).toBe(409);
    expect(await duplicateCreate!.json()).toMatchObject({ code: "PLAN_SLUG_CONFLICT", conflict: true });

    const listed = await request("/v1/plans");
    expect(await listed!.json()).toMatchObject({ count: 2 });
    expect((await request(`/v1/plans/${createdPlan.id}`))?.status).toBe(200);

    const completed = await request(`/v1/plans/${createdPlan.id}`, "PATCH", { status: "completed" });
    expect(completed?.status).toBe(200);
    expect(await completed!.json()).toMatchObject({ plan: { id: createdPlan.id, status: "completed" } });

    for (const patch of [{}, { status: "done" }, { name: "" }, { slug: "---" }, { description: 42 }, { project_id: "unsafe" }]) {
      expect((await request(`/v1/plans/${createdPlan.id}`, "PATCH", patch))?.status).toBe(400);
    }
    const other = await request("/v1/plans", "POST", { name: "Other plan", slug: "other-plan" });
    const otherPlan = (await other!.json() as { plan: { id: string } }).plan;
    const duplicatePatch = await request(`/v1/plans/${otherPlan.id}`, "PATCH", { slug: "codila cli control" });
    expect(duplicatePatch?.status).toBe(409);
    expect(await duplicatePatch!.json()).toMatchObject({ code: "PLAN_SLUG_CONFLICT", conflict: true });
    expect((await request("/v1/plans/missing", "PATCH", { status: "completed" }))?.status).toBe(404);

    expect((await request(`/v1/plans/${createdPlan.id}`, "DELETE"))?.status).toBe(200);
    expect((await request(`/v1/plans/${createdPlan.id}`))?.status).toBe(404);
  });
});

describe("/v1 project mutation", () => {
  test("create preserves explicit canonical routing fields while patch cannot mutate them", async () => {
    const explicit = await request("/v1/projects", "POST", {
      name: "Injected",
      path: "/tmp/injected",
      task_list_id: "injected-explicit",
      task_prefix: "INJ",
    });
    expect(explicit?.status).toBe(201);
    expect(await explicit!.json()).toMatchObject({
      project: { task_list_id: "injected-explicit", task_prefix: "INJ" },
    });
    expect((await request("/v1/projects", "POST", {
      name: "Invalid Explicit",
      path: "/tmp/invalid-explicit",
      task_list_id: "Not Canonical !!",
    }))?.status).toBe(400);

    const first = await request("/v1/projects", "POST", { name: "Open Emails", path: "/tmp/open-emails" });
    expect(first?.status).toBe(201);
    const firstProject = (await first!.json() as { project: { id: string; task_list_id: string } }).project;
    expect(firstProject.task_list_id).toBe("todos-open-emails");

    const distinct = await request("/v1/projects", "POST", {
      name: "Open Emails",
      path: "/tmp/open-emails-2",
      task_list_id: "open-emails-secondary",
    });
    expect(distinct?.status).toBe(201);

    const duplicate = await request("/v1/projects", "POST", { name: "Open Emails", path: "/tmp/open-emails-3" });
    expect(duplicate?.status).toBe(409);
    expect(await duplicate!.json()).toMatchObject({ code: "PROJECT_SLUG_CONFLICT", conflict: true });

    const bypass = await request(`/v1/projects/${firstProject.id}`, "PATCH", { task_list_id: "bypass" });
    expect(bypass?.status).toBe(400);
    expect(await store.projects.get(firstProject.id)).toMatchObject({ task_list_id: "todos-open-emails" });

    const emptyCanonicalSlug = await request("/v1/projects", "POST", { name: "---", path: "/tmp/empty" });
    expect(emptyCanonicalSlug?.status).toBe(400);
  });

  test("renames a project and its canonical task list atomically", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails", task_list_id: "emails" });
    const list = await store.taskLists.create({ name: "Open Emails", slug: "emails", project_id: project.id });

    const response = await request(`/v1/projects/${project.id}/rename`, "POST", {
      new_slug: "emails-next",
      name: "Emails Next",
    });
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      project: { id: project.id, name: "Emails Next", task_list_id: "emails-next" },
      task_lists_updated: 1,
    });
    expect(await store.taskLists.get(list.id)).toMatchObject({ slug: "emails-next", name: "Emails Next" });

    const invalid = await request(`/v1/projects/${project.id}/rename`, "POST", { new_slug: "---" });
    expect(invalid?.status).toBe(400);
    expect(await store.projects.get(project.id)).toMatchObject({ task_list_id: "emails-next" });
  });

  test("rejects unknown and malformed project patch fields", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    for (const body of [{ task_prefix: "BAD" }, { name: "" }, { description: 42 }, {}]) {
      const response = await request(`/v1/projects/${project.id}`, "PATCH", body);
      expect(response?.status).toBe(400);
    }
    expect((await request(`/v1/projects/${project.id}/rename`, "POST", { new_slug: "next", extra: true }))?.status).toBe(400);
    expect((await request("/v1/projects/missing", "PATCH", { name: "Missing" }))?.status).toBe(404);
  });
});

describe("/v1 task hierarchy and lock authorization", () => {
  test("complete persists the full operational evidence body and confidence", async () => {
    const task = await store.tasks.create({ title: "evidence" });
    const response = await request(`/v1/tasks/${task.id}/complete`, "POST", {
      agent_id: "reviewer",
      attachment_ids: ["attachment-one", "attachment-two"],
      files_changed: ["src/a.ts", "src/b.ts"],
      test_results: "12 passed",
      commit_hash: "abc123",
      notes: "verified",
      confidence: 0.85,
    });
    expect(response?.status).toBe(200);
    const completed = (await response!.json() as { task: { confidence: number; metadata: Record<string, unknown> } }).task;
    expect(completed.confidence).toBe(0.85);
    expect(completed.metadata).toMatchObject({
      _evidence: {
        attachment_ids: ["attachment-one", "attachment-two"],
        files_changed: ["src/a.ts", "src/b.ts"],
        test_results: "12 passed",
        commit_hash: "abc123",
        notes: "verified",
      },
      _completion: { confidence: 0.85 },
    });
    expect(await store.tasks.get(task.id)).toMatchObject({ confidence: 0.85, metadata: completed.metadata });
  });

  test("complete rejects malformed evidence and confidence before storage mutation", async () => {
    for (const body of [
      null,
      [],
      { confidence: -0.1 },
      { confidence: 1.1 },
      { confidence: "high" },
      { attachment_ids: ["ok", 42] },
      { files_changed: "src/a.ts" },
      { test_results: 42 },
      { commit_hash: { sha: "abc" } },
      { notes: ["bad"] },
      { unknown: true },
    ]) {
      const task = await store.tasks.create({ title: `invalid ${JSON.stringify(body)}` });
      const response = await request(`/v1/tasks/${task.id}/complete`, "POST", body);
      expect(response?.status).toBe(400);
      expect(await store.tasks.get(task.id)).toMatchObject({ status: "pending", confidence: null });
    }
  });

  test("complete preserves empty-body and agent-only predecessor compatibility", async () => {
    const empty = await store.tasks.create({ title: "empty completion" });
    const emptyResponse = await request(`/v1/tasks/${empty.id}/complete`, "POST");
    expect(emptyResponse?.status).toBe(200);

    const agentOnly = await store.tasks.create({ title: "agent completion" });
    const agentResponse = await request(`/v1/tasks/${agentOnly.id}/complete`, "POST", { agent_id: "compat-agent" });
    expect(agentResponse?.status).toBe(200);
    expect(await store.tasks.get(agentOnly.id)).toMatchObject({ status: "completed" });
  });

  test("create persists parent_id and parent filtering includes only children", async () => {
    const parent = await store.tasks.create({ title: "parent" });
    const created = await request("/v1/tasks", "POST", { title: "child", parent_id: parent.id });
    const createdBody = await created!.json() as { task: { id: string; parent_id: string | null } };
    expect(createdBody.task.parent_id).toBe(parent.id);

    const response = await request(`/v1/tasks?parent_id=${parent.id}`);
    const body = await response!.json() as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((task) => task.id)).toEqual([createdBody.task.id]);
  });

  test("include_subtasks=true returns roots and descendants with an inclusive total", async () => {
    const parent = await store.tasks.create({ title: "parent" });
    const child = await store.tasks.create({ title: "child", parent_id: parent.id });
    const seenFilters: Array<Record<string, unknown>> = [];
    const originalList = store.tasks.list.bind(store.tasks);
    const originalCount = store.tasks.count.bind(store.tasks);
    store.tasks.list = (filter = {}) => {
      seenFilters.push({ ...filter });
      return originalList(filter);
    };
    store.tasks.count = (filter = {}) => {
      seenFilters.push({ ...filter });
      return originalCount(filter);
    };

    const response = await request("/v1/tasks?include_subtasks=true&limit=10&offset=0");
    expect(response?.status).toBe(200);
    const body = await response!.json() as { tasks: Array<{ id: string }>; count: number; total: number };
    expect(new Set(body.tasks.map((task) => task.id))).toEqual(new Set([parent.id, child.id]));
    expect(body.count).toBe(2);
    expect(body.total).toBe(2);
    expect(seenFilters).toEqual([
      { include_subtasks: true, limit: 10, offset: 0 },
      { include_subtasks: true },
    ]);
    expect((await request("/v1/tasks?include_subtasks=1"))?.status).toBe(400);
  });

  test("force unlock is restricted to todos:* and clears a parent-owned lock", async () => {
    const task = await store.tasks.create({ title: "locked" });
    await store.tasks.start(task.id, "parent-agent");

    principal = { agent: null, scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST", { force: true }))?.status).toBe(403);

    principal = { agent: null, scopes: ["todos:*"] };
    const response = await request(`/v1/tasks/${task.id}/unlock`, "POST", { force: true });
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ success: true });
    expect((await store.tasks.get(task.id))?.locked_by).toBeNull();
  });

  test("non-owner unlock is a 409 conflict and an unbound write key is denied", async () => {
    const task = await store.tasks.create({ title: "locked" });
    await store.tasks.start(task.id, "parent-agent");

    principal = { agent: "other-agent", scopes: ["todos:write"] };
    const conflict = await request(`/v1/tasks/${task.id}/unlock`, "POST");
    expect(conflict?.status).toBe(409);
    expect(await conflict!.json()).toMatchObject({ code: "LOCK_ERROR" });

    principal = { agent: null, scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST"))?.status).toBe(403);
  });
});

describe("/v1 short task reference resolution", () => {
  test("GET /v1/tasks/:ref resolves a unique id-prefix and an exact (case-insensitive) short_id", async () => {
    const created = await request("/v1/tasks", "POST", { title: "resolvable" });
    const { task } = await created!.json() as { task: { id: string } };
    // New tasks are created with a null short_id; the 50k legacy tasks carry one,
    // so seed a legacy-style short_id directly to exercise short_id resolution.
    db.query("UPDATE tasks SET short_id = ? WHERE id = ?").run("OPE2-00125", task.id);

    const byPrefix = await request(`/v1/tasks/${task.id.slice(0, 8)}`);
    expect(byPrefix?.status).toBe(200);
    expect((await byPrefix!.json() as { task: { id: string } }).task.id).toBe(task.id);

    const byShort = await request("/v1/tasks/ope2-00125");
    expect(byShort?.status).toBe(200);
    expect((await byShort!.json() as { task: { id: string } }).task.id).toBe(task.id);

    const byShortExact = await request("/v1/tasks/OPE2-00125");
    expect(byShortExact?.status).toBe(200);
    expect((await byShortExact!.json() as { task: { id: string } }).task.id).toBe(task.id);
  });

  test("GET /v1/tasks/:ref 404s an unknown reference and does not resolve a full-UUID exact miss", async () => {
    expect((await request("/v1/tasks/NOPE-00001"))?.status).toBe(404);
    expect((await request("/v1/tasks/ffffffff-ffff-4fff-8fff-ffffffffffff"))?.status).toBe(404);
  });

  test("GET /v1/tasks/:ref 409s an ambiguous id-prefix", async () => {
    const a = await request("/v1/tasks", "POST", { title: "a" });
    const b = await request("/v1/tasks", "POST", { title: "b" });
    const idA = (await a!.json() as { task: { id: string } }).task.id;
    const idB = (await b!.json() as { task: { id: string } }).task.id;
    // Force two live tasks to share an id prefix so the prefix is ambiguous.
    db.query("UPDATE tasks SET id = ? WHERE id = ?").run("dddddddd-0000-4000-8000-000000000001", idA);
    db.query("UPDATE tasks SET id = ? WHERE id = ?").run("dddddddd-0000-4000-8000-000000000002", idB);
    expect((await request("/v1/tasks/dddddddd"))?.status).toBe(409);
  });
});
