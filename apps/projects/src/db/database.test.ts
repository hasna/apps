import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, getDbPath, resolvePartialId, now, uuid } from "./database.js";
import { runMigrations } from "./schema.js";
import { createWorkspace } from "./workspaces.js";

const DATABASE_SRC = join(import.meta.dir, "database.ts");

function busyTimeoutMs(db: Database): number {
  const row = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
  return row?.timeout ?? -1;
}

function holderScript(): string {
  return `
import { writeFileSync, existsSync } from "node:fs";
import { getDatabase } from ${JSON.stringify(DATABASE_SRC)};
const dbPath = process.env["REGRESSION_DB_PATH"]!;
const heldMarker = process.env["REGRESSION_HELD_MARKER"]!;
const startMarker = process.env["REGRESSION_START_MARKER"]!;
const db = getDatabase(dbPath);
db.run("BEGIN IMMEDIATE");
db.run("INSERT INTO workspaces (id, slug, name) VALUES ('wks_proc_holder', 'proc-holder', 'Holder')");
writeFileSync(heldMarker, "1");
const deadline = Date.now() + 30_000;
while (!existsSync(startMarker)) {
  if (Date.now() > deadline) {
    console.error("holder: timed out waiting for the writer start marker");
    process.exit(2);
  }
  await Bun.sleep(10);
}
await Bun.sleep(500); // grace so the writer is mid-write (blocked on the lock) when we commit
db.run("COMMIT");
db.close();
`;
}

function writerScript(): string {
  return `
import { writeFileSync } from "node:fs";
import { getDatabase } from ${JSON.stringify(DATABASE_SRC)};
const dbPath = process.env["REGRESSION_DB_PATH"]!;
const startMarker = process.env["REGRESSION_START_MARKER"]!;
try {
  writeFileSync(startMarker, "1"); // signal the holder before attempting the write
  const db = getDatabase(dbPath);
  db.run("INSERT INTO workspaces (id, slug, name) VALUES ('wks_proc_writer', 'proc-writer', 'Writer')");
  console.log("WRITER OK");
  db.close();
} catch (e) {
  console.error("WRITER LOCKED: " + String(e));
  process.exit(1);
}
`;
}

