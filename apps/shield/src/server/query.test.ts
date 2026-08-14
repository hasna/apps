import { describe, expect, it } from "bun:test";
import { getFirstString, getQueryInt } from "./query.js";

describe("getFirstString", () => {
  it("returns string values directly", () => {
    expect(getFirstString("abc")).toBe("abc");
  });

  it("returns first string from array values", () => {
    expect(getFirstString(["x", "y"])).toBe("x");
  });

  it("returns undefined for non-string values", () => {
    expect(getFirstString(123)).toBeUndefined();
    expect(getFirstString([1, 2, 3])).toBeUndefined();
  });
});

describe("getQueryInt", () => {
  it("parses number from string", () => {
    expect(getQueryInt("42", 7)).toBe(42);
  });

  it("parses number from array first string", () => {
    expect(getQueryInt(["12", "14"], 7)).toBe(12);
  });

  it("falls back when value is missing or invalid", () => {
    expect(getQueryInt(undefined, 7)).toBe(7);
    expect(getQueryInt("not-a-number", 7)).toBe(7);
  });
});
