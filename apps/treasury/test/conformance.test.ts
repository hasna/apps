import { describe, expect, it } from "bun:test";
import * as contracts from "@hasna/contracts";

// Wraps the @hasna/contracts repo-conformance kit so `bun test` also proves the
// 6 conformance checks (manifest_valid, bins_allowlisted, bins_match_package,
// mode_enum_compliance, health_shape, no_cloud_guard) — BUILD-SPEC §4.5.
const runRepoConformance = (
  contracts as {
    runRepoConformance?: (root: string) => {
      ok: boolean;
      checks: { id: string; status: string; detail: string }[];
    };
  }
).runRepoConformance;

describe("hasna.service_contract.v1 conformance", () => {
  it("passes all repo-conformance checks", () => {
    expect(typeof runRepoConformance).toBe("function");
    const report = runRepoConformance!(process.cwd());
    const failed = report.checks.filter((c) => c.status === "fail");
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
    for (const id of ["manifest_valid", "bins_allowlisted", "bins_match_package", "mode_enum_compliance", "no_cloud_guard"]) {
      expect(report.checks.map((c) => c.id)).toContain(id);
    }
  });
});
