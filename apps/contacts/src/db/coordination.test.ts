import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  acquireLock,
  releaseLock,
  checkLock,
  cleanExpiredLocks,
  logAgentActivity,
  getAgentActivity,
} from "./coordination.js";
import { createContact } from "./contacts.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-coordination-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("acquireLock", () => {
  it("acquires a lock on an unlocked contact", () => {
    const contact = createContact({ display_name: "Alice" });
    const result = acquireLock(contact.id, "agent-1");
    expect(result.acquired).toBe(true);
    expect(result.lock).toBeDefined();
    expect(result.lock!.contact_id).toBe(contact.id);
    expect(result.lock!.agent_name).toBe("agent-1");
    expect(result.held_by).toBeUndefined();
  });

  it("fails to acquire a lock already held by another agent", () => {
    const contact = createContact({ display_name: "Bob" });
    acquireLock(contact.id, "agent-1");
    const result = acquireLock(contact.id, "agent-2");
    expect(result.acquired).toBe(false);
    expect(result.held_by).toBe("agent-1");
    expect(result.lock).toBeDefined();
  });

  it("stores reason and session_id", () => {
    const contact = createContact({ display_name: "Carol" });
    const result = acquireLock(contact.id, "agent-1", 300, "enrichment", "session-abc");
    expect(result.acquired).toBe(true);
    expect(result.lock!.reason).toBe("enrichment");
    expect(result.lock!.session_id).toBe("session-abc");
  });

  it("uses custom TTL for expiration", () => {
    const contact = createContact({ display_name: "Dave" });
    const result = acquireLock(contact.id, "agent-1", 60);
    expect(result.acquired).toBe(true);
    const expiresAt = new Date(result.lock!.expires_at).getTime();
    const acquiredAt = new Date(result.lock!.acquired_at).getTime();
    // TTL should be roughly 60 seconds (allow some slack)
    expect(expiresAt - acquiredAt).toBeLessThanOrEqual(70000);
    expect(expiresAt - acquiredAt).toBeGreaterThanOrEqual(50000);
  });

  it("allows acquiring lock after expired lock is cleaned", () => {
    const contact = createContact({ display_name: "Eve" });
    // Acquire with 0 TTL so it expires immediately
    acquireLock(contact.id, "agent-1", 0);
    // Small delay isn't needed — TTL=0 means expires_at is in the past
    const result = acquireLock(contact.id, "agent-2");
    expect(result.acquired).toBe(true);
    expect(result.lock!.agent_name).toBe("agent-2");
  });

  it("defaults reason and session_id to null", () => {
    const contact = createContact({ display_name: "Frank" });
    const result = acquireLock(contact.id, "agent-1");
    expect(result.lock!.reason).toBeNull();
    expect(result.lock!.session_id).toBeNull();
  });
});

describe("releaseLock", () => {
  it("releases a lock held by the agent", () => {
    const contact = createContact({ display_name: "Alice" });
    acquireLock(contact.id, "agent-1");
    const released = releaseLock(contact.id, "agent-1");
    expect(released).toBe(true);
    expect(checkLock(contact.id)).toBeNull();
  });

  it("returns false when no lock exists", () => {
    const contact = createContact({ display_name: "Bob" });
    const released = releaseLock(contact.id, "agent-1");
    expect(released).toBe(false);
  });

  it("returns false when lock is held by different agent", () => {
    const contact = createContact({ display_name: "Carol" });
    acquireLock(contact.id, "agent-1");
    const released = releaseLock(contact.id, "agent-2");
    expect(released).toBe(false);
    // Lock should still be held by agent-1
    const lock = checkLock(contact.id);
    expect(lock).not.toBeNull();
    expect(lock!.agent_name).toBe("agent-1");
  });
});

describe("checkLock", () => {
  it("returns null for unlocked contact", () => {
    const contact = createContact({ display_name: "Alice" });
    expect(checkLock(contact.id)).toBeNull();
  });

  it("returns the lock for a locked contact", () => {
    const contact = createContact({ display_name: "Bob" });
    acquireLock(contact.id, "agent-1");
    const lock = checkLock(contact.id);
    expect(lock).not.toBeNull();
    expect(lock!.agent_name).toBe("agent-1");
  });

  it("returns null for expired lock", () => {
    const contact = createContact({ display_name: "Carol" });
    acquireLock(contact.id, "agent-1", 0);
    const lock = checkLock(contact.id);
    expect(lock).toBeNull();
  });
});

describe("cleanExpiredLocks", () => {
  it("removes expired locks", () => {
    const contact = createContact({ display_name: "Alice" });
    acquireLock(contact.id, "agent-1", 0);
    cleanExpiredLocks();
    expect(checkLock(contact.id)).toBeNull();
  });

  it("does not remove active locks", () => {
    const contact = createContact({ display_name: "Bob" });
    acquireLock(contact.id, "agent-1", 3600);
    cleanExpiredLocks();
    const lock = checkLock(contact.id);
    expect(lock).not.toBeNull();
  });
});

describe("logAgentActivity", () => {
  it("logs an activity for a contact", () => {
    const contact = createContact({ display_name: "Alice" });
    logAgentActivity(contact.id, "agent-1", "enrich", "ran enrichment", "session-1");
    const activities = getAgentActivity(contact.id);
    expect(activities.length).toBe(1);
    expect(activities[0].agent_name).toBe("agent-1");
    expect(activities[0].action).toBe("enrich");
    expect(activities[0].details).toBe("ran enrichment");
    expect(activities[0].session_id).toBe("session-1");
  });

  it("defaults details and session_id to null", () => {
    const contact = createContact({ display_name: "Bob" });
    logAgentActivity(contact.id, "agent-1", "view");
    const activities = getAgentActivity(contact.id);
    expect(activities[0].details).toBeNull();
    expect(activities[0].session_id).toBeNull();
  });

  it("logs multiple activities", () => {
    const contact = createContact({ display_name: "Carol" });
    logAgentActivity(contact.id, "agent-1", "view");
    logAgentActivity(contact.id, "agent-2", "edit");
    logAgentActivity(contact.id, "agent-1", "enrich");
    const activities = getAgentActivity(contact.id);
    expect(activities.length).toBe(3);
  });
});

describe("getAgentActivity", () => {
  it("returns activities in descending order by created_at", () => {
    const contact = createContact({ display_name: "Alice" });
    logAgentActivity(contact.id, "agent-1", "first");
    logAgentActivity(contact.id, "agent-1", "second");
    logAgentActivity(contact.id, "agent-1", "third");
    const activities = getAgentActivity(contact.id);
    expect(activities[0].action).toBe("third");
    expect(activities[2].action).toBe("first");
  });

  it("respects the limit parameter", () => {
    const contact = createContact({ display_name: "Bob" });
    for (let i = 0; i < 5; i++) {
      logAgentActivity(contact.id, "agent-1", `action-${i}`);
    }
    const activities = getAgentActivity(contact.id, 2);
    expect(activities.length).toBe(2);
  });

  it("returns empty array for contact with no activity", () => {
    const contact = createContact({ display_name: "Carol" });
    const activities = getAgentActivity(contact.id);
    expect(activities).toEqual([]);
  });

  it("returns empty array for non-existent contact", () => {
    const activities = getAgentActivity("non-existent-id");
    expect(activities).toEqual([]);
  });
});
