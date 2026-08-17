// Regression: `mementos stale` must be able to scan PINNED memories.
//
// Fleet finding (2026-08-17, full 14370-row dump): 13 of 79 pinned memories
// have accessed_at = null (access_count 0), the oldest dating to 2026-06-28.
// Pinned memories are the high-visibility, always-surfaced subset, yet
// getStaleMemories hardcoded `pinned = 0` into its SQL, so a pin that is
// never accessed could never be flagged for curation by the stale check.

import { describe, expect, test } from "bun:test";
import { SqliteAdapter as Database } from "../storage.js";
import { getStaleMemories } from "./analytics.js";

// Minimal schema mirroring the columns the stale query touches. The full
// schema lives in migrations; the stale query only reads memories.
function freshDb(): Database {
  const db = new Database(":memory:", { create: true });
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'knowledge',
      scope TEXT NOT NULL DEFAULT 'private',
      summary TEXT,
      tags TEXT DEFAULT '[]',
      importance INTEGER NOT NULL DEFAULT 5,
      source TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT,
      project_id TEXT,
      session_id TEXT,
      machine_id TEXT,
      when_to_use TEXT,
      metadata TEXT DEFAULT '{}',
      access_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      accessed_at TEXT
    );
  `);
  return db;
}

function seedMemory(
  db: Database,
  id: string,
  key: string,
  opts: { pinned?: boolean; accessedAt?: string | null; createdAt?: string } = {}
): void {
  db.run(
    `INSERT INTO memories (id, key, value, status, pinned, access_count, accessed_at, created_at, updated_at)
     VALUES (?, ?, 'v', 'active', ?, 0, ?, ?, ?)`,
    [
      id,
      key,
      opts.pinned ? 1 : 0,
      opts.accessedAt === undefined ? null : opts.accessedAt,
      opts.createdAt ?? "2026-01-01T00:00:00.000Z",
      opts.createdAt ?? "2026-01-01T00:00:00.000Z",
    ]
  );
}

const NEVER = null;
const RECENT = new Date(Date.now() - 1000 * 60).toISOString(); // accessed 1 min ago

describe("getStaleMemories — pinned population coverage", () => {
  test("default scan excludes pinned rows entirely (existing contract)", () => {
    const db = freshDb();
    seedMemory(db, "pin-never", "pinned.never-accessed", { pinned: true, accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });
    seedMemory(db, "plain-never", "plain.never-accessed", { accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });

    const rows = getStaleMemories({ days: 30, limit: 100 }, db);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("plain.never-accessed");
    expect(keys).not.toContain("pinned.never-accessed");
  });

  test("stale scan with pinned:true surfaces a never-accessed pinned memory", () => {
    const db = freshDb();
    seedMemory(db, "pin-never", "pinned.never-accessed", { pinned: true, accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });

    const rows = getStaleMemories({ days: 30, limit: 100, pinned: true }, db);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("pinned.never-accessed");
  });

  test("pinned:true scan returns pinned rows only — unpinned stale rows are excluded", () => {
    const db = freshDb();
    seedMemory(db, "pin-never", "pinned.never-accessed", { pinned: true, accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });
    seedMemory(db, "plain-never", "plain.never-accessed", { accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });

    const rows = getStaleMemories({ days: 30, limit: 100, pinned: true }, db);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("pinned.never-accessed");
    expect(keys).not.toContain("plain.never-accessed");
  });

  test("pinned:false scan behaves like the default (pinned rows excluded)", () => {
    const db = freshDb();
    seedMemory(db, "pin-never", "pinned.never-accessed", { pinned: true, accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });
    seedMemory(db, "plain-never", "plain.never-accessed", { accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });

    const rows = getStaleMemories({ days: 30, limit: 100, pinned: false }, db);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("plain.never-accessed");
    expect(keys).not.toContain("pinned.never-accessed");
  });

  test("a recently-accessed pinned memory is not stale even under pinned:true", () => {
    const db = freshDb();
    seedMemory(db, "pin-fresh", "pinned.freshly-accessed", { pinned: true, accessedAt: RECENT, createdAt: "2026-01-01T00:00:00.000Z" });

    const rows = getStaleMemories({ days: 30, limit: 100, pinned: true }, db);
    expect(rows.map((r) => r.key)).not.toContain("pinned.freshly-accessed");
  });

  test("stale rows carry the pinned flag so JSON consumers can tell the population apart", () => {
    const db = freshDb();
    seedMemory(db, "pin-never", "pinned.never-accessed", { pinned: true, accessedAt: NEVER, createdAt: "2026-06-28T00:00:00.000Z" });

    const rows = getStaleMemories({ days: 30, limit: 100, pinned: true }, db);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.pinned).toBe(1);
      expect(row.access_count).toBe(0);
      expect(row.accessed_at).toBeNull();
    }
  });
});
