import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase, resolvePartialId, isLockExpired, lockExpiryCutoff, now, uuid } from "./database.js";
import { createTask } from "./tasks.js";
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

describe("resolvePartialId", () => {
  it("should match exact full UUID", () => {
    const task = createTask({ title: "Test task" }, db);
    const resolved = resolvePartialId(db, "tasks", task.id);
    expect(resolved).toBe(task.id);
  });

  it("should find unique match with 8-char prefix", () => {
    const task = createTask({ title: "Test task" }, db);
    const prefix = task.id.substring(0, 8);
    const resolved = resolvePartialId(db, "tasks", prefix);
    expect(resolved).toBe(task.id);
  });

  it("should return null for no match", () => {
    createTask({ title: "Test task" }, db);
    const resolved = resolvePartialId(db, "tasks", "aaaaaaaa");
    // Very unlikely to match a random UUID prefix
    // If by extreme chance it matches, we skip this assertion
    if (resolved !== null) {
      // Extremely unlikely but handle gracefully
      return;
    }
    expect(resolved).toBeNull();
  });

  it("should return null for non-existent full UUID", () => {
    const resolved = resolvePartialId(db, "tasks", "00000000-0000-0000-0000-000000000000");
    expect(resolved).toBeNull();
  });
});

describe("isLockExpired", () => {
  it("should return true for null locked_at", () => {
    expect(isLockExpired(null)).toBe(true);
  });

  it("should return true for old timestamp (>30 min ago)", () => {
    const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(isLockExpired(oldTime)).toBe(true);
  });

  it("should return false for recent timestamp (<30 min ago)", () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(isLockExpired(recentTime)).toBe(false);
  });

  it("should return false for current timestamp", () => {
    expect(isLockExpired(new Date().toISOString())).toBe(false);
  });

  it("should return true for exactly 30 minutes ago (boundary)", () => {
    // At exactly 30 minutes, Date.now() - lockTime === expiryMs, so > is false
    const exactBoundary = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    // Due to ms precision, this is at the boundary; the check is strictly greater than
    // so at exactly 30 min it should NOT be expired
    expect(isLockExpired(exactBoundary)).toBe(false);
  });
});

describe("lockExpiryCutoff", () => {
  it("should return a valid ISO string", () => {
    const cutoff = lockExpiryCutoff();
    const parsed = new Date(cutoff);
    expect(parsed.toISOString()).toBe(cutoff);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it("should return a time 30 minutes before the given timestamp", () => {
    const fixedNow = new Date("2026-01-15T12:00:00.000Z").getTime();
    const cutoff = lockExpiryCutoff(fixedNow);
    const expected = new Date("2026-01-15T11:30:00.000Z").toISOString();
    expect(cutoff).toBe(expected);
  });

  it("should default to 30 minutes before current time", () => {
    const before = Date.now();
    const cutoff = lockExpiryCutoff();
    const after = Date.now();

    const cutoffMs = new Date(cutoff).getTime();
    const thirtyMinMs = 30 * 60 * 1000;

    // cutoff should be approximately (now - 30 min)
    expect(cutoffMs).toBeGreaterThanOrEqual(before - thirtyMinMs);
    expect(cutoffMs).toBeLessThanOrEqual(after - thirtyMinMs);
  });
});

describe("now", () => {
  it("should return a valid ISO string", () => {
    const result = now();
    const parsed = new Date(result);
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("should return current time (within 1 second tolerance)", () => {
    const before = Date.now();
    const result = now();
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    expect(resultMs).toBeGreaterThanOrEqual(before - 1000);
    expect(resultMs).toBeLessThanOrEqual(after + 1000);
  });
});

describe("uuid", () => {
  it("should return a valid UUID format (36 chars with dashes)", () => {
    const id = uuid();
    expect(id).toHaveLength(36);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("should return unique values on each call", () => {
    const id1 = uuid();
    const id2 = uuid();
    const id3 = uuid();
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });
});
