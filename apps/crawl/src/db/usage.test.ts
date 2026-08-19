import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";

let dbPath: string;

beforeEach(() => {
  dbPath = `/tmp/crawl-usage-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
});

afterEach(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
});

describe("recordUsage", () => {
  it("charges the default credit cost per event type", async () => {
    const { recordUsage, getRecentEvents } = await import("./usage.js");
    recordUsage({ eventType: "crawl_page" });
    recordUsage({ eventType: "ai_extraction" });
    recordUsage({ eventType: "screenshot" });

    const events = getRecentEvents();
    const byType = Object.fromEntries(events.map((e) => [e.eventType, e.credits]));
    expect(byType["crawl_page"]).toBe(1);
    expect(byType["ai_extraction"]).toBe(4);
    expect(byType["screenshot"]).toBe(1);
  });

  it("honors an explicit credits override", async () => {
    const { recordUsage, getRecentEvents } = await import("./usage.js");
    recordUsage({ eventType: "crawl_page", credits: 42 });
    expect(getRecentEvents()[0]!.credits).toBe(42);
  });

  it("stores metadata as JSON and round-trips it", async () => {
    const { recordUsage, getRecentEvents } = await import("./usage.js");
    recordUsage({
      eventType: "crawl_page",
      crawlId: "crawl-1",
      pageId: "page-1",
      metadata: { depth: 3, tags: ["a", "b"] },
    });
    const event = getRecentEvents()[0]!;
    expect(event.crawlId).toBe("crawl-1");
    expect(event.pageId).toBe("page-1");
    expect(event.metadata).toEqual({ depth: 3, tags: ["a", "b"] });
  });
});

describe("getUsageSummary", () => {
  it("returns zero totals for an empty database", async () => {
    const { getUsageSummary } = await import("./usage.js");
    const summary = getUsageSummary();
    expect(summary.totalCredits).toBe(0);
    expect(summary.byType).toEqual({});
  });

  it("aggregates totals and per-type credits", async () => {
    const { recordUsage, getUsageSummary } = await import("./usage.js");
    recordUsage({ eventType: "crawl_page" });
    recordUsage({ eventType: "crawl_page" });
    recordUsage({ eventType: "ai_extraction" });

    const summary = getUsageSummary();
    expect(summary.totalCredits).toBe(6);
    expect(summary.byType["crawl_page"]).toEqual({ count: 2, credits: 2 });
    expect(summary.byType["ai_extraction"]).toEqual({ count: 1, credits: 4 });
  });

  it("filters by apiKeyId when given", async () => {
    const { recordUsage, getUsageSummary } = await import("./usage.js");
    recordUsage({ eventType: "crawl_page", apiKeyId: "key-a" });
    recordUsage({ eventType: "crawl_page", apiKeyId: "key-b" });

    const summary = getUsageSummary({ apiKeyId: "key-a" });
    expect(summary.totalCredits).toBe(1);
    expect(summary.byType["crawl_page"]!.count).toBe(1);
  });

  it("filters by the since date, including events at the boundary", async () => {
    const { recordUsage, getUsageSummary } = await import("./usage.js");
    recordUsage({ eventType: "crawl_page" });
    // Ensure strict ordering at millisecond precision before capturing the bound.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const boundary = new Date();
    recordUsage({ eventType: "map_url" });

    const summary = getUsageSummary({ since: boundary });
    expect(summary.totalCredits).toBe(1);
    expect(summary.byType["map_url"]).toBeDefined();
    expect(summary.byType["crawl_page"]).toBeUndefined();
  });
});

describe("getRecentEvents", () => {
  it("returns events newest-first and honors the limit", async () => {
    const { recordUsage, getRecentEvents } = await import("./usage.js");
    for (let i = 0; i < 5; i++) {
      recordUsage({ eventType: "crawl_page" });
    }
    const limited = getRecentEvents({ limit: 3 });
    expect(limited).toHaveLength(3);
    const createdAt = limited.map((e) => e.createdAt);
    expect([...createdAt].sort().reverse()).toEqual(createdAt);
  });

  it("defaults to the last fifty events", async () => {
    const { recordUsage, getRecentEvents } = await import("./usage.js");
    for (let i = 0; i < 60; i++) {
      recordUsage({ eventType: "crawl_page" });
    }
    expect(getRecentEvents()).toHaveLength(50);
  });

  it("filters by apiKeyId", async () => {
    const { recordUsage, getRecentEvents } = await import("./usage.js");
    recordUsage({ eventType: "crawl_page", apiKeyId: "key-a" });
    recordUsage({ eventType: "crawl_page", apiKeyId: "key-b" });
    const events = getRecentEvents({ apiKeyId: "key-a" });
    expect(events).toHaveLength(1);
    expect(events[0]!.apiKeyId).toBe("key-a");
  });
});
