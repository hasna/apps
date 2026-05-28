import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { addTaskFile, listTaskFiles, findTasksByFile, listActiveFiles, removeTaskFile, bulkFindTasksByFiles } from "./task-files.js";
import { createTask, updateTask, getTask } from "./tasks.js";
import { createProject } from "./projects.js";
import { registerAgent } from "./agents.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
});

describe("addTaskFile", () => {
  it("links a file to a task", () => {
    const task = createTask({ title: "T1" });
    const file = addTaskFile({ task_id: task.id, path: "src/foo.ts" });
    expect(file.task_id).toBe(task.id);
    expect(file.path).toBe("src/foo.ts");
    expect(file.status).toBe("active");
  });

  it("upserts on same task+path", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/foo.ts", status: "planned" });
    const updated = addTaskFile({ task_id: task.id, path: "src/foo.ts", status: "modified" });
    expect(updated.status).toBe("modified");
    expect(listTaskFiles(task.id)).toHaveLength(1);
  });
});

describe("findTasksByFile", () => {
  it("returns tasks linked to a path", () => {
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    addTaskFile({ task_id: t1.id, path: "src/foo.ts" });
    addTaskFile({ task_id: t2.id, path: "src/foo.ts" });
    addTaskFile({ task_id: t1.id, path: "src/bar.ts" });
    const results = findTasksByFile("src/foo.ts");
    expect(results).toHaveLength(2);
  });

  it("excludes removed files", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/foo.ts", status: "removed" });
    expect(findTasksByFile("src/foo.ts")).toHaveLength(0);
  });
});

describe("listActiveFiles", () => {
  it("returns files for in-progress tasks only", () => {
    const t1 = createTask({ title: "Active task" });
    const t2 = createTask({ title: "Pending task" });
    updateTask(t1.id, { status: "in_progress", version: getTask(t1.id)!.version });
    addTaskFile({ task_id: t1.id, path: "src/active.ts" });
    addTaskFile({ task_id: t2.id, path: "src/pending.ts" });

    const files = listActiveFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/active.ts");
    expect(files[0]!.task_status).toBe("in_progress");
  });

  it("excludes removed files", () => {
    const task = createTask({ title: "T1" });
    updateTask(task.id, { status: "in_progress", version: getTask(task.id)!.version });
    addTaskFile({ task_id: task.id, path: "src/foo.ts", status: "removed" });
    expect(listActiveFiles()).toHaveLength(0);
  });

  it("includes agent name when agent assigned", () => {
    const agent = registerAgent({ name: "test-agent" });
    const task = createTask({ title: "T1", assigned_to: agent.id });
    updateTask(task.id, { status: "in_progress", version: getTask(task.id)!.version });
    addTaskFile({ task_id: task.id, path: "src/foo.ts" });

    const files = listActiveFiles();
    expect(files[0]!.agent_name).toBe("test-agent");
  });

  it("returns empty when no in-progress tasks have files", () => {
    const task = createTask({ title: "T1" });
    updateTask(task.id, { status: "in_progress", version: getTask(task.id)!.version });
    // No files added
    expect(listActiveFiles()).toHaveLength(0);
  });

  it("includes task metadata", () => {
    const task = createTask({ title: "Work on login" });
    updateTask(task.id, { status: "in_progress", version: getTask(task.id)!.version });
    addTaskFile({ task_id: task.id, path: "src/auth.ts" });

    const files = listActiveFiles();
    expect(files[0]!.task_title).toBe("Work on login");
    expect(files[0]!.task_id).toBe(task.id);
  });
});

describe("removeTaskFile", () => {
  it("removes a file link", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/foo.ts" });
    const removed = removeTaskFile(task.id, "src/foo.ts");
    expect(removed).toBe(true);
    expect(listTaskFiles(task.id)).toHaveLength(0);
  });

  it("returns false for nonexistent file", () => {
    const task = createTask({ title: "T1" });
    expect(removeTaskFile(task.id, "nonexistent.ts")).toBe(false);
  });
});

describe("bulkFindTasksByFiles", () => {
  it("returns results for all paths including empty ones", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/a.ts" });
    const results = bulkFindTasksByFiles(["src/a.ts", "src/b.ts"]);
    expect(results).toHaveLength(2);
    expect(results.find(r => r.path === "src/a.ts")!.tasks).toHaveLength(1);
    expect(results.find(r => r.path === "src/b.ts")!.tasks).toHaveLength(0);
  });

  it("detects conflicts for paths claimed by multiple in-progress tasks", () => {
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    updateTask(t1.id, { status: "in_progress", version: getTask(t1.id)!.version });
    updateTask(t2.id, { status: "in_progress", version: getTask(t2.id)!.version });
    addTaskFile({ task_id: t1.id, path: "src/shared.ts" });
    addTaskFile({ task_id: t2.id, path: "src/shared.ts" });
    const results = bulkFindTasksByFiles(["src/shared.ts"]);
    expect(results[0]!.has_conflict).toBe(true);
    expect(results[0]!.in_progress_count).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(bulkFindTasksByFiles([])).toHaveLength(0);
  });

  it("excludes removed files", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/a.ts", status: "removed" });
    const results = bulkFindTasksByFiles(["src/a.ts"]);
    expect(results[0]!.tasks).toHaveLength(0);
  });
});

describe("detectFileConflicts", () => {
  it("returns conflicts for files claimed by other in-progress tasks", () => {
    const { detectFileConflicts } = require("./task-files.js");
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    updateTask(t1.id, { status: "in_progress", version: getTask(t1.id)!.version });
    updateTask(t2.id, { status: "in_progress", version: getTask(t2.id)!.version });
    addTaskFile({ task_id: t1.id, path: "src/shared.ts" });
    // t2 adding the same file
    const conflicts = detectFileConflicts(t2.id, ["src/shared.ts"]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflicting_task_id).toBe(t1.id);
  });

  it("does not conflict with itself", () => {
    const { detectFileConflicts } = require("./task-files.js");
    const task = createTask({ title: "T1" });
    updateTask(task.id, { status: "in_progress", version: getTask(task.id)!.version });
    addTaskFile({ task_id: task.id, path: "src/foo.ts" });
    const conflicts = detectFileConflicts(task.id, ["src/foo.ts"]);
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag files from completed tasks", () => {
    const { detectFileConflicts } = require("./task-files.js");
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    // t1 is completed, not in_progress
    addTaskFile({ task_id: t1.id, path: "src/foo.ts" });
    updateTask(t2.id, { status: "in_progress", version: getTask(t2.id)!.version });
    const conflicts = detectFileConflicts(t2.id, ["src/foo.ts"]);
    expect(conflicts).toHaveLength(0);
  });
});
