import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, test } from "bun:test";
import { SqliteAdapter } from "../src/db/sqlite-adapter";

const createdPaths: string[] = [];

function tempDbPath(): string {
  const path = `/tmp/hasna-gateway-sqlite-adapter-${crypto.randomUUID()}.db`;
  createdPaths.push(path);
  return path;
}

afterEach(async () => {
  const paths = createdPaths.splice(0, createdPaths.length);
  await Promise.all(
    paths.flatMap((path) =>
      [path, `${path}-shm`, `${path}-wal`].map((file) => unlink(file).catch(() => undefined)),
    ),
  );
});

describe("SqliteAdapter", () => {
  test("creates the database file and round-trips rows through run and all", () => {
    const db = new SqliteAdapter(tempDbPath());
    try {
      db.exec("CREATE TABLE ledger (id TEXT PRIMARY KEY, amount REAL)");
      const result = db.run("INSERT INTO ledger (id, amount) VALUES (?, ?)", "a", 1.5);
      expect(result.changes).toBe(1);
      expect(db.all("SELECT id, amount FROM ledger")).toEqual([{ id: "a", amount: 1.5 }]);
    } finally {
      db.close();
    }
  });

  test("enables WAL journalling so ledger readers do not block the writer", () => {
    const db = new SqliteAdapter(tempDbPath());
    try {
      expect(db.all("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }]);
    } finally {
      db.close();
    }
  });

  // Foreign key enforcement is per-connection and OFF by default in SQLite, so losing the
  // PRAGMA would not raise an error anywhere — it would silently downgrade every
  // ON DELETE CASCADE into a no-op and leave orphaned rows behind.
  test("enables foreign key enforcement on every connection", () => {
    const db = new SqliteAdapter(tempDbPath());
    try {
      expect(db.all("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    } finally {
      db.close();
    }
  });

  test("actually cascades deletes to child rows", () => {
    const path = tempDbPath();
    const db = new SqliteAdapter(path);
    try {
      db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY)");
      db.exec(
        "CREATE TABLE run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE)",
      );
      db.run("INSERT INTO runs (id) VALUES (?)", "run-1");
      db.run("INSERT INTO run_events (id, run_id) VALUES (?, ?)", "event-1", "run-1");
      expect(db.all("SELECT id FROM run_events")).toHaveLength(1);

      db.run("DELETE FROM runs WHERE id = ?", "run-1");
      expect(db.all("SELECT id FROM run_events")).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("rejects a child row that references a missing parent", () => {
    const db = new SqliteAdapter(tempDbPath());
    try {
      db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY)");
      db.exec(
        "CREATE TABLE run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE)",
      );
      expect(() => db.run("INSERT INTO run_events (id, run_id) VALUES (?, ?)", "event-1", "nope")).toThrow();
    } finally {
      db.close();
    }
  });

  test("reopens an existing database file without truncating it", () => {
    const path = tempDbPath();
    const first = new SqliteAdapter(path);
    try {
      first.exec("CREATE TABLE ledger (id TEXT PRIMARY KEY)");
      first.run("INSERT INTO ledger (id) VALUES (?)", "kept");
    } finally {
      first.close();
    }

    const second = new SqliteAdapter(path);
    try {
      expect(second.all("SELECT id FROM ledger")).toEqual([{ id: "kept" }]);
    } finally {
      second.close();
    }
  });
});
