import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { resetConfig, saveConfig } from "../lib/config.js";
import {
  addComment,
  getComment,
  listComments,
  deleteComment,
  logProgress,
  updateComment,
} from "./comments.js";
import { createTask, deleteTask } from "./tasks.js";
import { TaskNotFoundError } from "../types/index.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  resetConfig();
});

describe("addComment", () => {
  it("should add a comment with content only", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment(
      { task_id: task.id, content: "This is a comment" },
      db,
    );
    expect(comment.id).toBeTruthy();
    expect(comment.task_id).toBe(task.id);
    expect(comment.content).toBe("This is a comment");
    expect(comment.agent_id).toBeNull();
    expect(comment.session_id).toBeNull();
    expect(comment.created_at).toBeTruthy();
  });

  it("should add a comment with agent_id and session_id", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment(
      {
        task_id: task.id,
        content: "Agent comment",
        agent_id: "agent-001",
        session_id: "session-xyz",
      },
      db,
    );
    expect(comment.agent_id).toBe("agent-001");
    expect(comment.session_id).toBe("session-xyz");
  });

  it("should throw TaskNotFoundError for non-existent task", () => {
    expect(() =>
      addComment(
        { task_id: "non-existent-task", content: "Should fail" },
        db,
      ),
    ).toThrow(TaskNotFoundError);
  });

  it("should redact configured secrets before storing comments", () => {
    saveConfig({ secret_safety: { redaction_patterns: ["INTERNAL-[0-9]{4}"] } });
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment({ task_id: task.id, content: "token INTERNAL-1234" }, db);

    expect(comment.content).toBe("token [REDACTED]");
    expect(listComments(task.id, db)[0]!.content).not.toContain("INTERNAL-1234");
  });
});

describe("getComment", () => {
  it("should get a comment by ID", () => {
    const task = createTask({ title: "Test Task" }, db);
    const created = addComment(
      { task_id: task.id, content: "Hello" },
      db,
    );
    const fetched = getComment(created.id, db);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.content).toBe("Hello");
  });

  it("should return null for non-existent comment", () => {
    expect(getComment("non-existent-id", db)).toBeNull();
  });
});

describe("listComments", () => {
  it("should list all comments for a task", () => {
    const task = createTask({ title: "Test Task" }, db);
    addComment({ task_id: task.id, content: "Comment 1" }, db);
    addComment({ task_id: task.id, content: "Comment 2" }, db);
    addComment({ task_id: task.id, content: "Comment 3" }, db);

    const comments = listComments(task.id, db);
    expect(comments).toHaveLength(3);
  });

  it("should return empty array for task with no comments", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comments = listComments(task.id, db);
    expect(comments).toHaveLength(0);
  });

  it("should order comments by created_at and preserve insertion order on ties", () => {
    const task = createTask({ title: "Test Task" }, db);
    const c1 = addComment({ task_id: task.id, content: "First" }, db);
    const c2 = addComment({ task_id: task.id, content: "Second" }, db);
    const c3 = addComment({ task_id: task.id, content: "Third" }, db);

    const comments = listComments(task.id, db);
    expect(comments.map((comment) => comment.id)).toEqual([c1.id, c2.id, c3.id]);
  });

  it("should only return comments for the specified task", () => {
    const task1 = createTask({ title: "Task 1" }, db);
    const task2 = createTask({ title: "Task 2" }, db);
    addComment({ task_id: task1.id, content: "Comment on task 1" }, db);
    addComment({ task_id: task2.id, content: "Comment on task 2" }, db);

    const task1Comments = listComments(task1.id, db);
    expect(task1Comments).toHaveLength(1);
    expect(task1Comments[0]!.content).toBe("Comment on task 1");

    const task2Comments = listComments(task2.id, db);
    expect(task2Comments).toHaveLength(1);
    expect(task2Comments[0]!.content).toBe("Comment on task 2");
  });
});

describe("deleteComment", () => {
  it("should delete a comment and return true", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment(
      { task_id: task.id, content: "To delete" },
      db,
    );
    expect(deleteComment(comment.id, db)).toBe(true);
    expect(getComment(comment.id, db)).toBeNull();
  });

  it("should return false for non-existent comment", () => {
    expect(deleteComment("non-existent-id", db)).toBe(false);
  });
});

describe("logProgress", () => {
  it("should create a comment with type=progress", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = logProgress(task.id, "halfway done", undefined, undefined, db);
    expect(comment.type).toBe("progress");
    expect(comment.content).toBe("halfway done");
    expect(comment.progress_pct).toBeNull();
  });

  it("should store progress_pct correctly", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = logProgress(task.id, "almost done", 75, undefined, db);
    expect(comment.type).toBe("progress");
    expect(comment.progress_pct).toBe(75);
  });

  it("should store agent_id when provided", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = logProgress(task.id, "started", 10, "agent-42", db);
    expect(comment.agent_id).toBe("agent-42");
  });

  it("addComment with type=note stores correctly", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment({ task_id: task.id, content: "A note", type: "note" }, db);
    expect(comment.type).toBe("note");
    expect(comment.progress_pct).toBeNull();
  });

  it("addComment defaults type to comment", () => {
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment({ task_id: task.id, content: "regular" }, db);
    expect(comment.type).toBe("comment");
  });

  it("updateComment should redact secrets before storing content", () => {
    saveConfig({ secret_safety: { redaction_patterns: ["PRIVATE-[0-9]+"] } });
    const task = createTask({ title: "Test Task" }, db);
    const comment = addComment({ task_id: task.id, content: "regular" }, db);
    const updated = updateComment(comment.id, { content: "leak PRIVATE-42" }, db);

    expect(updated.content).toBe("leak [REDACTED]");
    expect(getComment(comment.id, db)!.content).not.toContain("PRIVATE-42");
  });
});

describe("cascade delete", () => {
  it("should delete comments when parent task is deleted", () => {
    const task = createTask({ title: "Test Task" }, db);
    const c1 = addComment({ task_id: task.id, content: "Comment 1" }, db);
    const c2 = addComment({ task_id: task.id, content: "Comment 2" }, db);

    // Verify comments exist
    expect(listComments(task.id, db)).toHaveLength(2);

    // Delete the task
    deleteTask(task.id, db);

    // Comments should be cascade-deleted
    expect(getComment(c1.id, db)).toBeNull();
    expect(getComment(c2.id, db)).toBeNull();
  });
});
