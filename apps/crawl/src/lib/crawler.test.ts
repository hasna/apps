import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── Isolation ────────────────────────────────────────────────────────────────

let dbPath: string;
let home: string;
const servers: Bun.Server[] = [];

beforeEach(() => {
  dbPath = `/tmp/crawl-crawler-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
  home = mkdtempSync(join(tmpdir(), "crawl-crawler-home-"));
  process.env["HOME"] = home;
  delete process.env["USERPROFILE"];
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  delete process.env["HOME"];
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
  rmSync(home, { recursive: true, force: true });
});

function serveSite(): { baseUrl: string; requests: string[] } {
  const requests: string[] = [];
  let base = "";
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      requests.push(url.pathname);
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /private\n", {
          headers: { "content-type": "text/plain" },
        });
      }
      if (url.pathname === "/sitemap.xml") {
        return new Response(
          `<urlset><url><loc>${base}/sitemap-page</loc></url></urlset>`,
          { headers: { "content-type": "application/xml" } }
        );
      }
      if (url.pathname === "/private") {
        return new Response("<html><body>secret</body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/b") {
        return new Response("<html><body><a href=\"/c\">C</a></body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/c") {
        return new Response("<html><body>page c</body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      // default: homepage with a spread of link shapes
      return new Response(
        `<html><body>
          <a href="/b">B</a>
          <a href="/private">private</a>
          <a href="https://ext.example/x">external</a>
          <a href="https://sub.127.0.0.1:9/y">subdomain</a>
          <a href="/skip-me/file.pdf">pdf</a>
        </body></html>`,
        { headers: { "content-type": "text/html" } }
      );
    },
  });
  servers.push(server);
  base = `http://127.0.0.1:${server.port}`;
  return { baseUrl: base, requests };
}

async function loadCrawler() {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  return await import("./crawler.js");
}

// ─── shouldCrawlUrl ───────────────────────────────────────────────────────────

describe("shouldCrawlUrl", () => {
  it("allows http and https URLs", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("https://example.com/")).toBe(true);
    expect(shouldCrawlUrl("http://example.com/a?q=1")).toBe(true);
  });

  it("rejects non-http protocols", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("mailto:someone@example.com")).toBe(false);
    expect(shouldCrawlUrl("ftp://example.com/file")).toBe(false);
    expect(shouldCrawlUrl("javascript:void(0)")).toBe(false);
    expect(shouldCrawlUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects fragment-only root URLs", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("https://example.com/#section")).toBe(false);
  });

  it("allows fragments on non-root paths", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("https://example.com/page#section")).toBe(true);
  });

  it("rejects binary and asset extensions case-insensitively", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("https://example.com/img.JPG")).toBe(false);
    expect(shouldCrawlUrl("https://example.com/app.css")).toBe(false);
    expect(shouldCrawlUrl("https://example.com/bundle.js")).toBe(false);
    expect(shouldCrawlUrl("https://example.com/archive.zip")).toBe(false);
    expect(shouldCrawlUrl("https://example.com/report.docx")).toBe(false);
    expect(shouldCrawlUrl("https://example.com/movie.mp4")).toBe(false);
  });

  it("does not treat a query string extension as a file extension", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("https://example.com/page?id=.jpg")).toBe(true);
  });

  it("returns false for a malformed URL", async () => {
    const { shouldCrawlUrl } = await loadCrawler();
    expect(shouldCrawlUrl("not a url")).toBe(false);
  });
});

// ─── startCrawl ───────────────────────────────────────────────────────────────

