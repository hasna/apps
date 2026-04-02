import { describe, expect, test } from "bun:test";
import { parseProjectListPagination, requireDeleteConfirmation } from "./projects.js";

describe("requireDeleteConfirmation", () => {
  test("throws when --yes is not provided", () => {
    expect(() => requireDeleteConfirmation(false)).toThrow("Project deletion requires --yes confirmation");
    expect(() => requireDeleteConfirmation(undefined)).toThrow("Project deletion requires --yes confirmation");
  });

  test("does not throw when --yes is provided", () => {
    expect(() => requireDeleteConfirmation(true)).not.toThrow();
  });
});


describe("parseProjectListPagination", () => {
  test("parses valid pagination values", () => {
    expect(parseProjectListPagination(5, 2)).toEqual({ limit: 5, offset: 2 });
    expect(parseProjectListPagination(undefined, undefined)).toEqual({ limit: undefined, offset: undefined });
  });

  test("rejects invalid pagination values", () => {
    expect(() => parseProjectListPagination(0, 0)).toThrow("--limit must be a positive integer.");
    expect(() => parseProjectListPagination(-1, 0)).toThrow("--limit must be a positive integer.");
    expect(() => parseProjectListPagination(1, -1)).toThrow("--offset must be a non-negative integer.");
    expect(() => parseProjectListPagination(NaN, 0)).toThrow("--limit must be a positive integer.");
  });
});
