import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { getIndexDbForTesting } from "../../db/index-db.js";
import { addRoot, indexRoot } from "./indexer.js";
import { searchFilePaths, searchFileContent, buildFtsQuery, tokenize } from "./query.js";

let root: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "search-query-"));
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

function setup(files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  const r = addRoot(root, {}, db);
  indexRoot(r.id, {}, db);
  return r;
}

describe("buildFtsQuery", () => {
  test("quotes tokens and joins with AND", () => {
    expect(buildFtsQuery("storage config")).toBe('"storage" AND "config"');
  });

  test("drops short tokens", () => {
    expect(buildFtsQuery("db storage")).toBe('"storage"');
    expect(buildFtsQuery("db a")).toBeNull();
  });

  test("escapes embedded quotes", () => {
    expect(buildFtsQuery('say"hi"')).toBe('"say""hi"""');
  });

  test("tokenize splits on whitespace", () => {
    expect(tokenize("  a  b\tc ")).toEqual(["a", "b", "c"]);
  });
});

describe("searchFilePaths", () => {
  test("substring match on filename ranks exact stem first", () => {
    setup({
      "src/db/storage-config.ts": "a",
      "src/db/storage-config.test.ts": "b",
      "docs/storage.md": "c",
    });

    const hits = searchFilePaths("storage-config", {}, db);
    expect(hits.length).toBe(2);
    expect(hits[0]!.name).toBe("storage-config.ts");
    expect(hits[0]!.absPath).toBe(join(root, "src/db/storage-config.ts"));
  });

  test("exact filename query returns exactly that file", () => {
    setup({
      "src/db/storage-config.ts": "a",
      "src/db/storage-config.test.ts": "b",
    });
    const hits = searchFilePaths("storage-config.ts", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.name).toBe("storage-config.ts");
  });

  test("multi-token query requires all tokens", () => {
    setup({
      "src/storage/config.ts": "a",
      "src/storage/other.ts": "b",
    });
    const hits = searchFilePaths("storage config", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("src/storage/config.ts");
  });

  test("short query falls back to LIKE", () => {
    setup({ "src/db.ts": "a", "src/main.ts": "b" });
    const hits = searchFilePaths("db", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.name).toBe("db.ts");
  });

  test("mixed short and long tokens enforce both", () => {
    setup({
      "src/db/storage.ts": "a",
      "src/lib/storage.ts": "b",
    });
    const hits = searchFilePaths("db storage", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("src/db/storage.ts");
  });

  test("mixed short and long tokens are filtered before candidate limit", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 400; i++) {
      files[`src/lib/storage-${i}.ts`] = "a";
    }
    files["src/db/storage.ts"] = "b";
    setup(files);

    const hits = searchFilePaths("db storage", { limit: 5 }, db);
    expect(hits.some((hit) => hit.relPath === "src/db/storage.ts")).toBe(true);
  });

  test("ext filter", () => {
    setup({ "a/readme.md": "x", "b/readme.txt": "y" });
    const hits = searchFilePaths("readme", { ext: ".md" }, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.ext).toBe("md");
  });

  test("dir filter", () => {
    setup({ "src/db/util.ts": "x", "src/lib/util.ts": "y" });
    const hits = searchFilePaths("util", { dir: "db" }, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.dir).toBe("src/db");
  });

  test("root filter by name; unknown root throws", () => {
    setup({ "a.ts": "x" });
    const rootName = root.split("/").pop()!;
    expect(searchFilePaths("a.ts", { root: rootName }, db).length).toBe(1);
    expect(() => searchFilePaths("a.ts", { root: "other-root" }, db)).toThrow(/not found/);
  });

  test("empty query returns nothing", () => {
    setup({ "a.ts": "x" });
    expect(searchFilePaths("", {}, db).length).toBe(0);
    expect(searchFilePaths("   ", {}, db).length).toBe(0);
  });

  test("case insensitive", () => {
    setup({ "src/MyComponent.tsx": "x" });
    const hits = searchFilePaths("mycomponent", {}, db);
    expect(hits.length).toBe(1);
  });
});

