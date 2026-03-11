import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask, startTask, completeTask, getTask, addDependency, getBlockingDeps } from "./tasks.js";
import { registerAgent, listAgents } from "./agents.js";
import { findBestAgent } from "../lib/auto-assign.js";

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

describe("getBlockingDeps", () => {
  it("should return empty when no dependencies", () => {
    const task = createTask({ title: "No deps" }, db);
    expect(getBlockingDeps(task.id, db)).toEqual([]);
  });

  it("should return incomplete dependencies", () => {
    const dep = createTask({ title: "Dependency" }, db);
    const task = createTask({ title: "Blocked task" }, db);
    addDependency(task.id, dep.id, db);
    const blocking = getBlockingDeps(task.id, db);
    expect(blocking.length).toBe(1);
    expect(blocking[0]!.id).toBe(dep.id);
  });

  it("should not return completed dependencies", () => {
    const dep = createTask({ title: "Completed dep", status: "in_progress" }, db);
    completeTask(dep.id, undefined, db);
    const task = createTask({ title: "Unblocked" }, db);
    addDependency(task.id, dep.id, db);
    expect(getBlockingDeps(task.id, db)).toEqual([]);
  });

  it("should return multiple blocking deps", () => {
    const dep1 = createTask({ title: "Dep 1" }, db);
    const dep2 = createTask({ title: "Dep 2" }, db);
    const task = createTask({ title: "Blocked" }, db);
    addDependency(task.id, dep1.id, db);
    addDependency(task.id, dep2.id, db);
    expect(getBlockingDeps(task.id, db).length).toBe(2);
  });

  it("should return only incomplete deps in a mixed set", () => {
    const completedDep = createTask({ title: "Done dep", status: "in_progress" }, db);
    completeTask(completedDep.id, undefined, db);
    const pendingDep = createTask({ title: "Pending dep" }, db);
    const task = createTask({ title: "Mixed deps" }, db);
    addDependency(task.id, completedDep.id, db);
    addDependency(task.id, pendingDep.id, db);
    const blocking = getBlockingDeps(task.id, db);
    expect(blocking.length).toBe(1);
    expect(blocking[0]!.id).toBe(pendingDep.id);
  });
});

describe("startTask with blocking deps", () => {
  it("should throw when task has unmet dependencies", () => {
    const dep = createTask({ title: "Dep" }, db);
    const task = createTask({ title: "Blocked" }, db);
    addDependency(task.id, dep.id, db);
    expect(() => startTask(task.id, "agent1", db)).toThrow(/blocked by/i);
  });

  it("should allow start when all dependencies completed", () => {
    const dep = createTask({ title: "Dep", status: "in_progress" }, db);
    completeTask(dep.id, undefined, db);
    const task = createTask({ title: "Ready" }, db);
    addDependency(task.id, dep.id, db);
    const started = startTask(task.id, "agent1", db);
    expect(started.status).toBe("in_progress");
  });

  it("should throw with multiple blocking deps", () => {
    const dep1 = createTask({ title: "Dep 1" }, db);
    const dep2 = createTask({ title: "Dep 2" }, db);
    const task = createTask({ title: "Blocked" }, db);
    addDependency(task.id, dep1.id, db);
    addDependency(task.id, dep2.id, db);
    expect(() => startTask(task.id, "agent1", db)).toThrow(/blocked by 2/i);
  });

  it("should allow start with no dependencies at all", () => {
    const task = createTask({ title: "Free" }, db);
    const started = startTask(task.id, "agent1", db);
    expect(started.status).toBe("in_progress");
  });
});

