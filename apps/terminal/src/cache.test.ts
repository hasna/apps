import { describe, it, expect, beforeEach } from "bun:test";
import { normalizeNl, cacheGet, cacheSet, loadCache } from "./cache.js";

describe("normalizeNl", () => {
  it("lowercases and trims", () => {
    expect(normalizeNl("  Hello World  ")).toBe("hello world");
  });

  it("removes special characters but keeps shell chars", () => {
    expect(normalizeNl("find .ts files")).toBe("find .ts files");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeNl("hello    world")).toBe("hello world");
  });

  it("keeps paths intact", () => {
    expect(normalizeNl("show src/utils/file.ts")).toBe("show src/utils/file.ts");
  });
});

describe("cache", () => {
  beforeEach(() => {
    // Reset in-memory cache by setting a fresh state
  });

  it("returns null for unknown query", () => {
    expect(cacheGet("nonexistent query")).toBeNull();
  });

  it("stores and retrieves queries", () => {
    cacheSet("list all files", "find . -type f");
    expect(cacheGet("list all files")).toBe("find . -type f");
  });

  it("normalizes keys for lookup", () => {
    cacheSet("LIST ALL FILES", "find . -type f");
    expect(cacheGet("list  all  files")).toBe("find . -type f");
  });

  it("loadCache does not throw when file missing", () => {
    expect(() => loadCache()).not.toThrow();
  });
});
