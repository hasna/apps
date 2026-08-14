import { describe, test, expect } from "bun:test";
import { levenshtein, fuzzyMatch, bestFuzzyScore } from "./fuzzy.js";

describe("levenshtein", () => {
  test("identical strings = 0", () => expect(levenshtein("stripe", "stripe")).toBe(0));
  test("single substitution = 1", () => expect(levenshtein("stripe", "strype")).toBe(1));
  test("single deletion = 1", () => expect(levenshtein("stripe", "strpe")).toBe(1));
  test("single insertion = 1", () => expect(levenshtein("stripe", "stripee")).toBe(1));
  test("two edits = 2", () => expect(levenshtein("stripe", "stryp")).toBe(2));
  test("completely different = max", () => expect(levenshtein("abc", "xyz")).toBe(3));
  test("empty vs non-empty", () => expect(levenshtein("", "abc")).toBe(3));
  test("both empty = 0", () => expect(levenshtein("", "")).toBe(0));
});

describe("fuzzyMatch", () => {
  test("short tokens (< 3 chars) never fuzzy match", () => {
    expect(fuzzyMatch("ab", "abc")).toBe(false);
  });
  test("exact substring always matches", () => {
    expect(fuzzyMatch("strip", "stripe")).toBe(true);
  });
  test("typo within distance matches", () => {
    expect(fuzzyMatch("strpe", "stripe", 1)).toBe(true);
  });
  test("too many edits rejects", () => {
    expect(fuzzyMatch("stxyz", "stripe", 1)).toBe(false);
  });
  test("large length difference rejects quickly", () => {
    expect(fuzzyMatch("stripe", "a", 2)).toBe(false);
  });
});

describe("bestFuzzyScore", () => {
  test("returns 0 for short tokens", () => {
    expect(bestFuzzyScore("ab", ["abc"])).toBe(0);
  });
  test("returns score for close match", () => {
    expect(bestFuzzyScore("strpe", ["stripe"], 2)).toBeGreaterThan(0);
  });
  test("returns 0 when nothing matches", () => {
    expect(bestFuzzyScore("zzzzz", ["stripe", "github"], 2)).toBe(0);
  });
  test("closer match = higher score", () => {
    const s1 = bestFuzzyScore("strpe", ["stripe"], 2); // dist 1
    const s2 = bestFuzzyScore("strxx", ["stripe"], 2); // dist 2
    expect(s1).toBeGreaterThan(s2);
  });
});
