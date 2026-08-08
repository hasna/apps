import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { getIndexDbForTesting } from "../../db/index-db.js";
import { addRoot, indexRoot } from "./indexer.js";
import { findLocal } from "./find.js";

let root: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "search-find-"));
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

describe("findLocal", () => {
  test("returns indexed:false with no roots", () => {
    const res = findLocal("anything", {}, db);
    expect(res.indexed).toBe(false);
    expect(res.results).toEqual([]);
    expect(res.roots).toBe(0);
  });

  test("kind=both merges path and content hits on the same file", () => {
    setup({
      "src/dedup.ts": "export function deduplicate() {}",
      "docs/notes.md": "we should deduplicate results",
    });

    const res = findLocal("dedup", { refresh: false }, db);
    expect(res.indexed).toBe(true);
    expect(res.total).toBe(2);

    const both = res.results.find((r) => r.path.endsWith("src/dedup.ts"))!;
    expect(both.kind).toBe("both");
    expect(both.line).toBe(1);
    expect(both.matches!.length).toBeGreaterThan(0);

    const contentOnly = res.results.find((r) => r.path.endsWith("docs/notes.md"))!;
    expect(contentOnly.kind).toBe("content");

    // file+content match should outrank content-only
    expect(res.results[0]!.path.endsWith("src/dedup.ts")).toBe(true);
  });

  test("kind=file returns only path matches", () => {
    setup({
      "src/dedup.ts": "nothing relevant",
      "docs/notes.md": "mentions dedup in text",
    });
    const res = findLocal("dedup", { kind: "file", refresh: false }, db);
    expect(res.results.length).toBe(1);
    expect(res.results[0]!.kind).toBe("file");
    expect(res.results[0]!.snippet).toBe("src/dedup.ts");
  });

  test("kind=content returns only content matches with line info", () => {
    setup({ "a.md": "first\nthe needleword is here" });
    const res = findLocal("needleword", { kind: "content", refresh: false }, db);
    expect(res.results.length).toBe(1);
    expect(res.results[0]!.line).toBe(2);
    expect(res.results[0]!.snippet).toContain("needleword");
  });

  test("redacts credential assignments without changing safe content or location metadata", () => {
    const syntheticValue = "synthetic-only-not-live-7a31";
    const sensitiveLine = `needleword service_password = ${syntheticValue}`;
    const safeLine = "needleword documents password handling without an assigned value";
    setup({
      "config.txt": `heading\n${sensitiveLine}\nfooter`,
      "guide.txt": safeLine,
    });

    const res = findLocal("needleword", { kind: "content", refresh: false }, db);
    const sensitive = res.results.find((result) => result.path.endsWith("config.txt"))!;
    const safe = res.results.find((result) => result.path.endsWith("guide.txt"))!;

    expect(sensitive.path).toBe(join(root, "config.txt"));
    expect(sensitive.line).toBe(2);
    expect(sensitive.snippet?.includes(syntheticValue)).toBe(false);
    expect(sensitive.snippet).toBe("needleword service_password = [REDACTED]");
    expect(sensitive.matches).toEqual([
      { line: 2, text: "needleword service_password = [REDACTED]" },
    ]);
    expect(safe.snippet).toBe(safeLine);
    expect(safe.matches).toEqual([{ line: 1, text: safeLine }]);
  });

  test("respects limit", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`dir/widget-${i}.ts`] = `widget ${i}`;
    setup(files);
    const res = findLocal("widget", { limit: 5, refresh: false }, db);
    expect(res.results.length).toBe(5);
  });

  test("ext and dir filters apply", () => {
    setup({
      "src/db/helper.ts": "helperfunc",
      "src/lib/helper.md": "helperfunc",
    });
    const res = findLocal("helper", { ext: "ts", refresh: false }, db);
    expect(res.results.length).toBe(1);
    expect(res.results[0]!.path.endsWith("helper.ts")).toBe(true);

    const res2 = findLocal("helper", { dir: "lib", refresh: false }, db);
    expect(res2.results.length).toBe(1);
    expect(res2.results[0]!.path.endsWith("helper.md")).toBe(true);
  });
});
