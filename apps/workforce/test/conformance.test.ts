import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Wraps scripts/conformance.ts: the six repo-conformance checks
// (manifest_valid, bins_allowlisted, bins_match_package, mode_enum_compliance,
// health_shape, no_cloud_guard).
//
// The vendored storage-kit check is NOT part of the script while the installed
// @hasna/contracts is mode-era (its generator still emits mode.ts, which this
// repo's kit has been purged of). The purged kit state is pinned below exactly
// — mode.ts missing, pool/index/README modified against the mode-era render, no
// extras, no stale version. When the contracts lane ships the mode-free
// generator and workforce re-pins, this assertion fails loudly in BOTH
// directions and must be updated to the all-pass shape.
describe("repo conformance", () => {
  it("passes repo-conformance and pins the purged storage-kit state", () => {
    const repoRoot = resolve(import.meta.dir, "..");
    const result = spawnSync("bun", ["run", "scripts/conformance.ts"], { cwd: repoRoot, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`conformance failed:\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain("ok conformance");
  }, 60000);

  it("hits exactly the transitional purged-kit gate", async () => {
    const contracts = (await import("@hasna/contracts")) as {
      checkKit?: (opts: { targetRepo: string }) => {
        ok: boolean;
        version: string;
        files: { file: string; status: string }[];
        extras: string[];
        staleVersion: string | null;
      };
    };
    expect(typeof contracts.checkKit).toBe("function");
    const kit = contracts.checkKit!({ targetRepo: process.cwd() });
    // Transitional gate (modes-removal lane): the installed mode-era generator
    // still emits mode.ts, so the purged kit reports exactly mode.ts missing and
    // the three edited files modified — no extras (mode.ts must NOT come back),
    // no stale version (manifest kitVersion 0.4.1 matches the pinned dep).
    expect(kit.files.find((f) => f.file === "mode.ts")?.status).toBe("missing");
    for (const file of ["pool.ts", "index.ts", "README.md"]) {
      expect(kit.files.find((f) => f.file === file)?.status).toBe("modified");
    }
    expect(kit.extras).toEqual([]);
    expect(kit.staleVersion).toBeNull();
  }, 60000);
});
