import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ACTIONS_VERSION } from "./version.js";

/**
 * `0.1.6` shipped as an incident fix for git/npm version drift, so the published
 * version, the version the CLI and MCP server advertise, and the changelog are kept in
 * lockstep by test rather than by convention.
 */
const repoRoot = join(import.meta.dir, "..");
const packageVersion = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { version: string }).version;

describe("release metadata", () => {
  test("ACTIONS_VERSION matches the package version", () => {
    expect(ACTIONS_VERSION).toBe(packageVersion);
  });

  test("the changelog documents the package version", () => {
    const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf-8");
    expect(changelog).toContain(`\n## ${packageVersion}\n`);
  });
});
