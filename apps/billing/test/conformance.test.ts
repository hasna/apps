import { describe, expect, it } from "bun:test";
import { checkKit } from "@hasna/contracts/vendor-kit";
import { runRepoConformance } from "@hasna/contracts/conformance";
import { buildApp } from "../src/server/app.js";
import { health } from "../src/server/health.js";

/**
 * Wraps scripts/conformance.ts assertions: the vendored storage-kit is
 * byte-identical to the pinned generator, and the current repo-conformance
 * checks pass with the default SQLite backend.
 */
describe("contract conformance", () => {
  it("vendored storage-kit matches the generator (vendor-kit --check)", () => {
    const kit = checkKit({ targetRepo: process.cwd() });
    const modified = kit.files.filter((f) => f.status !== "ok");
    expect({ modified, extras: kit.extras }).toEqual({ modified: [], extras: [] });
    expect(kit.ok).toBe(true);
  });

  it("passes current repo-conformance checks", () => {
    const report = runRepoConformance(process.cwd(), { env: {}, healthSample: health() });
    const failed = report.checks.filter((check) => check.status === "fail");
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
    const ids = report.checks.map((check) => check.id);
    for (const id of [
      "manifest_valid",
      "bins_allowlisted",
      "bins_match_package",
      "storage_capabilities",
      "public_manifest_safety",
      "hosting_story",
      "server_backend_configuration",
      "health_shape",
      "no_cloud_guard",
    ]) {
      expect(ids).toContain(id);
    }
  });

  // The repo-conformance health_shape check only inspects the serve bin statically
  // (reported as "skip" without a live sample). Exercise the actual /health
  // response so the mandated { status, version, backend } shape is proven, not just
  // inspected (BUILD-SPEC §4.5 / §6.2, DoD §9).
  it("serves the mandated /health shape { status, version, backend } (live)", async () => {
    const res = await buildApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["backend", "status", "version"]);
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(["sqlite", "postgresql"]).toContain(body.backend);
  });

  it("serves the OpenAPI document declared by the API and SDK surfaces", async () => {
    const response = await buildApp().request("/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as Record<string, unknown>;
    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toBeDefined();
    expect(document.paths).toBeDefined();
  });
});
