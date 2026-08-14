import { describe, expect, it } from "bun:test";
import "./setup";
import { readFileSync } from "fs";
import { readPackageVersion } from "../src/lib/version";

const CURRENT_VERSION = (() => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string };
  return pkg.version;
})();

describe("version resolution", () => {
  it("finds the package version from source entrypoints", () => {
    expect(readPackageVersion(new URL("../src/cli/index.tsx", import.meta.url).toString())).toBe(CURRENT_VERSION);
    expect(readPackageVersion(new URL("../src/mcp/index.ts", import.meta.url).toString())).toBe(CURRENT_VERSION);
  });

  it("finds the package version from bundled entrypoints", () => {
    expect(readPackageVersion(new URL("../bin/index.js", import.meta.url).toString())).toBe(CURRENT_VERSION);
    expect(readPackageVersion(new URL("../bin/mcp.js", import.meta.url).toString())).toBe(CURRENT_VERSION);
  });
});
