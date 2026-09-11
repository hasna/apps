/**
 * Build every hosted member (tooling/fleet/hosted-apps.json `source: monorepo`
 * ∪ manifest-declared hosted members) sequentially, for the `client-gates`
 * CI job. The client gates read BUILT `<name>` / `<name>-mcp` bins; the
 * standard `prepare:ordered` chain builds only the members with install-time
 * ordering constraints, so the rest must be built here first.
 *
 * Sequential on purpose: ci.yml documents that the 8-14 GB member builds must
 * never run in parallel inside one runner. Measured 2026-09-11 on the pinned
 * toolchain: 3-6 s per hosted member, ~2 min for all 23.
 *
 * Usage: bun tooling/ci/build-hosted-members.ts [--list]
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { APPS_DIR, REPO_ROOT } from "./tests/standard/census";
import { hostedMembersIn } from "./tests/standard/hosted";

const members = hostedMembersIn(APPS_DIR);
if (process.argv.includes("--list")) {
  console.log(members.join("\n"));
  process.exit(0);
}
let failed = 0;
for (const member of members) {
  const started = Date.now();
  const res = spawnSync("bun", ["run", "--filter", `@hasna/${member}`, "build"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log(`built @hasna/${member} (${seconds}s)`);
  } else {
    failed++;
    console.error(`BUILD FAILED @hasna/${member} (${seconds}s):\n${String(res.stderr).split("\n").slice(-30).join("\n")}\n${String(res.stdout).split("\n").slice(-20).join("\n")}`);
  }
}
console.log(`build-hosted-members: ${members.length - failed}/${members.length} hosted members built (${path.relative(REPO_ROOT, APPS_DIR)})`);
process.exit(failed > 0 ? 1 : 0);
