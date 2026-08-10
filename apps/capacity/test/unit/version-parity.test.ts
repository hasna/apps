import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_VERSION } from "../../src/version";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");

/**
 * Regression for the 0.1.2 release skew (todos 5283d08b): the published 0.1.2
 * artifact self-reported 0.1.1 because src/version.ts is hand-maintained and
 * the publish ran from a tree where package.json had been bumped but
 * PACKAGE_VERSION had not. The constant and the manifest must never disagree —
 * `capacity version` is the instrument the fleet's version-skew discipline
 * reads, and a constant that lags the manifest makes every installed-version
 * verification report a false mismatch (or worse, a false match).
 */
describe("version parity", () => {
  test("PACKAGE_VERSION matches package.json version", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
    ) as { version: string };
    expect<string>(PACKAGE_VERSION).toBe(manifest.version);
  });
});
