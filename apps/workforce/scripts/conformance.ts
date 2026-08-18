#!/usr/bin/env bun
// Conformance gate for the Hasna Service Contract v1.
//
// Runs the six repo-conformance checks (manifest_valid, bins_allowlisted,
// bins_match_package, mode_enum_compliance, health_shape, no_cloud_guard) from
// @hasna/contracts. @hasna/contracts is a dev-dependency only; runtime code
// never imports it.
//
// NOTE (modes-removal lane): the vendored storage-kit integrity check is NOT
// run here while the installed @hasna/contracts is mode-era — its generator
// still emits `mode.ts`, which this repo's kit has been purged of (RETIRED_KIT_FILES
// in the current generator; transitional requirement, recorded on the
// modes-removal task). The purged kit state is pinned by the sha256 manifest
// and asserted exactly in test/conformance.test.ts. When the contracts lane
// ships the mode-free generator and workforce re-pins, restore the
// `vendor-kit --check` half and flip the test to the all-pass shape.
import * as contracts from "@hasna/contracts";

type RunRepoConformance = (root: string) => {
  ok: boolean;
  name: string | null;
  class: string | null;
  checks: { id: string; status: string; detail: string }[];
};

const runRepoConformance = (contracts as unknown as { runRepoConformance?: RunRepoConformance }).runRepoConformance;

if (typeof runRepoConformance !== "function") {
  console.error("Install @hasna/contracts >= 0.4.0 (runRepoConformance not found).");
  process.exit(1);
}

const report = runRepoConformance(process.cwd());
console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) console.log(`  ${check.status}\t${check.id}: ${check.detail}`);
if (!report.ok) process.exit(1);
console.log("ok conformance");
