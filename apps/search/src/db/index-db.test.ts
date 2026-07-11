import { describe, expect, test } from "bun:test";
import { getIndexDbForTesting } from "./index-db.js";

describe("index db", () => {
  test("migrations create all tables", () => {
    const db = getIndexDbForTesting();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("index_roots");
    expect(tables).toContain("files");
    expect(tables).toContain("files_fts");
    expect(tables).toContain("file_content_grams");
    expect(tables).toContain("file_content_fts");
    expect(tables).toContain("_migrations");
  });

  test("migrations are idempotent", () => {
    const db = getIndexDbForTesting();
    const before = db.query("SELECT COUNT(*) as c FROM _migrations").get() as { c: number };
    const { runIndexMigrations } = require("./index-migrations.js");
    runIndexMigrations(db);
    const count = db.query("SELECT COUNT(*) as c FROM _migrations").get() as { c: number };
    expect(count.c).toBe(before.c);
  });

  test("files_fts trigram supports substring matching via triggers", () => {
    const db = getIndexDbForTesting();
    db.prepare(
      "INSERT INTO index_roots (id, path, name) VALUES ('r1', '/tmp/proj', 'proj')",
    ).run();
    db.prepare(
      `INSERT INTO files (root_id, rel_path, name, ext, dir, size, mtime_ms, indexed_at)
       VALUES ('r1', 'src/db/storage-config.ts', 'storage-config.ts', 'ts', 'src/db', 100, 1, '2026-01-01')`,
    ).run();

    const hits = db
      .query(`SELECT rowid FROM files_fts WHERE files_fts MATCH '"rage-conf"'`)
      .all();
    expect(hits.length).toBe(1);
  });

  test("file delete removes fts row via trigger", () => {
    const db = getIndexDbForTesting();
    db.prepare("INSERT INTO index_roots (id, path, name) VALUES ('r1', '/tmp/p', 'p')").run();
    db.prepare(
      `INSERT INTO files (root_id, rel_path, name, ext, dir, size, mtime_ms, indexed_at)
       VALUES ('r1', 'hello.txt', 'hello.txt', 'txt', '', 10, 1, '2026-01-01')`,
    ).run();
    db.prepare("DELETE FROM files WHERE rel_path = 'hello.txt'").run();
    const hits = db.query(`SELECT rowid FROM files_fts WHERE files_fts MATCH '"hello"'`).all();
    expect(hits.length).toBe(0);
  });

  test("root delete cascades to files", () => {
    const db = getIndexDbForTesting();
    db.prepare("INSERT INTO index_roots (id, path, name) VALUES ('r1', '/tmp/p2', 'p2')").run();
    db.prepare(
      `INSERT INTO files (root_id, rel_path, name, ext, dir, size, mtime_ms, indexed_at)
       VALUES ('r1', 'a.txt', 'a.txt', 'txt', '', 10, 1, '2026-01-01')`,
    ).run();
    db.prepare("DELETE FROM index_roots WHERE id = 'r1'").run();
    const count = db.query("SELECT COUNT(*) as c FROM files").get() as { c: number };
    expect(count.c).toBe(0);
  });

  test("contentless content fts supports insert, match, delete", () => {
    const db = getIndexDbForTesting();
    db.prepare("INSERT INTO file_content_fts (rowid, body) VALUES (7, 'export function getDbPath()')").run();
    let hits = db.query(`SELECT rowid FROM file_content_fts WHERE file_content_fts MATCH '"getDbPath"'`).all();
    expect(hits.length).toBe(1);
    db.prepare("DELETE FROM file_content_fts WHERE rowid = 7").run();
    hits = db.query(`SELECT rowid FROM file_content_fts WHERE file_content_fts MATCH '"getDbPath"'`).all();
    expect(hits.length).toBe(0);
  });
});
