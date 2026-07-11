import { describe, expect, it } from "bun:test";
import {
  MAX_MCP_LIST_LIMIT,
  MAX_MCP_TEXT_CHARS,
  clampChars,
  clampLimit,
  clampOffset,
  compactList,
  truncateText,
} from "./compact.js";

describe("MCP compact output helpers", () => {
  it("caps list results and reports pagination metadata", () => {
    const result = compactList(
      [{ id: "1", text: "one" }, { id: "2", text: "two" }, { id: "3", text: "three" }],
      2,
      (item) => ({ id: item.id, text: item.text }),
      { hint: "use verbose=true" },
    );

    expect(result.items).toEqual([{ id: "1", text: "one" }, { id: "2", text: "two" }]);
    expect(result.count).toBe(2);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.next_offset).toBe(2);
    expect(result.hint).toBe("use verbose=true");
  });

  it("clamps caller-provided pagination and text sizes", () => {
    expect(clampLimit(undefined, 10)).toBe(10);
    expect(clampLimit(-10, 10)).toBe(10);
    expect(clampLimit(10_000, 10)).toBe(MAX_MCP_LIST_LIMIT);
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(3.8)).toBe(3);
    expect(clampChars(999_999, 100)).toBe(MAX_MCP_TEXT_CHARS);
  });

  it("honors offsets while keeping a maximum page size", () => {
    const items = Array.from({ length: 300 }, (_, index) => ({ id: index }));
    const result = compactList(items, 10_000, (item) => item, { offset: 250 });

    expect(result.items).toHaveLength(50);
    expect(result.count).toBe(50);
    expect(result.total).toBe(300);
    expect(result.limit).toBe(MAX_MCP_LIST_LIMIT);
    expect(result.truncated).toBe(false);
  });

  it("normalizes and truncates long text", () => {
    expect(truncateText("hello\n\nworld", 20)).toBe("hello world");
    expect(truncateText("x".repeat(20), 8)).toBe("xxxxxxx…");
  });
});