describe("regex search", () => {
  test("content regex with literal prefilter finds exact lines", () => {
    setup({
      "src/a.ts": "export function handleClick() {}\nexport const handleHover = 1;",
      "src/b.ts": "nothing relevant",
    });
    const { searchFileContentRegex } = require("./query.js");
    const hits = searchFileContentRegex("export (function|const) handle\\w+", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("src/a.ts");
    expect(hits[0]!.matches.length).toBe(2);
    expect(hits[0]!.line).toBe(1);
  });

  test("path regex matches rel_path", () => {
    setup({ "src/db/storage-config.ts": "x", "src/db/storage-sync.ts": "x", "docs/storage.md": "x" });
    const { searchFilePathsRegex } = require("./query.js");
    const hits = searchFilePathsRegex("storage-(config|sync)\\.ts$", {}, db);
    expect(hits.map((h: { name: string }) => h.name).sort()).toEqual([
      "storage-config.ts",
      "storage-sync.ts",
    ]);
  });

  test("case sensitivity flag", () => {
    setup({ "a.ts": "const FooBar = 1;" });
    const { searchFileContentRegex } = require("./query.js");
    expect(searchFileContentRegex("foobar", {}, db).length).toBe(1);
    expect(searchFileContentRegex("foobar", { caseSensitive: true }, db).length).toBe(0);
    expect(searchFileContentRegex("FooBar", { caseSensitive: true }, db).length).toBe(1);
  });

  test("pattern without usable literals throws", () => {
    setup({ "a.ts": "x" });
    const { searchFileContentRegex, searchFilePathsRegex } = require("./query.js");
    expect(() => searchFileContentRegex("\\d+", {}, db)).toThrow(/literal/);
    expect(() => searchFilePathsRegex("[a-z]+", {}, db)).toThrow(/literal/);
  });

  test("invalid regex throws", () => {
    setup({ "a.ts": "x" });
    const { searchFileContentRegex } = require("./query.js");
    expect(() => searchFileContentRegex("(unclosed", {}, db)).toThrow();
  });
});

describe("ranking quality (round-2 regressions)", () => {
  test("deep, old exact-name file beats a fresh prose mention", () => {
    write("src/lib/dedup.ts", "export const x = 1;");
    write("notes.md", "dedup is mentioned here\nand dedup again");
    const { utimesSync } = require("node:fs");
    const old = new Date(Date.now() - 90 * 86_400_000);
    utimesSync(join(root, "src/lib/dedup.ts"), old, old);
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);

    const { findLocal } = require("./find.js");
    const res = findLocal("dedup", { refresh: false }, db);
    expect(res.results[0]!.path.endsWith("src/lib/dedup.ts")).toBe(true);
  });

  test("exact name match survives candidate-pool flooding", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 250; i++) {
      files[`gamma/gamma-${i}/gamma-gamma/gamma-gamma-${i}.txt`] = "x";
    }
    files["src/util/gamma.ts"] = "y";
    setup(files);

    const hits = searchFilePaths("gamma", { limit: 10 }, db);
    expect(hits[0]!.relPath).toBe("src/util/gamma.ts");
  });

  test("multi-word query matches separator-joined filename", () => {
    setup({
      "src/dedup-utils.ts": "export {}",
      "notes.md": "dedup utils mentioned in prose",
    });
    const { findLocal } = require("./find.js");
    const res = findLocal("dedup utils", { refresh: false }, db);
    expect(res.results[0]!.path.endsWith("src/dedup-utils.ts")).toBe(true);
  });

  test("phrase line beats scattered tokens in content ranking", () => {
    const scattered =
      Array.from({ length: 10 }, () => "memory leak mentioned alone here").join("\n") +
      "\n" +
      Array.from({ length: 10 }, () => "detector mentioned alone here").join("\n");
    setup({
      "scattered.txt": scattered,
      "phrase.txt": "the memory leak detector lives here",
    });
    const hits = searchFileContent("memory leak detector", {}, db);
    expect(hits[0]!.relPath).toBe("phrase.txt");
  });

  test("short tokens are enforced in content search", () => {
    setup({
      "no-db.txt": "configuration settings only",
      "with-db.txt": "db config here",
    });
    const hits = searchFileContent("db config", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("with-db.txt");
  });

  test("content search pages broad candidates until short tokens are verified", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i++) {
      files[`config-only-${i}.txt`] = "config value only";
    }
    files["with-db-config.txt"] = "db config target";
    setup(files);

    const hits = searchFileContent("db config", { limit: 5 }, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("with-db-config.txt");
  });

  test("deleted files do not ghost in file results", () => {
    setup({ "main.ts": "x", "other-main.ts": "y" });
    rmSync(join(root, "main.ts"));
    const hits = searchFilePaths("main", {}, db);
    expect(hits.map((h) => h.name)).toEqual(["other-main.ts"]);
  });
});

