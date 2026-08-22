import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPackageVersion } from "./version.js";

describe("getPackageVersion", () => {
  test("resolves the real package.json version from the module's walk-up", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(getPackageVersion()).toBe(pkg.version);
  });

  test("is stable across repeated calls (cached)", () => {
    expect(getPackageVersion()).toBe(getPackageVersion());
  });
});
