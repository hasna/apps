import { describe, it, expect } from "bun:test";
import { normalizeUrl, deduplicateResults } from "./dedup";
import type { SearchResult } from "../types/index.js";

describe("normalizeUrl", () => {
  it("should lowercase hostname", () => {
    expect(normalizeUrl("https://Example.COM/path")).toBe("https://example.com/path");
  });

  it("should strip trailing slash", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });

  it("should sort query params", () => {
    const result = normalizeUrl("https://example.com?b=2&a=1");
    expect(result).toBe("https://example.com/?a=1&b=2");
  });

  it("should remove tracking params", () => {
    const result = normalizeUrl("https://example.com/page?utm_source=google&utm_medium=cpc&real=1");
    expect(result).toContain("real=1");
    expect(result).not.toContain("utm_source");
  });

  it("should remove hash", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("should handle invalid URLs gracefully", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("deduplicateResults", () => {
  function makeResult(overrides: Partial<SearchResult>): SearchResult {
    return {
      id: "id-" + Math.random(),
      searchId: "s1",
      title: "Title",
      url: "https://example.com",
      snippet: "Snippet",
      source: "google",
      provider: "Google",
      rank: 1,
      score: 0.5,
      publishedAt: null,
      thumbnail: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("should deduplicate by URL", () => {
    const results = [
      makeResult({ url: "https://example.com/page", source: "google", score: 0.8 }),
      makeResult({ url: "https://example.com/page", source: "exa", score: 0.6 }),
      makeResult({ url: "https://other.com", source: "brave", score: 0.7 }),
    ];
    const deduped = deduplicateResults(results);
    expect(deduped.length).toBe(2);
  });

  it("should keep highest scoring result", () => {
    const results = [
      makeResult({ url: "https://example.com", source: "google", score: 0.3 }),
      makeResult({ url: "https://example.com", source: "exa", score: 0.9 }),
    ];
    const deduped = deduplicateResults(results);
    expect(deduped.length).toBe(1);
    expect(deduped[0]!.source).toBe("exa");
  });

  it("should merge metadata from duplicates", () => {
    const results = [
      makeResult({ url: "https://example.com", source: "google", score: 0.9 }),
      makeResult({ url: "https://example.com", source: "exa", score: 0.5 }),
    ];
    const deduped = deduplicateResults(results);
    expect(deduped[0]!.metadata.also_found_on_exa).toBe(true);
  });

  it("should re-rank results after dedup", () => {
    const results = [
      makeResult({ url: "https://a.com", score: 0.5 }),
      makeResult({ url: "https://b.com", score: 0.9 }),
      makeResult({ url: "https://c.com", score: 0.7 }),
    ];
    const deduped = deduplicateResults(results);
    expect(deduped[0]!.rank).toBe(1);
    expect(deduped[0]!.score).toBe(0.9);
    expect(deduped[2]!.rank).toBe(3);
  });
});
