import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { VERSION } from "./version.js";

describe("VERSION", () => {
  test("matches the package.json version so the surface never drifts from the artifact", async () => {
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as { version: string };
    expect(VERSION).toBe(packageJson.version);
  });

  test("is a valid semver patch version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
