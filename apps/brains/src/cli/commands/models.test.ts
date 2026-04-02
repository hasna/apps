import { describe, expect, test } from "bun:test";
import { parseListFilters, parseListLimit } from "./models.js";

describe("models list option parsing", () => {
  test("parseListLimit accepts positive integers", () => {
    expect(parseListLimit(undefined)).toBeUndefined();
    expect(parseListLimit("3")).toBe(3);
  });

  test("parseListLimit rejects invalid values", () => {
    expect(() => parseListLimit("0")).toThrow("Invalid --limit value");
    expect(() => parseListLimit("abc")).toThrow("Invalid --limit value");
  });

  test("parseListFilters validates provider", () => {
    expect(parseListFilters({ provider: "openai" })).toMatchObject({ provider: "openai" });
    expect(() => parseListFilters({ provider: "other" })).toThrow("Invalid --provider value");
  });

  test("parseListFilters carries status and limit", () => {
    expect(parseListFilters({ status: "running", limit: "10" })).toMatchObject({ status: "running", limit: 10 });
  });
});
