import { describe, it, expect } from "bun:test";
import { isSourceFile, isExcludedDir, relevanceScore } from "./filters.js";
import { searchContent } from "./content-search.js";

describe("filters", () => {
  it("identifies source files", () => {
    expect(isSourceFile("src/app.ts")).toBe(true);
    expect(isSourceFile("index.tsx")).toBe(true);
    expect(isSourceFile("main.py")).toBe(true);
    expect(isSourceFile("image.png")).toBe(false);
    expect(isSourceFile("binary")).toBe(false);
  });

  it("identifies excluded directories", () => {
    expect(isExcludedDir("./node_modules/foo/bar.js")).toBe(true);
    expect(isExcludedDir("./dist/index.js")).toBe(true);
    expect(isExcludedDir("./.git/config")).toBe(true);
    expect(isExcludedDir("./src/lib/utils.ts")).toBe(false);
  });

  it("scores source files highest", () => {
    expect(relevanceScore("src/app.ts")).toBe(10);
    expect(relevanceScore("./node_modules/foo.js")).toBe(0);
    expect(relevanceScore("binary")).toBe(3);
  });
});

describe("searchContent", () => {
  it("keeps match output compact for agent token budgets", async () => {
    const result = await searchContent("export", process.cwd(), { maxResults: 5 });
    for (const file of result.files) {
      expect(file.matches.length).toBeLessThanOrEqual(3);
      for (const match of file.matches) {
        expect(match.content.length).toBeLessThanOrEqual(120);
      }
    }
  });
});
