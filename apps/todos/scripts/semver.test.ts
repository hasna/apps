import { describe, expect, test } from "bun:test";
import { isStrictSemver } from "./semver.ts";

describe("strict SemVer 2.0 validation", () => {
  test.each([
    "0.0.0",
    "0.11.96",
    "1.2.3-alpha",
    "1.2.3-0",
    "1.2.3-alpha.1",
    "1.2.3-1.alpha",
    "1.2.3-001alpha",
    "1.2.3-alpha-01",
    "1.2.3+build.01",
    "1.2.3-rc.1+build.01",
  ])("accepts valid SemVer %s", (version) => {
    expect(isStrictSemver(version)).toBe(true);
  });

  test.each([
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-01",
    "1.2.3-01.alpha",
    "1.2.3-alpha.01",
    "1.2.3-00",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-alpha..1",
  ])("rejects invalid SemVer %s", (version) => {
    expect(isStrictSemver(version)).toBe(false);
  });
});
