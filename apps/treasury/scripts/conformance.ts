// Repo self-conformance for the Hasna Service Contract v1. Delegates to the
// @hasna/contracts kit (dev-dependency): vendor-kit --check + repo-conformance.
// The package.json `conformance` script runs the CLI directly; this script is a
// programmatic fallback that mirrors the same checks.
import * as contracts from "@hasna/contracts";

const runRepoConformance = (
  contracts as {
    runRepoConformance?: (root: string) => {
      ok: boolean;
      name: string | null;
      class: string | null;
      checks: { id: string; status: string; detail: string }[];
    };
  }
).runRepoConformance;

if (typeof runRepoConformance !== "function") {
  console.error("This @hasna/contracts build has no runRepoConformance (need >= 0.4.0).");
  process.exit(1);
}

const report = runRepoConformance(process.cwd());
console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"})`);
for (const check of report.checks) {
  console.log(`  ${check.status}\t${check.id}: ${check.detail}`);
}
if (!report.ok) process.exit(1);
