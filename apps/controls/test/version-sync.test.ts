import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { APP_VERSION } from "../src/version.js";

/** Keeps the advertised version in lockstep with package.json (todos row 7e5f8f3d). */
const repoRoot = join(import.meta.dir, "..");
const packageVersion = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { version: string }).version;

describe("release metadata", () => {
  test("APP_VERSION matches the package version", () => {
    expect(APP_VERSION).toBe(packageVersion);
  });
});
