import { describe, expect, it } from "bun:test";
import * as contracts from "@hasna/contracts";
import { APP_VERSION } from "../src/version.js";

// Wraps the six Hasna Service Contract v1 conformance checks (§4.5).
const runRepoConformance = (contracts as {
  runRepoConformance?: (root: string, options?: { healthSample?: unknown }) => {
    ok: boolean;
    name: string | null;
    class: string | null;
    checks: { id: string; status: string; detail: string }[];
  };
}).runRepoConformance;

describe("repo conformance", () => {
  it("passes all conformance checks", () => {
    expect(typeof runRepoConformance).toBe("function");
    const report = runRepoConformance!(process.cwd(), { healthSample: { status: "ok", version: APP_VERSION, mode: "local" } });
    const failed = report.checks.filter((c) => c.status === "fail");
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.name).toBe("holdings");
    expect(report.class).toBe("cli-with-store");
  });

  it("covers the six required checks", () => {
    const report = runRepoConformance!(process.cwd(), { healthSample: { status: "ok", version: APP_VERSION, mode: "local" } });
    const ids = report.checks.map((c) => c.id).sort();
    for (const id of ["bins_allowlisted", "bins_match_package", "health_shape", "manifest_valid", "mode_enum_compliance", "no_cloud_guard"]) {
      expect(ids).toContain(id);
    }
  });
});
