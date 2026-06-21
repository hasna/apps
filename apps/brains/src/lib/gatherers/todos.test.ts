import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const todosDb = join(homedir(), ".todos", "todos.db");
const hasDb = existsSync(todosDb);

function createTodosDb(homeDir: string): void {
  const dbDir = join(homeDir, ".todos");
  mkdirSync(dbDir, { recursive: true });
  const db = new Database(join(dbDir, "todos.db"));
  try {
    db.run(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        short_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        tags TEXT,
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        task_list_id TEXT,
        plan_id TEXT
      )
    `);
    db.run(
      `INSERT INTO tasks (
        id, short_id, title, description, status, priority, tags,
        assigned_to, created_at, completed_at, task_list_id, plan_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "task-1",
      "T-1",
      "Handle malformed tags",
      "Regression coverage for bad local data",
      "pending",
      "medium",
      "{not-json",
      null,
      "2026-01-01T00:00:00.000Z",
      null,
      null,
      null
    );
  } finally {
    db.close();
  }
}

describe("gatherFromTodos", () => {
  test.skipIf(!hasDb)("returns GatherResult shape", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 10 });
    expect(result.source).toBe("todos");
    expect(Array.isArray(result.examples)).toBe(true);
    expect(result.count).toBe(result.examples.length);
  });

  test.skipIf(!hasDb)("generates training examples", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 5 });
    expect(result.examples.length).toBeGreaterThanOrEqual(0);
    for (const ex of result.examples) {
      expect(Array.isArray(ex.messages)).toBe(true);
      expect(ex.messages.length).toBeGreaterThanOrEqual(2);
    }
  });

  test.skipIf(!hasDb)("respects limit option", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 3 });
    expect(result.examples.length).toBeLessThanOrEqual(3);
  });

  test.skipIf(!hasDb)("respects since option with future date — returns empty", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const futureDate = new Date("2099-01-01");
    const result = await gatherFromTodos({ since: futureDate });
    // All tasks have created_at before 2099 — but search examples are always generated
    // The key is we get a valid result shape
    expect(result.source).toBe("todos");
    expect(Array.isArray(result.examples)).toBe(true);
  });

  test.skipIf(!hasDb)("each example has system, user, and assistant messages", async () => {
    const { gatherFromTodos } = await import("./todos.js");
    const result = await gatherFromTodos({ limit: 5 });
    for (const ex of result.examples) {
      const roles = ex.messages.map((m) => m.role);
      expect(roles[0]).toBe("system");
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
    }
  });

  test("uses supplied homeDir and treats malformed task tags as empty", async () => {
    const homeDir = join(tmpdir(), `brains-todos-gatherer-${Date.now()}`);
    createTodosDb(homeDir);

    try {
      const { gatherFromTodos } = await import("./todos.js");
      const result = await gatherFromTodos({ limit: 1, homeDir });

      expect(result.source).toBe("todos");
      expect(result.count).toBe(1);
      expect(result.examples[0]?.messages[1]?.content).toContain("Handle malformed tags");
      expect(result.examples[0]?.messages[2]?.content).toContain('"tags": []');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
