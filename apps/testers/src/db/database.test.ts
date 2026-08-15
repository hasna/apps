process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId, uuid } from "./database.js";

describe("database", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("getDatabase", () => {
    test("returns a Database instance", () => {
      const db = getDatabase();
      expect(db).toBeDefined();
      expect(typeof db.query).toBe("function");
    });

    test("returns the same instance on subsequent calls", () => {
      const db1 = getDatabase();
      const db2 = getDatabase();
      expect(db1).toBe(db2);
    });

    test("creates all expected tables", () => {
      const db = getDatabase();
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("projects");
      expect(tableNames).toContain("agents");
      expect(tableNames).toContain("scenarios");
      expect(tableNames).toContain("runs");
      expect(tableNames).toContain("results");
      expect(tableNames).toContain("screenshots");
      expect(tableNames).toContain("_migrations");
    });
  });

  describe("closeDatabase", () => {
    test("closes the database and allows reopening", () => {
      const db1 = getDatabase();
      closeDatabase();
      const db2 = getDatabase();
      // After close + reopen, should be a new instance
      expect(db2).not.toBe(db1);
    });

    test("can be called multiple times without error", () => {
      closeDatabase();
      closeDatabase();
      closeDatabase();
      // No error thrown
    });
  });

  describe("resetDatabase", () => {
    test("clears all data from tables", () => {
      const db = getDatabase();
      // Insert a project
      db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run("test-id", "test-project");

      const before = db.query("SELECT COUNT(*) as count FROM projects").get() as { count: number };
      expect(before.count).toBe(1);

      resetDatabase();

      const dbAfter = getDatabase();
      const after = dbAfter.query("SELECT COUNT(*) as count FROM projects").get() as { count: number };
      expect(after.count).toBe(0);
    });

    test("preserves table structure after reset", () => {
      resetDatabase();
      const db = getDatabase();
      // Should still be able to insert after reset
      db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run("new-id", "new-project");
      const row = db.query("SELECT * FROM projects WHERE id = ?").get("new-id") as { id: string; name: string };
      expect(row.name).toBe("new-project");
    });
  });

  describe("resolvePartialId", () => {
    test("resolves a partial ID to a full ID when unique match exists", () => {
      const db = getDatabase();
      const fullId = uuid();
      db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(fullId, "test-project");

      const partialId = fullId.slice(0, 8);
      const resolved = resolvePartialId("projects", partialId);
      expect(resolved).toBe(fullId);
    });

    test("returns null when no match exists", () => {
      const resolved = resolvePartialId("projects", "nonexistent");
      expect(resolved).toBeNull();
    });

    test("returns null when multiple matches exist", () => {
      const db = getDatabase();
      // Insert two projects with IDs sharing the same prefix
      db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run("abc-111-aaa", "project1");
      db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run("abc-222-bbb", "project2");

      const resolved = resolvePartialId("projects", "abc");
      expect(resolved).toBeNull();
    });

    test("returns full ID when given the complete ID", () => {
      const db = getDatabase();
      const fullId = uuid();
      db.query("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(fullId, "test-project");

      const resolved = resolvePartialId("projects", fullId);
      expect(resolved).toBe(fullId);
    });
  });
});