describe("startCrawl", () => {
  it("crawls the seed page and follows same-domain internal links within depth", async () => {
    const { baseUrl } = serveSite();
    const { startCrawl } = await loadCrawler();
    const { listPages } = await import("../db/pages.js");
    const { getCrawl } = await import("../db/crawls.js");

    const crawl = await startCrawl({
      url: `${baseUrl}/`,
      depth: 1,
      options: { delay: 0, maxConcurrent: 5 },
    });

    expect(crawl.status).toBe("completed");
    const pages = listPages(crawl.id, { limit: 100 });
    const urls = pages.map((p) => p.url);
    expect(urls).toContain(`${baseUrl}/`);
    expect(urls).toContain(`${baseUrl}/b`);
    // Every depth-1 same-domain link is crawled, including /private and the
    // .pdf path (pdf is not in the binary-extension blocklist).
    expect(urls).toContain(`${baseUrl}/private`);
    expect(urls).toContain(`${baseUrl}/skip-me/file.pdf`);
    // /c is one hop deeper than depth 1; external and subdomain hosts are
    // outside the domain policy.
    expect(urls).not.toContain(`${baseUrl}/c`);
    expect(urls).not.toContain("https://ext.example/x");
    expect(urls).not.toContain("https://sub.127.0.0.1:9/y");
    expect(getCrawl(crawl.id)!.pagesCrawled).toBe(pages.length);
  });

  it("caps the number of pages at maxPages", async () => {
    const { baseUrl } = serveSite();
    const { startCrawl } = await loadCrawler();
    const { listPages } = await import("../db/pages.js");

    const crawl = await startCrawl({
      url: `${baseUrl}/`,
      depth: 3,
      maxPages: 2,
      options: { delay: 0 },
    });

    expect(crawl.status).toBe("completed");
    expect(listPages(crawl.id, { limit: 100 })).toHaveLength(2);
  });

  it("applies the include filter to discovered links", async () => {
    const { baseUrl } = serveSite();
    const { startCrawl } = await loadCrawler();
    const { listPages } = await import("../db/pages.js");

    const crawl = await startCrawl({
      url: `${baseUrl}/`,
      depth: 2,
      options: { delay: 0, include: ["/b"] },
    });

    const urls = listPages(crawl.id, { limit: 100 }).map((p) => p.url);
    expect(urls).toContain(`${baseUrl}/b`);
    expect(urls).not.toContain(`${baseUrl}/c`);
  });

  it("applies the exclude filter to discovered links", async () => {
    const { baseUrl } = serveSite();
    const { startCrawl } = await loadCrawler();
    const { listPages } = await import("../db/pages.js");

    const crawl = await startCrawl({
      url: `${baseUrl}/`,
      depth: 2,
      options: { delay: 0, exclude: ["/b"] },
    });

    const urls = listPages(crawl.id, { limit: 100 }).map((p) => p.url);
    expect(urls).not.toContain(`${baseUrl}/b`);
    expect(urls).not.toContain(`${baseUrl}/c`);
  });

  it("does not collect links from a page with a nofollow robots meta", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        requests.push(url.pathname);
        if (url.pathname === "/") {
          return new Response(
            '<html><head><meta name="robots" content="nofollow"></head><body><a href="/child">child</a></body></html>',
            { headers: { "content-type": "text/html" } }
          );
        }
        return new Response("<html><body>child</body></html>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const { startCrawl } = await loadCrawler();
    const { listPages } = await import("../db/pages.js");

    const crawl = await startCrawl({
      url: `${base}/`,
      depth: 2,
      options: { delay: 0 },
    });

    const urls = listPages(crawl.id, { limit: 100 }).map((p) => p.url);
    expect(urls).toEqual([`${base}/`]);
    expect(requests).not.toContain("/child");
  });

  it("marks the crawl failed with the error message when the queue throws", async () => {
    const { baseUrl } = serveSite();

    const { startCrawl } = await loadCrawler();
    const { getCrawl } = await import("../db/crawls.js");

    // A throwing onProgress callback makes the BFS batch reject, which is the
    // deterministic path into startCrawl's failure handling.
    const crawl = await startCrawl({
      url: `${baseUrl}/`,
      depth: 1,
      options: {
        delay: 0,
        onProgress: () => {
          throw new Error("progress callback failed");
        },
      },
    });
    expect(crawl.status).toBe("failed");
    expect(crawl.errorMessage).toBe("progress callback failed");
  });
});

// ─── batchCrawl ───────────────────────────────────────────────────────────────

describe("batchCrawl", () => {
  it("throws when given no URLs", async () => {
    const { batchCrawl } = await loadCrawler();
    await expect(batchCrawl([], {})).rejects.toThrow("at least one URL");
  });

  it("crawls each URL and completes", async () => {
    const { baseUrl } = serveSite();
    const { batchCrawl } = await loadCrawler();
    const { listPages } = await import("../db/pages.js");

    const crawl = await batchCrawl([`${baseUrl}/`, `${baseUrl}/b`], {
      delay: 0,
      maxConcurrent: 2,
    });

    expect(crawl.status).toBe("completed");
    expect(crawl.pagesCrawled).toBe(2);
    expect(listPages(crawl.id, { limit: 10 })).toHaveLength(2);
  });
});

// ─── crawlUrl cache ───────────────────────────────────────────────────────────

