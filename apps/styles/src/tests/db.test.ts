import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, resetDb, setDbPath, initDb, getDataDir } from "../lib/db.js";

let testDbPath = "";

beforeEach(() => {
  testDbPath = join(tmpdir(), `styles-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  setDbPath(testDbPath);
});

afterEach(() => {
  resetDb();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("db", () => {
  describe("getDataDir", () => {
    test("returns a string path", () => {
      const dir = getDataDir();
      expect(typeof dir).toBe("string");
      expect(dir).toContain(".hasna");
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("initDb", () => {
    test("creates database and returns it", () => {
      const db = initDb();
      expect(db).toBeDefined();
    });
  });

  describe("getDb", () => {
    test("returns cached database on second call", () => {
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
    });

    test("creates all required tables", () => {
      const db = getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("style_profiles");
      expect(tableNames).toContain("preferences");
      expect(tableNames).toContain("project_configs");
      expect(tableNames).toContain("templates");
      expect(tableNames).toContain("health_checks");
      expect(tableNames).toContain("health_violations");
      expect(tableNames).toContain("extracted_style_kits");
      expect(tableNames).toContain("agent_presence");
      expect(tableNames).toContain("feedback");
    });
  });

  describe("resetDb", () => {
    test("closes and nullifies cached db", () => {
      const db = getDb();
      expect(db).toBeDefined();
      resetDb();
      // After reset, getDb should create a new instance
      const db2 = getDb();
      expect(db2).toBeDefined();
    });
  });

  describe("setDbPath", () => {
    test("resets db and changes path", () => {
      getDb();
      const newPath = join(tmpdir(), `styles-db-test-alt-${Date.now()}.db`);
      setDbPath(newPath);
      const db = getDb();
      expect(db).toBeDefined();
      if (existsSync(newPath)) unlinkSync(newPath);
    });
  });
});
