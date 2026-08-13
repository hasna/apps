#!/usr/bin/env bun
// Repo conformance gate for the Hasna Service Contract v1.
// Runs runRepoConformance(cwd) from @hasna/contracts (>= 0.4.0) and exits 1 on fail.
import * as contracts from "@hasna/contracts";

const run = (contracts as unknown as {
  runRepoConformance?: (cwd: string) => { ok: boolean; checks: { id: string; status: string; detail: string }[] };
}).runRepoConformance;

if (typeof run !== "function") {
  console.error("Install @hasna/contracts >= 0.4.0 (runRepoConformance not found)");
  process.exit(1);
}

const r = run(process.cwd());
for (const c of r.checks) console.log(`  ${c.status}\t${c.id}: ${c.detail}`);
console.log(r.ok ? "ok" : "fail");
if (!r.ok) process.exit(1);
