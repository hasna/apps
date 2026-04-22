import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { addTaskFile, listTaskFiles, findTasksByFile, listActiveFiles, removeTaskFile, bulkFindTasksByFiles, getTaskFile, updateTaskFileStatus, getFileHeatMap, bulkAddTaskFiles, detectFileConflicts } from "./task-files.js";
import { createTask, updateTask, getTask } from "./tasks.js";
import { createProject } from "./projects.js";
import { registerAgent } from "./agents.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
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
    const task = createTask({ title: "T1" });
    updateTask(task.id, { status: "in_progress", version: getTask(task.id)!.version });
    addTaskFile({ task_id: task.id, path: "src/foo.ts" });
    const conflicts = detectFileConflicts(task.id, ["src/foo.ts"]);
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag files from completed tasks", () => {
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    // t1 is completed, not in_progress
    addTaskFile({ task_id: t1.id, path: "src/foo.ts" });
    updateTask(t2.id, { status: "in_progress", version: getTask(t2.id)!.version });
    const conflicts = detectFileConflicts(t2.id, ["src/foo.ts"]);
    expect(conflicts).toHaveLength(0);
  });
});

describe("getTaskFile", () => {
  it("returns task file by id", () => {
    const task = createTask({ title: "T1" });
    const file = addTaskFile({ task_id: task.id, path: "src/foo.ts" });
    const found = getTaskFile(file.id);
    expect(found).not.toBeNull();
    expect(found!.path).toBe("src/foo.ts");
  });

  it("returns null for nonexistent id", () => {
    expect(getTaskFile("nonexistent")).toBeNull();
  });

  it("uses provided database", () => {
    const d = getDatabase();
    const task = createTask({ title: "T1" }, d);
    const file = addTaskFile({ task_id: task.id, path: "src/bar.ts" }, d);
    const found = getTaskFile(file.id, d);
    expect(found).not.toBeNull();
  });
});

describe("listTaskFiles", () => {
  it("returns all files for a task ordered by path", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/z.ts" });
    addTaskFile({ task_id: task.id, path: "src/a.ts" });
    addTaskFile({ task_id: task.id, path: "src/m.ts" });
    const files = listTaskFiles(task.id);
    expect(files).toHaveLength(3);
    expect(files[0]!.path).toBe("src/a.ts");
    expect(files[1]!.path).toBe("src/m.ts");
    expect(files[2]!.path).toBe("src/z.ts");
  });

  it("returns empty array for task with no files", () => {
    const task = createTask({ title: "No files" });
    expect(listTaskFiles(task.id)).toEqual([]);
  });

  it("uses provided database", () => {
    const db = getDatabase();
    const task = createTask({ title: "T1" }, db);
    addTaskFile({ task_id: task.id, path: "src/x.ts" }, db);
    expect(listTaskFiles(task.id, db)).toHaveLength(1);
  });
});

describe("updateTaskFileStatus", () => {
  it("updates status for task+path", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/foo.ts", status: "active" });
    const updated = updateTaskFileStatus(task.id, "src/foo.ts", "reviewed");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("reviewed");
  });

  it("updates agent_id when provided", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/foo.ts" });
    const updated = updateTaskFileStatus(task.id, "src/foo.ts", "modified", "agent-123");
    expect(updated!.agent_id).toBe("agent-123");
  });

  it("preserves existing agent_id when not provided", () => {
    const task = createTask({ title: "T1" });
    addTaskFile({ task_id: task.id, path: "src/foo.ts", agent_id: "existing-agent" });
    const updated = updateTaskFileStatus(task.id, "src/foo.ts", "reviewed");
    expect(updated!.agent_id).toBe("existing-agent");
  });

  it("returns null for nonexistent task+path", () => {
    const task = createTask({ title: "T1" });
    expect(updateTaskFileStatus(task.id, "nonexistent.ts", "active")).toBeNull();
  });

  it("uses provided database", () => {
    const db = getDatabase();
    const task = createTask({ title: "T1" }, db);
    addTaskFile({ task_id: task.id, path: "src/bar.ts" }, db);
    const updated = updateTaskFileStatus(task.id, "src/bar.ts", "planned", undefined, db);
    expect(updated!.status).toBe("planned");
  });
});

