import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { getIndexDbForTesting } from "../../db/index-db.js";
import { addRoot, indexRoot } from "./indexer.js";
import { benchmarkLocalSearch } from "./benchmark.js";

let root: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "search-bench-"));
  db = getIndexDbForTesting();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "router.ts"), "export function routeSearchProviders() {}");
  const indexed = addRoot(root, {}, db);
  indexRoot(indexed.id, {}, db);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("benchmarkLocalSearch", () => {
  test("reports repeated local query timings", () => {
    const report = benchmarkLocalSearch(
      ["routeSearchProviders"],
      { iterations: 2, warmups: 0, kind: "content", refresh: false },
      db,
    );

    expect(report.roots).toBe(1);
    expect(report.files).toBe(1);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.query).toBe("routeSearchProviders");
    expect(report.rows[0]!.iterations).toBe(2);
    expect(report.rows[0]!.resultCount).toBe(1);
    expect(report.rows[0]!.p50Ms).toBeGreaterThanOrEqual(0);
  });
});
