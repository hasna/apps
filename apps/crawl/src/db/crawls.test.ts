import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";

// Reset the DB singleton before each test by closing and re-pointing the path.
// We import closeDb lazily (after env is set) inside the beforeEach via dynamic imports.
let dbPath: string;

async function resetDb() {
  // Close and clear the singleton so the next getDb() call uses the new path.
  const { closeDb } = await import("./database");
  closeDb();
}

beforeEach(() => {
  dbPath = `/tmp/test-crawl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
});

afterEach(async () => {
  await resetDb();
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
});

// ─── createCrawl ──────────────────────────────────────────────────────────────

describe("createCrawl", () => {
  it("creates a crawl with required fields and defaults", async () => {
    const { createCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });

    expect(crawl.id).toBeString();
    expect(crawl.url).toBe("https://example.com");
    expect(crawl.domain).toBe("example.com");
    expect(crawl.status).toBe("pending");
    expect(crawl.depth).toBe(1);
    expect(crawl.maxPages).toBe(100);
    expect(crawl.pagesCrawled).toBe(0);
    expect(crawl.options).toEqual({});
    expect(crawl.createdAt).toBeString();
    expect(crawl.updatedAt).toBeString();
    expect(crawl.completedAt).toBeNull();
    expect(crawl.errorMessage).toBeNull();
  });

  it("creates a crawl with all custom fields", async () => {
    const { createCrawl } = await import("./crawls");
    const crawl = createCrawl({
      url: "https://example.com/deep",
      depth: 5,
      maxPages: 500,
      options: { delay: 2000, storeHtml: true, render: false },
    });

    expect(crawl.depth).toBe(5);
    expect(crawl.maxPages).toBe(500);
    expect(crawl.options).toEqual({ delay: 2000, storeHtml: true, render: false });
  });

  it("extracts domain from URL", async () => {
    const { createCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://sub.domain.co.uk/path?q=1" });
    expect(crawl.domain).toBe("sub.domain.co.uk");
  });

  it("stores null domain for invalid URL", async () => {
    const { createCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "not-a-valid-url" });
    expect(crawl.domain).toBeNull();
  });
});

// ─── getCrawl ─────────────────────────────────────────────────────────────────

describe("getCrawl", () => {
  it("returns the correct crawl by id", async () => {
    const { createCrawl, getCrawl } = await import("./crawls");
    const created = createCrawl({ url: "https://example.com" });
    const fetched = getCrawl(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.url).toBe("https://example.com");
  });

  it("returns null for unknown id", async () => {
    const { getCrawl } = await import("./crawls");
    const result = getCrawl("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});

// ─── listCrawls ───────────────────────────────────────────────────────────────

describe("listCrawls", () => {
  it("returns all crawls with no filter", async () => {
    const { createCrawl, listCrawls } = await import("./crawls");
    createCrawl({ url: "https://a.com" });
    createCrawl({ url: "https://b.com" });
    createCrawl({ url: "https://c.com" });

    const crawls = listCrawls();
    expect(crawls.length).toBe(3);
  });

  it("returns empty array when no crawls exist", async () => {
    const { listCrawls } = await import("./crawls");
    expect(listCrawls()).toEqual([]);
  });

  it("filters by status", async () => {
    const { createCrawl, listCrawls, updateCrawl } = await import("./crawls");
    const c1 = createCrawl({ url: "https://a.com" });
    const c2 = createCrawl({ url: "https://b.com" });
    createCrawl({ url: "https://c.com" });

    updateCrawl(c1.id, { status: "running" });
    updateCrawl(c2.id, { status: "running" });

    const running = listCrawls({ status: "running" });
    expect(running.length).toBe(2);
    expect(running.every((c) => c.status === "running")).toBe(true);

    const pending = listCrawls({ status: "pending" });
    expect(pending.length).toBe(1);
  });

  it("respects limit", async () => {
    const { createCrawl, listCrawls } = await import("./crawls");
    createCrawl({ url: "https://a.com" });
    createCrawl({ url: "https://b.com" });
    createCrawl({ url: "https://c.com" });

    const limited = listCrawls({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  it("respects offset", async () => {
    const { createCrawl, listCrawls } = await import("./crawls");
    createCrawl({ url: "https://a.com" });
    createCrawl({ url: "https://b.com" });
    createCrawl({ url: "https://c.com" });

    // List is ordered by created_at DESC — all 3 with offset 2 gives last 1
    const offsetted = listCrawls({ limit: 100, offset: 2 });
    expect(offsetted.length).toBe(1);
  });

  it("respects limit with status filter", async () => {
    const { createCrawl, listCrawls, updateCrawl } = await import("./crawls");
    const c1 = createCrawl({ url: "https://a.com" });
    const c2 = createCrawl({ url: "https://b.com" });
    const c3 = createCrawl({ url: "https://c.com" });
    updateCrawl(c1.id, { status: "completed" });
    updateCrawl(c2.id, { status: "completed" });
    updateCrawl(c3.id, { status: "completed" });

    const limited = listCrawls({ status: "completed", limit: 2 });
    expect(limited.length).toBe(2);
  });
});

// ─── updateCrawl ──────────────────────────────────────────────────────────────

describe("updateCrawl", () => {
  it("updates status to running", async () => {
    const { createCrawl, updateCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const updated = updateCrawl(crawl.id, { status: "running" });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("running");
  });

  it("updates status to completed", async () => {
    const { createCrawl, updateCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const completedAt = new Date().toISOString();
    const updated = updateCrawl(crawl.id, { status: "completed", completedAt });

    expect(updated!.status).toBe("completed");
    expect(updated!.completedAt).toBe(completedAt);
  });

  it("updates status to failed", async () => {
    const { createCrawl, updateCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const updated = updateCrawl(crawl.id, { status: "failed" });

    expect(updated!.status).toBe("failed");
  });

  it("updates pagesCrawled", async () => {
    const { createCrawl, updateCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const updated = updateCrawl(crawl.id, { pagesCrawled: 42 });

    expect(updated!.pagesCrawled).toBe(42);
  });

  it("updates errorMessage", async () => {
    const { createCrawl, updateCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const updated = updateCrawl(crawl.id, { errorMessage: "Connection refused" });

    expect(updated!.errorMessage).toBe("Connection refused");
  });

  it("returns null for unknown id", async () => {
    const { updateCrawl } = await import("./crawls");
    const result = updateCrawl("00000000-0000-0000-0000-000000000000", { status: "running" });
    expect(result).toBeNull();
  });

  it("updates updatedAt timestamp", async () => {
    const { createCrawl, updateCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const before = crawl.updatedAt;

    // Ensure a small time gap
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = updateCrawl(crawl.id, { status: "running" });

    expect(updated!.updatedAt).not.toBe(before);
  });
});

// ─── deleteCrawl ──────────────────────────────────────────────────────────────

describe("deleteCrawl", () => {
  it("deletes an existing crawl and returns true", async () => {
    const { createCrawl, deleteCrawl, getCrawl } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const result = deleteCrawl(crawl.id);

    expect(result).toBe(true);
    expect(getCrawl(crawl.id)).toBeNull();
  });

  it("returns false for unknown id", async () => {
    const { deleteCrawl } = await import("./crawls");
    const result = deleteCrawl("00000000-0000-0000-0000-000000000000");
    expect(result).toBe(false);
  });
});

// ─── getCrawlStats ────────────────────────────────────────────────────────────

describe("getCrawlStats", () => {
  it("returns zero totals for crawl with no pages", async () => {
    const { createCrawl, getCrawlStats } = await import("./crawls");
    const crawl = createCrawl({ url: "https://example.com" });
    const stats = getCrawlStats(crawl.id);

    expect(stats.total).toBe(0);
    expect(stats.statusCodes).toEqual({});
    expect(stats.avgWordCount).toBe(0);
  });

  it("returns correct total page count", async () => {
    const { createCrawl, getCrawlStats } = await import("./crawls");
    const { createPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({ crawlId: crawl.id, url: "https://example.com/a", statusCode: 200 });
    createPage({ crawlId: crawl.id, url: "https://example.com/b", statusCode: 200 });
    createPage({ crawlId: crawl.id, url: "https://example.com/c", statusCode: 404 });

    const stats = getCrawlStats(crawl.id);
    expect(stats.total).toBe(3);
  });

  it("returns status codes breakdown", async () => {
    const { createCrawl, getCrawlStats } = await import("./crawls");
    const { createPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({ crawlId: crawl.id, url: "https://example.com/a", statusCode: 200 });
    createPage({ crawlId: crawl.id, url: "https://example.com/b", statusCode: 200 });
    createPage({ crawlId: crawl.id, url: "https://example.com/c", statusCode: 404 });
    createPage({ crawlId: crawl.id, url: "https://example.com/d", statusCode: 301 });

    const stats = getCrawlStats(crawl.id);
    expect(stats.statusCodes["200"]).toBe(2);
    expect(stats.statusCodes["404"]).toBe(1);
    expect(stats.statusCodes["301"]).toBe(1);
  });

  it("returns correct avgWordCount", async () => {
    const { createCrawl, getCrawlStats } = await import("./crawls");
    const { createPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({ crawlId: crawl.id, url: "https://example.com/a", wordCount: 100 });
    createPage({ crawlId: crawl.id, url: "https://example.com/b", wordCount: 200 });

    const stats = getCrawlStats(crawl.id);
    expect(stats.avgWordCount).toBe(150);
  });

  it("only counts pages belonging to the given crawl", async () => {
    const { createCrawl, getCrawlStats } = await import("./crawls");
    const { createPage } = await import("./pages");
    const crawl1 = createCrawl({ url: "https://a.com" });
    const crawl2 = createCrawl({ url: "https://b.com" });

    createPage({ crawlId: crawl1.id, url: "https://a.com/1", statusCode: 200 });
    createPage({ crawlId: crawl1.id, url: "https://a.com/2", statusCode: 200 });
    createPage({ crawlId: crawl2.id, url: "https://b.com/1", statusCode: 200 });

    const stats = getCrawlStats(crawl1.id);
    expect(stats.total).toBe(2);
  });
});
