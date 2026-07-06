// Prove @hasna/billing satisfies the Hasna Service Contract v1: the vendored
// storage-kit matches the generator (vendor-kit --check) AND the 6 repo
// conformance checks pass. Uses @hasna/contracts (dev-dependency) — the runtime
// never imports it (no_cloud_guard, §4.2).
import { checkKit } from "@hasna/contracts/vendor-kit";
import { runRepoConformance } from "@hasna/contracts/conformance";

const root = process.cwd();

// 1. Vendored storage-kit is byte-identical to the pinned generator output.
const kit = checkKit({ targetRepo: root });
console.log(`${kit.ok ? "ok" : "fail"} vendor-kit --check (kitVersion ${kit.version}${kit.staleVersion ? `, on-disk ${kit.staleVersion}` : ""})`);
for (const f of kit.files) {
  if (f.status !== "ok") console.log(`  ${f.status}\t${f.file}`);
}
if (kit.extras.length > 0) console.log(`  extras: ${kit.extras.join(", ")}`);

// 2. Repo conformance (manifest_valid, bins_allowlisted, bins_match_package,
//    mode_enum_compliance, health_shape, no_cloud_guard).
const report = runRepoConformance(root);
console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) {
  console.log(`  ${check.status}\t${check.id}: ${check.detail}`);
}

if (!kit.ok || !report.ok) process.exit(1);
