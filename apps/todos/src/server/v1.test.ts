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

function request(path: string, method = "GET", body?: Record<string, unknown>): Promise<Response | null> {
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
  test("create persists parent_id and parent filtering includes only children", async () => {
    const parent = await store.tasks.create({ title: "parent" });
    const created = await request("/v1/tasks", "POST", { title: "child", parent_id: parent.id });
    const createdBody = await created!.json() as { task: { id: string; parent_id: string | null } };
    expect(createdBody.task.parent_id).toBe(parent.id);

    const response = await request(`/v1/tasks?parent_id=${parent.id}`);
    const body = await response!.json() as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((task) => task.id)).toEqual([createdBody.task.id]);
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
