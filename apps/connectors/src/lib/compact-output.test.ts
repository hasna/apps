import { describe, test, expect } from "bun:test";
import {
  parseNonNegativeInt,
  normalizeLimit,
  parseCursor,
  pageItems,
  truncateText,
  firstNonEmptyLines,
  compactConnector,
  maybeTruncateOutput,
  DEFAULT_COMPACT_LIMIT,
  DEFAULT_MCP_LIMIT,
  MAX_COMPACT_LIMIT,
  DEFAULT_TEXT_WIDTH,
  DEFAULT_OUTPUT_CHARS,
} from "./compact-output.js";
import { CONNECTORS } from "./registry.js";

describe("parseNonNegativeInt", () => {
  test("undefined input returns no value and no error", () => {
    const r = parseNonNegativeInt(undefined, "--limit");
    expect(r.value).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  test("valid digits parse", () => {
    expect(parseNonNegativeInt("0", "--limit")).toEqual({ value: 0 });
    expect(parseNonNegativeInt("42", "--limit")).toEqual({ value: 42 });
    expect(parseNonNegativeInt("007", "--limit")).toEqual({ value: 7 });
  });

  test("negative numbers are rejected", () => {
    const r = parseNonNegativeInt("-1", "--limit");
    expect(r.value).toBeUndefined();
    expect(r.error).toContain("--limit");
    expect(r.error).toContain("non-negative integer");
  });

  test("non-numeric strings are rejected and name the flag", () => {
    for (const raw of ["abc", "1.5", "", " 5", "5 ", "1e3", "+3"]) {
      const r = parseNonNegativeInt(raw, "--cursor");
      expect(r.value).toBeUndefined();
      expect(r.error).toContain("--cursor");
      expect(r.error).toContain(`'${raw}'`);
    }
  });
});

describe("normalizeLimit", () => {
  test("undefined falls back", () => {
    expect(normalizeLimit(undefined, DEFAULT_COMPACT_LIMIT)).toBe(DEFAULT_COMPACT_LIMIT);
    expect(normalizeLimit(undefined, DEFAULT_MCP_LIMIT)).toBe(DEFAULT_MCP_LIMIT);
  });

  test("non-finite values fall back (NaN/Infinity cannot reach a slice)", () => {
    expect(normalizeLimit(Number.NaN, 5)).toBe(5);
    expect(normalizeLimit(Number.POSITIVE_INFINITY, 5)).toBe(5);
    expect(normalizeLimit(Number.NEGATIVE_INFINITY, 5)).toBe(5);
  });

  test("values below 1 clamp to 1, never to 0 or negative", () => {
    expect(normalizeLimit(0, 5)).toBe(1);
    expect(normalizeLimit(-3, 5)).toBe(1);
  });

  test("fractional values floor before clamping", () => {
    expect(normalizeLimit(2.9, 5)).toBe(2);
    expect(normalizeLimit(0.5, 5)).toBe(1);
  });

  test("values above max clamp to max", () => {
    expect(normalizeLimit(1000, 5)).toBe(MAX_COMPACT_LIMIT);
    expect(normalizeLimit(MAX_COMPACT_LIMIT + 1, 5)).toBe(MAX_COMPACT_LIMIT);
  });

  test("in-range values pass through", () => {
    expect(normalizeLimit(7, 5)).toBe(7);
  });
});

describe("parseCursor", () => {
  test("undefined and empty string both mean page zero", () => {
    expect(parseCursor(undefined)).toEqual({ value: 0 });
    expect(parseCursor("")).toEqual({ value: 0 });
  });

  test("valid cursor parses", () => {
    expect(parseCursor("12")).toEqual({ value: 12 });
  });

  test("invalid cursor reports the --cursor flag", () => {
    const r = parseCursor("abc");
    expect(r.value).toBeUndefined();
    expect(r.error).toContain("--cursor");
  });
});

describe("pageItems", () => {
  const items = [0, 1, 2, 3, 4, 5];

  test("no options returns everything with null limit and nextOffset", () => {
    const r = pageItems(items, {});
    expect(r.items).toEqual(items);
    expect(r.total).toBe(6);
    expect(r.offset).toBe(0);
    expect(r.limit).toBeNull();
    expect(r.nextOffset).toBeNull();
  });

  test("negative offset clamps to zero instead of slicing from the end", () => {
    const r = pageItems(items, { offset: -2, limit: 2 });
    expect(r.offset).toBe(0);
    expect(r.items).toEqual([0, 1]);
  });

  test("exact page boundary returns null nextOffset", () => {
    const r = pageItems(items, { offset: 0, limit: 6 });
    expect(r.items).toHaveLength(6);
    expect(r.nextOffset).toBeNull();
  });

  test("partial page beyond boundary returns null nextOffset", () => {
    const r = pageItems(items, { offset: 5, limit: 10 });
    expect(r.items).toEqual([5]);
    expect(r.nextOffset).toBeNull();
  });

  test("mid-list page reports the next offset arithmetic", () => {
    const r = pageItems(items, { offset: 2, limit: 3 });
    expect(r.items).toEqual([2, 3, 4]);
    expect(r.nextOffset).toBe(5);
  });

  test("empty source list yields empty page and null nextOffset", () => {
    const r = pageItems([], { offset: 0, limit: 10 });
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.nextOffset).toBeNull();
  });

  test("limit below 1 clamps to 1 (never zero-length or negative slice)", () => {
    const r = pageItems(items, { offset: 0, limit: 0 });
    expect(r.items).toEqual([0]);
    expect(r.limit).toBe(1);
  });

  test("fractional limit floors", () => {
    const r = pageItems(items, { offset: 0, limit: 2.9 });
    expect(r.items).toEqual([0, 1]);
    expect(r.limit).toBe(2);
  });

  test("offset beyond the list returns empty items and null nextOffset", () => {
    const r = pageItems(items, { offset: 100 });
    expect(r.items).toEqual([]);
    expect(r.nextOffset).toBeNull();
  });
});

describe("truncateText", () => {
  test("short text passes through unchanged", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  test("undefined/empty normalize to empty string", () => {
    expect(truncateText(undefined)).toBe("");
    expect(truncateText("")).toBe("");
  });

  test("internal whitespace collapses to single spaces and edges trim", () => {
    expect(truncateText("  a   b\t\nc  ")).toBe("a b c");
  });

  test("long text truncates with ellipsis and trims the tail", () => {
    expect(truncateText("abcdefghij", 8)).toBe("abcde...");
  });

  test("max width <= 3 slices without ellipsis", () => {
    expect(truncateText("abcdef", 3)).toBe("abc");
    expect(truncateText("abcdef", 1)).toBe("a");
  });

  test("text exactly at max is not truncated", () => {
    expect(truncateText("abcdefgh", 8)).toBe("abcdefgh");
  });
});

describe("firstNonEmptyLines", () => {
  test("filters blank/whitespace lines before capping", () => {
    const r = firstNonEmptyLines("\n  a  \n\n b \nc\n", 2);
    expect(r).toEqual(["a", "b"]);
  });

  test("caps at maxLines", () => {
    const r = firstNonEmptyLines("a\nb\nc\nd", 2);
    expect(r).toEqual(["a", "b"]);
  });

  test("per-line width truncation applies", () => {
    const r = firstNonEmptyLines("x".repeat(120) + "\ny", 5, 20);
    expect(r[0]).toBe("x".repeat(17) + "...");
    expect(r[1]).toBe("y");
  });

  test("undefined input yields empty array", () => {
    expect(firstNonEmptyLines(undefined, 3)).toEqual([]);
  });
});

describe("compactConnector", () => {
  test("truncates description to the requested width", () => {
    const c = CONNECTORS[0];
    const r = compactConnector(c, 10);
    expect(r.name).toBe(c.name);
    expect(r.displayName).toBe(c.displayName);
    expect(r.version).toBe(c.version);
    expect(r.category).toBe(c.category);
    expect(r.description.length).toBeLessThanOrEqual(10);
  });

  test("default width is DEFAULT_TEXT_WIDTH", () => {
    const r = compactConnector(CONNECTORS[0]);
    expect(r.description.length).toBeLessThanOrEqual(DEFAULT_TEXT_WIDTH);
  });
});

describe("maybeTruncateOutput", () => {
  test("text under the limit passes through untruncated", () => {
    const r = maybeTruncateOutput("short");
    expect(r).toEqual({ text: "short", truncated: false });
  });

  test("text exactly at the limit is not truncated", () => {
    const text = "x".repeat(DEFAULT_OUTPUT_CHARS);
    expect(maybeTruncateOutput(text).truncated).toBe(false);
  });

  test("disabled option never truncates", () => {
    const text = "x".repeat(DEFAULT_OUTPUT_CHARS + 100);
    const r = maybeTruncateOutput(text, { enabled: false });
    expect(r.text).toBe(text);
    expect(r.truncated).toBe(false);
  });

  test("truncation reports the exact omitted char count", () => {
    const text = "x".repeat(DEFAULT_OUTPUT_CHARS + 25);
    const r = maybeTruncateOutput(text);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("[truncated 25 chars]");
  });

  test("default hint mentions --verbose; custom hint wins", () => {
    const text = "x".repeat(DEFAULT_OUTPUT_CHARS + 1);
    expect(maybeTruncateOutput(text).text).toContain("Use --verbose for full output.");
    const r = maybeTruncateOutput(text, { hint: "see --help" });
    expect(r.text).toContain("see --help");
    expect(r.text).not.toContain("--verbose");
  });

  test("preserved prefix is trimmed at the cut so no dangling whitespace precedes the hint", () => {
    const text = "x".repeat(100) + "   " + "y".repeat(DEFAULT_OUTPUT_CHARS);
    const r = maybeTruncateOutput(text, { maxChars: 100 });
    expect(r.text.startsWith("x".repeat(100))).toBe(true);
    expect(r.text).toContain("\n\n[truncated ");
    expect(r.text.slice(0, 103)).not.toContain("y");
  });
});
