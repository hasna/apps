import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

describe("repo conformance", () => {
  it("passes vendor-kit --check + the 6 contract checks", () => {
    const result = spawnSync("bun", ["run", "scripts/conformance.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok storage-kit check");
    expect(result.stdout).toContain("ok hasna.service_contract.v1 consolidations");
    expect(result.stdout).toContain("pass\tno_cloud_guard");
  });
});
