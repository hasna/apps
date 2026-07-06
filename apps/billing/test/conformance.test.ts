import { describe, expect, it } from "bun:test";
import { checkKit } from "@hasna/contracts/vendor-kit";
import { runRepoConformance } from "@hasna/contracts/conformance";
import { buildApp } from "../src/server/app.js";

/**
 * Wraps scripts/conformance.ts assertions: the vendored storage-kit is
 * byte-identical to the pinned generator, and all 6 repo-conformance checks
 * pass (BUILD-SPEC §4.5). Runs with a clean env so mode_enum_compliance sees
 * the default local mode.
 */
describe("contract conformance", () => {
  it("vendored storage-kit matches the generator (vendor-kit --check)", () => {
    const kit = checkKit({ targetRepo: process.cwd() });
    const modified = kit.files.filter((f) => f.status !== "ok");
    expect({ modified, extras: kit.extras }).toEqual({ modified: [], extras: [] });
    expect(kit.ok).toBe(true);
  });

  it("passes all 6 repo-conformance checks", () => {
    const prevMode = process.env["HASNA_BILLING_STORAGE_MODE"];
    delete process.env["HASNA_BILLING_STORAGE_MODE"];
    try {
      const report = runRepoConformance(process.cwd(), { env: {} });
      const failed = report.checks.filter((c) => c.status === "fail");
      expect(failed).toEqual([]);
      expect(report.ok).toBe(true);
      const ids = report.checks.map((c) => c.id);
      for (const id of ["manifest_valid", "bins_allowlisted", "bins_match_package", "mode_enum_compliance", "health_shape", "no_cloud_guard"]) {
        expect(ids).toContain(id);
      }
    } finally {
      if (prevMode !== undefined) process.env["HASNA_BILLING_STORAGE_MODE"] = prevMode;
    }
  });

  // The repo-conformance health_shape check only inspects the serve bin statically
  // (reported as "skip" without a live sample). Exercise the actual /health
  // response so the mandated { status, version, mode } shape is proven, not just
  // inspected (BUILD-SPEC §4.5 / §6.2, DoD §9).
  it("serves the mandated /health shape { status, version, mode } (live)", async () => {
    const res = await buildApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["mode", "status", "version"]);
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(["local", "cloud"]).toContain(body.mode);
  });
});
