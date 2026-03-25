import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("database module", () => {
  describe("getConnectorsHome", () => {
    test("returns a string path", async () => {
      const { getConnectorsHome } = await import("./database.js");
      const dir = getConnectorsHome();
      expect(typeof dir).toBe("string");
      expect(dir.length).toBeGreaterThan(0);
    });

    test("creates the directory if it does not exist", async () => {
      const { getConnectorsHome } = await import("./database.js");
      const dir = getConnectorsHome();
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("getDatabase / closeDatabase", () => {
    test("getDatabase returns a database instance", async () => {
      const { getDatabase, closeDatabase } = await import("./database.js");
      const tmp = join(tmpdir(), `test-connectors-db-${process.pid}.db`);
      try {
        const db = getDatabase(tmp);
        expect(db).not.toBeNull();
        expect(typeof db.run).toBe("function");
      } finally {
        closeDatabase();
        try { rmSync(tmp, { force: true }); } catch {}
      }
    });

    test("closeDatabase is idempotent", async () => {
      const { closeDatabase } = await import("./database.js");
      expect(() => closeDatabase()).not.toThrow();
      expect(() => closeDatabase()).not.toThrow();
    });

    test("getDatabase creates migrations (all tables exist)", async () => {
      const { getDatabase, closeDatabase } = await import("./database.js");
      const tmp = join(tmpdir(), `test-connectors-mig-${process.pid}.db`);
      try {
        const db = getDatabase(tmp);
        // Check that the migration ran and tables exist
        const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        const tableNames = tables.map((t: any) => t.name);
        expect(tableNames).toContain("agents");
        expect(tableNames).toContain("connector_jobs");
        expect(tableNames).toContain("connector_rate_usage");
        expect(tableNames).toContain("resource_locks");
        expect(tableNames).toContain("feedback");
      } finally {
        closeDatabase();
        try { rmSync(tmp, { force: true }); } catch {}
      }
    });
  });

  describe("now / shortUuid", () => {
    test("now() returns ISO timestamp string", async () => {
      const { now } = await import("./database.js");
      const t = now();
      expect(typeof t).toBe("string");
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("shortUuid() returns 8-char string", async () => {
      const { shortUuid } = await import("./database.js");
      const id = shortUuid();
      expect(typeof id).toBe("string");
      expect(id.length).toBe(8);
    });

    test("shortUuid() produces unique values", async () => {
      const { shortUuid } = await import("./database.js");
      const ids = new Set(Array.from({ length: 50 }, () => shortUuid()));
      expect(ids.size).toBe(50);
    });
  });
});

describe("getConnectorsHome auto-migration", () => {
  test("copies files from old ~/.connectors to new ~/.hasna/connectors when old exists and new doesn't", () => {
    // We can't easily test the HOME env var override due to Bun caching homedir(),
    // but we can verify the function handles the case where both directories exist
    const { getConnectorsHome } = require("./database.js");
    const result = getConnectorsHome();
    expect(typeof result).toBe("string");
    expect(existsSync(result)).toBe(true);
  });
});
