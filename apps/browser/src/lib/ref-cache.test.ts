/**
 * Tests for the element ref cache L1 contract (src/lib/ref-cache.ts).
 * The mementos L2 SDK is mocked away here so the tests exercise only the
 * in-process cache: key normalization, TTL, capacity eviction, invalidation.
 * The real mementos round-trip is covered in ref-cache-l2.test.ts.
 */
import { describe, expect, it, beforeEach, afterEach, setSystemTime, mock } from "bun:test";
import { cacheRefs, getCachedRefs, invalidateRefCache } from "./ref-cache.js";
import type { RefInfo } from "../types/index.js";

// L2 is a no-op in this file — the module's dynamic import resolves to this mock.
mock.module("@hasna/mementos", () => ({
  createMemory: async () => ({ ok: true }),
  getMemoryByKey: async () => null,
}));

const REF: RefInfo = { role: "button", name: "Save", visible: true, enabled: true };

beforeEach(() => {
  invalidateRefCache(); // module-level L1 persists between tests
});

afterEach(() => {
  invalidateRefCache();
  setSystemTime();
});

describe("ref cache key normalization", () => {
  it("drops query strings: different queries on the same path share one entry", async () => {
    await cacheRefs("https://example.com/pricing?tab=monthly&ref=abc", { btn: REF });
    const hit = await getCachedRefs("https://example.com/pricing?tab=yearly&ref=xyz");
    expect(hit).not.toBeNull();
    expect(hit?.btn).toEqual(REF);
  });

  it("drops hash fragments", async () => {
    await cacheRefs("https://example.com/docs#section-2", { a: REF });
    const hit = await getCachedRefs("https://example.com/docs#section-9");
    expect(hit?.a).toEqual(REF);
  });

  it("separates entries by hostname", async () => {
    await cacheRefs("https://example.com/page", { a: REF });
    const miss = await getCachedRefs("https://other.com/page");
    expect(miss).toBeNull();
  });

  it("separates entries by pathname", async () => {
    await cacheRefs("https://example.com/a", { a: REF });
    const miss = await getCachedRefs("https://example.com/b");
    expect(miss).toBeNull();
  });

  it("falls back to the raw string for unparseable URLs", async () => {
    await cacheRefs("not a url at all", { a: REF });
    const hit = await getCachedRefs("not a url at all");
    expect(hit?.a).toEqual(REF);
    // And a parseable URL must NOT collide with the raw-string key
    const miss = await getCachedRefs("https://not-a-url-at-all.example/x");
    expect(miss).toBeNull();
  });
});

describe("ref cache TTL and lifecycle", () => {
  it("returns cached refs while fresh", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await cacheRefs("https://example.com/fresh", { a: REF });
    const hit = await getCachedRefs("https://example.com/fresh");
    expect(hit?.a).toEqual(REF);
  });

  it("evicts entries after the one-hour TTL", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await cacheRefs("https://example.com/expires", { a: REF });
    setSystemTime(new Date("2026-01-01T01:00:01Z")); // TTL + 1s
    const miss = await getCachedRefs("https://example.com/expires");
    expect(miss).toBeNull();
  });

  it("keeps entries alive just under the TTL", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await cacheRefs("https://example.com/border", { a: REF });
    setSystemTime(new Date("2026-01-01T00:59:59Z")); // TTL - 1s
    const hit = await getCachedRefs("https://example.com/border");
    expect(hit?.a).toEqual(REF);
  });

  it("evicts the oldest entry when capacity (500) is exceeded", async () => {
    // Fill to exactly 500 distinct keys
    for (let i = 0; i < 500; i++) {
      await cacheRefs(`https://cap.example/p/${i}`, { a: REF });
    }
    expect((await getCachedRefs("https://cap.example/p/0"))?.a).toEqual(REF);

    // The 501st insert evicts the oldest (p/0)
    await cacheRefs("https://cap.example/p/500", { a: REF });
    expect(await getCachedRefs("https://cap.example/p/0")).toBeNull();
    expect((await getCachedRefs("https://cap.example/p/500"))?.a).toEqual(REF);
  });

  it("re-caching an existing key does not evict anything else", async () => {
    for (let i = 0; i < 500; i++) {
      await cacheRefs(`https://cap2.example/p/${i}`, { a: REF });
    }
    // Refresh an existing key — must not evict the head
    await cacheRefs("https://cap2.example/p/0", { a: REF, extra: REF });
    expect((await getCachedRefs("https://cap2.example/p/1"))?.a).toEqual(REF);
  });
});

describe("ref cache invalidation", () => {
  it("invalidates a single URL while leaving others intact", async () => {
    await cacheRefs("https://example.com/one", { a: REF });
    await cacheRefs("https://example.com/two", { a: REF });
    invalidateRefCache("https://example.com/one?ignored=1"); // query dropped → same key
    expect(await getCachedRefs("https://example.com/one")).toBeNull();
    expect((await getCachedRefs("https://example.com/two"))?.a).toEqual(REF);
  });

  it("clears every entry when called without a URL", async () => {
    await cacheRefs("https://example.com/x", { a: REF });
    await cacheRefs("https://other.com/y", { a: REF });
    invalidateRefCache();
    expect(await getCachedRefs("https://example.com/x")).toBeNull();
    expect(await getCachedRefs("https://other.com/y")).toBeNull();
  });
});
