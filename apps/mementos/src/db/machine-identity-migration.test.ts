import { describe, expect, test } from "bun:test";
import { SqliteAdapter } from "../storage.js";
import { applyMachineIdentityMigration } from "./database.js";

function legacyDb(): SqliteAdapter {
  const db = new SqliteAdapter(":memory:");
  db.exec(`
    CREATE TABLE machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      hostname TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX idx_machines_hostname ON machines(hostname);
    CREATE TABLE memories (id TEXT PRIMARY KEY, machine_id TEXT REFERENCES machines(id) ON DELETE SET NULL);
    CREATE TABLE _migrations (id INTEGER PRIMARY KEY);
  `);
  return db;
}


describe("machine identity migration", () => {
  test("canonicalizes a valid legacy hostname without changing stable ids or attribution", () => {
    const db = legacyDb();
    db.run(
      "INSERT INTO machines VALUES (?, ?, ?, ?, ?, ?, ?)",
      "stable-id", "machine", " HOST.EXAMPLE. ", "linux", 1,
      "2026-01-01 00:00:00", "2026-01-01 00:00:00",
    );
    db.run("INSERT INTO memories VALUES (?, ?)", "memory-id", "stable-id");

    applyMachineIdentityMigration(db as any);

    expect(db.query("SELECT id, hostname, is_primary FROM machines").all()).toEqual([
      { id: "stable-id", hostname: "host.example", is_primary: 1 },
    ]);
    expect(db.query("SELECT machine_id FROM memories WHERE id = ?").get("memory-id")).toEqual({ machine_id: "stable-id" });
    expect(() => db.run(
      "INSERT INTO machines (id, name, hostname, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      "duplicate", "duplicate", "host.example", "linux", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z",
    )).toThrow();
    expect(() => db.run(
      "INSERT INTO machines (id, name, hostname, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      "noncanonical", "noncanonical", "HOST.EXAMPLE.", "linux", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z",
    )).toThrow("canonical");
    expect(() => db.run(
      "INSERT INTO machines (id, name, hostname, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      "control-name", "bad\nname", "control-name", "linux", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z",
    )).toThrow("runtime contract");
    expect(() => db.run(
      "INSERT INTO machines (id, name, hostname, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      "reverse-time", "reverse-time", "reverse-time", "linux", "2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
    )).toThrow("runtime contract");
    db.close();
  });

  test("refuses canonical hostname collisions without deleting or re-pointing rows", () => {
    const db = legacyDb();
    db.run("INSERT INTO machines VALUES (?, ?, ?, ?, 0, ?, ?)", "first", "first", "host", "linux", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.run("INSERT INTO machines VALUES (?, ?, ?, ?, 0, ?, ?)", "second", "second", " HOST. ", "linux", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
    db.run("INSERT INTO memories VALUES (?, ?)", "memory-id", "second");

    expect(() => applyMachineIdentityMigration(db as any)).toThrow();
    expect(db.query("SELECT id, hostname FROM machines ORDER BY id").all()).toEqual([
      { id: "first", hostname: "host" },
      { id: "second", hostname: " HOST. " },
    ]);
    expect(db.query("SELECT machine_id FROM memories WHERE id = ?").get("memory-id")).toEqual({ machine_id: "second" });
    expect(db.query("SELECT id FROM _migrations WHERE id = 41").get()).toBeNull();
    db.close();
  });

  test("refuses legacy multiple-primary state transactionally", () => {
    const db = legacyDb();
    db.run("INSERT INTO machines VALUES (?, ?, ?, ?, 1, ?, ?)", "first", "first", "first", "linux", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.run("INSERT INTO machines VALUES (?, ?, ?, ?, 1, ?, ?)", "second", "second", "second", "linux", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");

    expect(() => applyMachineIdentityMigration(db as any)).toThrow();
    expect(db.query("SELECT id FROM machines WHERE is_primary = 1 ORDER BY id").all()).toEqual([{ id: "first" }, { id: "second" }]);
    expect(db.query("SELECT id FROM _migrations WHERE id = 41").get()).toBeNull();
    db.close();
  });
  test.each([
    {
      label: "control-character display name",
      name: "unsafe\nname",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    {
      label: "last_seen_at earlier than created_at",
      name: "valid-name",
      createdAt: "2026-02-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
  ])("refuses $label and rolls back rows, attribution, indexes, and receipt", ({ name, createdAt, lastSeenAt }) => {
    const db = legacyDb();
    db.run(
      "INSERT INTO machines VALUES (?, ?, ?, ?, 0, ?, ?)",
      "invalid-id", name, " INVALID-HOST. ", "linux", createdAt, lastSeenAt,
    );
    db.run("INSERT INTO memories VALUES (?, ?)", "memory-id", "invalid-id");
    const before = db.query("SELECT * FROM machines WHERE id = ?").get("invalid-id");

    expect(() => applyMachineIdentityMigration(db as any)).toThrow("invalid legacy machine row");

    expect(db.query("SELECT * FROM machines WHERE id = ?").get("invalid-id")).toEqual(before);
    expect(db.query("SELECT machine_id FROM memories WHERE id = ?").get("memory-id")).toEqual({ machine_id: "invalid-id" });
    expect(db.query("SELECT id FROM _migrations WHERE id = 41").get()).toBeNull();
    const hostnameIndex = db.query("PRAGMA index_list(machines)").all() as Array<{ name: string; unique: number }>;
    expect(hostnameIndex.find((index) => index.name === "idx_machines_hostname")?.unique).toBe(0);
    db.close();
  });

});
