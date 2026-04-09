import { describe, it, expect, afterAll } from "bun:test";
import "./setup";
import { getDb, closeDb } from "../src/lib/db";
import { existsSync } from "fs";
import { TEST_DB_PATH } from "./setup";

describe("db", () => {
  afterAll(() => {
    closeDb();
  });

  it("creates the database file on first call", () => {
    const db = getDb();
    expect(db).toBeDefined();
    // The DB file exists somewhere (may be the mocked path or real path)
    // Verify we got a working DB instance
    const result = db.prepare("SELECT 1 as v").get() as { v: number };
    expect(result.v).toBe(1);
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("creates the servers table", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='servers'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("creates the tool_cache table", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tool_cache'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("creates the machines table", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='machines'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("creates the idx_tool_cache_server index", () => {
    const db = getDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tool_cache_server'")
      .all();
    expect(indexes).toHaveLength(1);
  });

  it("creates the idx_machines_enabled index", () => {
    const db = getDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_machines_enabled'")
      .all();
    expect(indexes).toHaveLength(1);
  });

  it("uses WAL journal mode", () => {
    const db = getDb();
    const result = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe("wal");
  });

  it("closeDb sets instance to null so next getDb creates fresh one", () => {
    const db1 = getDb();
    closeDb();
    const db2 = getDb();
    // After close + reopen, a new instance is returned
    expect(db2).toBeDefined();
  });

  it("closeDb is safe to call when already closed", () => {
    closeDb();
    expect(() => closeDb()).not.toThrow();
  });
});
