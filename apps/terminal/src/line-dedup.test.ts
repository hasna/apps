import { describe, it, expect, beforeEach } from "bun:test";
import { dedup, clearDedup } from "./line-dedup.js";

beforeEach(() => {
  clearDedup();
});

describe("dedup", () => {
  it("does not deduplicate short output", () => {
    const result = dedup("line1\nline2\nline3");
    expect(result.deduplicated).toBe(false);
    expect(result.output).toBe("line1\nline2\nline3");
  });

  it("adds short output to seen set", () => {
    const result = dedup("line1\nline2\nline3");
    expect(result.novelCount).toBe(3);
    expect(result.seenCount).toBe(0);
  });

  it("deduplicates when >50% lines already seen", () => {
    // Seed with 10 lines
    dedup(Array(10).fill("seen").map((_, i) => `Line ${i}`).join("\n"));
    // Now output with 8 seen + 2 new
    const newOutput = [...Array(8).fill("seen").map((_, i) => `Line ${i}`), "New 1", "New 2"].join("\n");
    const result = dedup(newOutput);
    expect(result.deduplicated).toBe(true);
    expect(result.seenCount).toBe(8);
    expect(result.output).toContain("already shown");
  });

  it("does not deduplicate when <50% seen", () => {
    dedup("A\nB\nC\nD\nE\nF\nG\nH\nI\nJ");
    const newOutput = [...Array(5).fill("seen").map((_, i) => String.fromCharCode(65 + i)), ...Array(10).fill(0).map((_, i) => `New ${i}`)].join("\n");
    const result = dedup(newOutput);
    expect(result.deduplicated).toBe(false);
    expect(result.seenCount).toBe(0);
  });

  it("preserves empty lines", () => {
    const result = dedup("line1\n\nline2\nline3\nline4\nline5");
    expect(result.output).toContain("\n\n");
  });

  it("clearDedup resets seen set", () => {
    dedup(Array(10).fill("seen").map((_, i) => `Line ${i}`).join("\n"));
    clearDedup();
    const newOutput = [...Array(8).fill("seen").map((_, i) => `Line ${i}`), "New 1", "New 2"].join("\n");
    const result = dedup(newOutput);
    expect(result.deduplicated).toBe(false);
  });
});