describe("completeTask with evidence", () => {
  it("should store evidence in metadata", () => {
    const task = createTask({ title: "Evidence test", status: "in_progress" }, db);
    const completed = completeTask(task.id, "agent1", db, {
      files_changed: ["src/fix.ts", "src/fix.test.ts"],
      test_results: "15 pass, 0 fail",
      commit_hash: "abc123",
      notes: "Fixed the login bug",
    });
    expect(completed.status).toBe("completed");
    expect(completed.metadata._evidence).toBeDefined();
    const ev = completed.metadata._evidence as Record<string, unknown>;
    expect(ev.files_changed).toEqual(["src/fix.ts", "src/fix.test.ts"]);
    expect(ev.test_results).toBe("15 pass, 0 fail");
    expect(ev.commit_hash).toBe("abc123");
  });

  it("should complete without evidence", () => {
    const task = createTask({ title: "No evidence", status: "in_progress" }, db);
    const completed = completeTask(task.id, undefined, db);
    expect(completed.status).toBe("completed");
    expect(completed.metadata._evidence).toBeUndefined();
  });

  it("should preserve existing metadata when adding evidence", () => {
    const task = createTask({ title: "Meta test", status: "in_progress", metadata: { key: "value" } }, db);
    const completed = completeTask(task.id, "a1", db, { notes: "Done" });
    expect(completed.metadata.key).toBe("value");
    expect((completed.metadata._evidence as Record<string, unknown>).notes).toBe("Done");
  });

  it("should store evidence with only notes", () => {
    const task = createTask({ title: "Notes only", status: "in_progress" }, db);
    const completed = completeTask(task.id, "a1", db, { notes: "Quick fix" });
    expect(completed.metadata._evidence).toBeDefined();
    expect((completed.metadata._evidence as Record<string, unknown>).notes).toBe("Quick fix");
  });

  it("should store evidence with only files_changed", () => {
    const task = createTask({ title: "Files only", status: "in_progress" }, db);
    const completed = completeTask(task.id, "a1", db, { files_changed: ["a.ts"] });
    const ev = completed.metadata._evidence as Record<string, unknown>;
    expect(ev.files_changed).toEqual(["a.ts"]);
  });
});

describe("findBestAgent (auto-assignment)", () => {
  it("should return null when no agents exist", () => {
    const task = createTask({ title: "Test" }, db);
    expect(findBestAgent(task, db)).toBeNull();
  });

  it("should return the only agent", () => {
    registerAgent({ name: "solo-agent" }, db);
    const task = createTask({ title: "Test" }, db);
    expect(findBestAgent(task, db)).toBe("solo-agent");
  });

  it("should prefer agent with fewer in-progress tasks", () => {
    registerAgent({ name: "busy-agent" }, db);
    registerAgent({ name: "idle-agent" }, db);
    // Give busy-agent 3 in-progress tasks
    for (let i = 0; i < 3; i++) {
      const t = createTask({ title: `Busy ${i}`, assigned_to: "busy-agent" }, db);
      startTask(t.id, "busy-agent", db);
    }
    const task = createTask({ title: "New task" }, db);
    expect(findBestAgent(task, db)).toBe("idle-agent");
  });

  it("should skip admin agents", () => {
    registerAgent({ name: "admin-agent", role: "admin" }, db);
    registerAgent({ name: "worker" }, db);
    const task = createTask({ title: "Test" }, db);
    expect(findBestAgent(task, db)).toBe("worker");
  });

  it("should skip observer agents", () => {
    registerAgent({ name: "watcher", role: "observer" }, db);
    registerAgent({ name: "doer" }, db);
    const task = createTask({ title: "Test" }, db);
    expect(findBestAgent(task, db)).toBe("doer");
  });

  it("should return null when only admin and observer agents exist", () => {
    registerAgent({ name: "admin-only", role: "admin" }, db);
    registerAgent({ name: "observer-only", role: "observer" }, db);
    const task = createTask({ title: "Test" }, db);
    expect(findBestAgent(task, db)).toBeNull();
  });

  it("should pick agent with equal load", () => {
    registerAgent({ name: "agent-a" }, db);
    registerAgent({ name: "agent-b" }, db);
    const task = createTask({ title: "Test" }, db);
    const result = findBestAgent(task, db);
    // Either agent is valid since both have 0 load
    expect(["agent-a", "agent-b"]).toContain(result);
  });
});

describe("task approval workflow", () => {
  it("should create task with requires_approval", () => {
    const task = createTask({ title: "Needs approval", requires_approval: true }, db);
    expect(task.requires_approval).toBe(true);
    expect(task.approved_by).toBeNull();
  });

  it("should default requires_approval to false", () => {
    const task = createTask({ title: "Normal" }, db);
    expect(task.requires_approval).toBe(false);
  });

  it("should store estimated_minutes", () => {
    const task = createTask({ title: "Estimated", estimated_minutes: 30 }, db);
    expect(task.estimated_minutes).toBe(30);
  });

  it("should default estimated_minutes to null", () => {
    const task = createTask({ title: "No estimate" }, db);
    expect(task.estimated_minutes).toBeNull();
  });

  it("should store approved_by via updateTask", () => {
    const task = createTask({ title: "Approve me", requires_approval: true }, db);
    const { updateTask } = require("./tasks.js");
    const updated = updateTask(task.id, { approved_by: "admin-agent", version: task.version }, db);
    expect(updated.approved_by).toBe("admin-agent");
    expect(updated.approved_at).toBeTruthy();
  });
});
