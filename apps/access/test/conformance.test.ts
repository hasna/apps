import { describe, expect, it } from "bun:test";
import * as contracts from "@hasna/contracts";

const runRepoConformance = (contracts as unknown as {
  runRepoConformance: (cwd: string) => { ok: boolean; checks: { id: string; status: string; detail: string }[] };
}).runRepoConformance;

describe("repo conformance", () => {
  it("passes all Hasna Service Contract v1 checks", () => {
    const report = runRepoConformance(process.cwd());
    const failed = report.checks.filter((c) => c.status === "fail");
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("declares the three access bins in the manifest", () => {
    const ids = report().checks.map((c) => c.id);
    for (const id of ["manifest_valid", "bins_allowlisted", "bins_match_package", "mode_enum_compliance", "no_cloud_guard"]) {
      expect(ids).toContain(id);
    }
  });
});

function report() {
  return runRepoConformance(process.cwd());
}
