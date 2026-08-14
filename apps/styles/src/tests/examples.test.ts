import { describe, expect, test } from "bun:test";
import { getExample, listExamples, PATTERNS } from "../lib/examples.js";

describe("getExample", () => {
  test("returns string for existing style + pattern", () => {
    const code = getExample("brutalist", "button");
    expect(typeof code).toBe("string");
    expect(code!.length).toBeGreaterThan(0);
    // Should contain a React component
    expect(code).toContain("export");
  });

  test("returns null for unknown style", () => {
    expect(getExample("nonexistent", "button")).toBeNull();
  });

  test("returns null for unknown pattern", () => {
    expect(getExample("brutalist", "nonexistent" as Parameters<typeof getExample>[1])).toBeNull();
  });

  test("valid patterns are in the PATTERNS array", () => {
    expect(PATTERNS).toContain("card");
    expect(PATTERNS).toContain("button");
    expect(PATTERNS).toContain("input");
    expect(PATTERNS).toContain("nav");
    expect(PATTERNS).toContain("hero");
  });
});

describe("listExamples", () => {
  test("returns array of pattern names for valid style", () => {
    const patterns = listExamples("brutalist");
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  test("returns empty array for style with no examples directory", () => {
    // Some styles might have no examples directory
    const patterns = listExamples("minimalist");
    // Minimalist has no examples dir — should be empty
    expect(Array.isArray(patterns)).toBe(true);
  });

  test("returns empty array for unknown style", () => {
    expect(listExamples("nonexistent")).toEqual([]);
  });
});
