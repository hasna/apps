import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { lockFile, unlockFile, checkFileLock, listFileLocks, forceUnlockFile, cleanExpiredFileLocks } from "./file-locks.js";
import { LockError } from "../types/index.js";
import { createTask } from "./tasks.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
});

describe("lockFile", () => {
  it("acquires a lock on a file path", () => {
    const lock = lockFile({ path: "src/foo.ts", agent_id: "agent-1" });
    expect(lock.path).toBe("src/foo.ts");
    expect(lock.agent_id).toBe("agent-1");
    expect(lock.expires_at).toBeTruthy();
  });

  it("throws LockError when another agent holds the lock", () => {
    lockFile({ path: "src/foo.ts", agent_id: "agent-1" });
    expect(() => lockFile({ path: "src/foo.ts", agent_id: "agent-2" })).toThrow(LockError);
  });

  it("same agent re-locking refreshes TTL", () => {
    const first = lockFile({ path: "src/foo.ts", agent_id: "agent-1", ttl_seconds: 10 });
    const refreshed = lockFile({ path: "src/foo.ts", agent_id: "agent-1", ttl_seconds: 3600 });
    expect(refreshed.id).toBe(first.id);
    expect(new Date(refreshed.expires_at) > new Date(first.expires_at)).toBe(true);
  });

  it("allows re-lock after expiry", () => {
    // Lock with past expiry by directly inserting expired lock
    const db = getDatabase();
    db.run(
      "INSERT INTO file_locks (id, path, agent_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      ["expired-id", "src/foo.ts", "agent-1", new Date(Date.now() - 1000).toISOString(), new Date().toISOString()],
    );
    // agent-2 can now lock since agent-1's lock is expired
    const lock = lockFile({ path: "src/foo.ts", agent_id: "agent-2" });
    expect(lock.agent_id).toBe("agent-2");
  });

  it("stores associated task_id", () => {
    const task = createTask({ title: "My task" });
    const lock = lockFile({ path: "src/foo.ts", agent_id: "agent-1", task_id: task.id });
    expect(lock.task_id).toBe(task.id);
  });
});

describe("unlockFile", () => {
  it("releases a lock held by the agent", () => {
    lockFile({ path: "src/foo.ts", agent_id: "agent-1" });
    const released = unlockFile("src/foo.ts", "agent-1");
    expect(released).toBe(true);
    expect(checkFileLock("src/foo.ts")).toBeNull();
  });

  it("returns false when agent does not hold the lock", () => {
    lockFile({ path: "src/foo.ts", agent_id: "agent-1" });
    const released = unlockFile("src/foo.ts", "agent-2");
    expect(released).toBe(false);
    expect(checkFileLock("src/foo.ts")).not.toBeNull();
  });

  it("returns false for unlocked path", () => {
    expect(unlockFile("src/nonexistent.ts", "agent-1")).toBe(false);
  });
});

describe("checkFileLock", () => {
  it("returns lock info when locked", () => {
    lockFile({ path: "src/foo.ts", agent_id: "agent-1" });
    const lock = checkFileLock("src/foo.ts");
    expect(lock).not.toBeNull();
    expect(lock!.agent_id).toBe("agent-1");
  });

  it("returns null for unlocked path", () => {
    expect(checkFileLock("src/foo.ts")).toBeNull();
  });

  it("returns null for expired lock", () => {
    const db = getDatabase();
    db.run(
      "INSERT INTO file_locks (id, path, agent_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      ["exp-id", "src/foo.ts", "agent-1", new Date(Date.now() - 1000).toISOString(), new Date().toISOString()],
    );
    expect(checkFileLock("src/foo.ts")).toBeNull();
  });
});

describe("listFileLocks", () => {
  it("returns all active locks", () => {
    lockFile({ path: "src/a.ts", agent_id: "agent-1" });
    lockFile({ path: "src/b.ts", agent_id: "agent-2" });
    const locks = listFileLocks();
    expect(locks).toHaveLength(2);
  });

  it("filters by agent_id", () => {
    lockFile({ path: "src/a.ts", agent_id: "agent-1" });
    lockFile({ path: "src/b.ts", agent_id: "agent-2" });
    const locks = listFileLocks("agent-1");
    expect(locks).toHaveLength(1);
    expect(locks[0]!.agent_id).toBe("agent-1");
  });

  it("excludes expired locks", () => {
    const db = getDatabase();
    db.run(
      "INSERT INTO file_locks (id, path, agent_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      ["exp-id", "src/foo.ts", "agent-1", new Date(Date.now() - 1000).toISOString(), new Date().toISOString()],
    );
    expect(listFileLocks()).toHaveLength(0);
  });
});

describe("forceUnlockFile", () => {
  it("removes a lock regardless of holder", () => {
    lockFile({ path: "src/foo.ts", agent_id: "agent-1" });
    const removed = forceUnlockFile("src/foo.ts");
    expect(removed).toBe(true);
    expect(checkFileLock("src/foo.ts")).toBeNull();
  });

  it("returns false for unlocked path", () => {
    expect(forceUnlockFile("src/nonexistent.ts")).toBe(false);
  });
});

describe("cleanExpiredFileLocks", () => {
  it("removes only expired locks", () => {
    lockFile({ path: "src/active.ts", agent_id: "agent-1", ttl_seconds: 3600 });
    const db = getDatabase();
    db.run(
      "INSERT INTO file_locks (id, path, agent_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      ["exp-id", "src/expired.ts", "agent-1", new Date(Date.now() - 1000).toISOString(), new Date().toISOString()],
    );
    const removed = cleanExpiredFileLocks();
    expect(removed).toBe(1);
    expect(checkFileLock("src/active.ts")).not.toBeNull();
  });
});
