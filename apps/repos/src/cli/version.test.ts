import { describe, expect, test } from "bun:test";
import { FALLBACK_CLI_VERSION, parseVersionFromPackageJson } from "./version.js";

describe("parseVersionFromPackageJson", () => {
  test("returns version when present", () => {
    const version = parseVersionFromPackageJson('{"name":"x","version":"1.2.3"}');
    expect(version).toBe("1.2.3");
  });

  test("falls back when JSON is invalid", () => {
    const version = parseVersionFromPackageJson("{not-json");
    expect(version).toBe(FALLBACK_CLI_VERSION);
  });

  test("falls back when version is missing", () => {
    const version = parseVersionFromPackageJson('{"name":"x"}');
    expect(version).toBe(FALLBACK_CLI_VERSION);
  });
});
