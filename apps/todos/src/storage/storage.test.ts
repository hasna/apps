import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import {
  createLocalSqliteTodosStorageAdapter,
  type TodosStorageAdapter,
} from "../storage.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("storage adapter contracts", () => {
  test("keeps pure storage interfaces independent of SQLite modules", () => {
    const source = readFileSync(new URL("./interfaces.ts", import.meta.url), "utf8");

    expect(source).not.toContain("bun:sqlite");
    expect(source).not.toContain("../db/");
    expect(source).toContain("interface TodosStorageAdapter");
    expect(source).toContain("interface TodosTaskStore");
    expect(source).toContain("interface TodosProjectStore");
    expect(source).toContain("interface TodosAgentStore");
    expect(source).toContain("interface TodosTemplateStore");
    expect(source).toContain("interface TodosAuditStore");
    expect(source).toContain("interface TodosSyncStore");
  });

  test("exposes the expected domain stores through the local SQLite adapter", () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });

    expect(adapter.kind).toBe("sqlite");
    expect(adapter.capabilities).toEqual({
      localPersistence: true,
      remotePersistence: false,
      transactions: true,
      auditLog: true,
      sync: true,
    });
    expectStore(adapter, "tasks", [
      "create",
      "get",
      "list",
      "count",
      "update",
      "delete",
      "start",
      "complete",
      "fail",
      "claimNext",
      "getNext",
      "getActiveWork",
      "getChangedSince",
    ]);
    expectStore(adapter, "projects", ["create", "get", "getByPath", "list", "update", "delete"]);
    expectStore(adapter, "plans", ["create", "get", "list", "update", "delete"]);
    expectStore(adapter, "agents", ["register", "get", "getByName", "list", "update"]);
    expectStore(adapter, "taskLists", ["create", "get", "getBySlug", "list", "update", "delete"]);
    expectStore(adapter, "templates", ["create", "get", "list", "update", "delete", "getWithTasks"]);
    expectStore(adapter, "audit", ["logTaskChange", "addComment", "getTaskHistory", "getRecentActivity"]);
    expectStore(adapter, "sync", ["getTasksChangedSince"]);
  });

  test("delegates core task, project, plan, agent, template, audit, and sync operations", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });
    const project = await adapter.projects.create({
      name: "Storage Boundary",
      path: "/tmp/storage-boundary",
    });
    const taskList = await adapter.taskLists.create({
      name: "Storage List",
      slug: "storage-list",
      project_id: project.id,
    });
    const plan = await adapter.plans.create({
      name: "Storage Plan",
      project_id: project.id,
      task_list_id: taskList.id,
    });
    const agent = await adapter.agents.register({
      name: "storageagent",
      project_id: project.id,
      force: true,
    });
    if ("conflict" in agent) throw new Error(agent.message);

    const template = await adapter.templates.create({
      name: "Storage Template",
      title_pattern: "Template task",
      project_id: project.id,
      plan_id: plan.id,
      tasks: [{ title_pattern: "Template step", priority: "high" }],
    });
    const task = await adapter.tasks.create({
      title: "Use storage boundary",
      project_id: project.id,
      task_list_id: taskList.id,
      plan_id: plan.id,
      agent_id: agent.id,
      priority: "high",
      tags: ["storage"],
    });

    await adapter.audit.addComment({
      task_id: task.id,
      agent_id: agent.id,
      content: "Adapter comment",
    });
    await adapter.audit.logTaskChange(task.id, "test", "priority", "medium", "high", agent.id);
    const updated = await adapter.tasks.update(task.id, {
      version: task.version,
      priority: "critical",
    });

    expect(await adapter.projects.getByPath("/tmp/storage-boundary")).toMatchObject({ id: project.id });
    expect(await adapter.taskLists.getBySlug("storage-list", project.id)).toMatchObject({ id: taskList.id });
    expect(await adapter.plans.list(project.id)).toEqual([expect.objectContaining({ id: plan.id })]);
    expect(await adapter.agents.getByName("storageagent")).toMatchObject({ id: agent.id });
    expect(await adapter.templates.getWithTasks(template.id)).toMatchObject({
      id: template.id,
      tasks: [expect.objectContaining({ title_pattern: "Template step" })],
    });
    expect(updated.priority).toBe("critical");
    expect(await adapter.tasks.count({ project_id: project.id })).toBe(1);
    expect(await adapter.tasks.list({ tags: ["storage"] })).toEqual([
      expect.objectContaining({ id: task.id }),
    ]);
    expect(await adapter.audit.getTaskHistory(task.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "test" })]),
    );
    expect(await adapter.sync.getTasksChangedSince("1970-01-01T00:00:00.000Z", { project_id: project.id })).toEqual([
      expect.objectContaining({ id: task.id }),
    ]);
  });

  test("runs local adapter transactions against the same SQLite database", async () => {
    const adapter = createLocalSqliteTodosStorageAdapter({ db });

    const task = await adapter.transaction!(async (storage) => {
      const project = await storage.projects.create({
        name: "Transactional Project",
        path: "/tmp/transactional-project",
      });
      return storage.tasks.create({
        title: "Created in transaction",
        project_id: project.id,
      });
    });

    expect(task.title).toBe("Created in transaction");
    expect(await adapter.tasks.get(task.id)).toMatchObject({ id: task.id });
  });
});

function expectStore(
  adapter: TodosStorageAdapter,
  key: keyof Omit<TodosStorageAdapter, "kind" | "capabilities" | "transaction">,
  methods: string[],
) {
  const store = adapter[key] as Record<string, unknown>;
  for (const method of methods) {
    expect(typeof store[method]).toBe("function");
  }
}
