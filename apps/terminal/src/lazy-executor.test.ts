import { describe, it, expect } from "bun:test";
import { shouldBeLazy, toLazy, getSlice } from "./lazy-executor.js";

describe("shouldBeLazy", () => {
  it("returns false for short output", () => {
    const short = Array(10).fill("line").join("\n");
    expect(shouldBeLazy(short)).toBe(false);
  });

  it("returns true for long output", () => {
    const long = Array(300).fill("line").join("\n");
    expect(shouldBeLazy(long)).toBe(true);
  });

  it("returns false for cat command even with long output", () => {
    const long = Array(300).fill("line").join("\n");
    expect(shouldBeLazy(long, "cat large-file.txt")).toBe(false);
  });

  it("returns false for git diff even with long output", () => {
    const long = Array(300).fill("line").join("\n");
    expect(shouldBeLazy(long, "git diff")).toBe(false);
  });

  it("returns false for head command", () => {
    const long = Array(300).fill("line").join("\n");
    expect(shouldBeLazy(long, "head -n 300 file.txt")).toBe(false);
  });

  it("returns false for empty output", () => {
    expect(shouldBeLazy("")).toBe(false);
  });

  it("counts only non-empty lines", () => {
    const withBlanks = Array(300).fill("\n").join("\n");
    expect(shouldBeLazy(withBlanks)).toBe(false);
  });
});

describe("toLazy", () => {
  it("returns lazy result with count and sample", () => {
    const lines = Array(500).fill("data").map((_, i) => `line ${i}`);
    const result = toLazy(lines.join("\n"), "find /");
    expect(result.lazy).toBe(true);
    expect(result.count).toBe(500);
    expect(result.sample).toHaveLength(20);
    expect(result.hint).toContain("500 results");
  });

  it("categorizes file path output", () => {
    const files = [
      "src/file1.ts", "src/file2.ts", "src/sub/file3.ts",
      "test/file1.test.ts", "test/file2.test.ts",
    ];
    const result = toLazy(files.join("\n"), "find .");
    expect(result.categories).toBeDefined();
    expect(Object.keys(result.categories!).length).toBeGreaterThan(0);
  });

  it("omits categories when there is only one", () => {
    const lines = ["item1", "item2", "item3"];
    const result = toLazy(lines.join("\n"), "ls");
    expect(result.categories).toBeUndefined();
  });
});

describe("getSlice", () => {
  it("returns a slice of output", () => {
    const lines = Array(100).fill("line").map((_, i) => `line ${i}`);
    const result = getSlice(lines.join("\n"), 10, 5);
    expect(result.lines).toHaveLength(5);
    expect(result.total).toBe(100);
    expect(result.hasMore).toBe(true);
  });

  it("has hasMore=false at end", () => {
    const lines = Array(20).fill("line").map((_, i) => `line ${i}`);
    const result = getSlice(lines.join("\n"), 15, 10);
    expect(result.hasMore).toBe(false);
    expect(result.lines.length).toBeLessThanOrEqual(5);
  });

  it("returns empty slice for empty input", () => {
    const result = getSlice("", 0, 10);
    expect(result.lines).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});
