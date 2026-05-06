import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { linkTaskToCommit, getTaskCommits, findTaskByCommit, unlinkTaskCommit } from "./task-commits.js";
import type { Database } from "bun:sqlite";

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

function setupTask(title = "Test") {
  const projId = "proj-" + Math.random().toString(36).slice(2, 10);
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
  return createTask({ title, project_id: projId }, db);
}

describe("linkTaskToCommit", () => {
  it("should link a commit to a task", () => {
    const task = setupTask();
    const commit = linkTaskToCommit({ task_id: task.id, sha: "abc123def" });
    expect(commit.id).toBeTruthy();
    expect(commit.task_id).toBe(task.id);
    expect(commit.sha).toBe("abc123def");
    expect(commit.message).toBeNull();
  });

  it("should link a commit with full metadata", () => {
    const task = setupTask();
    const commit = linkTaskToCommit({
      task_id: task.id,
      sha: "def456abc",
      message: "Fix login bug",
      author: "Alice",
      files_changed: ["src/auth.ts", "src/login.ts"],
      committed_at: "2024-01-15T10:00:00Z",
    });
    expect(commit.message).toBe("Fix login bug");
    expect(commit.author).toBe("Alice");
    expect(commit.files_changed).toEqual(["src/auth.ts", "src/login.ts"]);
    expect(commit.committed_at).toBe("2024-01-15T10:00:00Z");
  });

  it("should upsert on same task+sha (update fields)", () => {
    const task = setupTask();
    linkTaskToCommit({ task_id: task.id, sha: "sha123", message: "Initial" });
    const updated = linkTaskToCommit({ task_id: task.id, sha: "sha123", message: "Updated message", author: "Bob" });
    expect(updated.message).toBe("Updated message");
    expect(updated.author).toBe("Bob");
  });
});

describe("getTaskCommits", () => {
  it("should return empty array for no commits", () => {
    expect(getTaskCommits("nonexistent")).toEqual([]);
  });

  it("should return commits for a task", () => {
    const task = setupTask();
    linkTaskToCommit({ task_id: task.id, sha: "aaa", message: "First" });
    linkTaskToCommit({ task_id: task.id, sha: "bbb", message: "Second" });
    const commits = getTaskCommits(task.id);
    expect(commits).toHaveLength(2);
  });

  it("should only return commits for the specified task", () => {
    const task1 = setupTask("Task 1");
    const task2 = setupTask("Task 2");
    linkTaskToCommit({ task_id: task1.id, sha: "aaa" });
    linkTaskToCommit({ task_id: task2.id, sha: "bbb" });
    const commits = getTaskCommits(task1.id);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("aaa");
  });
});

describe("findTaskByCommit", () => {
  it("should return null for unknown SHA", () => {
    expect(findTaskByCommit("unknown")).toBeNull();
  });

  it("should find a task by exact SHA", () => {
    const task = setupTask();
    linkTaskToCommit({ task_id: task.id, sha: "abcdef1234567890" });
    const result = findTaskByCommit("abcdef1234567890");
    expect(result).not.toBeNull();
    expect(result!.task_id).toBe(task.id);
  });

  it("should find by SHA prefix (7+ chars)", () => {
    const task = setupTask();
    linkTaskToCommit({ task_id: task.id, sha: "abcdef1234567890" });
    const result = findTaskByCommit("abcdef12");
    expect(result).not.toBeNull();
    expect(result!.task_id).toBe(task.id);
  });
});

describe("unlinkTaskCommit", () => {
  it("should return false for non-existent link", () => {
    expect(unlinkTaskCommit("fake-task", "fake-sha")).toBe(false);
  });

  it("should unlink a commit by full SHA", () => {
    const task = setupTask();
    linkTaskToCommit({ task_id: task.id, sha: "abc123" });
    expect(unlinkTaskCommit(task.id, "abc123")).toBe(true);
    expect(getTaskCommits(task.id)).toEqual([]);
  });

  it("should unlink by SHA prefix", () => {
    const task = setupTask();
    linkTaskToCommit({ task_id: task.id, sha: "abcdef1234567890" });
    expect(unlinkTaskCommit(task.id, "abcdef12")).toBe(true);
  });
});