describe("query robustness", () => {
  test("NUL bytes in query do not crash FTS", () => {
    setup({ "a.ts": "abcdef here" });
    expect(() => searchFilePaths("abc\u0000def", {}, db)).not.toThrow();
    expect(() => searchFileContent("abc\u0000def xyz", {}, db)).not.toThrow();
    // NUL is stripped, so the joined token still matches indexed content
    expect(searchFileContent("abc\u0000def", {}, db).length).toBe(1);
  });

  test("dir filter escapes LIKE wildcards", () => {
    setup({ "sub_dir/a.ts": "x", "subxdir/a.ts": "x" });
    const hits = searchFilePaths("a.ts", { dir: "sub_dir" }, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.dir).toBe("sub_dir");
  });
});

describe("searchFileContent", () => {
  test("finds files by content with exact line numbers", () => {
    setup({
      "src/app.ts": "line one\nexport function magicFunction() {}\nline three",
      "src/other.ts": "nothing here",
    });

    const hits = searchFileContent("magicFunction", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("src/app.ts");
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.lineText).toContain("magicFunction");
  });

  test("multi-token content query matches files containing all tokens", () => {
    setup({
      "a.md": "alpha here\nand beta there",
      "b.md": "only alpha",
    });
    const hits = searchFileContent("alpha beta", {}, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("a.md");
    expect(hits[0]!.matches.length).toBeGreaterThan(0);
  });

  test("phrase match is preferred for line selection", () => {
    setup({
      "doc.md": "storage exists\nthe storage config lives here\nconfig alone",
    });
    const hits = searchFileContent("storage config", {}, db);
    expect(hits[0]!.line).toBe(2);
  });

  test("returns empty for short-only queries", () => {
    setup({ "a.ts": "db db db" });
    expect(searchFileContent("db", {}, db).length).toBe(0);
  });

  test("skips files deleted after indexing", () => {
    setup({ "gone.ts": "vanishingsymbol here" });
    rmSync(join(root, "gone.ts"));
    expect(searchFileContent("vanishingsymbol", {}, db).length).toBe(0);
  });

  test("ext filter applies", () => {
    setup({ "a.ts": "sharedsymbol", "b.md": "sharedsymbol" });
    const hits = searchFileContent("sharedsymbol", { ext: "ts" }, db);
    expect(hits.length).toBe(1);
    expect(hits[0]!.ext).toBe("ts");
  });

  test("caps matches per file", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `repeatedsymbol line ${i}`).join("\n");
    setup({ "many.txt": lines });
    const hits = searchFileContent("repeatedsymbol", {}, db);
    expect(hits[0]!.matches.length).toBeLessThanOrEqual(5);
  });
});
