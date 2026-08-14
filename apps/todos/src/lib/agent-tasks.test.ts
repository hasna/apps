import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask, listTasks, updateTask } from "../db/tasks.js";
import {
  pullFromAgentTaskList,
  pushToAgentTaskList,
  syncAgentTaskList,
} from "./agent-tasks.js";

let db: Database;
let tasksRoot: string;

function taskListDir(taskListId: string): string {
  return join(tasksRoot, "codex", taskListId);
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  tasksRoot = mkdtempSync(join(tmpdir(), "todos-agent-tasks-test-"));
  process.env["TODOS_CODEX_TASKS_DIR"] = tasksRoot;
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_CODEX_TASKS_DIR"];
  rmSync(tasksRoot, { recursive: true, force: true });
});

describe("pushToAgentTaskList", () => {
  it("writes new tasks, persists their external IDs, and updates existing files", () => {
    expect(pushToAgentTaskList("codex", "queue")).toEqual({
      pushed: 0,
      pulled: 0,
      errors: [],
    });

    const task = createTask({
      title: "Ship agent sync",
      description: "Keep the external queue current",
      priority: "high",
      assigned_to: "codex",
      tags: ["sync"],
      metadata: { source: "unit-test" },
    }, db);

    expect(pushToAgentTaskList("codex", "queue")).toEqual({
      pushed: 1,
      pulled: 0,
      errors: [],
    });
    const externalPath = join(taskListDir("queue"), "1.json");
    expect(JSON.parse(readFileSync(externalPath, "utf8"))).toMatchObject({
      id: "1",
      title: "Ship agent sync",
      priority: "high",
      assigned_to: "codex",
      tags: ["sync"],
      metadata: {
        todos_id: task.id,
        source: "unit-test",
      },
    });
    expect(getTask(task.id, db)?.metadata["codex_task_id"]).toBe("1");

    const current = getTask(task.id, db)!;
    updateTask(task.id, { version: current.version, title: "Ship updated agent sync" }, db);
    expect(pushToAgentTaskList("codex", "queue").pushed).toBe(1);
    expect(JSON.parse(readFileSync(externalPath, "utf8")).title).toBe("Ship updated agent sync");
    expect(readFileSync(join(taskListDir("queue"), ".highwatermark"), "utf8")).toBe("2");
  });

  it("surfaces an unusable task-list base path", () => {
    const blockedPath = join(tasksRoot, "not-a-directory");
    writeFileSync(blockedPath, "blocked");
    process.env["TODOS_CODEX_TASKS_DIR"] = blockedPath;
    createTask({ title: "Cannot be written" }, db);

    expect(() => pushToAgentTaskList("codex", "queue")).toThrow();
  });
});

describe("pullFromAgentTaskList", () => {
  it("returns a useful error when the external task list is missing", () => {
    const result = pullFromAgentTaskList("codex", "missing");

    expect(result).toEqual({
      pushed: 0,
      pulled: 0,
      errors: [`Task list directory not found: ${taskListDir("missing")}`],
    });
  });

  it("creates and updates tasks while ignoring internal and malformed files", () => {
    const directory = taskListDir("incoming");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "7.json"), JSON.stringify({
      id: "7",
      title: "Review incoming change",
      description: "Initial description",
      status: "pending",
      priority: "high",
      assigned_to: "codex",
      tags: ["review"],
      metadata: { source: "external" },
    }));
    writeFileSync(join(directory, "8.json"), JSON.stringify({
      id: "8",
      title: "Internal bookkeeping",
      description: "",
      status: "pending",
      priority: "low",
      assigned_to: "",
      tags: [],
      metadata: { _internal: true },
    }));
    writeFileSync(join(directory, "broken.json"), "not-json");

    expect(pullFromAgentTaskList("codex", "incoming")).toEqual({
      pushed: 0,
      pulled: 1,
      errors: [],
    });
    expect(listTasks({}, db)).toHaveLength(1);
    const created = listTasks({}, db)[0]!;
    expect(created).toMatchObject({
      title: "Review incoming change",
      description: "Initial description",
      status: "pending",
      priority: "high",
      assigned_to: "codex",
      tags: ["review"],
      metadata: expect.objectContaining({
        source: "external",
        codex_task_id: "7",
      }),
    });

    writeFileSync(join(directory, "7.json"), JSON.stringify({
      id: "7",
      title: "Review revised change",
      description: "Revised description",
      status: "completed",
      priority: "critical",
      assigned_to: "athena",
      tags: ["review", "done"],
      metadata: { source: "external-update" },
    }));

    expect(pullFromAgentTaskList("codex", "incoming").pulled).toBe(1);
    expect(listTasks({}, db)).toHaveLength(1);
    expect(getTask(created.id, db)).toMatchObject({
      title: "Review revised change",
      description: "Revised description",
      status: "completed",
      priority: "critical",
      assigned_to: "athena",
      tags: ["review", "done"],
      metadata: expect.objectContaining({
        source: "external-update",
        codex_task_id: "7",
      }),
    });
  });
});

describe("syncAgentTaskList", () => {
  it("combines pull and push results for an existing empty queue", () => {
    mkdirSync(taskListDir("sync"), { recursive: true });
    const task = createTask({ title: "Push during bidirectional sync" }, db);

    expect(syncAgentTaskList("codex", "sync")).toEqual({
      pushed: 1,
      pulled: 0,
      errors: [],
    });
    expect(JSON.parse(readFileSync(join(taskListDir("sync"), "1.json"), "utf8"))).toMatchObject({
      title: "Push during bidirectional sync",
      metadata: { todos_id: task.id },
    });
  });

  it("preserves a missing-list pull error while creating and pushing the queue", () => {
    createTask({ title: "Create queue during sync" }, db);

    const result = syncAgentTaskList("codex", "new-queue");

    expect(result).toMatchObject({ pushed: 1, pulled: 0 });
    expect(result.errors).toEqual([
      `Task list directory not found: ${taskListDir("new-queue")}`,
    ]);
    expect(JSON.parse(readFileSync(join(taskListDir("new-queue"), "1.json"), "utf8")).title)
      .toBe("Create queue during sync");
  });
});
