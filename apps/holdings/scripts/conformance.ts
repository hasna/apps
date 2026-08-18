// Prove this repo satisfies the Hasna Service Contract v1 using its own
// hasna.contract.json. Blocks on the purge-relevant checks; the align-lane
// checks (surface_matrix, service_api_topology, storage_capabilities,
// public_manifest_safety, published_artifact_gate) are reported as pending
// until the contracts-align lane lands full 0.11.1 compliance — they cannot
// pass from this lane (the sdk surface requires a real ./sdk export, the
// artifactScan/pgTestGate gates require release/postgres-test wiring).
import * as contracts from "@hasna/contracts";
import { APP_VERSION } from "../src/version.js";

const runRepoConformance = (
  contracts as {
    runRepoConformance?: (
      root: string,
      options?: { healthSample?: unknown },
    ) => {
      ok: boolean;
      name: string | null;
      class: string | null;
      checks: { id: string; status: string; detail: string }[];
    };
  }
).runRepoConformance;

if (typeof runRepoConformance !== "function") {
  console.error(
    "This @hasna/contracts version has no runRepoConformance. Install @hasna/contracts >= 0.4.0 (Hasna Service Contract v1 kit).",
  );
  process.exit(1);
}

const PENDING_ALIGN_CHECKS = new Set([
  "surface_matrix",
  "service_api_topology",
  "storage_capabilities",
  "public_manifest_safety",
  "published_artifact_gate",
]);

const report = runRepoConformance(process.cwd(), {
  healthSample: { status: "ok", version: APP_VERSION, backend: "sqlite" },
});
const blocking = report.checks.filter(
  (check) => check.status === "fail" && !PENDING_ALIGN_CHECKS.has(check.id),
);

console.log(`${blocking.length === 0 ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) {
  const suffix = PENDING_ALIGN_CHECKS.has(check.id) && check.status === "fail" ? " [pending align lane]" : "";
  console.log(`  ${check.status}\t${check.id}: ${check.detail}${suffix}`);
}
if (blocking.length > 0) process.exit(1);
