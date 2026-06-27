import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
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

    test("getDatabase reopens when called with a different path", async () => {
      const { getDatabase, closeDatabase } = await import("./database.js");
      const tmpA = join(tmpdir(), `test-connectors-a-${process.pid}.db`);
      const tmpB = join(tmpdir(), `test-connectors-b-${process.pid}.db`);
      try {
        const dbA = getDatabase(tmpA);
        const dbB = getDatabase(tmpB);
        expect(dbA).not.toBe(dbB);
      } finally {
        closeDatabase();
        try { rmSync(tmpA, { force: true }); } catch {}
        try { rmSync(tmpB, { force: true }); } catch {}
      }
    });

    test("getDatabase supports :memory: path", async () => {
      const { getDatabase, closeDatabase } = await import("./database.js");
      try {
        const db = getDatabase(":memory:");
        const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'");
        expect(Array.isArray(tables)).toBe(true);
      } finally {
        closeDatabase();
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
  test("copies missing legacy files into an existing ~/.hasna/connectors without overwriting", async () => {
    const originalHome = process.env.HOME;
    const testHome = join(tmpdir(), `connectors-home-migration-${crypto.randomUUID()}`);

    try {
      const targetDir = join(testHome, ".hasna", "connectors");
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, "preserve.json"), "target");

      const legacyConnectorsDir = join(testHome, ".connectors", "connect-github");
      mkdirSync(legacyConnectorsDir, { recursive: true });
      writeFileSync(join(legacyConnectorsDir, "credentials.json"), "legacy-connectors");

      const legacyConnectDir = join(testHome, ".connect", "connect-slack");
      mkdirSync(legacyConnectDir, { recursive: true });
      writeFileSync(join(legacyConnectDir, "credentials.json"), "legacy-connect");
      writeFileSync(join(testHome, ".connect", "preserve.json"), "legacy");

      process.env.HOME = testHome;
      const mod = await import(`./database.js?migration=${crypto.randomUUID()}`);
      const result = mod.getConnectorsHome();

      expect(result).toBe(targetDir);
      expect(readFileSync(join(targetDir, "preserve.json"), "utf8")).toBe("target");
      expect(readFileSync(join(targetDir, "connect-github", "credentials.json"), "utf8")).toBe("legacy-connectors");
      expect(readFileSync(join(targetDir, "connect-slack", "credentials.json"), "utf8")).toBe("legacy-connect");
      expect(existsSync(join(testHome, ".connectors", "connect-github", "credentials.json"))).toBe(true);
      expect(existsSync(join(testHome, ".connect", "connect-slack", "credentials.json"))).toBe(true);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      rmSync(testHome, { recursive: true, force: true });
    }
  });
});
