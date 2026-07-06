import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { acquireLock, tryBulkAcquireLock, releaseLock, checkLock, cleanExpiredLocks, listLocks, listLocksEnriched, releaseStaleAgentLocks } from "./locks";
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
    const result = acquireLock("channel", "general", "agent-1");
    expect(result.acquired).toBe(true);
    expect(result.lock).toBeTruthy();
    expect(result.lock!.resource_type).toBe("channel");
    expect(result.lock!.resource_id).toBe("general");
    expect(result.lock!.agent_id).toBe("agent-1");
    expect(result.lock!.lock_type).toBe("advisory");
  });

  test("defaults to advisory lock type", () => {
    const result = acquireLock("channel", "room", "agent-1");
    expect(result.lock!.lock_type).toBe("advisory");
  });

  test("supports exclusive lock type", () => {
    const result = acquireLock("pinned_message", "42", "agent-1", "exclusive");
    expect(result.lock!.lock_type).toBe("exclusive");
  });

  test("same agent re-acquiring same lock refreshes it", () => {
    acquireLock("channel", "general", "agent-1");
    const result = acquireLock("channel", "general", "agent-1");
    expect(result.acquired).toBe(true);
    expect(result.held_by).toBeUndefined();
  });

  test("different agent blocked by existing lock", () => {
    acquireLock("channel", "general", "agent-1");
    const result = acquireLock("channel", "general", "agent-2");
    expect(result.acquired).toBe(false);
    expect(result.lock).toBeNull();
    expect(result.held_by).toBe("agent-1");
  });

  test("different agent is blocked across advisory and exclusive lock types", () => {
    acquireLock("channel", "general", "agent-1", "advisory");
    const exclusive = acquireLock("channel", "general", "agent-2", "exclusive");
    expect(exclusive.acquired).toBe(false);
    expect(exclusive.held_by).toBe("agent-1");

    releaseLock("channel", "general", "agent-1");
    acquireLock("channel", "general", "agent-2", "exclusive");
    const advisory = acquireLock("channel", "general", "agent-1", "advisory");
    expect(advisory.acquired).toBe(false);
    expect(advisory.held_by).toBe("agent-2");
  });

  test("different resource types don't conflict", () => {
    acquireLock("channel", "general", "agent-1");
    const result = acquireLock("pinned_message", "general", "agent-2");
    expect(result.acquired).toBe(true);
  });

  test("different resource IDs don't conflict", () => {
    acquireLock("channel", "room-a", "agent-1");
    const result = acquireLock("channel", "room-b", "agent-2");
    expect(result.acquired).toBe(true);
  });

  test("expired lock allows new agent to acquire", () => {
    const db = getDb();
    // Insert an already-expired lock
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'expired-room', 'old-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();

    const result = acquireLock("channel", "expired-room", "new-agent");
    expect(result.acquired).toBe(true);
  });
});

describe("releaseLock", () => {
  test("releases lock held by agent", () => {
    acquireLock("channel", "general", "agent-1");
    const released = releaseLock("channel", "general", "agent-1");
    expect(released).toBe(true);
    expect(checkLock("channel", "general")).toBeNull();
  });

  test("returns false if agent doesn't hold the lock", () => {
    acquireLock("channel", "general", "agent-1");
    const released = releaseLock("channel", "general", "agent-2");
    expect(released).toBe(false);
    expect(checkLock("channel", "general")).toBeTruthy();
  });

  test("returns false for nonexistent lock", () => {
    const released = releaseLock("channel", "nonexistent", "agent-1");
    expect(released).toBe(false);
  });
});

describe("checkLock", () => {
  test("returns null when no lock exists", () => {
    expect(checkLock("channel", "general")).toBeNull();
  });

  test("returns lock when it exists", () => {
    acquireLock("channel", "general", "agent-1");
    const lock = checkLock("channel", "general");
    expect(lock).toBeTruthy();
    expect(lock!.agent_id).toBe("agent-1");
  });

  test("returns null for expired locks", () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'stale', 'old-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();
    expect(checkLock("channel", "stale")).toBeNull();
  });
});

