import { describe, test, expect } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import { promoteConnector, demoteConnector, getPromotedConnectors, isPromoted } from "./promotions.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS connector_promotions (
    connector TEXT UNIQUE NOT NULL, promoted_at TEXT NOT NULL
  )`);
  return db;
}

describe("promoteConnector", () => {
  test("promotes a connector", () => {
    const db = makeDb();
    promoteConnector("stripe", db);
    expect(isPromoted("stripe", db)).toBe(true);
  });

  test("idempotent (double promote)", () => {
    const db = makeDb();
    promoteConnector("stripe", db);
    promoteConnector("stripe", db);
    expect(getPromotedConnectors(db)).toHaveLength(1);
  });
});

describe("demoteConnector", () => {
  test("removes promotion", () => {
    const db = makeDb();
    promoteConnector("stripe", db);
    expect(demoteConnector("stripe", db)).toBe(true);
    expect(isPromoted("stripe", db)).toBe(false);
  });

  test("returns false for non-promoted", () => {
    const db = makeDb();
    expect(demoteConnector("nonexistent", db)).toBe(false);
  });
});

describe("getPromotedConnectors", () => {
  test("returns all promoted connectors", () => {
    const db = makeDb();
    promoteConnector("stripe", db);
    promoteConnector("github", db);
    const promoted = getPromotedConnectors(db);
    expect(promoted).toContain("stripe");
    expect(promoted).toContain("github");
    expect(promoted).toHaveLength(2);
  });

  test("returns empty when none promoted", () => {
    const db = makeDb();
    expect(getPromotedConnectors(db)).toEqual([]);
  });
});

describe("isPromoted", () => {
  test("returns false for non-promoted", () => {
    const db = makeDb();
    expect(isPromoted("nope", db)).toBe(false);
  });
});
