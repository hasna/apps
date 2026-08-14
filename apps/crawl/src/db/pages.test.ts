import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";

let dbPath: string;

async function resetDb() {
  const { closeDb } = await import("./database");
  closeDb();
}

beforeEach(() => {
  dbPath = `/tmp/test-pages-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
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

// ─── createPage ───────────────────────────────────────────────────────────────

describe("createPage", () => {
  it("creates a page with required fields only", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    const page = createPage({ crawlId: crawl.id, url: "https://example.com/page" });

    expect(page.id).toBeString();
    expect(page.crawlId).toBe(crawl.id);
    expect(page.url).toBe("https://example.com/page");
    expect(page.statusCode).toBeNull();
    expect(page.contentType).toBeNull();
    expect(page.title).toBeNull();
    expect(page.description).toBeNull();
    expect(page.textContent).toBeNull();
    expect(page.markdownContent).toBeNull();
    expect(page.htmlContent).toBeNull();
    expect(page.metadata).toEqual({});
    expect(page.screenshotPath).toBeNull();
    expect(page.wordCount).toBeNull();
    expect(page.byteSize).toBeNull();
    expect(page.crawledAt).toBeString();
  });

  it("creates a page with all fields", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    const metadata = {
      headings: [{ level: 1, text: "Main Heading" }],
      links: [{ href: "https://example.com/about", text: "About" }],
      images: [{ src: "https://example.com/img.png", alt: "Logo" }],
      lang: "en",
    };

    const page = createPage({
      crawlId: crawl.id,
      url: "https://example.com/full",
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      title: "Full Page",
      description: "A full page with all fields",
      textContent: "Hello world",
      markdownContent: "# Hello world",
      htmlContent: "<h1>Hello world</h1>",
      metadata,
      screenshotPath: "/tmp/screenshot.png",
      wordCount: 2,
      byteSize: 1024,
    });

    expect(page.statusCode).toBe(200);
    expect(page.contentType).toBe("text/html; charset=utf-8");
    expect(page.title).toBe("Full Page");
    expect(page.description).toBe("A full page with all fields");
    expect(page.textContent).toBe("Hello world");
    expect(page.markdownContent).toBe("# Hello world");
    expect(page.htmlContent).toBe("<h1>Hello world</h1>");
    expect(page.metadata).toEqual(metadata);
    expect(page.screenshotPath).toBe("/tmp/screenshot.png");
    expect(page.wordCount).toBe(2);
    expect(page.byteSize).toBe(1024);
  });
});

// ─── getPage ──────────────────────────────────────────────────────────────────

describe("getPage", () => {
  it("returns the correct page by id", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, getPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const created = createPage({ crawlId: crawl.id, url: "https://example.com/about", title: "About" });

    const fetched = getPage(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe("About");
  });

  it("returns null for unknown id", async () => {
    const { getPage } = await import("./pages");
    const result = getPage("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});

// ─── getPageByUrl ─────────────────────────────────────────────────────────────

describe("getPageByUrl", () => {
  it("returns the correct page by crawlId + url", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, getPageByUrl } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    createPage({ crawlId: crawl.id, url: "https://example.com/contact", title: "Contact" });

    const result = getPageByUrl(crawl.id, "https://example.com/contact");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Contact");
  });

  it("returns null when url not found in crawl", async () => {
    const { createCrawl } = await import("./crawls");
    const { getPageByUrl } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    const result = getPageByUrl(crawl.id, "https://example.com/nonexistent");
    expect(result).toBeNull();
  });

  it("does not return page from a different crawl", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, getPageByUrl } = await import("./pages");
    const crawl1 = createCrawl({ url: "https://a.com" });
    const crawl2 = createCrawl({ url: "https://b.com" });

    createPage({ crawlId: crawl1.id, url: "https://shared.com/page" });

    const result = getPageByUrl(crawl2.id, "https://shared.com/page");
    expect(result).toBeNull();
  });
});

// ─── listPages ────────────────────────────────────────────────────────────────

describe("listPages", () => {
  it("returns all pages for a crawl", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, listPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({ crawlId: crawl.id, url: "https://example.com/a" });
    createPage({ crawlId: crawl.id, url: "https://example.com/b" });
    createPage({ crawlId: crawl.id, url: "https://example.com/c" });

    const pages = listPages(crawl.id);
    expect(pages.length).toBe(3);
  });

  it("returns empty array for crawl with no pages", async () => {
    const { createCrawl } = await import("./crawls");
    const { listPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    expect(listPages(crawl.id)).toEqual([]);
  });

  it("only returns pages for the specified crawl", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, listPages } = await import("./pages");
    const crawl1 = createCrawl({ url: "https://a.com" });
    const crawl2 = createCrawl({ url: "https://b.com" });

    createPage({ crawlId: crawl1.id, url: "https://a.com/1" });
    createPage({ crawlId: crawl1.id, url: "https://a.com/2" });
    createPage({ crawlId: crawl2.id, url: "https://b.com/1" });

    expect(listPages(crawl1.id).length).toBe(2);
    expect(listPages(crawl2.id).length).toBe(1);
  });

  it("respects limit and offset", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, listPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({ crawlId: crawl.id, url: "https://example.com/a" });
    createPage({ crawlId: crawl.id, url: "https://example.com/b" });
    createPage({ crawlId: crawl.id, url: "https://example.com/c" });

    const limited = listPages(crawl.id, { limit: 2 });
    expect(limited.length).toBe(2);

    const offsetted = listPages(crawl.id, { limit: 100, offset: 2 });
    expect(offsetted.length).toBe(1);
  });
});

// ─── deletePage ───────────────────────────────────────────────────────────────

describe("deletePage", () => {
  it("deletes a page and returns true", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, deletePage, getPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/del" });

    const result = deletePage(page.id);
    expect(result).toBe(true);
    expect(getPage(page.id)).toBeNull();
  });

  it("returns false for unknown id", async () => {
    const { deletePage } = await import("./pages");
    const result = deletePage("00000000-0000-0000-0000-000000000000");
    expect(result).toBe(false);
  });

  it("cascades page deletion when parent crawl is deleted", async () => {
    const { createCrawl, deleteCrawl } = await import("./crawls");
    const { createPage, getPage } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/cascade" });

    deleteCrawl(crawl.id);

    expect(getPage(page.id)).toBeNull();
  });
});

// ─── searchPages (FTS5) ───────────────────────────────────────────────────────

describe("searchPages", () => {
  it("returns matching results", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, searchPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({
      crawlId: crawl.id,
      url: "https://example.com/typescript",
      title: "TypeScript Guide",
      textContent: "TypeScript is a typed superset of JavaScript",
    });

    const results = searchPages("TypeScript");
    expect(results.length).toBe(1);
    expect(results[0]!.page.title).toBe("TypeScript Guide");
    expect(results[0]!.snippet).toBeString();
    expect(typeof results[0]!.rank).toBe("number");
  });

  it("returns empty array for no match", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, searchPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({
      crawlId: crawl.id,
      url: "https://example.com/page",
      title: "Some Page",
      textContent: "Some content about databases",
    });

    const results = searchPages("xyznonexistentterm");
    expect(results.length).toBe(0);
  });

  it("filters results by domain", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, searchPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({
      crawlId: crawl.id,
      url: "https://example.com/docs",
      title: "Docs on example",
      textContent: "crawling is fun",
    });
    createPage({
      crawlId: crawl.id,
      url: "https://other.com/docs",
      title: "Docs on other",
      textContent: "crawling is fun",
    });

    const results = searchPages("crawling", { domain: "example.com" });
    expect(results.length).toBe(1);
    expect(results[0]!.page.url).toContain("example.com");
  });

  it("filters results by crawlId", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, searchPages } = await import("./pages");
    const crawl1 = createCrawl({ url: "https://a.com" });
    const crawl2 = createCrawl({ url: "https://b.com" });

    createPage({
      crawlId: crawl1.id,
      url: "https://a.com/page",
      title: "Page A",
      textContent: "searching for content",
    });
    createPage({
      crawlId: crawl2.id,
      url: "https://b.com/page",
      title: "Page B",
      textContent: "searching for content",
    });

    const results = searchPages("searching", { crawlId: crawl1.id });
    expect(results.length).toBe(1);
    expect(results[0]!.page.crawlId).toBe(crawl1.id);
  });

  it("returns results ordered by relevance rank", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, searchPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    createPage({
      crawlId: crawl.id,
      url: "https://example.com/very-relevant",
      title: "web crawler web crawler",
      textContent: "web crawler web crawler web crawler",
    });
    createPage({
      crawlId: crawl.id,
      url: "https://example.com/less-relevant",
      title: "web crawler",
      textContent: "some other content",
    });

    const results = searchPages("web");
    expect(results.length).toBe(2);
    // FTS5 rank is negative (BM25); results ordered by rank means most negative = most relevant first
    expect(results[0]!.rank).toBeLessThanOrEqual(results[1]!.rank);
  });

  it("respects limit option", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, searchPages } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });

    for (let i = 0; i < 5; i++) {
      createPage({
        crawlId: crawl.id,
        url: `https://example.com/page${i}`,
        title: `Page ${i}`,
        textContent: "javascript programming language",
      });
    }

    const results = searchPages("javascript", { limit: 3 });
    expect(results.length).toBe(3);
  });
});

