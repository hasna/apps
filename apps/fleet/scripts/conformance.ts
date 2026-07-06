#!/usr/bin/env bun
// Repo conformance gate for the Hasna Service Contract v1.
//
// Runs the 6 canonical checks (manifest_valid, bins_allowlisted, bins_match_package,
// mode_enum_compliance, health_shape, no_cloud_guard) via @hasna/contracts
// runRepoConformance, AND verifies the vendored storage-kit is byte-for-byte intact
// (the offline equivalent of `contracts vendor-kit --check`).
//
// @hasna/contracts is a devDependency; this is a build-time script, never runtime
// code, so importing it here does not violate no_cloud_guard.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as contracts from "@hasna/contracts";
import { health } from "../src/server/health.js";

interface ConformanceCheck {
  id: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

const runRepoConformance = (
  contracts as unknown as {
    runRepoConformance?: (
      root: string,
      options?: { healthSample?: unknown },
    ) => { ok: boolean; name: string | null; class: string | null; checks: ConformanceCheck[] };
  }
).runRepoConformance;

if (typeof runRepoConformance !== "function") {
  console.error(
    "This @hasna/contracts build has no runRepoConformance. Install @hasna/contracts >= 0.4.0 (Service Contract v1 kit).",
  );
  process.exit(1);
}

const root = process.cwd();

// --- vendor-kit --check: verify vendored storage-kit sha256 integrity ---
function verifyVendoredKit(): ConformanceCheck {
  const manifestPath = join(root, "src/generated/storage-kit/.storage-kit-manifest.json");
  if (!existsSync(manifestPath)) {
    return { id: "vendor_kit_check", status: "fail", detail: "vendored storage-kit manifest missing (run vendor-kit)" };
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files?: Record<string, string> | { path: string; sha256: string }[];
    };
    const entries: { path: string; sha256: string }[] = Array.isArray(manifest.files)
      ? manifest.files
      : Object.entries(manifest.files ?? {}).map(([path, sha256]) => ({ path, sha256: String(sha256) }));
    if (entries.length === 0) {
      return { id: "vendor_kit_check", status: "fail", detail: "storage-kit manifest lists no files" };
    }
    const drift: string[] = [];
    for (const { path, sha256 } of entries) {
      const filePath = join(root, "src/generated/storage-kit", path);
      if (!existsSync(filePath)) {
        drift.push(`${path} missing`);
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      const expected = sha256.replace(/^sha256:/, "");
      if (actual !== expected) drift.push(`${path} sha256 mismatch`);
    }
    return drift.length > 0
      ? { id: "vendor_kit_check", status: "fail", detail: `storage-kit drift: ${drift.join(", ")}` }
      : { id: "vendor_kit_check", status: "pass", detail: `vendored storage-kit intact (${entries.length} files)` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "vendor_kit_check", status: "fail", detail: `storage-kit manifest unreadable: ${message}` };
  }
}

const report = runRepoConformance(root, { healthSample: health() });
const kitCheck = verifyVendoredKit();
const checks = [...report.checks, kitCheck];

console.log(`${report.ok && kitCheck.status !== "fail" ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of checks) {
  console.log(`  ${check.status}\t${check.id}: ${check.detail}`);
}

if (!report.ok || kitCheck.status === "fail") process.exit(1);
