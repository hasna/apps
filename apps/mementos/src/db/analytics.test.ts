// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase } from "./database.js";
import { getMemoryStats } from "./analytics.js";

let savedCwd: string;

beforeEach(() => {
  resetDatabase();
  savedCwd = process.cwd();
});

afterEach(() => {
  if (process.cwd() !== savedCwd) {
    try {
      process.chdir(savedCwd);
    } catch {
      /* ignore */
    }
  }
  process.env["MEMENTOS_DB_PATH"] = ":memory:";
  delete process.env["HASNA_MEMENTOS_DB_PATH"];
});

function insertMemory(db: ReturnType<typeof getDatabase>, overrides: Record<string, unknown> = {}): void {
  const cols = {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    key: `key-${Math.random().toString(36).slice(2)}`,
    value: "v",
    category: "knowledge",
    scope: "private",
    status: "active",
    ...overrides,
  };
  const names = Object.keys(cols);
  const placeholders = names.map(() => "?").join(", ");
  db.run(
    `INSERT INTO memories (${names.join(", ")}) VALUES (${placeholders})`,
    ...(Object.values(cols) as string[])
  );
}

// ============================================================================
// getMemoryStats — expired_count semantics (regression)
//
// Issue: `mementos stats` reported expired_count 874 while zero memories were
// actually expired (by_status.expired = 0, `list --status expired` = []).
// expired_count conflated status = 'expired' with "carries a past-dated
// expires_at while still active". The field must count rows returned by
// `--status expired` (pure status match), and the count of rows carrying an
// expiry date lives in a distinctly named field, expires_at_count.
// ============================================================================

describe("getMemoryStats expired_count semantics", () => {
  test("active memory with a past-dated expires_at is NOT counted as expired", () => {
    const db = getDatabase(":memory:");
    insertMemory(db, { expires_at: new Date(Date.now() - 86_400_000).toISOString() });

    const stats = getMemoryStats(db);

    // Regression: the old query counted this row via
    // `expires_at IS NOT NULL AND expires_at < datetime('now')` — the same
    // shape that produced expired_count 874 on a fleet store with zero
    // status='expired' rows.
    expect(stats.expired_count).toBe(0);
    expect(stats.expires_at_count).toBe(1);
  });

  test("expired_count counts exactly the rows returned by --status expired", () => {
    const db = getDatabase(":memory:");
    insertMemory(db, { expires_at: new Date(Date.now() - 86_400_000).toISOString() });
    insertMemory(db, { expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    insertMemory(db, { status: "expired" });
    insertMemory(db, { status: "expired", expires_at: new Date(Date.now() - 86_400_000).toISOString() });

    const stats = getMemoryStats(db);

    // `--status expired` is a pure status match: exactly the two
    // status='expired' rows, regardless of their expires_at.
    expect(stats.expired_count).toBe(2);
    // Every row carrying an expiry date is counted separately, whether the
    // date is past or future, active or expired.
    expect(stats.expires_at_count).toBe(3);
  });

  test("expires_at_count counts all rows carrying an expiry date, future or past", () => {
    const db = getDatabase(":memory:");
    insertMemory(db, { expires_at: new Date(Date.now() - 86_400_000).toISOString() });
    insertMemory(db, { expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    insertMemory(db, {}); // no expiry

    const stats = getMemoryStats(db);

    expect(stats.expires_at_count).toBe(2);
    expect(stats.expired_count).toBe(0);
  });

  test("archived rows with expiry dates do not affect expired_count", () => {
    const db = getDatabase(":memory:");
    insertMemory(db, { status: "archived", expires_at: new Date(Date.now() - 86_400_000).toISOString() });

    const stats = getMemoryStats(db);

    expect(stats.expired_count).toBe(0);
    expect(stats.expires_at_count).toBe(1);
  });
});
