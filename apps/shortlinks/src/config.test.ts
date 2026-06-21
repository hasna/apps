import { describe, expect, test } from "bun:test";
import { normalizeHostname } from "./config.js";

describe("normalizeHostname", () => {
  test("normalizes protocol, case, path, and trailing dot", () => {
    expect(normalizeHostname("https://HAS.NA/docs.")).toBe("has.na");
    expect(normalizeHostname("go.example.com.")).toBe("go.example.com");
  });

  test("rejects hostnames with invalid DNS labels", () => {
    expect(() => normalizeHostname("-bad.example.com")).toThrow("Invalid domain");
    expect(() => normalizeHostname("bad-.example.com")).toThrow("Invalid domain");
    expect(() => normalizeHostname(`go.${"a".repeat(64)}.example.com`)).toThrow("Invalid domain");
  });
});
