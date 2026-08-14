import { describe, it, expect } from "bun:test";
import { diffOutput, clearDiffCache } from "./diff-cache.js";

describe("diffOutput", () => {
  it("returns first run with no previous", () => {
    clearDiffCache();
    const result = diffOutput("npm test", "/tmp", "PASS\n5 passed");
    expect(result.hasPrevious).toBe(false);
    expect(result.diffSummary).toBe("first run");
    expect(result.tokensSaved).toBe(0);
  });

  it("detects identical output", () => {
    clearDiffCache();
    diffOutput("npm test", "/tmp/id", "PASS\n5 passed");
    const result = diffOutput("npm test", "/tmp/id", "PASS\n5 passed");
    expect(result.unchanged).toBe(true);
    expect(result.diffSummary).toBe("identical to previous run");
  });

  it("computes diff for changed output", () => {
    clearDiffCache();
    diffOutput("npm test", "/tmp/diff", "PASS test1\nPASS test2\nFAIL test3");
    const result = diffOutput("npm test", "/tmp/diff", "PASS test1\nPASS test2\nPASS test3");
    expect(result.hasPrevious).toBe(true);
    expect(result.unchanged).toBe(false);
    expect(result.added).toContain("PASS test3");
    expect(result.removed).toContain("FAIL test3");
  });
});
