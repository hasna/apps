import { describe, expect, test } from "bun:test";
import { parseRemoveType } from "./remove.js";

describe("parseRemoveType", () => {
  test("accepts valid types", () => {
    expect(parseRemoveType("model")).toBe("model");
    expect(parseRemoveType("JOB")).toBe("job");
    expect(parseRemoveType(undefined)).toBeUndefined();
  });

  test("rejects invalid types", () => {
    expect(() => parseRemoveType("something")).toThrow("Invalid --type value");
  });
});
