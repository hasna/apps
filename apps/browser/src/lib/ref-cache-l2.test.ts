/**
 * L2 (mementos) round-trip tests for the element ref cache.
 * Uses the REAL @hasna/mementos SDK against one isolated temp DB so the
 * fleet store is never touched. Verifies that getCachedRefs repopulates L1
 * from mementos after in-process invalidation, and that the cacheKey is the
 * shared identity between both layers.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cacheRefs, getCachedRefs, invalidateRefCache } from "./ref-cache.js";
import type { RefInfo } from "../types/index.js";

const REF: RefInfo = { role: "link", name: "Docs", visible: true, enabled: true };

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ref-cache-l2-test-"));
  process.env["HASNA_MEMENTOS_DB_PATH"] = join(tmpDir, "mementos.db");
});

afterAll(() => {
  delete process.env["HASNA_MEMENTOS_DB_PATH"];
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  invalidateRefCache();
});

describe("ref cache L2 round-trip", () => {
  it("repopulates L1 from mementos after invalidation", async () => {
    await cacheRefs("https://example.com/l2", { a: REF });
    invalidateRefCache(); // drop L1; L2 entry persists in the isolated store
    const hit = await getCachedRefs("https://example.com/l2");
    expect(hit).not.toBeNull();
    expect(hit?.a).toEqual(REF);
  });

  it("uses the same normalized key in both layers (query dropped)", async () => {
    await cacheRefs("https://example.com/q?token=1", { a: REF });
    invalidateRefCache();
    const hit = await getCachedRefs("https://example.com/q?token=2");
    expect(hit?.a).toEqual(REF);
  });

  it("misses on L2 for a URL never cached", async () => {
    invalidateRefCache();
    expect(await getCachedRefs("https://example.com/never-cached")).toBeNull();
  });

  it("overwrites the L2 entry when the same URL is re-cached", async () => {
    await cacheRefs("https://example.com/overwrite", { a: REF });
    const updated: RefInfo = { role: "button", name: "Renamed", visible: false, enabled: false };
    await cacheRefs("https://example.com/overwrite", { a: updated });
    invalidateRefCache();
    const hit = await getCachedRefs("https://example.com/overwrite");
    expect(hit?.a).toEqual(updated);
  });
});
