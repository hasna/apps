import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";

// Regression: async crawl routes returned one crawl record id while the
// background worker created a DIFFERENT record (release-review P1 for
// @hasna/crawl@0.4.19). startCrawl/batchCrawl must perform the work under the
// pre-created record id when one is passed in.

let dbPath: string;

async function resetDb() {
  const { closeDb } = await import("../db/database.js");
  closeDb();
}

beforeEach(() => {
  dbPath = `/tmp/test-crawl-id-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
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

async function serveFixture(): Promise<{ base: string; stop: () => void }> {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nAllow: /");
      }
      return new Response(
        "<!doctype html><html><head><title>fixture</title></head><body><p>hello</p></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    },
  });
  return { base: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("async crawl job identity", () => {
  it("startCrawl with a pre-created crawlId completes THAT record and creates no orphan", async () => {
    const { createCrawl, getCrawl, listCrawls } = await import("../db/crawls.js");
    const { startCrawl } = await import("./crawler.js");
    const fixture = await serveFixture();
    try {
      const pre = createCrawl({ url: `${fixture.base}/`, depth: 0, maxPages: 2 });
      const result = await startCrawl({
        url: `${fixture.base}/`,
        depth: 0,
        maxPages: 2,
        crawlId: pre.id,
      });

      expect(result.id).toBe(pre.id);
      const after = getCrawl(pre.id);
      expect(after?.status).toBe("completed");
      // Exactly one crawl record for this url — the returned id IS the working id.
      const all = listCrawls({});
      expect(all.filter((c) => c.url.startsWith(fixture.base)).length).toBe(1);
    } finally {
      fixture.stop();
    }
  });

  it("batchCrawl with a pre-created crawlId completes THAT record and creates no orphan", async () => {
    const { createCrawl, getCrawl, listCrawls } = await import("../db/crawls.js");
    const { batchCrawl } = await import("./crawler.js");
    const fixture = await serveFixture();
    try {
      const pre = createCrawl({
        url: `${fixture.base}/`,
        maxPages: 2,
      });
      const result = await batchCrawl([`${fixture.base}/`], {}, pre.id);

      expect(result.id).toBe(pre.id);
      const after = getCrawl(pre.id);
      expect(after?.status).toBe("completed");
      const all = listCrawls({});
      expect(all.filter((c) => c.url.startsWith(fixture.base)).length).toBe(1);
    } finally {
      fixture.stop();
    }
  });
});