describe("database", () => {
  afterEach(() => {
    closeDatabase();
    delete process.env["HASNA_WORKSPACES_DB_PATH"];
    delete process.env["HASNA_PROJECTS_DB_PATH"];
    delete process.env["HASNA_PROJECTS_HOME"];
    delete process.env["HASNA_DATA_HOME"];
  });

  describe("getDatabase", () => {
    test("creates in-memory database", () => {
      const db = new Database(":memory:");
      runMigrations(db);
      expect(db).toBeDefined();
      db.close();
    });

    test("creates database at custom path with auto-created directory", () => {
      const tmp = mkdtempSync(join(tmpdir(), "db-test-"));
      const dbPath = join(tmp, "nested", "dir", "test.db");
      expect(existsSync(join(tmp, "nested"))).toBe(false);

      const db = getDatabase(dbPath);
      expect(db).toBeDefined();
      expect(existsSync(dbPath)).toBe(true);

      db.close();
      rmSync(tmp, { recursive: true });
    });

    test("reopens the cached default database when HASNA_PROJECTS_DB_PATH changes", () => {
      const tmp = mkdtempSync(join(tmpdir(), "db-switch-"));
      const firstPath = join(tmp, "first.db");
      const secondPath = join(tmp, "second.db");

      process.env["HASNA_PROJECTS_DB_PATH"] = firstPath;
      const first = getDatabase();
      createWorkspace({ name: "First", slug: "first", kind: "generic" });

      process.env["HASNA_PROJECTS_DB_PATH"] = secondPath;
      const second = getDatabase();
      createWorkspace({ name: "Second", slug: "second", kind: "generic" });

      expect(first).not.toBe(second);
      expect(resolvePartialId("second")).toBeTruthy();
      expect(existsSync(firstPath)).toBe(true);
      expect(existsSync(secondPath)).toBe(true);

      rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("busy_timeout", () => {
    test("sets busy_timeout=5000 on path-opened connections", () => {
      const tmp = mkdtempSync(join(tmpdir(), "db-timeout-path-"));
      const dbPath = join(tmp, "registry.db");
      const db = getDatabase(dbPath);
      expect(busyTimeoutMs(db)).toBe(5000);
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    });

    test("sets busy_timeout=5000 on the cached default connection", () => {
      const tmp = mkdtempSync(join(tmpdir(), "db-timeout-default-"));
      const dbPath = join(tmp, "registry.db");
      process.env["HASNA_PROJECTS_DB_PATH"] = dbPath;
      const db = getDatabase();
      expect(busyTimeoutMs(db)).toBe(5000);
      closeDatabase();
      rmSync(tmp, { recursive: true, force: true });
    });

    test("a second concurrent writer waits for the write lock instead of failing immediately", () => {
      const tmp = mkdtempSync(join(tmpdir(), "db-busy-wait-"));
      const dbPath = join(tmp, "registry.db");
      const holder = getDatabase(dbPath);
      // Acquire and hold the write lock.
      holder.run("BEGIN IMMEDIATE");
      holder.run(
        "INSERT INTO workspaces (id, slug, name) VALUES ('wks_hold1', 'hold1', 'Hold One')",
      );

      const writer = getDatabase(dbPath);
      const start = performance.now();
      let error: string | null = null;
      try {
        writer.run(
          "INSERT INTO workspaces (id, slug, name) VALUES ('wks_hold2', 'hold2', 'Hold Two')",
        );
      } catch (e) {
        error = String(e);
      }
      const elapsed = performance.now() - start;

      holder.run("COMMIT");
      holder.close();
      writer.close();

      // Without busy_timeout (default 0ms) the second writer fails immediately
      // with SQLITE_BUSY ("database is locked"). With busy_timeout=5000 it
      // blocks for the full timeout before giving up.
      expect(error).not.toBeNull();
      expect(error).toContain("database is locked");
      expect(elapsed).toBeGreaterThan(1000);
      rmSync(tmp, { recursive: true, force: true });
    }, 15_000);

    test("two concurrent writers against one registry DB both succeed", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "db-busy-proc-"));
      const dbPath = join(tmp, "registry.db");
      const heldMarker = join(tmp, "held.marker");
      const startMarker = join(tmp, "start.marker");
      const env = {
        ...process.env,
        REGRESSION_DB_PATH: dbPath,
        REGRESSION_HELD_MARKER: heldMarker,
        REGRESSION_START_MARKER: startMarker,
      };

      // Writer 1 (holder): acquires the write lock and releases it only after
      // writer 2 signals it has started its write, so writer 2 is blocked
      // mid-write when the lock is released.
      const holder = Bun.spawn({
        cmd: [process.execPath, "-e", holderScript()],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const heldDeadline = Date.now() + 15_000;
      while (!existsSync(heldMarker)) {
        if (Date.now() > heldDeadline) {
          holder.kill();
          throw new Error("holder never acquired the write lock");
        }
        await Bun.sleep(20);
      }

      // Writer 2: signals it is starting, then writes; on unfixed code this
      // fails immediately with SQLITE_BUSY, on fixed code it waits for the
      // holder to commit.
      const writer = Bun.spawn({
        cmd: [process.execPath, "-e", writerScript()],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const killTimer = setTimeout(() => writer.kill(), 60_000);
      const [stdout, stderr] = await Promise.all([
        new Response(writer.stdout).text(),
        new Response(writer.stderr).text(),
      ]);
      const writerExit = await writer.exited;
      clearTimeout(killTimer);
      const holderExit = await holder.exited;

      expect(holderExit).toBe(0);
      expect(writerExit).toBe(0);
      expect(stdout).toContain("WRITER OK");
      if (writerExit !== 0) console.error(stderr);

      // Both writes must have landed.
      const db = getDatabase(dbPath);
      const row = db
        .query<{ id: string }, []>("SELECT id FROM workspaces WHERE id = 'wks_proc_writer'")
        .get();
      expect(row?.id).toBe("wks_proc_writer");
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    }, 90_000);
  });

  describe("getDbPath", () => {
    test("uses HASNA_PROJECTS_DB_PATH env var", () => {
      process.env["HASNA_PROJECTS_DB_PATH"] = "/custom/env.db";
      expect(getDbPath()).toBe("/custom/env.db");
      delete process.env["HASNA_PROJECTS_DB_PATH"];
    });

    test("keeps HASNA_WORKSPACES_DB_PATH as a legacy fallback", () => {
      process.env["HASNA_WORKSPACES_DB_PATH"] = "/custom/legacy.db";
      expect(getDbPath()).toBe("/custom/legacy.db");
      process.env["HASNA_PROJECTS_DB_PATH"] = "/custom/project.db";
      expect(getDbPath()).toBe("/custom/project.db");
    });

    test("returns default path when no env vars", () => {
      delete process.env["HASNA_DATA_HOME"];
      delete process.env["HASNA_PROJECTS_HOME"];
      const path = getDbPath();
      expect(path).toBe(join(process.env["HOME"]!, ".hasna", "projects", "projects.db"));
    });

    test("routes the default DB to the resolver data home when HASNA_DATA_HOME is set", () => {
      const base = mkdtempSync(join(tmpdir(), "db-xdg-"));
      try {
        process.env["HASNA_DATA_HOME"] = base;
        const path = getDbPath();
        expect(path).toBe(join(base, "projects", "projects.db"));
      } finally {
        delete process.env["HASNA_DATA_HOME"];
        rmSync(base, { recursive: true, force: true });
      }
    });
  });

  describe("now and uuid", () => {
    test("now returns ISO-like timestamp", () => {
      const t = now();
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/);
    });

    test("uuid returns a valid UUID", () => {
      const id = uuid();
      expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    });
  });

  describe("resolvePartialId", () => {
    test("returns null for short partial ids", () => {
      const db = getDatabase(":memory:");
      expect(resolvePartialId("abc", db)).toBeNull();
      expect(resolvePartialId("ab", db)).toBeNull();
    });

    test("returns null when no workspace exists", () => {
      const db = getDatabase(":memory:");
      expect(resolvePartialId("wks_1234", db)).toBeNull();
    });

    test("matches partial id prefix", () => {
      const db = getDatabase(":memory:");
      const dir = mkdtempSync(join(tmpdir(), "db-partial-"));
      const workspace = createWorkspace({ name: "Partial", primary_path: dir, kind: "generic" }, db);
      const partial = workspace.id.slice(0, 8);
      const result = resolvePartialId(partial, db);
      expect(result).toBe(workspace.id);
      rmSync(dir, { recursive: true });
      db.close();
    });
  });
});
