import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";
import { listActivity, type LogActivityInput } from "../lib/activity-audit.js";

let db: Database;
let store: TodosStorageAdapter;
let principal: { agent: string | null; scopes: string[]; kid?: string };
let dependencies: V1RequestDependencies;

function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, dependencies);
}

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
  store = createLocalSqliteTodosStorageAdapter({ db });
  principal = { agent: "test-agent", scopes: ["todos:*"] };
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
  test("a bound write principal rejects a spoofed lifecycle actor", async () => {
    principal = { agent: "bound-agent", scopes: ["todos:write"] };
    const task = await store.tasks.create({ title: "authority regression" });

    const response = await request(`/v1/tasks/${task.id}/complete`, "POST", {
      agent_id: "spoofed-agent",
    });

    expect(response?.status).toBe(403);
    expect(await store.tasks.get(task.id)).toMatchObject({ status: "pending" });
  });

  test("complete persists the full operational evidence body and confidence", async () => {
    principal = { agent: "reviewer", scopes: ["todos:write"] };
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
    principal = { agent: "compat-agent", scopes: ["todos:write"] };
    const agentResponse = await request(`/v1/tasks/${agentOnly.id}/complete`, "POST", { agent_id: "compat-agent" });
    expect(agentResponse?.status).toBe(200);
    expect(await store.tasks.get(agentOnly.id)).toMatchObject({ status: "completed" });
  });

  test("generic task PATCH keeps local completion and reopen lifecycle compatibility", async () => {
    const task = await store.tasks.create({ title: "generic lifecycle", assigned_to: "test-agent" });
    const started = await store.tasks.start(task.id, "test-agent");

    const completedResponse = await request(`/v1/tasks/${task.id}`, "PATCH", {
      version: started.version,
      status: "completed",
    });
    expect(completedResponse?.status).toBe(200);
    const completed = (await completedResponse!.json() as { task: typeof started }).task;
    expect(completed).toMatchObject({ status: "completed", locked_by: null, locked_at: null });
    expect(completed.completed_at).toBe(completed.updated_at);

    const reopenedResponse = await request(`/v1/tasks/${task.id}`, "PATCH", {
      version: completed.version,
      status: "pending",
    });
    expect(reopenedResponse?.status).toBe(200);
    expect((await reopenedResponse!.json() as { task: typeof started }).task).toMatchObject({
      status: "pending",
      completed_at: null,
    });
  });

  test("generic task PATCH returns 409 for a stale canonical completion update", async () => {
    const task = await store.tasks.create({ title: "stale canonical completion" });
    const startedResponse = await request(`/v1/tasks/${task.id}`, "PATCH", {
      status: "in_progress",
      version: task.version,
    });
    expect(startedResponse?.status).toBe(200);

    const conflict = await request(`/v1/tasks/${task.id}`, "PATCH", {
      status: "completed",
      version: task.version,
    });
    expect(conflict?.status).toBe(409);
    expect(await store.tasks.get(task.id)).toMatchObject({ status: "in_progress" });
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

    principal = { agent: "admin-agent", scopes: ["todos:*"] };
    const response = await request(
      `/v1/tasks/${task.id}/unlock`,
      "POST",
      { force: true },
      { "x-todos-act-as": "parent-agent" },
    );
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

describe("/v1 mutation actor authority", () => {
  test("an unbound write credential cannot mutate and no todos-serve fallback exists", async () => {
    principal = { agent: null, scopes: ["todos:write"] };
    const response = await request("/v1/tasks", "POST", { title: "must not exist" });
    expect(response?.status).toBe(403);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(0);
  });

  test("bound principal wins for every actor-bearing task mutation", async () => {
    principal = { agent: "bound-agent", scopes: ["todos:write"] };
    const actions = ["start", "complete", "fail", "claim", "lock", "unlock"];
    for (const action of actions) {
      const task = await store.tasks.create({ title: `guard ${action}` });
      const response = await request(`/v1/tasks/${task.id}/${action}`, "POST", { agent_id: "spoofed-agent" });
      expect(response?.status).toBe(403);
      expect(await store.tasks.get(task.id)).toMatchObject({ status: "pending", locked_by: null });
    }

    const evidenceTask = await store.tasks.create({ title: "evidence guard" });
    expect((await request(`/v1/tasks/${evidenceTask.id}/comments`, "POST", {
      content: "spoofed",
      agent_id: "spoofed-agent",
    }))?.status).toBe(403);
    expect((await request(`/v1/tasks/${evidenceTask.id}/verifications`, "POST", {
      command: "bun test",
      agent_id: "spoofed-agent",
    }))?.status).toBe(403);
  });

  test("task update rejects coordination and actor fields outside UpdateTaskInput", async () => {
    const task = await store.tasks.create({ title: "closed update surface" });
    const response = await request(`/v1/tasks/${task.id}`, "PATCH", {
      locked_by: "spoofed-agent",
      locked_at: "2026-07-18T12:00:00.000Z",
    });

    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ error: "unknown task update field: locked_by" });
    expect(await store.tasks.get(task.id)).toMatchObject({ locked_by: null, locked_at: null, version: task.version });
  });

  test("task update rejects invalid runtime values before storage", async () => {
    const task = await store.tasks.create({ title: "validated patch" });
    const invalidBodies = [
      { status: "blocked" },
      { priority: "urgent" },
      { tags: "not-an-array" },
      { tags: ["valid", 42] },
      { metadata: [] },
      { due_at: "not-a-timestamp" },
      { due_at: "2026-07-19" },
      { due_at: "2026-02-31T00:00:00Z" },
      { completed_at: "2025-02-29T00:00:00+00:00" },
      { completed_at: false },
      { retry_after: 42 },
      { requires_approval: "yes" },
      { confidence: 2 },
      { retry_count: -1 },
      { version: 1.5 },
      { description: null },
      { working_dir: 42 },
    ];

    for (const body of invalidBodies) {
      const response = await request(`/v1/tasks/${task.id}`, "PATCH", body);
      expect(response?.status).toBe(400);
    }
    expect(await store.tasks.get(task.id)).toMatchObject({ version: task.version, status: "pending", priority: "medium" });
  });

  test("task update accepts documented nullable fields and records approval time", async () => {
    const task = await store.tasks.create({
      title: "valid patch",
      assigned_to: "test-agent",
      due_at: "2026-07-19T00:00:00.000Z",
      requires_approval: true,
    });
    const response = await request(`/v1/tasks/${task.id}`, "PATCH", {
      assigned_to: null,
      working_dir: null,
      due_at: null,
      confidence: null,
      approved_by: "test-agent",
      version: task.version,
    });

    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      task: {
        assigned_to: null,
        working_dir: null,
        due_at: null,
        confidence: null,
        approved_by: "test-agent",
        approved_at: expect.any(String),
      },
    });
  });

  test("task update preserves an omitted task list and detaches an explicit null task list", async () => {
    const taskList = await store.taskLists.create({ name: "Remote queue", slug: "remote-queue" });
    const task = await store.tasks.create({ title: "remote detach", task_list_id: taskList.id });

    const preservedResponse = await request(`/v1/tasks/${task.id}`, "PATCH", {
      priority: "high",
      version: task.version,
    });
    expect(preservedResponse?.status).toBe(200);
    const preserved = (await preservedResponse!.json() as { task: typeof task }).task;
    expect(preserved).toMatchObject({ task_list_id: taskList.id, priority: "high" });

    const detachedResponse = await request(`/v1/tasks/${task.id}`, "PATCH", {
      task_list_id: null,
      version: preserved.version,
    });
    expect(detachedResponse?.status).toBe(200);
    expect(await detachedResponse!.json()).toMatchObject({ task: { task_list_id: null } });
    expect(await store.tasks.get(task.id)).toMatchObject({ task_list_id: null });
  });

  test("task update accepts calendar-valid RFC3339 leap-day timestamps", async () => {
    const task = await store.tasks.create({ title: "valid leap timestamp" });
    const response = await request(`/v1/tasks/${task.id}`, "PATCH", {
      due_at: "2024-02-29T23:59:59+14:00",
      version: task.version,
    });

    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      task: { due_at: "2024-02-29T23:59:59+14:00" },
    });
  });

  test("approval stores the normalized effective actor instead of the body spelling", async () => {
    const task = await store.tasks.create({ title: "normalized approval", requires_approval: true });
    const response = await request(`/v1/tasks/${task.id}`, "PATCH", {
      approved_by: "  test-agent  ",
      version: task.version,
    });

    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({ task: { approved_by: "test-agent" } });
  });

  test("fail rejects a malformed retry timestamp before changing task state", async () => {
    for (const retryAfter of ["tomorrow", "2026-02-31T00:00:00Z"]) {
      const task = await store.tasks.create({ title: `invalid retry timestamp ${retryAfter}` });
      const response = await request(`/v1/tasks/${task.id}/fail`, "POST", {
        retry: true,
        retry_after: retryAfter,
      });

      expect(response?.status).toBe(400);
      expect(await store.tasks.get(task.id)).toMatchObject({ status: "pending", version: task.version });
    }
  });

  test("task assignment and approval assertions cannot name a different actor", async () => {
    expect((await request("/v1/tasks", "POST", {
      title: "forged assignment",
      assigned_by: "spoofed-agent",
    }))?.status).toBe(403);
    expect((await request("/v1/tasks/upsert", "POST", {
      title: "forged upsert assignment",
      fingerprint: "forged-upsert-assignment",
      assigned_by: "spoofed-agent",
    }))?.status).toBe(403);

    const task = await store.tasks.create({ title: "approval guard", requires_approval: true });
    expect((await request(`/v1/tasks/${task.id}`, "PATCH", {
      version: task.version,
      approved_by: "spoofed-agent",
    }))?.status).toBe(403);
    expect(await store.tasks.get(task.id)).toMatchObject({ approved_by: null, version: task.version });
  });

  test("task and plan agent_id remain domain data while storage actor is authenticated principal", async () => {
    const contexts: Array<Record<string, unknown> | undefined> = [];
    const originalTaskCreate = store.tasks.create.bind(store.tasks);
    const originalPlanCreate = store.plans.create.bind(store.plans);
    store.tasks.create = (input, context) => {
      contexts.push(context);
      return originalTaskCreate(input, context);
    };
    store.plans.create = (input, context) => {
      contexts.push(context);
      return originalPlanCreate(input, context);
    };

    const taskResponse = await request("/v1/tasks", "POST", { title: "domain owner", agent_id: "domain-agent" });
    const planResponse = await request("/v1/plans", "POST", { name: "Domain plan", agent_id: "plan-domain-agent" });
    expect(taskResponse?.status).toBe(201);
    expect(planResponse?.status).toBe(201);
    expect(await taskResponse!.json()).toMatchObject({ task: { agent_id: "domain-agent" } });
    expect(await planResponse!.json()).toMatchObject({ plan: { agent_id: "plan-domain-agent" } });
    expect(contexts).toEqual([
      expect.objectContaining({ authenticatedAgentId: "test-agent", effectiveAgentId: "test-agent", agentId: "test-agent", actorActAs: false }),
      expect.objectContaining({ authenticatedAgentId: "test-agent", effectiveAgentId: "test-agent", agentId: "test-agent", actorActAs: false }),
    ]);
  });

  test("administrative act-as is explicit and preserves authenticated plus effective attribution", async () => {
    principal = { agent: "admin-agent", scopes: ["todos:*"], kid: "test-key-id" };
    const contexts: Array<Record<string, unknown> | undefined> = [];
    const auditCalls: Array<{ input: LogActivityInput; context: unknown }> = [];
    const originalCreate = store.tasks.create.bind(store.tasks);
    const originalLogActivity = store.audit.logActivity!.bind(store.audit);
    store.tasks.create = (input, context) => {
      contexts.push(context);
      return originalCreate(input, context);
    };
    store.audit.logActivity = (input, context) => {
      auditCalls.push({ input, context });
      return originalLogActivity(input, context);
    };

    const allowed = await request(
      "/v1/tasks",
      "POST",
      { title: "denied" },
      { "x-todos-act-as": "effective-agent" },
    );
    expect(allowed?.status).toBe(201);
    expect(contexts[0]).toEqual(expect.objectContaining({
      authenticatedAgentId: "admin-agent",
      effectiveAgentId: "effective-agent",
      agentId: "effective-agent",
      actorKeyId: "test-key-id",
      actorActAs: true,
    }));
    expect(auditCalls[0]).toEqual({
      input: expect.objectContaining({
        entity_type: "api_mutation",
        entity_id: "/v1/tasks",
        action: "admin_act_as_attempt",
        old_value: "admin-agent",
        new_value: "effective-agent",
        actor_id: "effective-agent",
      }),
      context: expect.objectContaining({
        authenticatedAgentId: "admin-agent",
        effectiveAgentId: "effective-agent",
        actorKeyId: "test-key-id",
        actorActAs: true,
      }),
    });

    principal = { agent: null, scopes: ["todos:*"], kid: "unbound-admin-key" };
    expect((await request(
      "/v1/tasks",
      "POST",
      { title: "unattributed act-as" },
      { "x-todos-act-as": "effective-agent" },
    ))?.status).toBe(403);

    principal = { agent: "writer", scopes: ["todos:write"] };
    expect((await request(
      "/v1/tasks",
      "POST",
      { title: "not admin" },
      { "x-todos-act-as": "effective-agent" },
    ))?.status).toBe(403);
  });

  test("administrative act-as fails before mutation when the activity ledger is unavailable", async () => {
    principal = { agent: "admin-agent", scopes: ["todos:*"], kid: "test-key-id" };
    store.audit.logActivity = undefined;

    const response = await request(
      "/v1/tasks",
      "POST",
      { title: "must not be created" },
      { "x-todos-act-as": "effective-agent" },
    );

    expect(response?.status).toBe(503);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(0);
  });

  test("agent registration and lifecycle cannot target another agent", async () => {
    principal = { agent: "Marcus", scopes: ["todos:write"] };
    expect((await request("/v1/agents", "POST", { name: "Brutus" }))?.status).toBe(403);

    const target = await store.agents.register({ name: "Brutus" });
    if ("conflict" in target) throw new Error("unexpected agent fixture conflict");
    expect((await request(`/v1/agents/${target.id}/heartbeat`, "POST"))?.status).toBe(403);
    expect((await request(`/v1/agents/${target.id}/release`, "POST"))?.status).toBe(403);
  });

  test("snapshot import needs dedicated authority and always audits as immutable importer", async () => {
    let seenContext: Record<string, unknown> | undefined;
    store.sync.importSnapshot = async (_snapshot, context) => {
      seenContext = context;
      return { inserted: 1, updated: 0, skipped: 0 };
    };
    const snapshot = { tasks: [{ id: "import-fixture" }] };

    principal = { agent: "writer", scopes: ["todos:write"], kid: "writer-key" };
    expect((await request("/v1/import", "POST", snapshot))?.status).toBe(403);

    principal = { agent: "import-runner", scopes: ["todos:import"], kid: "import-key" };
    const imported = await request("/v1/import", "POST", snapshot);
    expect(imported?.status).toBe(200);
    expect(seenContext).toEqual(expect.objectContaining({
      authenticatedAgentId: "import-runner",
      effectiveAgentId: "todos-importer",
      agentId: "todos-importer",
      actorKeyId: "import-key",
      actorActAs: false,
    }));
    expect(listActivity({ action: "snapshot_import_attempt" }, db)).toEqual([
      expect.objectContaining({
        entity_type: "api_mutation",
        entity_id: "/v1/import",
        actor_id: "todos-importer",
        old_value: "import-runner",
        new_value: "todos-importer",
        metadata: expect.objectContaining({
          authenticated_agent_id: "import-runner",
          effective_agent_id: "todos-importer",
          actor_key_id: "import-key",
          immutable_importer: true,
        }),
      }),
    ]);
    expect((await request(
      "/v1/import",
      "POST",
      snapshot,
      { "x-todos-act-as": "someone-else" },
    ))?.status).toBe(400);
  });
});
