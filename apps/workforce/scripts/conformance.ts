#!/usr/bin/env bun
// Conformance gate for the Hasna Service Contract v1.
//
// Runs the vendored storage-kit integrity check (vendor-kit --check) AND the six
// repo-conformance checks (manifest_valid, bins_allowlisted, bins_match_package,
// mode_enum_compliance, health_shape, no_cloud_guard) from @hasna/contracts.
// @hasna/contracts is a dev-dependency only; runtime code never imports it.
import * as contracts from "@hasna/contracts";

type CheckKit = (opts: { targetRepo: string }) => {
  ok: boolean;
  version: string;
  files: { file: string; status: string }[];
  extras: string[];
  staleVersion: string | null;
};
type RunRepoConformance = (root: string) => {
  ok: boolean;
  name: string | null;
  class: string | null;
  checks: { id: string; status: string; detail: string }[];
};

const checkKit = (contracts as unknown as { checkKit?: CheckKit }).checkKit;
const runRepoConformance = (contracts as unknown as { runRepoConformance?: RunRepoConformance }).runRepoConformance;

if (typeof checkKit !== "function" || typeof runRepoConformance !== "function") {
  console.error("Install @hasna/contracts >= 0.4.0 (checkKit / runRepoConformance not found).");
  process.exit(1);
}

let failed = false;

const kit = checkKit({ targetRepo: process.cwd() });
console.log(`${kit.ok ? "ok" : "fail"} vendored storage-kit (expected v${kit.version})`);
for (const file of kit.files) if (file.status !== "ok") console.log(`  ${file.status}\t${file.file}`);
for (const extra of kit.extras) console.log(`  unexpected\t${extra}`);
if (kit.staleVersion) console.log(`  stale: on-disk kit is v${kit.staleVersion}`);
if (!kit.ok) failed = true;

const report = runRepoConformance(process.cwd());
console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) console.log(`  ${check.status}\t${check.id}: ${check.detail}`);
if (!report.ok) failed = true;

if (failed) process.exit(1);
console.log("ok conformance");
