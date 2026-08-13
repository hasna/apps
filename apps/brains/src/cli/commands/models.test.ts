import { describe, expect, test } from "bun:test";
import {
  addModelTagJson,
  formatModelTags,
  parseListFilters,
  parseListLimit,
  removeModelTagJson,
} from "./models.js";

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

describe("model tag helpers", () => {
  test("formatModelTags treats malformed stored tags as empty", () => {
    expect(formatModelTags("not-json")).toBe("(none)");
    expect(formatModelTags('{"tag":"prod"}')).toBe("(none)");
  });

  test("formatModelTags renders valid string tags", () => {
    expect(formatModelTags('["prod","eval"]')).toBe("prod, eval");
  });

  test("addModelTagJson preserves valid tags and deduplicates", () => {
    expect(addModelTagJson('["prod"]', "eval")).toBe('["prod","eval"]');
    expect(addModelTagJson('["prod"]', "prod")).toBe('["prod"]');
  });

  test("addModelTagJson recovers from malformed stored tags", () => {
    expect(addModelTagJson("not-json", "prod")).toBe('["prod"]');
  });

  test("removeModelTagJson recovers from malformed stored tags", () => {
    expect(removeModelTagJson("not-json", "prod")).toBe("[]");
  });
});
