// Regression: mementos stats `expired_count` must count the rows returned by
// `--status expired` (status = 'expired'), never rows that merely carry an
// `expires_at` date.
//
// Measured on the live store (2026-08-17): `mementos stats --format json`
// reported `expired_count: 876` and `by_status: {..., expired: 0}` while
// `mementos list --status expired --format json` returned [] — 876 rows carry
// an `expires_at` value (873 genuinely past due, 3 future) but zero rows have
// status = 'expired' (no lifecycle path ever transitions status to 'expired';
// cleanExpiredMemories deletes instead). A machine-read stats consumer would
// report 876 expired memories that do not exist.
//
// The corrected contract, per the issue:
//   - expired_count     == rows with status = 'expired' (what --status expired returns)
//   - expires_at_count  == rows carrying any expires_at value (new field)
//   - expired_due_count == rows status='expired' OR expires_at in the past (new
//                          field, preserves the old SQL's retention-backlog meaning)

import { describe, it, expect } from "bun:test";
import { SqliteAdapter as Database } from "../storage.js";
import { getMemoryStats } from "./analytics.js";

function freshDb(): Database {
  const db = new Database(":memory:", { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'knowledge',
      scope TEXT NOT NULL DEFAULT 'private',
      summary TEXT,
      tags TEXT DEFAULT '[]',
      importance INTEGER NOT NULL DEFAULT 5,
      source TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'expired')),
      pinned INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT,
      project_id TEXT,
      session_id TEXT,
      machine_id TEXT,
      flag TEXT,
      when_to_use TEXT DEFAULT NULL,
      sequence_group TEXT DEFAULT NULL,
      sequence_order INTEGER DEFAULT NULL,
      metadata TEXT DEFAULT '{}',
      access_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      valid_from TEXT DEFAULT NULL,
      valid_until TEXT DEFAULT NULL,
      ingested_at TEXT DEFAULT NULL,
      namespace TEXT DEFAULT NULL,
      created_by_agent TEXT DEFAULT NULL,
      updated_by_agent TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      accessed_at TEXT
    );
  `);
  return db;
}

function insert(
  db: Database,
  row: { id: string; status: string; expires_at: string | null },
): void {
  db.run(
    `INSERT INTO memories (id, key, value, status, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [row.id, `key-${row.id}`, "value", row.status, row.expires_at],
  );
}

describe("getMemoryStats expiry fields", () => {
  it("expired_count matches --status expired (status='expired' rows only), never rows that merely carry an expires_at date", () => {
    const db = freshDb();
    // The exact bug shape from the live store:
    insert(db, { id: "active-no-expiry", status: "active", expires_at: null });
    insert(db, { id: "active-future-expiry", status: "active", expires_at: "2099-01-01T00:00:00.000Z" });
    insert(db, { id: "active-past-expiry", status: "active", expires_at: "2026-08-12T12:48:03.354Z" });
    insert(db, { id: "archived-no-expiry", status: "archived", expires_at: null });
    insert(db, { id: "expired-status-row", status: "expired", expires_at: null });

    const stats = getMemoryStats(db);

    // The contradiction the issue names: --status expired returns only the
    // status='expired' row, so expired_count must be 1 — not 2 (past-due) and
    // not 3 (any expires_at).
    expect(stats.expired_count).toBe(1);
    // The two rows carrying a (future or past) expiry date land in the new
    // explicitly named field instead.
    expect(stats.expires_at_count).toBe(2);
    // Retention backlog: status='expired' OR past-due expiry.
    expect(stats.expired_due_count).toBe(2);
    // by_status buckets partition `total` (active only) — pre-existing
    // invariant; expired rows are not in the active partition.
    expect(stats.by_status.expired).toBe(0);
    expect(stats.total).toBe(3);
    expect(stats.by_status.active).toBe(3);
  });

  it("a memory with only a future expires_at is not expired by any field", () => {
    const db = freshDb();
    insert(db, { id: "future-only", status: "active", expires_at: "2099-01-01T00:00:00.000Z" });

    const stats = getMemoryStats(db);
    expect(stats.expired_count).toBe(0);
    expect(stats.expired_due_count).toBe(0);
    expect(stats.expires_at_count).toBe(1);
    expect(stats.total).toBe(1);
  });
});
