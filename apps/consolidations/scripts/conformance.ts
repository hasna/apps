// Repo conformance gate for the Hasna Service Contract v1.
//
// Two gates, both driven by @hasna/contracts PINNED to EXACTLY 0.14.0 (registry
// devDependency "0.14.0", no caret) so a concurrent publish of 0.14.1 cannot
// re-break this app:
//   1. vendor-kit --check : the vendored src/generated/storage-kit/* still
//      matches the canonical generator output (sha256 per file) — no drift.
//   2. runRepoConformance : the 6 contract checks (manifest_valid,
//      bins_allowlisted, bins_match_package, mode_enum_compliance,
//      health_shape, no_cloud_guard).
//
// The package `exports` map exposes "." and "./sdk" (the SDK barrel build);
// internal modules are loaded by direct file path from the installed dist dir.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// --- Gate 0: the installed contracts kit is EXACTLY the pinned version.
const PINNED_CONTRACTS_VERSION = "0.14.0";
const contractsPkgPath = join(process.cwd(), "node_modules", "@hasna", "contracts", "package.json");
const installedContractsVersion = JSON.parse(readFileSync(contractsPkgPath, "utf8")).version as string;
if (installedContractsVersion !== PINNED_CONTRACTS_VERSION) {
  console.error(
    `fail contracts pin: expected @hasna/contracts@${PINNED_CONTRACTS_VERSION}, found ${installedContractsVersion}`,
  );
  process.exit(1);
}
console.log(`ok contracts pin @hasna/contracts@${installedContractsVersion} (exact)`);

const dist = join(process.cwd(), "node_modules", "@hasna", "contracts", "dist");
const toUrl = (rel: string) => pathToFileURL(join(dist, rel)).href;

// --- Gate 1: vendored kit is unmodified & current.
const { checkKit } = (await import(toUrl("kit/generate.js"))) as {
  checkKit: (opts: { targetRepo: string }) => {
    ok: boolean;
    version: string;
    files: { file: string; status: string }[];
    extras: string[];
    staleVersion: string | null;
  };
};
const kit = checkKit({ targetRepo: process.cwd() });
console.log(`${kit.ok ? "ok" : "fail"} storage-kit check (expected v${kit.version})`);
for (const f of kit.files) if (f.status !== "ok") console.log(`  ${f.status} ${f.file}`);
for (const extra of kit.extras) console.log(`  unexpected ${extra}`);

// --- Gate 2: repo conformance (6 checks).
const contracts = (await import(toUrl("index.js"))) as {
  runRepoConformance?: (cwd: string) => {
    ok: boolean;
    name: string | null;
    class: string | null;
    checks: { id: string; status: string; detail: string }[];
  };
};
if (typeof contracts.runRepoConformance !== "function") {
  console.error("Install @hasna/contracts >= 0.4.0 (runRepoConformance not found)");
  process.exit(1);
}
const report = contracts.runRepoConformance(process.cwd());
console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) console.log(`  ${check.status}\t${check.id}: ${check.detail}`);

if (!kit.ok || !report.ok) process.exit(1);