describe("cleanExpiredLocks", () => {
  test("removes expired locks and returns count", () => {
    const db = getDb();
    // Insert expired locks directly (bypass acquireLock which auto-cleans)
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'r1', 'a1', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'r2', 'a2', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-600 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-300 seconds'))
    `).run();
    // Insert an active lock directly too
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'active', 'a3', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+60 seconds'))
    `).run();

    const cleaned = cleanExpiredLocks();
    expect(cleaned).toBe(2);
    expect(listLocks()).toHaveLength(1);
  });
});

describe("releaseStaleAgentLocks", () => {
  test("releases locks for agents with stale heartbeat (>30 min)", () => {
    const db = getDb();
    // Insert a stale agent presence (>30 min ago)
    db.prepare(`
      INSERT OR REPLACE INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
      VALUES ('aa', 'stale-agent', 'sess1', 'agent', 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1900 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1900 seconds'))
    `).run();
    // Insert a lock held by that stale agent
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'stale-room', 'stale-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1900 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+3600 seconds'))
    `).run();

    const released = releaseStaleAgentLocks();
    expect(released).toBe(1);
    expect(checkLock("channel", "stale-room")).toBeNull();
  });

  test("does not release locks for agents with fresh heartbeat", () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
      VALUES ('bb', 'fresh-agent', 'sess2', 'agent', 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-60 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-60 seconds'))
    `).run();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'fresh-room', 'fresh-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+3600 seconds'))
    `).run();

    const released = releaseStaleAgentLocks();
    expect(released).toBe(0);
    expect(checkLock("channel", "fresh-room")).toBeTruthy();
  });

  test("does not release locks for agents with no presence record", () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'unknown-room', 'unknown-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+3600 seconds'))
    `).run();

    const released = releaseStaleAgentLocks();
    expect(released).toBe(0);
    expect(checkLock("channel", "unknown-room")).toBeTruthy();
  });

  test("auto-releases stale agent locks via acquireLock cleanup", () => {
    const db = getDb();
    // Insert stale agent + their lock
    db.prepare(`
      INSERT OR REPLACE INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
      VALUES ('cc', 'zombie-agent', 'sess3', 'agent', 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-2000 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-2000 seconds'))
    `).run();
    db.prepare(`
      INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
      VALUES ('channel', 'zombie-room', 'zombie-agent', 'advisory', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-2000 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+3600 seconds'))
    `).run();

    // A new agent tries to acquire the same lock — cleanup runs internally and succeeds
    const result = acquireLock("channel", "zombie-room", "new-agent");
    expect(result.acquired).toBe(true);
  });
});

describe("listLocks", () => {
  test("returns empty array when no locks", () => {
    expect(listLocks()).toEqual([]);
  });

  test("returns all active locks", () => {
    acquireLock("channel", "r1", "agent-1");
    acquireLock("pinned_message", "42", "agent-2", "exclusive");
    expect(listLocks()).toHaveLength(2);
  });

  test("filters by resource_type", () => {
    acquireLock("channel", "r1", "agent-1");
    acquireLock("pinned_message", "42", "agent-2");
    const channelLocks = listLocks({ resource_type: "channel" });
    expect(channelLocks).toHaveLength(1);
    expect(channelLocks[0].resource_type).toBe("channel");
  });

  test("filters by agent_id", () => {
    acquireLock("channel", "r1", "agent-1");
    acquireLock("channel", "r2", "agent-2");
    const agentLocks = listLocks({ agent_id: "agent-1" });
    expect(agentLocks).toHaveLength(1);
    expect(agentLocks[0].agent_id).toBe("agent-1");
  });
});

