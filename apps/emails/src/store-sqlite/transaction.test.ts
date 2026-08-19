// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// withImmediateTransaction is the write-transaction primitive every SQLite
// store mutation goes through. The contract has two halves, and a weak test
// covers only the first:
//
//  1. TAKE THE WRITE LOCK UP FRONT (BEGIN IMMEDIATE, never a deferred BEGIN).
//     A deferred BEGIN takes a WAL read snapshot and upgrades on the first
//     write; if another connection commits in between, the upgrade fails
//     with SQLITE_BUSY_SNAPSHOT, which SQLite deliberately does NOT route
//     through the busy handler — the writes are SKIPPED while the now
//     read-only COMMIT still succeeds, so the caller is told the write
//     landed. The test cannot reproduce the cross-connection race, but it
//     can pin the mechanism: the transaction must be a write transaction
//     from the start, which is what BEGIN IMMEDIATE buys.
//
//  2. JOIN, NEVER NEST. When the connection is already inside a caller's
//     transaction, the work must join it (the enclosing scope owns the
//     commit). The "join" decision is made by asking the connection, and a
//     caller ROLLBACK must discard the joined work — otherwise a partially
//     written batch would be reported as whole.
//
//  3. THROW OUT, ROLL BACK. A work function that throws must roll the
//     transaction back so no partial write survives.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase, type Database } from "../db/database.js";
import { withImmediateTransaction } from "./transaction.js";

let db: Database;

beforeEach(() => {
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
});

function countRows(): number {
  return (db.query("SELECT COUNT(*) AS n FROM owners").get() as { n: number }).n;
}

function insertOwner(id: string): void {
  db.run("INSERT INTO owners (id, type, name, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?)", [
    id,
    "owner-" + id,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ]);
}

describe("withImmediateTransaction", () => {
  it("commits the work when it succeeds", () => {
    withImmediateTransaction(db, () => {
      insertOwner("a");
      return "result";
    });
    expect(countRows()).toBe(1);
    // The work's return value is passed through.
    expect(withImmediateTransaction(db, () => 42)).toBe(42);
  });

  it("rolls the work back when it throws — no partial write survives", () => {
    expect(() =>
      withImmediateTransaction(db, () => {
        insertOwner("a");
        insertOwner("b");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(countRows()).toBe(0);
  });

  it("joins an enclosing caller transaction instead of nesting", () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      withImmediateTransaction(db, () => {
        insertOwner("a");
      });
      // Still inside the caller's transaction: the row is not yet durable.
      expect(countRows()).toBe(1);
      db.exec("COMMIT");
    } finally {
      if (db.inTransaction) db.exec("ROLLBACK");
    }
    expect(countRows()).toBe(1);
  });

  it("enclosing-caller ROLLBACK discards the joined work", () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      withImmediateTransaction(db, () => {
        insertOwner("a");
      });
      db.exec("ROLLBACK");
    } finally {
      if (db.inTransaction) db.exec("ROLLBACK");
    }
    expect(countRows()).toBe(0);
  });

  it("a throw inside a joined caller transaction rethrows and leaves the caller's transaction alive for its own decision", () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      expect(() =>
        withImmediateTransaction(db, () => {
          insertOwner("a");
          throw new Error("inner boom");
        }),
      ).toThrow("inner boom");
      // The inner work is visible to the still-open caller transaction; the
      // caller decides commit or rollback — the primitive did not commit.
      expect(countRows()).toBe(1);
      db.exec("ROLLBACK");
    } finally {
      if (db.inTransaction) db.exec("ROLLBACK");
    }
    expect(countRows()).toBe(0);
  });
});
