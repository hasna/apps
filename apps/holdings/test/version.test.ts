import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../src/version.js";

describe("version", () => {
  it("APP_VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("is semver", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