describe("listLocksEnriched", () => {
  test("includes locked_seconds_ago and expires_in_seconds", () => {
    acquireLock("channel", "enrich-room", "enrich-agent");
    const locks = listLocksEnriched();
    expect(locks).toHaveLength(1);
    expect(typeof locks[0].locked_seconds_ago).toBe("number");
    expect(locks[0].locked_seconds_ago).toBeGreaterThanOrEqual(0);
    expect(typeof locks[0].expires_in_seconds).toBe("number");
    expect(locks[0].expires_in_seconds).toBeGreaterThan(0);
  });

  test("agent is null when no presence record exists", () => {
    acquireLock("channel", "no-presence-room", "ghost-agent");
    const locks = listLocksEnriched({ agent_id: "ghost-agent" });
    expect(locks).toHaveLength(1);
    expect(locks[0].agent).toBeNull();
  });

  test("includes agent presence details when available", () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
      VALUES ('dd', 'known-agent', 'sess', 'engineer', 'busy', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    `).run();
    acquireLock("channel", "known-room", "known-agent");
    const locks = listLocksEnriched({ agent_id: "known-agent" });
    expect(locks).toHaveLength(1);
    expect(locks[0].agent).not.toBeNull();
    expect(locks[0].agent!.role).toBe("engineer");
    expect(locks[0].agent!.status).toBe("busy");
    expect(locks[0].agent!.online).toBe(true);
  });

  test("agent.online is false for stale presence", () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
      VALUES ('ee', 'offline-agent', 'sess', 'agent', 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now', '-120 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-120 seconds'))
    `).run();
    acquireLock("channel", "offline-room", "offline-agent");
    const locks = listLocksEnriched({ agent_id: "offline-agent" });
    expect(locks[0].agent!.online).toBe(false);
  });
});

describe("tryBulkAcquireLock", () => {
  test("acquires multiple locks atomically", () => {
    const result = tryBulkAcquireLock([
      { resource_type: "channel", resource_id: "bulk-a" },
      { resource_type: "channel", resource_id: "bulk-b" },
      { resource_type: "pinned_message", resource_id: "42", lock_type: "exclusive" },
    ], "bulk-agent");

    expect(result.acquired).toBe(true);
    expect(result.locks).toHaveLength(3);
    expect(result.blocked_by).toBeUndefined();

    // Verify all locks exist in DB
    expect(checkLock("channel", "bulk-a")).toBeTruthy();
    expect(checkLock("channel", "bulk-b")).toBeTruthy();
    expect(checkLock("pinned_message", "42")).toBeTruthy();
  });

  test("returns failure and no locks when any resource is blocked", () => {
    // agent-other holds bulk-blocked
    acquireLock("channel", "bulk-blocked", "agent-other");

    const result = tryBulkAcquireLock([
      { resource_type: "channel", resource_id: "bulk-free" },
      { resource_type: "channel", resource_id: "bulk-blocked" },
    ], "bulk-requester");

    expect(result.acquired).toBe(false);
    expect(result.locks).toHaveLength(0);
    expect(result.blocked_by).toEqual({
      resource_type: "channel",
      resource_id: "bulk-blocked",
      held_by: "agent-other",
    });

    // bulk-free must NOT have been acquired (atomicity)
    expect(checkLock("channel", "bulk-free")).toBeNull();
  });

  test("blocks bulk acquire when another agent holds the resource with another lock type", () => {
    acquireLock("channel", "bulk-cross-type", "agent-other", "advisory");

    const result = tryBulkAcquireLock([
      { resource_type: "channel", resource_id: "bulk-cross-type", lock_type: "exclusive" },
    ], "bulk-requester");

    expect(result.acquired).toBe(false);
    expect(result.blocked_by).toEqual({
      resource_type: "channel",
      resource_id: "bulk-cross-type",
      held_by: "agent-other",
    });
  });

  test("same agent re-acquiring all owned locks succeeds", () => {
    acquireLock("channel", "bulk-owned-a", "self-agent");
    acquireLock("channel", "bulk-owned-b", "self-agent");

    const result = tryBulkAcquireLock([
      { resource_type: "channel", resource_id: "bulk-owned-a" },
      { resource_type: "channel", resource_id: "bulk-owned-b" },
    ], "self-agent");

    expect(result.acquired).toBe(true);
    expect(result.locks).toHaveLength(2);
  });

  test("empty resources list succeeds with empty locks", () => {
    const result = tryBulkAcquireLock([], "any-agent");
    expect(result.acquired).toBe(true);
    expect(result.locks).toHaveLength(0);
  });
});
