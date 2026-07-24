import { describe, expect, test } from "bun:test";
import {
  limitItems,
  parsePositiveIntegerOption,
  formatShortId,
  summarizeTrainingExample,
  truncateMiddle,
  truncateText,
} from "./compact-output.js";

describe("compact output helpers", () => {
  test("truncateText compacts whitespace and long values", () => {
    expect(truncateText("one\n two\tthree", 20)).toBe("one two three");
    expect(truncateText("x".repeat(20), 8)).toBe("xxxxxxx…");
  });

  test("truncateMiddle keeps both ends of path-like values", () => {
    expect(truncateMiddle("/tmp/" + "x".repeat(20) + "/file.jsonl", 18)).toBe("/tmp/xxxx…le.jsonl");
  });

  test("limitItems reports hidden rows", () => {
    expect(limitItems([1, 2, 3], 2)).toEqual({
      items: [1, 2],
      total: 3,
      shown: 2,
      hidden: 1,
      limit: 2,
    });
  });

  test("formatShortId keeps IDs usable for follow-up detail commands", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(formatShortId(id)).toBe(id);
  });

  test("parsePositiveIntegerOption rejects invalid values", () => {
    expect(parsePositiveIntegerOption(undefined, "--limit", 20)).toBe(20);
    expect(parsePositiveIntegerOption("3", "--limit")).toBe(3);
    expect(() => parsePositiveIntegerOption("0", "--limit")).toThrow("Invalid --limit value");
  });

  test("summarizeTrainingExample truncates message and metadata payloads", () => {
    const summary = summarizeTrainingExample({
      messages: [
        { role: "user", content: "u".repeat(200) },
        { role: "assistant", content: "short" },
      ],
      metadata: { path: "/tmp/" + "p".repeat(200) },
    }, { maxTextLength: 40 });

    expect(summary.messages).toHaveLength(2);
    expect(summary.messages[0]?.content.endsWith("…")).toBe(true);
    expect(summary.metadata?.path.endsWith("…")).toBe(true);
    expect(summary.truncated).toBe(true);
  });
});
