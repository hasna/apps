import { describe, test, expect } from "bun:test";
import { renderMarkdownDiff } from "./compare.js";

describe("renderMarkdownDiff", () => {
  test("renders no-change message", () => {
    const md = renderMarkdownDiff({
      regressions: [],
      improvements: [],
      scoreDelta: 0,
      passRateDelta: 0,
    });

    expect(md).toContain("## Diff");
    expect(md).toContain("No changes between runs");
  });

  test("renders regressions, improvements, and score delta", () => {
    const md = renderMarkdownDiff({
      regressions: [{ caseId: "case-1", before: "PASS", after: "FAIL" }],
      improvements: [{ caseId: "case-2", before: "FAIL", after: "PASS" }],
      scoreDelta: 0,
      passRateDelta: -0.2,
    });

    expect(md).toContain("### Regressions");
    expect(md).toContain("case-1: PASS -> FAIL");
    expect(md).toContain("### Improvements");
    expect(md).toContain("case-2: FAIL -> PASS");
    expect(md).toContain("Score delta: -20.0%");
  });
});
