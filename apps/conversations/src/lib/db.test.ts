import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, getDbPath, closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-db-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  delete process.env.CONVERSATIONS_DB_PATH;
});

describe("db", () => {
  test("getDbPath returns env override", () => {
    expect(getDbPath()).toBe(TEST_DB);
  });

  test("getDbPath returns default when no env", () => {
    delete process.env.CONVERSATIONS_DB_PATH;
    const path = getDbPath();
    expect(path).toContain(".conversations");
    expect(path).toEndWith("messages.db");
  });

  test("getDb creates database and tables", () => {
    const db = getDb();
    expect(db).toBeDefined();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("channels");
    expect(tableNames).toContain("channel_members");
  });

  test("getDb returns singleton", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  test("getDb sets WAL mode", () => {
    const db = getDb();
    const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode).toBe("wal");
  });

  test("getDb creates indexes", () => {
    const db = getDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_messages_session");
    expect(names).toContain("idx_messages_to");
    expect(names).toContain("idx_messages_created");
    expect(names).toContain("idx_messages_channel");
  });

  test("closeDb closes and resets singleton", () => {
    getDb();
    closeDb();
    // Should be able to get a new connection
    const db = getDb();
    expect(db).toBeDefined();
  });

  test("closeDb is safe to call when no db open", () => {
    closeDb();
    closeDb(); // Should not throw
  });

  test("messages table has channel column", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("channel");
  });
});
