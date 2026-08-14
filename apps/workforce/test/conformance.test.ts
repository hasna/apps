import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Wraps scripts/conformance.ts: vendor-kit integrity + the six repo-conformance
// checks (manifest_valid, bins_allowlisted, bins_match_package,
// mode_enum_compliance, health_shape, no_cloud_guard).
describe("repo conformance", () => {
  it("passes vendor-kit --check and repo-conformance", () => {
    const repoRoot = resolve(import.meta.dir, "..");
    const result = spawnSync("bun", ["run", "scripts/conformance.ts"], { cwd: repoRoot, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`conformance failed:\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain("ok conformance");
  }, 60000);
});
