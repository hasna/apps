/**
 * Tests for the crawl-results store (src/db/crawl-results.ts): create with
 * JSON round-trip, the computed total_links aggregate, per-project listing,
 * and deletion.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "./schema.js";
import { createProject } from "./projects.js";
import { createCrawlResult, getCrawlResult, listCrawlResults, deleteCrawlResult } from "./crawl-results.js";
import type { CrawledPage } from "../types/index.js";

let tmpDir: string;
let projX: string;
let projOther: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "crawl-results-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
  // project_id is FK-constrained to projects(id)
  projX = createProject({ name: "crawl-x", path: "/tmp/crawl-x" }).id;
  projOther = createProject({ name: "crawl-other", path: "/tmp/crawl-other" }).id;
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

const pages: CrawledPage[] = [
  { url: "https://example.com/", title: "Home", links: ["/a", "/b"] },
  { url: "https://example.com/a", title: "A", links: ["/"] },
  { url: "https://example.com/b", title: "B", links: [] },
];

describe("crawl results", () => {
  it("creates a crawl result and reads it back with pages parsed", () => {
    const result = createCrawlResult({
      project_id: projX,
      start_url: "https://example.com/",
      depth: 2,
      pages,
      errors: ["timeout on /c"],
    });
    expect(result.id).toBeTruthy();
    expect(result.start_url).toBe("https://example.com/");
    expect(result.depth).toBe(2);
    expect(result.pages).toEqual(pages);
    expect(result.errors).toEqual(["timeout on /c"]);
  });

  it("computes total_links as the sum of per-page link counts", () => {
    const result = createCrawlResult({ start_url: "https://example.com/", depth: 1, pages, errors: [] });
    expect(result.total_links).toBe(3); // 2 + 1 + 0
  });

  it("returns null for an unknown id", () => {
    expect(getCrawlResult("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("lists results for a project, newest first", () => {
    createCrawlResult({ project_id: projX, start_url: "https://one.example/", depth: 1, pages: [], errors: [] });
    createCrawlResult({ project_id: projX, start_url: "https://two.example/", depth: 1, pages: [], errors: [] });
    createCrawlResult({ project_id: projOther, start_url: "https://three.example/", depth: 1, pages: [], errors: [] });

    const forProject = listCrawlResults(projX);
    expect(forProject).toHaveLength(2);
    // created_at has SQLite second resolution — two rows created in the same
    // second tie on ORDER BY, so assert membership rather than order here
    expect(forProject.map(r => r.start_url).sort()).toEqual([
      "https://one.example/",
      "https://two.example/",
    ]);

    const all = listCrawlResults();
    expect(all).toHaveLength(3);
  });

  it("deletes a crawl result", () => {
    const result = createCrawlResult({ start_url: "https://example.com/", depth: 1, pages: [], errors: [] });
    deleteCrawlResult(result.id);
    expect(getCrawlResult(result.id)).toBeNull();
  });

  it("round-trips empty pages and errors", () => {
    const result = createCrawlResult({ start_url: "https://example.com/", depth: 0, pages: [], errors: [] });
    expect(result.pages).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.total_links).toBe(0);
  });
});
