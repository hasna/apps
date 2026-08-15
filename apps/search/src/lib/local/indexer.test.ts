import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { getIndexDbForTesting } from "../../db/index-db.js";
import {
  addRoot,
  getRoot,
  listRoots,
  removeRoot,
  indexRoot,
  hasReadyRoot,
  refreshStaleRoots,
  normalizeRootPath,
} from "./indexer.js";

let root: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "search-indexer-"));
  db = getIndexDbForTesting();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content = "x") {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function fileRows() {
  return db.query("SELECT * FROM files ORDER BY rel_path").all() as Array<{
    id: number;
    rel_path: string;
    size: number;
    is_binary: number;
    content_indexed: number;
  }>;
}

function contentMatch(q: string) {
  return db
    .query(`SELECT rowid FROM file_content_fts WHERE file_content_fts MATCH ?`)
    .all(`"${q}"`) as Array<{ rowid: number }>;
}

describe("roots", () => {
  test("addRoot normalizes path and defaults name to basename", () => {
    const r = addRoot(root + "/", {}, db);
    expect(r.path).toBe(normalizeRootPath(root));
    expect(r.name).toBe(root.split("/").pop());
    expect(r.status).toBe("pending");
  });

  test("addRoot rejects duplicates", () => {
    addRoot(root, {}, db);
    expect(() => addRoot(root + "/", {}, db)).toThrow(/already indexed/);
  });

  test("getRoot resolves by id, path, or name", () => {
    const r = addRoot(root, {}, db);
    expect(getRoot(r.id, db)?.id).toBe(r.id);
    expect(getRoot(root, db)?.id).toBe(r.id);
    expect(getRoot(r.name, db)?.id).toBe(r.id);
    expect(getRoot("/nope", db)).toBeNull();
  });

  test("removeRoot deletes files and content fts entries", () => {
    write("a.ts", "alphacontent here");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    expect(fileRows().length).toBe(1);
    expect(contentMatch("alphacontent").length).toBe(1);

    expect(removeRoot(r.id, db)).toBe(true);
    expect(fileRows().length).toBe(0);
    expect(contentMatch("alphacontent").length).toBe(0);
    expect(listRoots(db).length).toBe(0);
  });
});

describe("indexRoot", () => {
  test("initial index adds files and content", () => {
    write("src/app.ts", "export const magicToken = 42;");
    write("README.md", "# readme");
    write("logo.png", "fakebinary");

    const r = addRoot(root, {}, db);
    const stats = indexRoot(r.id, {}, db);

    expect(stats.added).toBe(3);
    expect(stats.deleted).toBe(0);
    expect(stats.fileCount).toBe(3);

    const rows = fileRows();
    const png = rows.find((f) => f.rel_path === "logo.png")!;
    expect(png.is_binary).toBe(1);
    expect(png.content_indexed).toBe(0);

    expect(contentMatch("magicToken").length).toBe(1);
    expect(getRoot(r.id, db)!.status).toBe("ready");
    expect(getRoot(r.id, db)!.fileCount).toBe(3);
    expect(hasReadyRoot(db)).toBe(true);
  });

  test("incremental: unchanged files are not touched", () => {
    write("a.ts", "const a = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    const stats = indexRoot(r.id, {}, db);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.deleted).toBe(0);
  });

  test("incremental: modified file is re-indexed with new content", () => {
    write("a.ts", "const oldsymbol = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    expect(contentMatch("oldsymbol").length).toBe(1);

    write("a.ts", "const newsymbol = 2;!!");
    const stats = indexRoot(r.id, {}, db);
    expect(stats.updated).toBe(1);
    expect(contentMatch("oldsymbol").length).toBe(0);
    expect(contentMatch("newsymbol").length).toBe(1);
  });

  test("incremental: deleted file is removed from index", () => {
    write("a.ts", "const gonesymbol = 1;");
    write("b.ts", "const staysymbol = 2;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);

    rmSync(join(root, "a.ts"));
    const stats = indexRoot(r.id, {}, db);
    expect(stats.deleted).toBe(1);
    expect(fileRows().map((f) => f.rel_path)).toEqual(["b.ts"]);
    expect(contentMatch("gonesymbol").length).toBe(0);
    expect(contentMatch("staysymbol").length).toBe(1);
  });

  test("mtime-only change triggers reindex", () => {
    write("a.ts", "const samesize = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);

    const future = new Date(Date.now() + 10_000);
    utimesSync(join(root, "a.ts"), future, future);
    const stats = indexRoot(r.id, {}, db);
    expect(stats.updated).toBe(1);
  });

  test("respects contentIndexing=false", () => {
    write("a.ts", "const invisiblesymbol = 1;");
    const r = addRoot(root, { contentIndexing: false }, db);
    indexRoot(r.id, {}, db);
    expect(contentMatch("invisiblesymbol").length).toBe(0);
    expect(fileRows().length).toBe(1);
  });

  test("respects maxFileSize for content", () => {
    write("big.txt", "bigfilesymbol ".repeat(100));
    const r = addRoot(root, { maxFileSize: 50 }, db);
    indexRoot(r.id, {}, db);
    expect(contentMatch("bigfilesymbol").length).toBe(0);
    expect(fileRows()[0]!.content_indexed).toBe(0);
  });

  test("binary files detected by sniffing are not content indexed", () => {
    writeFileSync(join(root, "data.unknownext"), Buffer.from([0x41, 0x00, 0x42]));
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    const row = fileRows()[0]!;
    expect(row.is_binary).toBe(1);
    expect(row.content_indexed).toBe(0);
  });

  test("lockfiles are path-indexed but not content-indexed", () => {
    write("bun.lock", '{"lockfilesymbol": 1}');
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    expect(fileRows().map((f) => f.rel_path)).toContain("bun.lock");
    expect(contentMatch("lockfilesymbol").length).toBe(0);
  });

  test("missing root path sets error status and keeps existing index data", () => {
    write("a.ts", "const keepme = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    expect(fileRows().length).toBe(1);

    rmSync(root, { recursive: true, force: true });
    expect(() => indexRoot(r.id, {}, db)).toThrow(/Cannot read index root/);
    expect(getRoot(r.id, db)!.status).toBe("error");
    // The previous index survives a transiently missing root (e.g. unmounted share)
    expect(fileRows().length).toBe(1);
  });

  test("addRoot rejects nonexistent paths and plain files", () => {
    expect(() => addRoot("/nonexistent/nope", {}, db)).toThrow(/does not exist/);
    write("plain.txt", "x");
    expect(() => addRoot(join(root, "plain.txt"), {}, db)).toThrow(/Not a directory/);
    expect(listRoots(db).length).toBe(0);
  });

  test("addRoot expands ~ and rejects duplicate names", () => {
    expect(normalizeRootPath("~/somewhere")).toBe(`${process.env.HOME}/somewhere`);

    write("sub1/x.txt", "a");
    write("sub2/x.txt", "b");
    addRoot(join(root, "sub1"), { name: "same" }, db);
    expect(() => addRoot(join(root, "sub2"), { name: "same" }, db)).toThrow(/already used/);
  });

  test("addRoot rejects invalid maxFileSize", () => {
    expect(() => addRoot(root, { maxFileSize: NaN }, db)).toThrow(/maxFileSize/);
    expect(() => addRoot(root, { maxFileSize: -1 }, db)).toThrow(/maxFileSize/);
  });

  test("unknown root throws", () => {
    expect(() => indexRoot("nope", {}, db)).toThrow(/not found/);
  });
});

describe("refreshStaleRoots", () => {
  test("refreshes only stale ready roots", () => {
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);

    // Fresh: no refresh
    expect(refreshStaleRoots(5, db).length).toBe(0);

    // Backdate last_indexed_at to force staleness
    db.prepare("UPDATE index_roots SET last_indexed_at = ? WHERE id = ?").run(
      new Date(Date.now() - 10 * 60_000).toISOString(),
      r.id,
    );
    write("b.ts", "const y = 2;");
    const stats = refreshStaleRoots(5, db);
    expect(stats.length).toBe(1);
    expect(stats[0]!.added).toBe(1);
  });

  test("skips pending roots", () => {
    addRoot(root, {}, db);
    expect(refreshStaleRoots(5, db).length).toBe(0);
  });
});
