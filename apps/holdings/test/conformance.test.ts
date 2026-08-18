import { describe, expect, it } from "bun:test";
import * as contracts from "@hasna/contracts";
import { APP_VERSION } from "../src/version.js";

// Wraps the Hasna Service Contract v1 conformance checks. The five align-lane
// checks (surface_matrix, service_api_topology, storage_capabilities,
// public_manifest_safety, published_artifact_gate) are pending the
// contracts-align lane for @hasna/holdings and are asserted to be the ONLY
// failures — any other failing check is a regression this test refuses.
const runRepoConformance = (contracts as {
  runRepoConformance?: (root: string, options?: { healthSample?: unknown }) => {
    ok: boolean;
    name: string | null;
    class: string | null;
    checks: { id: string; status: string; detail: string }[];
  };
}).runRepoConformance;

const PENDING_ALIGN_CHECKS = new Set([
  "surface_matrix",
  "service_api_topology",
  "storage_capabilities",
  "public_manifest_safety",
  "published_artifact_gate",
]);

describe("repo conformance", () => {
  it("passes every check except the recorded align-lane pendings", () => {
    expect(typeof runRepoConformance).toBe("function");
    const report = runRepoConformance!(process.cwd(), { healthSample: { status: "ok", version: APP_VERSION, backend: "sqlite" } });
    const unexpected = report.checks.filter((c) => c.status === "fail" && !PENDING_ALIGN_CHECKS.has(c.id));
    expect(unexpected.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    const pending = report.checks.filter((c) => c.status === "fail" && PENDING_ALIGN_CHECKS.has(c.id));
    expect(pending.map((c) => c.id).sort()).toEqual([...PENDING_ALIGN_CHECKS].sort());
    expect(report.name).toBe("holdings");
    expect(report.class).toBe("cli-with-store");
  });

  it("covers the purge-relevant checks", () => {
    const report = runRepoConformance!(process.cwd(), { healthSample: { status: "ok", version: APP_VERSION, backend: "sqlite" } });
    const ids = report.checks.map((c) => c.id).sort();
    for (const id of ["bins_allowlisted", "bins_match_package", "health_shape", "manifest_valid", "no_cloud_guard"]) {
      expect(ids).toContain(id);
    }
  });
});
