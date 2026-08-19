import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteAdapter } from "./sqlite-adapter.js";

const adapters: SqliteAdapter[] = [];
const tmpDirs: string[] = [];

function makeAdapter(path: string = ":memory:"): SqliteAdapter {
  const a = new SqliteAdapter(path);
  adapters.push(a);
  return a;
}

/** File-backed database so engine pragmas (WAL) behave as in production. */
function makeFileAdapter(): SqliteAdapter {
  const dir = mkdtempSync(join(tmpdir(), "connectors-sqlite-test-"));
  tmpDirs.push(dir);
  return makeAdapter(join(dir, "test.db"));
}

afterEach(() => {
  while (adapters.length) adapters.pop()?.close();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("SqliteAdapter — statement binding forms", () => {
  test("run/get/all accept the spread form", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    expect(db.run("INSERT INTO t (name) VALUES (?)", "alpha").changes).toBe(1);
    expect((db.get("SELECT name FROM t WHERE id = ?", 1) as { name: string }).name).toBe("alpha");
    expect(db.all("SELECT name FROM t ORDER BY id")).toHaveLength(1);
  });

  test("run/get/all accept the array binding form used by call sites", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO t (name) VALUES (?)", ["beta"]);
    expect((db.get("SELECT name FROM t WHERE id = ?", [1]) as { name: string }).name).toBe("beta");
    const rows = db.all("SELECT name FROM t WHERE name = ?", ["beta"]);
    expect(rows).toHaveLength(1);
  });

  test("run reports lastInsertRowid", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const r = db.run("INSERT INTO t (name) VALUES (?)", "x");
    expect(Number(r.lastInsertRowid)).toBe(1);
    const r2 = db.run("INSERT INTO t (name) VALUES (?)", "y");
    expect(Number(r2.lastInsertRowid)).toBe(2);
  });

  test("run reports changes for updates and deletes", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO t (name) VALUES (?)", "a");
    db.run("INSERT INTO t (name) VALUES (?)", "b");
    expect(db.run("UPDATE t SET name = ? WHERE id = ?", "z", 1).changes).toBe(1);
    expect(db.run("UPDATE t SET name = ? WHERE id = ?", "z", 99).changes).toBe(0);
    expect(db.run("DELETE FROM t WHERE name = ?", "z").changes).toBe(1);
  });
});

describe("SqliteAdapter — prepared statements", () => {
  test("prepare().run/get/all work and finalize is idempotent-safe", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const stmt = db.prepare("INSERT INTO t (name) VALUES (?)");
    stmt.run("one");
    stmt.run(["two"]);
    stmt.finalize();

    const q = db.prepare("SELECT COUNT(*) AS n FROM t");
    expect((q.get() as { n: number }).n).toBe(2);
    expect(q.all()).toHaveLength(1);
    q.finalize();
  });

  test("prepare supports both binding forms like the adapter itself", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const stmt = db.prepare("INSERT INTO t (name) VALUES (?)");
    stmt.run("s");
    stmt.run(["a"]);
    const rows = db.all("SELECT name FROM t ORDER BY id");
    expect(rows.map((r) => (r as { name: string }).name)).toEqual(["s", "a"]);
  });
});

describe("SqliteAdapter — transactions", () => {
  test("transaction commits all writes atomically", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db.transaction(() => {
      db.run("INSERT INTO t (name) VALUES (?)", "a");
      db.run("INSERT INTO t (name) VALUES (?)", "b");
    });
    expect(db.all("SELECT name FROM t")).toHaveLength(2);
  });

  test("transaction rolls back on throw and leaves no partial state", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t (name) VALUES (?)", "a");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.all("SELECT name FROM t")).toHaveLength(0);
  });
});

describe("SqliteAdapter — engine guarantees", () => {
  test("foreign_keys pragma is enabled so FK violations throw", () => {
    const db = makeAdapter();
    db.exec(
      "CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))",
    );
    expect(() => db.run("INSERT INTO child (parent_id) VALUES (?)", 999)).toThrow();
  });

  test("WAL journal mode is set at construction on file-backed databases", () => {
    const db = makeFileAdapter();
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode.toLowerCase()).toBe("wal");
  });

  test(":memory: databases construct cleanly (SQLite reports 'memory' journal mode there)", () => {
    // WAL is impossible on an in-memory DB; the pragma is accepted and reports
    // "memory". The adapter must not throw on this path.
    const db = makeAdapter();
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode.toLowerCase()).toBe("memory");
    db.run("CREATE TABLE t (x INTEGER)");
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 't'")).toHaveLength(1);
  });

  test("exec runs multi-statement DDL", () => {
    const db = makeAdapter();
    db.exec("CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER);");
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    expect(tables.map((t) => (t as { name: string }).name)).toEqual(["a", "b"]);
  });
});