describe("crawlUrl cache", () => {
  it("returns the cached page when maxAge covers the fetch", async () => {
    const { baseUrl } = serveSite();
    const { crawlUrl } = await loadCrawler();
    const { createCrawl } = await import("../db/crawls.js");
    const crawl = createCrawl({ url: `${baseUrl}/` });

    const first = await crawlUrl(`${baseUrl}/b`, crawl.id, { delay: 0, maxAge: 60_000 });
    const second = await crawlUrl(`${baseUrl}/b`, crawl.id, { delay: 0, maxAge: 60_000 });

    expect(second.id).toBe(first.id);
    expect(second.url).toBe(`${baseUrl}/b`);
  });

  it("crawls fresh when maxAge is zero", async () => {
    const { baseUrl } = serveSite();
    const { crawlUrl } = await loadCrawler();
    const { createCrawl } = await import("../db/crawls.js");
    const crawl = createCrawl({ url: `${baseUrl}/` });

    const first = await crawlUrl(`${baseUrl}/b`, crawl.id, { delay: 0 });
    const second = await crawlUrl(`${baseUrl}/b`, crawl.id, { delay: 0 });

    expect(second.id).not.toBe(first.id);
  });
});

// ─── mapSite ──────────────────────────────────────────────────────────────────

describe("mapSite", () => {
  it("unions sitemap entries and homepage links and caps at the limit", async () => {
    const { baseUrl } = serveSite();
    const { mapSite } = await loadCrawler();

    const urls = await mapSite(`${baseUrl}/`, { limit: 100 });

    expect(urls).toContain(`${baseUrl}/sitemap-page`);
    expect(urls).toContain(`${baseUrl}/b`);
    expect(urls).toContain(`${baseUrl}/private`);
    // External and subdomain hosts are filtered out.
    expect(urls).not.toContain("https://ext.example/x");
    expect(urls).not.toContain("https://sub.127.0.0.1:9/y");
  });

  it("filters by the search pattern and sorts the result", async () => {
    const { baseUrl } = serveSite();
    const { mapSite } = await loadCrawler();

    const urls = await mapSite(`${baseUrl}/`, { search: "/b" });
    expect(urls).toEqual([`${baseUrl}/b`]);
  });

  it("returns sitemap entries only when the homepage is unreachable", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/sitemap.xml") {
          return new Response(
            `<urlset><url><loc>http://other.example/from-sitemap</loc></url></urlset>`,
            { headers: { "content-type": "application/xml" } }
          );
        }
        // Simulate an unavailable homepage with a 500, not a handler throw:
        // mapSite (and fetchPage) catch fetch errors and skip the homepage,
        // while a thrown Bun.serve handler is reported by the test harness
        // as an uncaught error and fails the test regardless of mapSite's
        // own contract.
        return new Response("homepage down", { status: 500 });
      },
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const { mapSite } = await loadCrawler();
    const urls = await mapSite(`${base}/`, { limit: 100 });
    // The sitemap entry points at a different domain and is filtered by the
    // domain policy, so an unavailable homepage leaves an empty map.
    expect(urls).toEqual([]);
  });
});

// ─── recrawl ──────────────────────────────────────────────────────────────────

describe("recrawl", () => {
  it("re-fetches every page and records page versions", async () => {
    const { baseUrl } = serveSite();
    const { crawlUrl, recrawl } = await loadCrawler();
    const { createCrawl } = await import("../db/crawls.js");
    const { getPageVersions } = await import("../db/pages.js");

    const crawl = createCrawl({ url: `${baseUrl}/` });
    const page = await crawlUrl(`${baseUrl}/`, crawl.id, { delay: 0 });

    const result = await recrawl(crawl.id);
    expect(result.status).toBe("completed");
    expect(result.pagesCrawled).toBe(1);

    const versions = getPageVersions(page.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.some((v) => v.diffSummary?.startsWith("recrawl:"))).toBe(true);
  });

  it("throws for a crawl that does not exist", async () => {
    const { recrawl } = await loadCrawler();
    await expect(recrawl("missing")).rejects.toThrow("Crawl not found");
  });
});

// ─── resumeCrawl ──────────────────────────────────────────────────────────────

describe("resumeCrawl", () => {
  it("skips already-visited pages and completes", async () => {
    const { baseUrl } = serveSite();
    const { crawlUrl, resumeCrawl } = await loadCrawler();
    const { createCrawl } = await import("../db/crawls.js");
    const { listPages } = await import("../db/pages.js");

    const crawl = createCrawl({ url: `${baseUrl}/`, depth: 1, maxPages: 10 });
    await crawlUrl(`${baseUrl}/`, crawl.id, { delay: 0 });

    const resumed = await resumeCrawl(crawl.id);
    expect(resumed.status).toBe("completed");
    const urls = listPages(crawl.id, { limit: 100 }).map((p) => p.url);
    // The seed is already visited; the resume should not duplicate it, and
    // should only add new pages within the depth limit.
    expect(urls.filter((u) => u === `${baseUrl}/`)).toHaveLength(1);
  });

  it("throws for a crawl that does not exist", async () => {
    const { resumeCrawl } = await loadCrawler();
    await expect(resumeCrawl("missing")).rejects.toThrow("Crawl not found");
  });
});
