import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrateLogsSourceCheck } from "./005_logs_source_check.ts";

/** Build a legacy DB whose `logs.source` carries the old restrictive CHECK. */
function legacyDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
  db.run(
    "CREATE TABLE pages (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id))",
  );
  db.run(`
    CREATE TABLE logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
      level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error','fatal')),
      source TEXT NOT NULL DEFAULT 'sdk' CHECK(source IN ('sdk','script','scanner')),
      service TEXT,
      message TEXT NOT NULL,
      trace_id TEXT,
      session_id TEXT,
      agent TEXT,
      url TEXT,
      stack_trace TEXT,
      metadata TEXT
    )
  `);
  db.run(`
    CREATE VIRTUAL TABLE logs_fts USING fts5(
      message, service, stack_trace, content=logs, content_rowid=rowid
    )
  `);
  db.run(`
    CREATE TRIGGER logs_fts_insert AFTER INSERT ON logs BEGIN
      INSERT INTO logs_fts(rowid, message, service, stack_trace)
      VALUES (new.rowid, new.message, new.service, new.stack_trace);
    END
  `);
  db.run(`
    CREATE TRIGGER logs_fts_delete AFTER DELETE ON logs BEGIN
      INSERT INTO logs_fts(logs_fts, rowid, message, service, stack_trace)
      VALUES ('delete', old.rowid, old.message, old.service, old.stack_trace);
    END
  `);
  db.run(
    "CREATE TABLE event_records (id TEXT PRIMARY KEY, log_id TEXT REFERENCES logs(id) ON DELETE SET NULL)",
  );
  return db;
}

describe("migrateLogsSourceCheck", () => {
  test("legacy DB rejects non-allowlisted sources before migration", () => {
    const db = legacyDb();
    expect(() =>
      db.run(
        "INSERT INTO logs (id, level, source, message) VALUES ('a','info','cli','x')",
      ),
    ).toThrow(/CHECK constraint/i);
    db.close();
  });

  test("rebuilds the table, drops the source CHECK, preserves rowid + refs + FTS", () => {
    const db = legacyDb();
    db.run("INSERT INTO projects (id, name) VALUES ('p1','proj')");
    db.run(
      "INSERT INTO logs (id, level, source, message, service) VALUES ('log1','error','sdk','boom','svc')",
    );
    const before = db
      .prepare("SELECT rowid FROM logs WHERE id = 'log1'")
      .get() as { rowid: number };
    db.run("INSERT INTO event_records (id, log_id) VALUES ('ev1','log1')");

    migrateLogsSourceCheck(db);

    // CHECK is gone: previously-rejected sources now insert cleanly.
    db.run(
      "INSERT INTO logs (id, level, source, message) VALUES ('log2','info','cli','ran')",
    );
    db.run(
      "INSERT INTO logs (id, level, source, message) VALUES ('log3','info','jsonl','imported')",
    );

    // rowid preserved for the migrated row.
    const after = db
      .prepare("SELECT rowid FROM logs WHERE id = 'log1'")
      .get() as { rowid: number };
    expect(after.rowid).toBe(before.rowid);

    // event_records.log_id reference survived the rebuild (no cascade null).
    const ev = db
      .prepare("SELECT log_id FROM event_records WHERE id = 'ev1'")
      .get() as { log_id: string | null };
    expect(ev.log_id).toBe("log1");

    // External-content FTS still resolves the preserved row.
    const hit = db
      .prepare(
        "SELECT l.id FROM logs_fts f JOIN logs l ON l.rowid = f.rowid WHERE logs_fts MATCH 'boom'",
      )
      .get() as { id: string } | null;
    expect(hit?.id).toBe("log1");

    // Foreign keys restored to ON.
    const fk = db.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    expect(fk.foreign_keys).toBe(1);

    db.close();
  });

  test("is a no-op on a fresh schema without the source CHECK", () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error','fatal')),
        source TEXT NOT NULL DEFAULT 'sdk',
        message TEXT NOT NULL
      )
    `);
    const sqlBefore = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='logs'",
        )
        .get() as { sql: string }
    ).sql;
    migrateLogsSourceCheck(db);
    const sqlAfter = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='logs'",
        )
        .get() as { sql: string }
    ).sql;
    expect(sqlAfter).toBe(sqlBefore);
    db.close();
  });
});
