import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { getBurndown } from "./burndown.js";
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

describe("getBurndown", () => {
  it("should return empty data when no tasks exist", () => {
    const result = getBurndown({});
    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.days.length).toBeGreaterThanOrEqual(0);
    expect(typeof result.chart).toBe("string");
  });

  it("should count total and completed tasks", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    createTask({ title: "Task 1", project_id: projId, status: "completed" }, db);
    createTask({ title: "Task 2", project_id: projId, status: "completed" }, db);
    createTask({ title: "Task 3", project_id: projId, status: "pending" }, db);
    const result = getBurndown({ project_id: projId });
    expect(result.total).toBe(3);
    expect(result.completed).toBe(2);
    expect(result.remaining).toBe(1);
  });

  it("should filter by project_id", () => {
    const projA = "proj-" + Math.random().toString(36).slice(2, 10);
    const projB = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projA, "A", "/tmp/test-" + projA]);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projB, "B", "/tmp/test-" + projB]);
    createTask({ title: "A1", project_id: projA }, db);
    createTask({ title: "B1", project_id: projB }, db);
    const result = getBurndown({ project_id: projA });
    expect(result.total).toBe(1);
  });

  it("should generate a chart string", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    createTask({ title: "T1", project_id: projId, status: "completed" }, db);
    const result = getBurndown({ project_id: projId });
    expect(result.chart).toContain("actual remaining");
    expect(result.chart).toContain("ideal burndown");
  });
});
