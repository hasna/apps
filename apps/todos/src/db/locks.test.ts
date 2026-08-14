import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { acquireLock, releaseLock, checkLock, cleanExpiredLocks } from "./locks.js";
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

describe("acquireLock", () => {
  it("should acquire a new advisory lock", () => {
    const result = acquireLock("task", "task-1", "agent-1");
    expect(result).toBe(true);
  });

  it("should acquire a new exclusive lock", () => {
    const result = acquireLock("file", "file.txt", "agent-1", "exclusive");
    expect(result).toBe(true);
  });

  it("should allow same agent to re-acquire (extend)", () => {
    acquireLock("task", "task-1", "agent-1");
    const result = acquireLock("task", "task-1", "agent-1");
    expect(result).toBe(true);
  });

  it("should deny a different agent for same resource", () => {
    acquireLock("task", "task-1", "agent-1");
    const result = acquireLock("task", "task-1", "agent-2");
    expect(result).toBe(false);
  });

  it("should allow different lock types on same resource", () => {
    acquireLock("file", "f.txt", "agent-1", "advisory");
    const result = acquireLock("file", "f.txt", "agent-1", "exclusive");
    expect(result).toBe(true);
  });

  it("should allow same agent on different resources", () => {
    acquireLock("task", "task-1", "agent-1");
    const result = acquireLock("task", "task-2", "agent-1");
    expect(result).toBe(true);
  });
});

describe("releaseLock", () => {
  it("should release an owned lock", () => {
    acquireLock("task", "task-1", "agent-1");
    const result = releaseLock("task", "task-1", "agent-1");
    expect(result).toBe(true);
  });

  it("should return false for non-existent lock", () => {
    const result = releaseLock("task", "nonexistent", "agent-1");
    expect(result).toBe(false);
  });

  it("should return false when releasing another agent's lock", () => {
    acquireLock("task", "task-1", "agent-1");
    const result = releaseLock("task", "task-1", "agent-2");
    expect(result).toBe(false);
  });

  it("should allow re-acquire after release", () => {
    acquireLock("task", "task-1", "agent-1");
    releaseLock("task", "task-1", "agent-1");
    const result = acquireLock("task", "task-1", "agent-2");
    expect(result).toBe(true);
  });
});

describe("checkLock", () => {
  it("should return null for unlocked resource", () => {
    expect(checkLock("task", "nonexistent")).toBeNull();
  });

  it("should return lock info for locked resource", () => {
    acquireLock("task", "task-1", "agent-1");
    const lock = checkLock("task", "task-1");
    expect(lock).not.toBeNull();
    expect(lock!.agent_id).toBe("agent-1");
    expect(lock!.resource_type).toBe("task");
    expect(lock!.resource_id).toBe("task-1");
  });

  it("should clean expired locks when checking", () => {
    // Insert an expired lock manually
    const past = new Date(Date.now() - 60000).toISOString();
    db.run(
      "INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["task", "expired-task", "agent-old", "advisory", past, past],
    );
    const lock = checkLock("task", "expired-task");
    expect(lock).toBeNull();
  });
});

describe("cleanExpiredLocks", () => {
  it("should remove expired locks", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    db.run(
      "INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["task", "task-old", "agent-old", "advisory", past, past],
    );
    const count = cleanExpiredLocks();
    expect(count).toBeGreaterThan(0);
  });

  it("should keep non-expired locks", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    db.run(
      "INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["task", "task-fresh", "agent-1", "advisory", future, future],
    );
    cleanExpiredLocks();
    const lock = checkLock("task", "task-fresh");
    expect(lock).not.toBeNull();
  });
});