describe("getFileHeatMap", () => {
  it("returns file edit aggregation", () => {
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    addTaskFile({ task_id: t1.id, path: "src/hot.ts", status: "active" });
    addTaskFile({ task_id: t2.id, path: "src/hot.ts", status: "modified" });
    addTaskFile({ task_id: t1.id, path: "src/cold.ts", status: "active" });
    const heatMap = getFileHeatMap();
    const hot = heatMap.find(h => h.path === "src/hot.ts")!;
    expect(hot).toBeDefined();
    expect(hot.edit_count).toBe(2);
  });

  it("respects limit parameter", () => {
    const task = createTask({ title: "T1" });
    for (let i = 0; i < 5; i++) {
      addTaskFile({ task_id: task.id, path: `src/file-${i}.ts` });
    }
    const heatMap = getFileHeatMap({ limit: 2 });
    expect(heatMap).toHaveLength(2);
  });

  it("respects min_edits filter", () => {
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    addTaskFile({ task_id: t1.id, path: "src/once.ts" });
    addTaskFile({ task_id: t1.id, path: "src/twice.ts" });
    addTaskFile({ task_id: t2.id, path: "src/twice.ts", status: "modified" });
    const heatMap = getFileHeatMap({ min_edits: 2 });
    expect(heatMap).toHaveLength(1);
    expect(heatMap[0].path).toBe("src/twice.ts");
  });

  it("filters by project_id", () => {
    const d = getDatabase();
    const project = createProject({ name: "Test Project", path: "/tmp/test-proj" }, d);
    const t1 = createTask({ title: "Proj task", project_id: project.id }, d);
    const t2 = createTask({ title: "Other task" }, d);
    addTaskFile({ task_id: t1.id, path: "src/shared.ts" }, d);
    addTaskFile({ task_id: t2.id, path: "src/shared.ts" }, d);
    const heatMap = getFileHeatMap({ project_id: project.id }, d);
    expect(heatMap).toHaveLength(1);
    expect(heatMap[0].path).toBe("src/shared.ts");
    expect(heatMap[0].edit_count).toBe(1);
  });

  it("counts unique agents correctly", () => {
    const agent1 = registerAgent({ name: "agent-a" });
    const agent2 = registerAgent({ name: "agent-b" });
    const t1 = createTask({ title: "T1" });
    const t2 = createTask({ title: "T2" });
    addTaskFile({ task_id: t1.id, path: "src/multi.ts", agent_id: agent1.id });
    addTaskFile({ task_id: t2.id, path: "src/multi.ts", agent_id: agent2.id });
    const heatMap = getFileHeatMap();
    const entry = heatMap.find(h => h.path === "src/multi.ts")!;
    expect(entry.unique_agents).toBe(2);
    expect(entry.agent_ids).toHaveLength(2);
  });

  it("includes active task count", () => {
    const t1 = createTask({ title: "Active", status: "in_progress" });
    const t2 = createTask({ title: "Pending" });
    addTaskFile({ task_id: t1.id, path: "src/active.ts" });
    addTaskFile({ task_id: t2.id, path: "src/active.ts" });
    const heatMap = getFileHeatMap();
    const entry = heatMap.find(h => h.path === "src/active.ts")!;
    expect(entry.active_task_count).toBe(1);
  });

  it("uses default limit of 20", () => {
    const heatMap = getFileHeatMap();
    expect(Array.isArray(heatMap)).toBe(true);
  });

  it("uses provided database", () => {
    const db = getDatabase();
    const task = createTask({ title: "T1" }, db);
    addTaskFile({ task_id: task.id, path: "src/db.ts" }, db);
    const heatMap = getFileHeatMap(undefined, db);
    expect(Array.isArray(heatMap)).toBe(true);
  });
});

describe("bulkAddTaskFiles", () => {
  it("adds multiple files in a transaction", () => {
    const task = createTask({ title: "T1" });
    const results = bulkAddTaskFiles(task.id, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(results).toHaveLength(3);
    expect(results.map(r => r.path)).toContain("src/a.ts");
    expect(results.map(r => r.path)).toContain("src/b.ts");
    expect(results.map(r => r.path)).toContain("src/c.ts");
    expect(results[0].status).toBe("active");
  });

  it("sets agent_id on all files", () => {
    const agent = registerAgent({ name: "bulk-agent" });
    const task = createTask({ title: "T1" });
    const results = bulkAddTaskFiles(task.id, ["src/x.ts", "src/y.ts"], agent.id);
    expect(results.every(r => r.agent_id === agent.id)).toBe(true);
  });

  it("returns empty array for empty paths", () => {
    const task = createTask({ title: "T1" });
    expect(bulkAddTaskFiles(task.id, [])).toEqual([]);
  });

  it("uses provided database", () => {
    const db = getDatabase();
    const task = createTask({ title: "T1" }, db);
    const results = bulkAddTaskFiles(task.id, ["src/z.ts"], undefined, db);
    expect(results).toHaveLength(1);
  });
});
