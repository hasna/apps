// Prove this repo satisfies the Hasna Service Contract v1 using its own
// hasna.contract.json (§4.5: manifest_valid, bins_allowlisted, bins_match_package,
// mode_enum_compliance, health_shape, no_cloud_guard). Requires @hasna/contracts
// >= 0.4.0 as a devDependency (the Service Contract v1 conformance kit).
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

const report = runRepoConformance(process.cwd(), {
  healthSample: { status: "ok", version: APP_VERSION, mode: "local" },
});
console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) {
  console.log(`  ${check.status}\t${check.id}: ${check.detail}`);
}
if (!report.ok) process.exit(1);
