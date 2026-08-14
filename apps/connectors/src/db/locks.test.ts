import { describe, test, expect, beforeEach } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import {
  acquireLock, releaseLock, releaseResourceLocks, releaseAllAgentLocks,
  checkLock, agentHoldsLock, listAgentLocks, cleanExpiredLocks,
} from "./locks.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'exclusive',
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusive ON resource_locks(resource_type, resource_id) WHERE lock_type = 'exclusive'`);
  return db;
}

describe("acquireLock", () => {
  test("acquires exclusive lock successfully", () => {
    const db = makeDb();
    const lock = acquireLock("agent1", "connector", "stripe", "exclusive", 300, db);
    expect(lock).not.toBeNull();
    expect(lock!.resource_type).toBe("connector");
    expect(lock!.resource_id).toBe("stripe");
    expect(lock!.agent_id).toBe("agent1");
    expect(lock!.lock_type).toBe("exclusive");
    expect(lock!.id).toHaveLength(8);
  });

  test("blocks second agent from acquiring exclusive lock on same resource", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "exclusive", 300, db);
    const blocked = acquireLock("agent2", "connector", "stripe", "exclusive", 300, db);
    expect(blocked).toBeNull();
  });

  test("same agent re-acquires (refreshes TTL)", () => {
    const db = makeDb();
    const lock1 = acquireLock("agent1", "connector", "stripe", "exclusive", 300, db);
    const lock2 = acquireLock("agent1", "connector", "stripe", "exclusive", 600, db);
    expect(lock2).not.toBeNull();
    expect(lock2!.id).toBe(lock1!.id); // Same lock, refreshed TTL
    expect(lock2!.expires_at > lock1!.expires_at).toBe(true);
  });

  test("advisory locks allow multiple agents", () => {
    const db = makeDb();
    const l1 = acquireLock("agent1", "connector", "stripe", "advisory", 300, db);
    const l2 = acquireLock("agent2", "connector", "stripe", "advisory", 300, db);
    expect(l1).not.toBeNull();
    expect(l2).not.toBeNull();
  });

  test("different resources don't block each other", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "exclusive", 300, db);
    const lock = acquireLock("agent2", "connector", "github", "exclusive", 300, db);
    expect(lock).not.toBeNull();
  });

  test("token resource type works", () => {
    const db = makeDb();
    const lock = acquireLock("agent1", "token", "gmail-default", "exclusive", 30, db);
    expect(lock).not.toBeNull();
    expect(lock!.resource_type).toBe("token");
  });
});

describe("releaseLock", () => {
  test("releases lock successfully", () => {
    const db = makeDb();
    const lock = acquireLock("agent1", "connector", "stripe", "exclusive", 300, db)!;
    expect(releaseLock(lock.id, "agent1", db)).toBe(true);
    expect(checkLock("connector", "stripe", "exclusive", db)).toHaveLength(0);
  });

  test("cannot release another agent's lock", () => {
    const db = makeDb();
    const lock = acquireLock("agent1", "connector", "stripe", "exclusive", 300, db)!;
    expect(releaseLock(lock.id, "agent2", db)).toBe(false);
    expect(checkLock("connector", "stripe", "exclusive", db)).toHaveLength(1);
  });

  test("after release, another agent can acquire", () => {
    const db = makeDb();
    const lock = acquireLock("agent1", "connector", "stripe", "exclusive", 300, db)!;
    releaseLock(lock.id, "agent1", db);
    const lock2 = acquireLock("agent2", "connector", "stripe", "exclusive", 300, db);
    expect(lock2).not.toBeNull();
  });
});

describe("releaseResourceLocks / releaseAllAgentLocks", () => {
  test("releaseResourceLocks removes all locks for agent on resource", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "advisory", 300, db);
    releaseResourceLocks("agent1", "connector", "stripe", db);
    expect(checkLock("connector", "stripe", undefined, db)).toHaveLength(0);
  });

  test("releaseAllAgentLocks clears all locks for agent", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "advisory", 300, db);
    acquireLock("agent1", "token", "gmail-default", "exclusive", 300, db);
    releaseAllAgentLocks("agent1", db);
    expect(listAgentLocks("agent1", db)).toHaveLength(0);
  });
});

describe("checkLock", () => {
  test("returns empty array when no lock", () => {
    const db = makeDb();
    expect(checkLock("connector", "stripe", undefined, db)).toHaveLength(0);
  });

  test("returns active locks", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "advisory", 300, db);
    acquireLock("agent2", "connector", "stripe", "advisory", 300, db);
    expect(checkLock("connector", "stripe", undefined, db)).toHaveLength(2);
  });

  test("filter by lock type", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "advisory", 300, db);
    expect(checkLock("connector", "stripe", "exclusive", db)).toHaveLength(0);
    expect(checkLock("connector", "stripe", "advisory", db)).toHaveLength(1);
  });
});

describe("agentHoldsLock", () => {
  test("returns lock when agent holds it", () => {
    const db = makeDb();
    acquireLock("agent1", "connector", "stripe", "exclusive", 300, db);
    const held = agentHoldsLock("agent1", "connector", "stripe", undefined, db);
    expect(held).not.toBeNull();
    expect(held!.agent_id).toBe("agent1");
  });

  test("returns null when agent doesn't hold lock", () => {
    const db = makeDb();
    expect(agentHoldsLock("agent1", "connector", "stripe", undefined, db)).toBeNull();
  });
});

describe("cleanExpiredLocks", () => {
  test("removes expired locks", () => {
    const db = makeDb();
    // Insert already-expired lock
    db.run(
      "INSERT INTO resource_locks (id, resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '-1 second'))",
      ["expiredx", "connector", "stripe", "agent1", "exclusive"]
    );
    const removed = cleanExpiredLocks(db);
    expect(removed).toBe(1);
    expect(checkLock("connector", "stripe", undefined, db)).toHaveLength(0);
  });
});
