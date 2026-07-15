import { describe, expect, test } from "bun:test";
import packageJson from "../../package.json";
import { getPackageVersion } from "./package-version";

describe("package version", () => {
  test("is embedded for manifest-free runtime bundles", () => {
    expect(getPackageVersion()).toBe(packageJson.version);
    expect(getPackageVersion("file:///no/runtime/package.json")).toBe(packageJson.version);
  });
});
