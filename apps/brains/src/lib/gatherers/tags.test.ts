// agent-authored (no SOL consult available)

import { describe, expect, test } from "bun:test";
import { parseTagList } from "./tags.js";

describe("parseTagList", () => {
  test("null, undefined, empty and whitespace-only values return an empty list", () => {
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList("   ")).toEqual([]);
    expect(parseTagList("\n\t")).toEqual([]);
  });

  test("malformed JSON returns an empty list", () => {
    expect(parseTagList("{not-json")).toEqual([]);
    expect(parseTagList('["unterminated')).toEqual([]);
    expect(parseTagList("just words")).toEqual([]);
  });

  test("a JSON object is not a tag list", () => {
    expect(parseTagList('{"tag":"prod"}')).toEqual([]);
    expect(parseTagList('{"tags":["prod"]}')).toEqual([]);
  });

  test("JSON scalars are not tag lists", () => {
    expect(parseTagList('"prod"')).toEqual([]);
    expect(parseTagList("42")).toEqual([]);
    expect(parseTagList("true")).toEqual([]);
  });

  test("a valid JSON string array is returned as-is", () => {
    expect(parseTagList('["coding","chat"]')).toEqual(["coding", "chat"]);
    expect(parseTagList("[]")).toEqual([]);
    expect(parseTagList('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  test("non-string members are filtered out, strings are kept", () => {
    expect(parseTagList('["coding", 42, null, "chat", {"x":1}, true]')).toEqual(["coding", "chat"]);
  });

  test("empty strings inside the array survive the string filter", () => {
    // typeof "" === "string" — the filter keeps it; this documents the contract
    expect(parseTagList('["", "a"]')).toEqual(["", "a"]);
  });

  test("trailing garbage after a valid array is rejected as malformed", () => {
    expect(parseTagList('["a"] extra')).toEqual([]);
  });
});
