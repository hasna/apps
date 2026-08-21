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

describe("models list legacy-row provider filtering", () => {
  test("provider thinker-labs normalizes to tinker and matches legacy rows", () => {
    const filters = parseListFilters({ provider: "thinker-labs" });
    expect(filters.provider).toBe("tinker");
    // Legacy rows stored "thinker-labs"; the filter must match both spellings
    // so `models list --provider tinker` includes pre-0.0.36 rows.
    expect(filters.providerValues).toEqual(["tinker", "thinker-labs"]);
  });

  test("provider tinker matches legacy rows too", () => {
    const filters = parseListFilters({ provider: "tinker" });
    expect(filters.providerValues).toEqual(["tinker", "thinker-labs"]);
  });

  test("provider openai matches only openai rows", () => {
    const filters = parseListFilters({ provider: "openai" });
    expect(filters.providerValues).toEqual(["openai"]);
  });

  test("no provider means no provider filter", () => {
    expect(parseListFilters({}).providerValues).toBeUndefined();
  });
});
