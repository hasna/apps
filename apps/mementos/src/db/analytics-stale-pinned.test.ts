process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { getDatabase, resetDatabase } from "./database.js";
import { getStaleMemories } from "./analytics.js";

// ============================================================================
// Regression test: the stale check hardcoded `pinned = 0`, so pinned memories
// — the high-visibility, always-surfaced subset — could never be flagged as
// stale. Never-accessed pins (accessed_at IS NULL) stayed pinned indefinitely
// with no surface reporting them. getStaleMemories must accept a `pinned`
// filter so `mementos stale --pinned` can surface them for curation.
// ============================================================================

function seedMemory(
  id: string,
  key: string,
  opts: { pinned?: boolean; accessedAt?: string | null; createdAt?: string }
): void {
  const db = getDatabase();
  db.run(
    `INSERT INTO memories (id, key, value, category, scope, status, pinned, access_count, created_at, updated_at, accessed_at)
     VALUES (?, ?, ?, 'knowledge', 'private', 'active', ?, ?, ?, ?, ?)`,
    [
      id,
      key,
      "value-" + key,
      opts.pinned ? 1 : 0,
      opts.accessedAt === null ? 0 : 1,
      opts.createdAt ?? "2026-01-01T00:00:00.000Z",
      new Date().toISOString(),
      opts.accessedAt,
    ]
  );
}

describe("getStaleMemories pinned filter", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("excludes pinned memories by default (existing contract preserved)", () => {
    seedMemory("pin-never", "pin-never", { pinned: true, accessedAt: null });
    seedMemory("plain-old", "plain-old", { pinned: false, accessedAt: "2026-01-01T00:00:00.000Z" });

    const rows = getStaleMemories({});
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("plain-old");
    expect(keys).not.toContain("pin-never");
  });

  it("includes never-accessed pinned memories when pinned: true, with access stats", () => {
    seedMemory("pin-never", "pin-never", { pinned: true, accessedAt: null });
    seedMemory("pin-recent", "pin-recent", { pinned: true, accessedAt: new Date().toISOString() });
    seedMemory("pin-old", "pin-old", { pinned: true, accessedAt: "2026-01-01T00:00:00.000Z" });

    const rows = getStaleMemories({ pinned: true });
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("pin-never");
    expect(keys).toContain("pin-old");
    expect(keys).not.toContain("pin-recent");

    const never = rows.find((r) => r.key === "pin-never")!;
    expect(never.accessed_at).toBeNull();
    expect(never.access_count).toBe(0);
  });

  it("returns only pinned rows when pinned: true", () => {
    seedMemory("pin-never", "pin-never", { pinned: true, accessedAt: null });
    seedMemory("plain-never", "plain-never", { pinned: false, accessedAt: null });

    const rows = getStaleMemories({ pinned: true });
    expect(rows.map((r) => r.key)).toContain("pin-never");
    expect(rows.map((r) => r.key)).not.toContain("plain-never");
  });

  it("returns only unpinned rows when pinned: false", () => {
    seedMemory("pin-never", "pin-never", { pinned: true, accessedAt: null });
    seedMemory("plain-never", "plain-never", { pinned: false, accessedAt: null });

    const rows = getStaleMemories({ pinned: false });
    expect(rows.map((r) => r.key)).toContain("plain-never");
    expect(rows.map((r) => r.key)).not.toContain("pin-never");
  });
});
