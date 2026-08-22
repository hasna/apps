// Regression tests for todos 5e184765 — incremental sync cursor race.
//
// runIncrementalSync (src/storage.ts) and syncMemoriesTable
// (src/lib/storage-sync.ts) snapshotted source rows with
// `WHERE updated_at > last_synced_at` and then wrote the cursor as
// `new Date().toISOString()` AFTER the whole transfer. Any source row mutated
// between the SELECT and the cursor write landed inside
// (old_cursor, new_cursor]: it was not in this run's result set and the strict
// `>` in every future run excluded it — the change was silently lost from the
// target until _sync_meta was reset.
//
// The cursor must be the high-water mark of what was actually processed: the
// max updated_at over rows written or skipped, never the wall clock, and never
// advanced past a row that errored (so it is retried) or when no rows were
// selected (so the cursor converges instead of busy-looping).
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  SqliteAdapter,
  incrementalSyncPush,
  markServerContext,
  resetServerContextForTests,
} from "./storage.js";
import { pushStorageChanges } from "./lib/storage-sync.js";

const T0 = "2026-08-22T00:00:00.000Z";
const T_ROW = "2026-08-22T00:00:01.000Z";
const T_MID = "2026-08-22T01:00:00.000Z";

beforeEach(() => {
  markServerContext();
});

afterEach(() => {
  resetServerContextForTests();
});

function genericDb(): SqliteAdapter {
  const db = new SqliteAdapter(":memory:");
  db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT)`);
  return db;
}

function seedGenericCursor(db: SqliteAdapter, cursor: string): void {
  db.exec(`CREATE TABLE _sync_meta (table_name TEXT PRIMARY KEY, last_synced_at TEXT, last_synced_row_count INTEGER DEFAULT 0, direction TEXT DEFAULT 'push')`);
  db.run(
    `INSERT INTO _sync_meta (table_name, last_synced_at, last_synced_row_count, direction) VALUES (?, ?, ?, ?)`,
    "t",
    cursor,
    0,
    "push"
  );
}

function genericCursor(db: SqliteAdapter): string | null | undefined {
  return db.get(`SELECT last_synced_at FROM _sync_meta WHERE table_name = ?`, "t")
    ?.last_synced_at as string | null | undefined;
}

describe("incremental generic table sync cursor (todos 5e184765)", () => {
  it("re-syncs a source row mutated between the SELECT and the cursor write", () => {
    const source = genericDb();
    const target = genericDb();
    source.run(`INSERT INTO t (id, payload, updated_at) VALUES (?, ?, ?)`, "A", "ORIGINAL", T_ROW);
    seedGenericCursor(source, T0);

    // Concurrent writer: the first INSERT on the target mutates the source row
    // with a fresh updated_at inside the old (cursor, cursor-write] window.
    let injected = false;
    const originalRun = target.run.bind(target);
    target.run = ((sql: string, ...params: unknown[]) => {
      const result = originalRun(sql, ...params);
      if (!injected && sql.startsWith('INSERT INTO "t"')) {
        injected = true;
        source.run(
          `UPDATE t SET payload = ?, updated_at = ? WHERE id = ?`,
          "CHANGED-MID-SYNC",
          T_MID,
          "A"
        );
      }
      return result;
    }) as typeof target.run;

    const run1 = incrementalSyncPush(source, target, ["t"], {});
    expect(run1[0].errors).toEqual([]);
    expect(run1[0].synced_rows).toBe(1);
    expect(injected).toBe(true);

    // The cursor must be the max updated_at actually processed (T_ROW), not
    // the wall clock at write time — otherwise the mid-window mutation (T_MID)
    // sits below the cursor and is skipped forever.
    expect(genericCursor(source)).toBe(T_ROW);

    const run2 = incrementalSyncPush(source, target, ["t"], {});
    expect(run2[0].errors).toEqual([]);
    const after = target.get(`SELECT payload FROM t WHERE id = ?`, "A");
    expect(after.payload).toBe("CHANGED-MID-SYNC");
  });

  it("does not advance the cursor past a row that errored, so it is retried", () => {
    const source = genericDb();
    const target = genericDb();
    source.run(`INSERT INTO t (id, payload, updated_at) VALUES (?, ?, ?)`, "A", "ORIGINAL", T_ROW);
    seedGenericCursor(source, T0);

    // The transfer's first INSERT fails once (transient), then succeeds.
    let failing = true;
    const originalRun = target.run.bind(target);
    target.run = ((sql: string, ...params: unknown[]) => {
      if (failing && sql.startsWith('INSERT INTO "t"')) {
        failing = false;
        throw new Error("transient failure");
      }
      return originalRun(sql, ...params);
    }) as typeof target.run;

    const run1 = incrementalSyncPush(source, target, ["t"], {});
    expect(run1[0].synced_rows).toBe(0);
    expect(run1[0].errors).toHaveLength(1);

    // The errored row must stay above the cursor (cursor unchanged), so run 2
    // retries it instead of dropping it.
    expect(genericCursor(source)).toBe(T0);

    const run2 = incrementalSyncPush(source, target, ["t"], {});
    expect(run2[0].errors).toEqual([]);
    expect(run2[0].synced_rows).toBe(1);
    const after = target.get(`SELECT payload FROM t WHERE id = ?`, "A");
    expect(after.payload).toBe("ORIGINAL");
  });

  it("leaves the cursor unchanged when no rows are selected", () => {
    const source = genericDb();
    const target = genericDb();
    source.run(`INSERT INTO t (id, payload, updated_at) VALUES (?, ?, ?)`, "A", "ORIGINAL", T_ROW);
    seedGenericCursor(source, T0);

    const run1 = incrementalSyncPush(source, target, ["t"], {});
    expect(run1[0].synced_rows).toBe(1);
    expect(genericCursor(source)).toBe(T_ROW);

    // Nothing changed since the cursor: no rows selected, so the cursor must
    // NOT be rewritten to the wall clock (which would also busy-loop).
    const run2 = incrementalSyncPush(source, target, ["t"], {});
    expect(run2[0].synced_rows).toBe(0);
    expect(genericCursor(source)).toBe(T_ROW);
  });
});

const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'knowledge',
    scope TEXT NOT NULL DEFAULT 'private',
    summary TEXT,
    tags TEXT DEFAULT '[]',
    importance INTEGER NOT NULL DEFAULT 5,
    source TEXT NOT NULL DEFAULT 'agent',
    status TEXT NOT NULL DEFAULT 'active',
    pinned INTEGER NOT NULL DEFAULT 0,
    agent_id TEXT,
    project_id TEXT,
    session_id TEXT,
    machine_id TEXT,
    metadata TEXT DEFAULT '{}',
    access_count INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accessed_at TEXT,
    ingested_at TEXT
  )
`;

