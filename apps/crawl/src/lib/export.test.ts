import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";

let dbPath: string;

beforeEach(() => {
  dbPath = `/tmp/crawl-export-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
});

async function seedPage(overrides: Record<string, unknown> = {}) {
  const { createCrawl } = await import("../db/crawls.js");
  const { createPage } = await import("../db/pages.js");
  const crawl = createCrawl({ url: "https://example.com/" });
  const page = createPage({
    crawlId: crawl.id,
    url: "https://example.com/page",
    title: "Example",
    description: "A page",
    textContent: "Hello world",
    markdownContent: "# Hello",
    statusCode: 200,
    wordCount: 2,
    metadata: { lang: "en", canonicalUrl: "https://example.com/page" },
    ...overrides,
  });
  return { crawl, page };
}

describe("exportCrawl", () => {
  it("exports json with pretty-printed page objects", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage();
    const content = await exportCrawl(crawl.id, "json");
    const parsed = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.url).toBe("https://example.com/page");
    expect(content).toContain("\n  ");
  });

  it("exports csv with headers and one row per page", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage();
    const content = await exportCrawl(crawl.id, "csv");
    const lines = content.split("\n");
    expect(lines[0]).toBe(
      "id,url,title,description,word_count,crawled_at,status_code"
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("https://example.com/page");
    expect(lines[1]).toContain("Example");
  });

  it("quotes csv fields containing commas, quotes or newlines", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage({
      title: 'He said "hi", ok',
      description: "line one\nline two",
    });
    const content = await exportCrawl(crawl.id, "csv");
    // The row itself contains an embedded newline inside a quoted field, so it
    // must be taken as the whole remainder after the header line.
    const row = content.slice(content.indexOf("\n") + 1);
    expect(row).toContain('"He said ""hi"", ok"');
    expect(row).toContain('"line one\nline two"');
  });

  it("exports markdown with title, url and markdown content sections", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage();
    const content = await exportCrawl(crawl.id, "md");
    expect(content).toContain("# Example");
    expect(content).toContain("**URL:** https://example.com/page");
    expect(content).toContain("# Hello");
  });

  it("omits null fields from the markdown render", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage({
      title: null,
      description: null,
      statusCode: null,
      wordCount: null,
      markdownContent: null,
    });
    const content = await exportCrawl(crawl.id, "md");
    expect(content).not.toContain("**Word Count:**");
    expect(content).not.toContain("**Status Code:**");
    expect(content).not.toContain("**Description:**");
  });

  it("throws for an unknown export format", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage();
    await expect(
      exportCrawl(crawl.id, "xml" as never)
    ).rejects.toThrow("Unknown export format");
  });

  it("writes the file when an output path is given", async () => {
    const { exportCrawl } = await import("./export.js");
    const { crawl } = await seedPage();
    const out = `/tmp/crawl-export-out-${Date.now()}.json`;
    try {
      await exportCrawl(crawl.id, "json", out);
      const fs = await import("fs");
      expect(fs.existsSync(out)).toBe(true);
      expect(JSON.parse(fs.readFileSync(out, "utf-8"))).toHaveLength(1);
    } finally {
      if (existsSync(out)) unlinkSync(out);
    }
  });
});

describe("exportPage", () => {
  it("exports a single page as json", async () => {
    const { exportPage } = await import("./export.js");
    const { page } = await seedPage();
    const parsed = JSON.parse(await exportPage(page.id, "json")) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe(page.id);
  });

  it("throws when the page does not exist", async () => {
    const { exportPage } = await import("./export.js");
    await expect(exportPage("missing-id", "json")).rejects.toThrow(
      "Page not found"
    );
  });
});
