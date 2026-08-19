// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// parseJsonArray / parseJsonObject decode JSON columns that older rows store
// as NULL and that malformed rows store as garbage. The contract is
// fail-safe: a bad column must degrade to the empty collection, never throw
// and never return the wrong SHAPE. The failure modes a happy-path test
// misses:
//   - "null" is valid JSON but must NOT come back as null — callers destructure
//     `.map` / `.length` on the result and a null would throw downstream;
//   - a valid JSON value of the WRONG shape (object where an array is
//     expected, array where an object is expected) must be rejected — an array
//     is truthy and `value && typeof value === "object"` would otherwise pass
//     it through an object column;
//   - JSON.parse accepts whitespace and trailing content rules — leading/
//     trailing whitespace is fine and must parse.

import { describe, expect, it } from "bun:test";
import { parseJsonArray, parseJsonObject } from "./json.js";

describe("parseJsonArray", () => {
  it("returns [] for null, undefined and empty-string columns", () => {
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
    expect(parseJsonArray("")).toEqual([]);
  });

  it("parses a real array", () => {
    expect(parseJsonArray<number>("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(parseJsonArray("[]")).toEqual([]);
    expect(parseJsonArray(" [1] ")).toEqual([1]);
  });

  it("returns [] when the JSON is a non-array value, even a valid one", () => {
    expect(parseJsonArray("null")).toEqual([]);
    expect(parseJsonArray('{"a":1}')).toEqual([]);
    expect(parseJsonArray('"str"')).toEqual([]);
    expect(parseJsonArray("42")).toEqual([]);
    expect(parseJsonArray("true")).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseJsonArray('{"a":')).toEqual([]);
    expect(parseJsonArray("[1, 2")).toEqual([]);
    expect(parseJsonArray("not json")).toEqual([]);
  });
});

describe("parseJsonObject", () => {
  it("returns {} for null, undefined and empty-string columns", () => {
    expect(parseJsonObject(null)).toEqual({});
    expect(parseJsonObject(undefined)).toEqual({});
    expect(parseJsonObject("")).toEqual({});
  });

  it("parses a real object", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject("{}")).toEqual({});
    expect(parseJsonObject(' { "a" : 1 } ')).toEqual({ a: 1 });
  });

  it("returns {} when the JSON is not a plain object — arrays are objects too", () => {
    // The array case is the sneaky one: `typeof [] === "object"` is true, and
    // an unguarded truthy check would let a JSON array through an object
    // column as an array-typed value.
    expect(parseJsonObject("[]")).toEqual({});
    expect(parseJsonObject("[1]")).toEqual({});
    expect(parseJsonObject("null")).toEqual({});
    expect(parseJsonObject('"str"')).toEqual({});
    expect(parseJsonObject("42")).toEqual({});
    expect(parseJsonObject("true")).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(parseJsonObject('{"a":')).toEqual({});
    expect(parseJsonObject("{")).toEqual({});
    expect(parseJsonObject("garbage")).toEqual({});
  });
});
