import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

// Wraps scripts/conformance.ts: the 6 Service Contract v1 checks plus the
// vendored storage-kit integrity check must all pass.
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
    expect(output).toContain("pass\tmode_enum_compliance");
    expect(output).toContain("pass\tno_cloud_guard");
    expect(output).toContain("pass\tvendor_kit_check");
    expect(result.status).toBe(0);
  });
});
