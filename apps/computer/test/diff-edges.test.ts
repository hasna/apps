// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { describe, expect, test } from "bun:test";
import { compareHashes, computeScreenHash, screenshotsMatch } from "../src/lib/diff.js";
import type { Screenshot } from "../src/types/index.js";

function ss(data: string): Screenshot {
  return { base64: data, size: { width: 1280, height: 800 }, timestamp: Date.now() };
}

describe("diff — hash edge cases", () => {
  test("empty base64 yields an empty hash", () => {
    expect(computeScreenHash(ss(""))).toBe("");
  });

  test("short base64 yields the full string as the hash (below sample size)", () => {
    expect(computeScreenHash(ss("abc"))).toBe("abc");
  });

  test("hash samples evenly from long payloads", () => {
    const data = "A".repeat(1000);
    const hash = computeScreenHash(ss(data));
    expect(hash.length).toBe(256);
    expect(hash).toBe("A".repeat(256));
  });

  test("compareHashes with unequal lengths compares only the shared prefix", () => {
    expect(compareHashes("AAAA", "AA")).toBe(1.0);
    expect(compareHashes("AA", "AAAA")).toBe(1.0);
  });

  test("compareHashes one differing char in a 5-char hash is 0.8", () => {
    expect(compareHashes("AAAAB", "AAAAC")).toBe(0.8);
  });

  test("screenshotsMatch with empty payloads is false, never a crash", () => {
    expect(screenshotsMatch(ss(""), ss(""))).toBe(false);
  });

  test("screenshotsMatch default 0.98 ACCEPTS a single-byte difference in a 600-char payload", () => {
    // Hash samples every 2nd char of 600 chars: only index 256 ("B" vs "C") differs.
    const a = ss(("A".repeat(256) + "B").padEnd(600, "A"));
    const b = ss(("A".repeat(256) + "C").padEnd(600, "A"));
    const ha = computeScreenHash(a);
    const hb = computeScreenHash(b);
    expect(compareHashes(ha, hb)).toBeCloseTo(255 / 256, 5); // ≈ 0.9961
    expect(screenshotsMatch(a, b)).toBe(true); // 0.9961 >= 0.98
    expect(screenshotsMatch(a, b, 0.999)).toBe(false); // stricter threshold rejects it
  });

  test("screenshotsMatch rejects payloads that differ by half", () => {
    // 600 chars sampled every 2nd char: 150 of the 256 sampled positions are
    // "A" in both (even indices 0..298), the other 106 are "B" vs "A"
    // → similarity ≈ 150/256 ≈ 0.586.
    const a = ss("A".repeat(600));
    const b = ss("A".repeat(300) + "B".repeat(300));
    const ha = computeScreenHash(a);
    const hb = computeScreenHash(b);
    expect(compareHashes(ha, hb)).toBeCloseTo(150 / 256, 5);
    expect(screenshotsMatch(a, b)).toBe(false); // 0.586 < 0.98
    expect(screenshotsMatch(a, b, 0.6)).toBe(false); // 0.586 < 0.6
    expect(screenshotsMatch(a, b, 0.5)).toBe(true); // 0.586 >= 0.5
  });
});
