import { describe, expect, test } from "bun:test";
import {
  STYLES,
  ALL_STYLE_NAMES,
  getStyle,
  searchStyles,
  getStylesByCategory,
  findSimilarStyles,
} from "../src/lib/registry.js";

describe("STYLES array", () => {
  test("has exactly 10 entries", () => {
    expect(STYLES).toHaveLength(10);
  });

  test("every style has required fields", () => {
    for (const style of STYLES) {
      expect(typeof style.name).toBe("string");
      expect(typeof style.displayName).toBe("string");
      expect(typeof style.description).toBe("string");
      expect(typeof style.category).toBe("string");
      expect(Array.isArray(style.tags)).toBe(true);
      expect(Array.isArray(style.principles)).toBe(true);
    }
  });
});

describe("ALL_STYLE_NAMES", () => {
  test("has exactly 10 entries", () => {
    expect(ALL_STYLE_NAMES).toHaveLength(10);
  });
});

describe("getStyle", () => {
  test("returns correct data for minimalist", () => {
    const style = getStyle("minimalist");
    expect(style).toBeDefined();
    expect(style!.name).toBe("minimalist");
    expect(style!.displayName).toBe("Minimalist");
    expect(style!.category).toBe("Minimalist");
  });

  test("returns undefined for nonexistent style", () => {
    expect(getStyle("nonexistent")).toBeUndefined();
  });

  test("is case-insensitive", () => {
    expect(getStyle("MINIMALIST")).toBeDefined();
    expect(getStyle("Minimalist")).toBeDefined();
  });
});

describe("searchStyles", () => {
  test("empty query returns all styles", () => {
    expect(searchStyles("")).toHaveLength(10);
  });

  test("'minimal' matches minimalist", () => {
    const results = searchStyles("minimal");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("minimalist");
  });

  test("unrelated query returns empty array", () => {
    const results = searchStyles("zzzznotastyle");
    expect(results).toHaveLength(0);
  });
});

describe("getStylesByCategory", () => {
  test("returns minimalist for category Minimalist", () => {
    const results = getStylesByCategory("Minimalist");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("minimalist");
  });

  test("is case-insensitive", () => {
    expect(getStylesByCategory("minimalist")).toHaveLength(1);
  });

  test("returns empty for unknown category", () => {
    expect(getStylesByCategory("unknown")).toHaveLength(0);
  });
});

describe("findSimilarStyles", () => {
  test("finds minimalist from typo 'minialist'", () => {
    const results = findSimilarStyles("minialist");
    expect(results).toContain("minimalist");
  });

  test("returns array", () => {
    expect(Array.isArray(findSimilarStyles("brutalst"))).toBe(true);
  });

  test("returns at most 3 results", () => {
    expect(findSimilarStyles("abc").length).toBeLessThanOrEqual(3);
  });
});
