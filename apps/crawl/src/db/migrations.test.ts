import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FEEDBACK_TABLE_SQL, migrations, runMigrations } from "./migrations.js";

const roots: string[] = [];
const files: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  for (const f of files.splice(0)) {
    rmSync(f, { force: true });
  }
});

function freshDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), "crawl-migrations-"));
  roots.push(root);
  const path = join(root, "migrate.db");
  files.push(path);
  return path;
}

function open(path: string): Database {
  return new Database(path, { create: true });
}

describe("runMigrations", () => {
  it("creates the full schema in order", () => {
    const path = freshDbPath();
    const db = open(path);
    runMigrations(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();

    for (const expected of [
      "_migrations",
      "api_keys",
      "crawls",
      "feedback",
      "page_versions",
      "pages",
      "pages_fts",
      "usage_events",
      "webhook_deliveries",
      "webhooks",
    ]) {
      expect(tables).toContain(expected);
    }
    db.close();
  });

  it("is idempotent on the same database file across handles", () => {
    const path = freshDbPath();
    const db = open(path);
    runMigrations(db);
    const appliedOnce = db
      .query("SELECT index_num FROM _migrations ORDER BY index_num")
      .all() as Array<{ index_num: number }>;
    db.close();

    const db2 = open(path);
    runMigrations(db2);
    const appliedTwice = db2
      .query("SELECT index_num FROM _migrations ORDER BY index_num")
      .all() as Array<{ index_num: number }>;

    expect(appliedTwice.map((r) => r.index_num)).toEqual(appliedOnce.map((r) => r.index_num));
    expect(appliedTwice.length).toBeGreaterThan(0);
    db2.close();
  });

  it("keeps the migration index aligned with the migration list", () => {
    const path = freshDbPath();
    const db = open(path);
    runMigrations(db);
    const applied = db.query("SELECT index_num FROM _migrations").all() as Array<{
      index_num: number;
    }>;
    expect(applied).toHaveLength(migrations.length);
    db.close();
  });

  it("wires the pages FTS trigger so inserts become searchable", () => {
    const path = freshDbPath();
    const db = open(path);
    runMigrations(db);

    db.run(
      "INSERT INTO crawls (id, url, status, depth, max_pages, created_at, updated_at) VALUES ('c1', 'https://example.com', 'completed', 1, 1, '2026-01-01', '2026-01-01')"
    );
    db.run(
      "INSERT INTO pages (id, crawl_id, url, title, text_content, crawled_at) VALUES ('p1', 'c1', 'https://example.com/a', 'Alpha', 'searchable needle text', '2026-01-01')"
    );

    const hits = db.query("SELECT rowid FROM pages_fts WHERE pages_fts MATCH 'needle'").all();
    expect(hits.length).toBe(1);
    db.close();
  });
});

describe("FEEDBACK_TABLE_SQL", () => {
  it("can be replayed idempotently after migrations have run", () => {
    const path = freshDbPath();
    const db = open(path);
    runMigrations(db);
    db.exec(FEEDBACK_TABLE_SQL); // the getDb() guard replays this exact statement
    db.exec(FEEDBACK_TABLE_SQL);
    const count = db.query("SELECT COUNT(*) AS n FROM feedback").get() as { n: number };
    expect(count.n).toBe(0);
    db.close();
  });
});
