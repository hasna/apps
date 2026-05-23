import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  RELEASE_CHECK_SCHEMA,
  auditPackageContents,
  validateReleaseScripts,
  runReleaseChecks,
  formatReleaseCheckReport,
  getReleaseWorkflowDocs,
} from "./release-checks.js";

const ROOT = join(import.meta.dir, "..", "..");

describe("release checks", () => {
  it("audits current package contents", () => {
    const checks = auditPackageContents(ROOT);
    expect(checks.some((c) => c.id.startsWith("bin_"))).toBe(true);
    expect(checks.some((c) => c.id === "files_dist" || c.message.includes("dist"))).toBe(true);
  });

  it("validates release scripts", () => {
    const checks = validateReleaseScripts(ROOT);
    expect(checks.some((c) => c.id === "prepublish_ok" || c.id === "prepublish_build")).toBe(true);
  });

  it("runs full report with schema version", () => {
    const report = runReleaseChecks({ root_dir: ROOT, skip_dist_scan: true });
    expect(report.schema_version).toBe(RELEASE_CHECK_SCHEMA);
    expect(report.package_name).toBe("@hasna/todos");
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it("formats report text", () => {
    const report = runReleaseChecks({ root_dir: ROOT, skip_dist_scan: true });
    const text = formatReleaseCheckReport(report);
    expect(text).toContain("@hasna/todos release check");
  });

  it("documents publish workflow without hosted-only deps", () => {
    const docs = getReleaseWorkflowDocs();
    expect(docs).toContain("bun install -g @hasna/todos");
    expect(docs).not.toMatch(/platform-todos|stripe/i);
  });
});