function memoryDb(): SqliteAdapter {
  const db = new SqliteAdapter(":memory:");
  db.exec(MEMORY_SCHEMA);
  return db;
}

describe("incremental memories sync cursor (todos 5e184765)", () => {
  it("re-syncs a memory mutated between the SELECT and the cursor write", () => {
    const local = memoryDb();
    const remote = memoryDb();
    local.run(
      `INSERT INTO memories (id, key, value, category, scope, tags, importance, source, status, pinned, machine_id, metadata, access_count, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["m1", "key-a", "ORIGINAL", "knowledge", "private", "[]", 5, "agent", "active", 0, "m1", "{}", 0, 1, T_ROW, T_ROW]
    );

    // Concurrent writer: the first memory INSERT on the remote mutates the
    // local row with a fresh updated_at inside the old (cursor, cursor-write]
    // window.
    let injected = false;
    const originalRun = remote.run.bind(remote);
    remote.run = ((sql: string, ...params: unknown[]) => {
      const result = originalRun(sql, ...params);
      if (!injected && sql.startsWith('INSERT INTO "memories"')) {
        injected = true;
        local.run(
          `UPDATE memories SET value = ?, updated_at = ? WHERE id = ?`,
          "CHANGED-MID-SYNC",
          T_MID,
          "m1"
        );
      }
      return result;
    }) as typeof remote.run;

    const run1 = pushStorageChanges({
      tables: ["memories"],
      local,
      remote,
      current_machine_id: "m1",
    });
    expect(run1.errors).toEqual([]);
    expect(run1.total_synced).toBe(1);
    expect(injected).toBe(true);

    // The memory cursor must be the max updated_at actually processed (T_ROW),
    // never the wall clock at write time.
    const cursor = local.get(
      `SELECT last_synced_at FROM _mementos_storage_sync_meta WHERE table_name = ? AND direction = ?`,
      "memories",
      "push"
    )?.last_synced_at as string | null | undefined;
    expect(cursor).toBe(T_ROW);

    const run2 = pushStorageChanges({
      tables: ["memories"],
      local,
      remote,
      current_machine_id: "m1",
    });
    expect(run2.errors).toEqual([]);
    const after = remote.get(`SELECT value FROM memories WHERE id = ?`, "m1");
    expect(after.value).toBe("CHANGED-MID-SYNC");

    local.close();
    remote.close();
  });
});
