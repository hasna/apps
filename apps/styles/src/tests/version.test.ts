import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

import { PACKAGE_VERSION } from "../version.js";

describe("package version wiring", () => {
  test("source version matches package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
