import { describe, expect, test } from "bun:test";
import {
  getStyle,
  searchStyles,
  getStylesByCategory,
  findSimilarStyles,
  STYLES,
  CATEGORIES,
  ALL_STYLE_NAMES,
} from "../lib/registry.js";

describe("getStyle", () => {
  test("returns style by exact name", () => {
    const style = getStyle("minimalist");
    expect(style).toBeDefined();
    expect(style!.name).toBe("minimalist");
    expect(style!.displayName).toBe("Minimalist");
  });

  test("case insensitive", () => {
    const style = getStyle("BRUTALIST");
    expect(style).toBeDefined();
    expect(style!.name).toBe("brutalist");
  });

  test("returns undefined for unknown style", () => {
    expect(getStyle("nonexistent")).toBeUndefined();
  });

  test("all style names resolve", () => {
    for (const name of ALL_STYLE_NAMES) {
      expect(getStyle(name)).toBeDefined();
    }
  });
});

describe("searchStyles", () => {
  test("returns all styles for empty query", () => {
    const results = searchStyles("");
    expect(results.length).toBe(STYLES.length);
  });

  test("exact name match scores highest", () => {
    const results = searchStyles("minimalist");
    expect(results[0].name).toBe("minimalist");
  });

  test("partial display name match", () => {
    const results = searchStyles("Brutal");
    expect(results.map((s) => s.name)).toContain("brutalist");
    expect(results.map((s) => s.name)).toContain("neubrutalism");
  });

  test("tag search", () => {
    const results = searchStyles("gradient");
    expect(results.map((s) => s.name)).toContain("startup");
  });

  test("description search", () => {
    const results = searchStyles("Swiss");
    expect(results.map((s) => s.name)).toContain("minimalist");
  });

  test("no results for gibberish query", () => {
    const results = searchStyles("xyznonexistent123");
    expect(results.length).toBe(0);
  });

  test("by display name", () => {
    const results = searchStyles("Material Design");
    expect(results.map((s) => s.name)).toContain("material");
  });

  test("returns in score order", () => {
    const results = searchStyles("minimalist");
    expect(results[0].name).toBe("minimalist");
  });
});

describe("getStylesByCategory", () => {
  test("filters by exact category", () => {
    const results = getStylesByCategory("Brutalist");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("brutalist");
  });

  test("case insensitive category", () => {
    const results = getStylesByCategory("corporate");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("corporate");
  });

  test("returns empty for unknown category", () => {
    expect(getStylesByCategory("unknown")).toEqual([]);
  });
});

describe("findSimilarStyles", () => {
  test("finds similar names via Levenshtein distance", () => {
    const similar = findSimilarStyles("minimalistt");
    expect(similar).toContain("minimalist");
  });

  test("finds suggestions for typos", () => {
    const similar = findSimilarStyles("brutlist");
    expect(similar).toContain("brutalist");
  });

  test("returns empty for very different name", () => {
    const similar = findSimilarStyles("completelydifferent");
    expect(similar.length).toBe(0);
  });

  test("max 3 suggestions", () => {
    const similar = findSimilarStyles("m");
    expect(similar.length).toBeLessThanOrEqual(3);
  });
});

describe("STYLES catalog", () => {
  test("has 10 styles", () => {
    expect(STYLES.length).toBe(10);
  });

  test("all styles have required fields", () => {
    for (const style of STYLES) {
      expect(style.name).toBeTruthy();
      expect(style.displayName).toBeTruthy();
      expect(style.description).toBeTruthy();
      expect(style.category).toBeTruthy();
      expect(Array.isArray(style.tags)).toBe(true);
      expect(style.tags.length).toBeGreaterThan(0);
      expect(Array.isArray(style.principles)).toBe(true);
      expect(style.principles.length).toBeGreaterThan(0);
    }
  });

  test("all categories are valid", () => {
    for (const style of STYLES) {
      expect(CATEGORIES).toContain(style.category);
    }
  });

  test("all names are kebab-case lowercase", () => {
    for (const name of ALL_STYLE_NAMES) {
      expect(name).toBe(name.toLowerCase());
      expect(name).not.toContain(" ");
    }
  });

  test("no duplicate names", () => {
    const names = STYLES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
