import { describe, it, expect } from "bun:test";
import { diffTexts, hasSignificantChange } from "./diff";

// ─── diffTexts ────────────────────────────────────────────────────────────────

describe("diffTexts", () => {
  it("returns '0 unchanged' for identical strings", () => {
    const text = "line one\nline two\nline three";
    const result = diffTexts(text, text);
    // No additions, no removals — only unchanged lines reported
    expect(result).not.toContain("added");
    expect(result).not.toContain("removed");
    expect(result).toContain("unchanged");
  });

  it("reports added lines when new text has extra content", () => {
    const oldText = "line one\nline two";
    const newText = "line one\nline two\nnew line three";
    const result = diffTexts(oldText, newText);
    expect(result).toContain("1 line added");
    expect(result).not.toContain("removed");
  });

  it("reports multiple added lines", () => {
    const oldText = "alpha";
    const newText = "alpha\nbeta\ngamma\ndelta";
    const result = diffTexts(oldText, newText);
    expect(result).toContain("3 lines added");
  });

  it("reports removed lines when new text is missing content", () => {
    const oldText = "line one\nline two\nline three";
    const newText = "line one";
    const result = diffTexts(oldText, newText);
    expect(result).toContain("removed");
    expect(result).not.toContain("added");
  });

  it("reports multiple removed lines", () => {
    const oldText = "alpha\nbeta\ngamma\ndelta";
    const newText = "alpha";
    const result = diffTexts(oldText, newText);
    expect(result).toContain("3 lines removed");
  });

  it("reports mixed changes (adds and removals)", () => {
    const oldText = "keep\nold1\nold2";
    const newText = "keep\nnew1\nnew2\nnew3";
    const result = diffTexts(oldText, newText);
    expect(result).toContain("added");
    expect(result).toContain("removed");
    expect(result).toContain("unchanged");
  });

  it("handles empty old text and non-empty new text", () => {
    const result = diffTexts("", "hello\nworld");
    expect(result).toContain("added");
  });

  it("handles non-empty old text and empty new text", () => {
    const result = diffTexts("hello\nworld", "");
    expect(result).toContain("removed");
  });

  it("handles both strings empty", () => {
    const result = diffTexts("", "");
    // Both empty split by \n yields [""] for each — both have the empty string line, so 1 unchanged
    expect(result).toContain("unchanged");
    expect(result).not.toContain("added");
    expect(result).not.toContain("removed");
  });

  it("uses singular 'line' for exactly 1 added", () => {
    const result = diffTexts("same", "same\nextra");
    expect(result).toContain("1 line added");
    expect(result).not.toContain("1 lines added");
  });

  it("uses singular 'line' for exactly 1 removed", () => {
    const result = diffTexts("same\nremoved", "same");
    expect(result).toContain("1 line removed");
    expect(result).not.toContain("1 lines removed");
  });

  it("uses plural 'lines' for more than 1 added", () => {
    const result = diffTexts("x", "x\na\nb");
    expect(result).toContain("2 lines added");
  });

  it("uses plural 'lines' for more than 1 removed", () => {
    const result = diffTexts("x\na\nb", "x");
    expect(result).toContain("2 lines removed");
  });

  it("handles single-line strings without newlines", () => {
    const result = diffTexts("old content", "new content");
    expect(result).toContain("1 line added");
    expect(result).toContain("1 line removed");
  });
});

// ─── hasSignificantChange ─────────────────────────────────────────────────────

describe("hasSignificantChange", () => {
  it("returns false for identical strings", () => {
    const text = "some content here\nwith multiple lines";
    expect(hasSignificantChange(text, text)).toBe(false);
  });

  it("returns false when old and new are both empty", () => {
    expect(hasSignificantChange("", "")).toBe(false);
  });

  it("returns true when old is empty and new is non-empty", () => {
    expect(hasSignificantChange("", "brand new content")).toBe(true);
  });

  it("returns true for completely different content", () => {
    const oldText = "alpha\nbeta\ngamma\ndelta\nepsilon";
    const newText = "one\ntwo\nthree\nfour\nfive";
    expect(hasSignificantChange(oldText, newText)).toBe(true);
  });

  it("returns false for a tiny change below 5% threshold", () => {
    // Build a large document with one small change
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Line number ${i} of the document`);
    }
    const oldText = lines.join("\n");
    // Change just 1 line out of 100 — that's 2 changed entries out of 200 total = 1% ratio
    lines[50] = "This line is slightly different";
    const newText = lines.join("\n");

    expect(hasSignificantChange(oldText, newText)).toBe(false);
  });

  it("returns true for a change above 5% threshold", () => {
    // Build a small document where a large proportion changes
    const oldText = "line1\nline2\nline3\nline4\nline5";
    // 4 of 5 lines are different — that's a huge change ratio
    const newText = "lineA\nlineB\nlineC\nlineD\nline5";
    expect(hasSignificantChange(oldText, newText)).toBe(true);
  });

  it("returns false when strings differ only by leading/trailing whitespace on a single shared line", () => {
    // Both contain the same single line — set-based diff sees no difference
    const oldText = "same";
    const newText = "same";
    expect(hasSignificantChange(oldText, newText)).toBe(false);
  });

  it("handles multi-line content with identical line sets (reordered)", () => {
    // Set-based diff: same unique lines, just reordered — both sets are equal
    const oldText = "apple\nbanana\ncherry";
    const newText = "cherry\nbanana\napple";
    // All lines exist in both sets → changed = 0 → ratio = 0 → no significant change
    expect(hasSignificantChange(oldText, newText)).toBe(false);
  });

  it("returns true when half the lines change in a short document", () => {
    const oldText = "one\ntwo";
    // "two" is shared, "three" is new, "one" is removed: changed=2, total=2, ratio=2/4=0.5 > 0.05
    const newText = "two\nthree";
    expect(hasSignificantChange(oldText, newText)).toBe(true);
  });
});
