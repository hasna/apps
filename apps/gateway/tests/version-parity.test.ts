import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gatewayVersion } from "../src/version";

const repositoryRoot = join(import.meta.dir, "..");

/**
 * Regression for the 0.1.7 release skew (todos a403124e): release PR #25
 * bumped package.json only, so main — and the published 0.1.7 artifact —
 * self-report 0.1.6 from `gateway --version`. The constant and the manifest
 * must never disagree: `--version` is the instrument the fleet's version-skew
 * discipline reads after an install, and a lagging constant makes every
 * installed-version verification report a false mismatch.
 */
describe("version parity", () => {
  test("gatewayVersion matches package.json version", () => {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { version: string };
    expect(gatewayVersion).toBe(manifest.version);
  });
});
