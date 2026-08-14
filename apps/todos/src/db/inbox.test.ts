import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createInboxItem, detectInboxSourceType, getInboxItem, listInboxItems } from "./inbox.js";
import { getTask } from "./tasks.js";

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

function setupProject() {
  const id = "proj-" + Math.random().toString(36).slice(2, 10);
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [id, "test", "/tmp/test-" + id]);
  return id;
}

describe("local inbox intake", () => {
  it("creates a redacted inbox item and linked task from pasted failure output", () => {
    const projectId = setupProject();
    const result = createInboxItem({
      body: "TypeError: Cannot read properties\nOPENAI_API_KEY=sk-testsecret123456789",
      project_id: projectId,
      metadata: { token: "secret-value" },
    }, db);

    expect(result.duplicate).toBe(false);
    expect(result.item.source_type).toBe("pasted_error");
    expect(result.item.body).not.toContain("sk-testsecret");
    expect(result.item.metadata.token).toBe("[REDACTED]");
    expect(result.task).not.toBeNull();
    expect(result.task!.tags).toContain("inbox");
    expect(result.task!.tags).toContain("pasted_error");
    expect(getTask(result.task!.id, db)!.description).not.toContain("sk-testsecret");
  });

  it("dedupes repeated CI log input by fingerprint", () => {
    const first = createInboxItem({ body: "bun test failed\nExpected 1 got 2", source_type: "ci_log" }, db);
    const second = createInboxItem({ body: "bun test failed\nExpected 1 got 2", source_type: "ci_log" }, db);

    expect(second.duplicate).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(listInboxItems({ source_type: "ci_log" }, db)).toHaveLength(1);
  });

  it("detects GitHub issue URLs and stores source metadata", () => {
    const result = createInboxItem({
      body: "https://github.com/hasna/todos/issues/42",
      source_url: "https://github.com/hasna/todos/issues/42",
    }, db);

    expect(result.item.source_type).toBe("github_issue");
    expect(result.item.title).toBe("GitHub issue hasna/todos#42");
    expect(result.item.metadata.github).toEqual({ owner: "hasna", repo: "todos", number: 42 });
    expect(getInboxItem(result.item.id.slice(0, 8), db)!.id).toBe(result.item.id);
  });

  it("detects source types from local text", () => {
    expect(detectInboxSourceType("M src/db/inbox.ts")).toBe("git_context");
    expect(detectInboxSourceType("GitHub Actions failed with exit code 1")).toBe("ci_log");
    expect(detectInboxSourceType("Traceback: ValueError")).toBe("pasted_error");
  });
});
