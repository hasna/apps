process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect } from "bun:test";
import { SqliteAdapter as Database } from "../storage.js";
import {
  resolveVisibleMachineId,
  visibleToMachineFilter,
  isMemoryVisibleToMachine,
  MachineIdentityUnresolvedError,
} from "./machine-visibility.js";

function freshDb(): Database {
  const db = new Database(":memory:", { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      hostname TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_machines_hostname ON machines(hostname);
  `);

  return db;
}

// ============================================================================
// resolveVisibleMachineId
// ============================================================================

describe("resolveVisibleMachineId", () => {
  it("returns explicit machineId when provided", () => {
    const db = freshDb();
    expect(resolveVisibleMachineId("explicit-id", db)).toBe("explicit-id");
    expect(resolveVisibleMachineId(null, db)).toBe(null);
    db.close();
  });

  it("returns null when no db and no machineId", () => {
    // resolveVisibleMachineId() tries getCurrentMachineId(db) with no db,
    // which will attempt to open a real DB — if it succeeds, it returns an id.
    // So the only guaranteed null is when we pass null explicitly.
    expect(resolveVisibleMachineId(null)).toBe(null);
  });

  it("auto-registers and returns machine id from db", () => {
    const db = freshDb();
    const id = resolveVisibleMachineId(undefined, db);
    expect(typeof id).toBe("string");
    // Calling again should return same id (idempotent registration)
    const id2 = resolveVisibleMachineId(undefined, db);
    expect(id2).toBe(id);
    db.close();
  });

  // FAIL CLOSED (P0, 2026-09-11). This test previously asserted
  // `resolveVisibleMachineId(undefined, brokenDb) === null`, i.e. the failure
  // was swallowed into a value indistinguishable from an explicit null — and
  // the two transports read that null in OPPOSITE ways (local: machine_id IS
  // NULL, hiding everything scoped; hosted: the param is dropped, so no filter
  // is applied and other machines' memories come back). Refusing is the only
  // answer that is safe on both.
  it("REFUSES when this machine's identity cannot be resolved", () => {
    // Without the machines table, getCurrentMachineId throws.
    const db = new Database(":memory:", { create: true });
    expect(() => resolveVisibleMachineId(undefined, db)).toThrow(MachineIdentityUnresolvedError);
    expect(() => resolveVisibleMachineId(undefined, db)).toThrow(/could not resolve this machine's identity/);
    db.close();
  });

  it("an EXPLICIT null is still honoured — the deliberate unscoped view keeps working", () => {
    const db = new Database(":memory:", { create: true });
    // Same broken store: the explicit argument never consults the machine table.
    expect(resolveVisibleMachineId(null, db)).toBe(null);
    expect(resolveVisibleMachineId("explicit-id", db)).toBe("explicit-id");
    db.close();
  });

  it("the refusal carries the cause so an operator can see WHY", () => {
    const db = new Database(":memory:", { create: true });
    try {
      resolveVisibleMachineId(undefined, db);
      throw new Error("expected a refusal");
    } catch (e) {
      expect(e).toBeInstanceOf(MachineIdentityUnresolvedError);
      expect((e as MachineIdentityUnresolvedError).code).toBe("MEMENTOS_MACHINE_IDENTITY_UNRESOLVED");
      expect((e as MachineIdentityUnresolvedError).cause).toBeDefined();
    }
    db.close();
  });
});

// ============================================================================
// visibleToMachineFilter
// ============================================================================

describe("visibleToMachineFilter", () => {
  it("returns filter with explicit machineId", () => {
    const db = freshDb();
    const filter = visibleToMachineFilter("machine-123", db);
    expect(filter.visible_to_machine_id).toBe("machine-123");
    db.close();
  });

  it("returns filter with null when no machineId", () => {
    const db = freshDb();
    const filter = visibleToMachineFilter(null, db);
    expect(filter.visible_to_machine_id).toBe(null);
    db.close();
  });

  it("auto-detects machineId from db", () => {
    const db = freshDb();
    const filter = visibleToMachineFilter(undefined, db);
    expect(typeof filter.visible_to_machine_id).toBe("string");
    db.close();
  });

  it("REFUSES rather than emitting a filter it cannot justify", () => {
    // The filter is where the damage happened: a null here silently becomes
    // "no machine filter" on the hosted transport.
    const db = new Database(":memory:", { create: true });
    expect(() => visibleToMachineFilter(undefined, db)).toThrow(MachineIdentityUnresolvedError);
    db.close();
  });
});

// ============================================================================
// isMemoryVisibleToMachine
// ============================================================================

describe("isMemoryVisibleToMachine", () => {
  it("memory without machine_id is visible to all", () => {
    const db = freshDb();
    const memory = { machine_id: null } as { machine_id: string | null };
    expect(isMemoryVisibleToMachine(memory, "any-machine", db)).toBe(true);
    expect(isMemoryVisibleToMachine(memory, undefined, db)).toBe(true);
    db.close();
  });

  it("memory with matching machine_id is visible", () => {
    const db = freshDb();
    const id = resolveVisibleMachineId(undefined, db);
    const memory = { machine_id: id } as { machine_id: string | null };
    expect(isMemoryVisibleToMachine(memory, id, db)).toBe(true);
    db.close();
  });

  it("memory with different machine_id is not visible", () => {
    const db = freshDb();
    expect(isMemoryVisibleToMachine({ machine_id: "other-machine" }, "my-machine", db)).toBe(false);
    db.close();
  });

  // The predicate stays TOTAL: for a machine-scoped memory, "not visible" is
  // already the closed answer, so it absorbs the refusal rather than throwing.
  it("returns false when db can't resolve machineId", () => {
    const db = new Database(":memory:", { create: true });
    const memory = { machine_id: "some-machine" } as { machine_id: string | null };
    expect(isMemoryVisibleToMachine(memory, undefined, db)).toBe(false);
    db.close();
  });

  it("returns false when machineId resolves to null", () => {
    const db = freshDb();
    const memory = { machine_id: "some-machine" } as { machine_id: string | null };
    expect(isMemoryVisibleToMachine(memory, null, db)).toBe(false);
    db.close();
  });
});