// ─── savePageVersion / getPageVersions ────────────────────────────────────────

describe("savePageVersion and getPageVersions", () => {
  it("saves a page version and retrieves it", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, savePageVersion, getPageVersions } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/versioned" });

    savePageVersion(page.id, "Version 1 content", "1 line added");

    const versions = getPageVersions(page.id);
    expect(versions.length).toBe(1);
    expect(versions[0]!.pageId).toBe(page.id);
    expect(versions[0]!.textContent).toBe("Version 1 content");
    expect(versions[0]!.diffSummary).toBe("1 line added");
    expect(versions[0]!.crawledAt).toBeString();
  });

  it("saves multiple versions ordered by crawledAt DESC", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, savePageVersion, getPageVersions } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/multi-version" });

    savePageVersion(page.id, "First version", "initial");
    await new Promise((resolve) => setTimeout(resolve, 5));
    savePageVersion(page.id, "Second version", "1 line added");
    await new Promise((resolve) => setTimeout(resolve, 5));
    savePageVersion(page.id, "Third version", "2 lines added");

    const versions = getPageVersions(page.id);
    expect(versions.length).toBe(3);
    // Ordered DESC — most recent first
    expect(versions[0]!.textContent).toBe("Third version");
    expect(versions[2]!.textContent).toBe("First version");
  });

  it("saves version with null textContent and null diffSummary", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, savePageVersion, getPageVersions } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/null-version" });

    savePageVersion(page.id, null);

    const versions = getPageVersions(page.id);
    expect(versions.length).toBe(1);
    expect(versions[0]!.textContent).toBeNull();
    expect(versions[0]!.diffSummary).toBeNull();
  });

  it("returns empty array when no versions exist", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, getPageVersions } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/no-versions" });

    const versions = getPageVersions(page.id);
    expect(versions).toEqual([]);
  });

  it("cascades page version deletion when page is deleted", async () => {
    const { createCrawl } = await import("./crawls");
    const { createPage, deletePage, savePageVersion, getPageVersions } = await import("./pages");
    const crawl = createCrawl({ url: "https://example.com" });
    const page = createPage({ crawlId: crawl.id, url: "https://example.com/cascade-versions" });

    savePageVersion(page.id, "Some content", "initial");
    expect(getPageVersions(page.id).length).toBe(1);

    deletePage(page.id);
    expect(getPageVersions(page.id).length).toBe(0);
  });
});
