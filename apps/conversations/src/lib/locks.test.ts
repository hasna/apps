import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { acquireLock, releaseLock, checkLock, cleanExpiredLocks, listLocks } from "./locks";
import { closeDb, getDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-locks-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

describe("acquireLock", () => {
  test("acquires a new lock", () => {
    const result = acquireLock("space", "general", "agent-1");
    expect(result.acquired).toBe(true);
    expect(result.lock).toBeTruthy();
    expect(result.lock!.resource_type).toBe("space");
    expect(result.lock!.resource_id).toBe("general");
    expect(result.lock!.agent_id).toBe("agent-1");
    expect(result.lock!.lock_type).toBe("advisory");
  });

  test("defaults to advisory lock type", () => {
    const result = acquireLock("space", "room", "agent-1");
    expect(result.lock!.lock_type).toBe("advisory");
  });

  test("supports exclusive lock type", () => {
    const result = acquireLock("pinned_message", "42", "agent-1", "exclusive");
    expect(result.lock!.lock_type).toBe("exclusive");
  });

  test("same agent re-acquiring same lock refreshes it", () => {
    acquireLock("space", "general", "agent-1");
    const result = acquireLock("space", "general", "agent-1");
    expect(result.acquired).toBe(true);
    expect(result.held_by).toBeUndefined();
  });

  test("different agent blocked by existing lock", () => {
    acquireLock("space", "general", "agent-1");
    const result = acquireLock("space", "general", "agent-2");
    expect(result.acquired).toBe(false);
    expect(result.lock).toBeNull();
    expect(result.held_by).toBe("agent-1");
  });

  test("different resource types don't conflict", () => {
    acquireLock("space", "general", "agent-1");
    const result = acquireLock("pinned_message", "general", "agent-2");
    expect(result.acquired).toBe(true);
  });

  test("different resource IDs don't conflict", () => {
    acquireLock("space", "room-a", "agent-1");
    const result = acquireLock("space", "room-b", "agent-2");
    expect(result.acquired).toBe(true);
  });

  test("expired lock allows new agent to acquire", () => {
    const db = getDb();
    // Insert an already-expired lock
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('space', 'expired-room', 'old-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();

    const result = acquireLock("space", "expired-room", "new-agent");
    expect(result.acquired).toBe(true);
  });
});

describe("releaseLock", () => {
  test("releases lock held by agent", () => {
    acquireLock("space", "general", "agent-1");
    const released = releaseLock("space", "general", "agent-1");
    expect(released).toBe(true);
    expect(checkLock("space", "general")).toBeNull();
  });

  test("returns false if agent doesn't hold the lock", () => {
    acquireLock("space", "general", "agent-1");
    const released = releaseLock("space", "general", "agent-2");
    expect(released).toBe(false);
    expect(checkLock("space", "general")).toBeTruthy();
  });

  test("returns false for nonexistent lock", () => {
    const released = releaseLock("space", "nonexistent", "agent-1");
    expect(released).toBe(false);
  });
});

describe("checkLock", () => {
  test("returns null when no lock exists", () => {
    expect(checkLock("space", "general")).toBeNull();
  });

  test("returns lock when it exists", () => {
    acquireLock("space", "general", "agent-1");
    const lock = checkLock("space", "general");
    expect(lock).toBeTruthy();
    expect(lock!.agent_id).toBe("agent-1");
  });

  test("returns null for expired locks", () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('space', 'stale', 'old-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();
    expect(checkLock("space", "stale")).toBeNull();
  });
});

describe("cleanExpiredLocks", () => {
  test("removes expired locks and returns count", () => {
    const db = getDb();
    // Insert expired locks directly (bypass acquireLock which auto-cleans)
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('space', 'r1', 'a1', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('space', 'r2', 'a2', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();
    // Insert an active lock directly too
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('space', 'active', 'a3', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+60 seconds'))
    `).run();

    const cleaned = cleanExpiredLocks();
    expect(cleaned).toBe(2);
    expect(listLocks()).toHaveLength(1);
  });
});

describe("listLocks", () => {
  test("returns empty array when no locks", () => {
    expect(listLocks()).toEqual([]);
  });

  test("returns all active locks", () => {
    acquireLock("space", "r1", "agent-1");
    acquireLock("pinned_message", "42", "agent-2", "exclusive");
    expect(listLocks()).toHaveLength(2);
  });

  test("filters by resource_type", () => {
    acquireLock("space", "r1", "agent-1");
    acquireLock("pinned_message", "42", "agent-2");
    const spaceLocks = listLocks({ resource_type: "space" });
    expect(spaceLocks).toHaveLength(1);
    expect(spaceLocks[0].resource_type).toBe("space");
  });

  test("filters by agent_id", () => {
    acquireLock("space", "r1", "agent-1");
    acquireLock("space", "r2", "agent-2");
    const agentLocks = listLocks({ agent_id: "agent-1" });
    expect(agentLocks).toHaveLength(1);
    expect(agentLocks[0].agent_id).toBe("agent-1");
  });
});
