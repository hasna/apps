import { describe, expect, test } from "bun:test";
import {
  arrayDifference,
  arrayIntersection,
  arrayUnion,
  clamp01,
  inverseNormalize,
  normalize,
  stringArray,
  unique,
} from "../src/utils";

describe("numeric score normalization boundaries", () => {
  test("clamps finite values and maps non-finite values to the safe floor", () => {
    expect([
      clamp01(Number.NEGATIVE_INFINITY),
      clamp01(Number.NaN),
      clamp01(-0.01),
      clamp01(0),
      clamp01(0.25),
      clamp01(1),
      clamp01(1.01),
      clamp01(Number.POSITIVE_INFINITY),
    ]).toEqual([0, 0, 0, 0, 0.25, 1, 1, 0]);
  });

  test("normalizes only finite peers and preserves midpoint direction", () => {
    const population = [10, undefined, Number.NaN, 20];

    expect(normalize(10, population, 0.4)).toBe(0);
    expect(normalize(15, population, 0.4)).toBe(0.5);
    expect(normalize(20, population, 0.4)).toBe(1);
    expect(inverseNormalize(10, population, 0.4)).toBe(1);
    expect(inverseNormalize(15, population, 0.4)).toBe(0.5);
    expect(inverseNormalize(20, population, 0.4)).toBe(0);
  });

  test("uses the fallback for an unscored value but fully scores a constant finite population", () => {
    expect(normalize(undefined, [7, 7], 0.35)).toBe(0.35);
    expect(inverseNormalize(Number.NaN, [7, 7], 0.35)).toBe(0.35);
    expect(normalize(7, [7, 7], 0.35)).toBe(1);
    expect(inverseNormalize(7, [7, 7], 0.35)).toBe(1);
  });
});

describe("set-like routing helpers", () => {
  test("filters non-string and empty inputs without coercion", () => {
    expect(stringArray(["openai", "", 0, false, "anthropic", null])).toEqual(["openai", "anthropic"]);
    expect(stringArray(["", 0, false, null])).toBeUndefined();
    expect(stringArray("openai")).toBeUndefined();
  });

  test("keeps deterministic first occurrence order across set operations", () => {
    expect(unique(["openai", "anthropic", "openai", "local"])).toEqual(["openai", "anthropic", "local"]);
    expect(arrayUnion(["openai", "anthropic"], ["anthropic", "local"])).toEqual(["openai", "anthropic", "local"]);
    expect(arrayIntersection(["openai", "anthropic", "local"], ["local", "openai"])).toEqual(["openai", "local"]);
    expect(arrayDifference(["openai", "anthropic", "local"], ["anthropic"])).toEqual(["openai", "local"]);
  });

  test("distinguishes an unspecified set from an explicitly empty set", () => {
    expect(arrayIntersection(undefined, [])).toEqual([]);
    expect(arrayIntersection([], undefined)).toEqual([]);
    expect(arrayUnion(undefined, undefined)).toBeUndefined();
    expect(arrayDifference(undefined, ["openai"])).toBeUndefined();
    expect(arrayDifference([], ["openai"])).toEqual([]);
  });
});
