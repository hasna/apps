import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

// Wraps scripts/conformance.ts: the Service Contract v1 checks plus the
// vendored storage-kit integrity check must all pass. The align-lane checks
// (surface_matrix, service_api_topology, storage_capabilities,
// public_manifest_safety, published_artifact_gate) are reported as pending
// and do not gate until the contracts-align lane lands full 0.11.1 compliance.
describe("repo conformance", () => {
  it("passes the contract conformance gate", () => {
    const result = spawnSync("bun", ["run", "scripts/conformance.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output, output).toContain("pass\tmanifest_valid");
    expect(output).toContain("pass\tbins_allowlisted");
    expect(output).toContain("pass\tbins_match_package");
    expect(output).toContain("pass\thealth_shape");
    expect(output).toContain("pass\tno_cloud_guard");
    expect(output).toContain("pass\tvendor_kit_check");
    expect(result.status).toBe(0);
  });
});
