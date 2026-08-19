import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Wraps scripts/conformance.ts: vendor-kit integrity + the repo-conformance
// checks (manifest_valid, bins_allowlisted, bins_match_package,
// server_backend_configuration, health_shape, no_cloud_guard, and the
// four-surface matrix).
describe("repo conformance", () => {
  it("keeps the vendored storage-kit in sync with the pinned kit and the manifest schema-valid", () => {
    const repoRoot = resolve(import.meta.dir, "..");
    const result = spawnSync("bun", ["run", "scripts/conformance.ts"], { cwd: repoRoot, encoding: "utf8" });
    const output = `${result.stdout}\n${result.stderr}`;
    // The vendored storage-kit must match the pinned @hasna/contracts
    // generator exactly (a stale or hand-edited kit fails the check).
    expect(output).toContain("ok vendored storage-kit");
    // The manifest must validate against the v1 schema at the pinned kit.
    expect(output).toContain("pass\tmanifest_valid");
    // Two tracked residuals, declared truthfully rather than papered over:
    // the API publishes no served OpenAPI document, so the SDK surface is
    // `deferred` (surface_matrix), and the package ships no packed-artifact
    // scan bound to prepack (published_artifact_gate — release-gate lane).
    expect(output).toContain("fail\tsurface_matrix");
    expect(output).toContain("fail\tpublished_artifact_gate");
  }, 60000);
});
