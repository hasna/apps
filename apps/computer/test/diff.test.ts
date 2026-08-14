import { describe, test, expect } from "bun:test";
import { computeScreenHash, compareHashes, screenshotsMatch } from "../src/lib/diff.js";
import type { Screenshot } from "../src/types/index.js";

const makeScreenshot = (data: string): Screenshot => ({
  base64: data,
  size: { width: 1280, height: 800 },
  timestamp: Date.now(),
});

describe("diff", () => {
  test("computeScreenHash returns non-empty string", () => {
    const ss = makeScreenshot("A".repeat(1000));
    const hash = computeScreenHash(ss);
    expect(hash.length).toBeGreaterThan(0);
  });

  test("identical screenshots produce same hash", () => {
    const data = "ABCDEFGHIJ".repeat(100);
    const ss1 = makeScreenshot(data);
    const ss2 = makeScreenshot(data);
    const hash1 = computeScreenHash(ss1);
    const hash2 = computeScreenHash(ss2);
    expect(hash1).toBe(hash2);
  });

  test("different screenshots produce different hashes", () => {
    const ss1 = makeScreenshot("A".repeat(1000));
    const ss2 = makeScreenshot("B".repeat(1000));
    const hash1 = computeScreenHash(ss1);
    const hash2 = computeScreenHash(ss2);
    expect(hash1).not.toBe(hash2);
  });

  test("compareHashes returns 1.0 for identical hashes", () => {
    expect(compareHashes("AAAA", "AAAA")).toBe(1.0);
  });

  test("compareHashes returns 0.0 for completely different hashes", () => {
    expect(compareHashes("AAAA", "BBBB")).toBe(0.0);
  });

  test("compareHashes returns 0.5 for half-matching hashes", () => {
    expect(compareHashes("AABB", "AACC")).toBe(0.5);
  });

  test("compareHashes handles empty strings", () => {
    expect(compareHashes("", "")).toBe(0);
  });

  test("screenshotsMatch returns true for identical data", () => {
    const data = "ABCDEFGHIJ".repeat(200);
    const ss1 = makeScreenshot(data);
    const ss2 = makeScreenshot(data);
    expect(screenshotsMatch(ss1, ss2)).toBe(true);
  });

  test("screenshotsMatch returns false for very different data", () => {
    const ss1 = makeScreenshot("A".repeat(2000));
    const ss2 = makeScreenshot("Z".repeat(2000));
    expect(screenshotsMatch(ss1, ss2)).toBe(false);
  });

  test("screenshotsMatch respects custom threshold", () => {
    const ss1 = makeScreenshot("AAAB".repeat(500));
    const ss2 = makeScreenshot("AAAC".repeat(500));
    // With high threshold they might not match
    // With low threshold they should match
    expect(screenshotsMatch(ss1, ss2, 0.1)).toBe(true);
  });
});
